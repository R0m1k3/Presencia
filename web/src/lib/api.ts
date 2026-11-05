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

async function send(path: string, method: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === 'TimeoutError';
    throw new ApiError(0, timeout ? 'Le serveur ne répond pas. Réessayez.' : 'Connexion au serveur impossible.');
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
  return (await res.json()) as T;
}

/** Downloads an export: the blob route keeps the API's error message. */
export async function download(path: string, fallback: string): Promise<void> {
  const res = await send(path, 'GET', undefined);
  if (!res.ok) return fail(res, path);
  const blob = await res.blob();
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
