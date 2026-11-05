import type { Me } from './types.ts';

class Session {
  user = $state<Me | null>(null);
  /** False until GET /api/auth/me answered. */
  ready = $state(false);
  /** Where to go back after signing in. */
  wanted = $state<string | null>(null);
  get isAdmin() {
    return this.user?.role === 'admin';
  }
}

export const session = new Session();
