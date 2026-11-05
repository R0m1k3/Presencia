// The app's write queue: the core (logic/queue.ts) with a reactive count of
// pending writes, and a warning before leaving with writes not sent.

import { WriteQueueCore } from './logic/queue.ts';

export type { QueueOwner } from './logic/queue.ts';

let pending = $state(0);

export const writes = new WriteQueueCore((n) => (pending = n));
export const pendingWrites = () => pending;

addEventListener('beforeunload', (e) => {
  if (pending > 0) e.preventDefault();
});
