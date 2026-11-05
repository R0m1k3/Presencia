// The app's write queue: the core (logic/queue.ts) with a reactive count of
// pending writes, and a warning before leaving with writes not sent.

import { WriteQueueCore } from './logic/queue.ts';

export type { QueueOwner } from './logic/queue.ts';

class Pending {
  n = $state(0);
}
const pending = new Pending();

export const writes = new WriteQueueCore((n) => (pending.n = n));
export const pendingWrites = () => pending.n;

addEventListener('beforeunload', (e) => {
  if (pending.n > 0) e.preventDefault();
});
