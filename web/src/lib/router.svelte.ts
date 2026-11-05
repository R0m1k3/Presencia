// Hash router: one address per screen (#/planning/2026-11), no server
// fallback needed, reload-safe.

function current(): string {
  let h = location.hash.replace(/^#/, '');
  try {
    h = decodeURI(h);
  } catch {
    return '/'; // a malformed escape: the dashboard rather than a blank page
  }
  return h.startsWith('/') ? h : '/';
}

class Router {
  path = $state(current());
}

export const router = new Router();

addEventListener('hashchange', () => {
  router.path = current();
});

export function go(path: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', `#${path}`);
    router.path = path;
  } else {
    location.hash = path;
  }
}

/** Segments of the current path: '/plannings/12/2026-11' → ['plannings', '12', '2026-11']. */
export function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}
