// fetch wrapper: JSON in and out, the API's French error messages, a 15 s
// limit, and any 401 sends the user back to the sign-in screen.

import { filenameFrom } from './logic/filename.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

const TIMEOUT_MS = 15_000;
/** Exports build a whole month for a company: give them longer. */
const EXPORT_TIMEOUT_MS = 120_000;

async function send(path: string, method: string, body: unknown, timeout = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw transport(e);
  }
}

/** A network failure or a timeout (also while reading the body) in French. */
function transport(e: unknown): ApiError {
  const timeout = e instanceof DOMException && e.name === 'TimeoutError';
  return new ApiError(0, timeout ? 'Le serveur ne répond pas. Réessayez.' : 'Connexion au serveur impossible.');
}

/** Reads a body inside the same error handling as the request itself. */
async function read<T>(res: Response, how: (r: Response) => Promise<T>): Promise<T> {
  try {
    return await how(res);
  } catch (e) {
    if (e instanceof SyntaxError) throw new ApiError(res.status, 'Réponse du serveur illisible.');
    throw transport(e);
  }
}

async function fail(res: Response, path: string): Promise<never> {
  let message = `Erreur ${res.status}`;
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') message = data.error;
  } catch {
    /* not JSON */
  }
  // A wrong password on the sign-in form is a 401 too: not a lost session.
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  throw new ApiError(res.status, message);
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await send(path, method, body);
  if (!res.ok) return fail(res, path);
  return read(res, (r) => r.json() as Promise<T>);
}

/** Downloads an export: the blob route keeps the API's error message. */
export async function download(path: string, fallback: string): Promise<void> {
  const res = await send(path, 'GET', undefined, EXPORT_TIMEOUT_MS);
  if (!res.ok) return fail(res, path);
  const blob = await read(res, (r) => r.blob());
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFrom(res.headers.get('content-disposition'), fallback);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inattendue.';
}
