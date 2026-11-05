// The single write queue (plan-webui §5.2): one request at a time, in order.
// The screen is updated before a write is sent; when one fails, every write
// still waiting is dropped and each screen that owned one reloads what the
// server really has.

export interface QueueOwner {
  /** Its own write failed: tell the user, then reload. */
  failed(e: unknown): void;
  /** Its writes were dropped after another owner's failure: reload. */
  dropped(): void;
}

type Job = { run: () => Promise<void>; owner: QueueOwner };

class WriteQueue {
  pending = $state(0);
  #jobs: Job[] = [];
  #running = false;
  #failedInRun = false;
  #idle: ((ok: boolean) => void)[] = [];

  push(run: () => Promise<void>, owner: QueueOwner) {
    this.#jobs.push({ run, owner });
    this.pending = this.#jobs.length + (this.#running ? 1 : 0);
    void this.#drain();
  }

  /** Resolves once every queued write is done: true if none failed or was dropped. */
  idle(): Promise<boolean> {
    if (!this.#running && this.#jobs.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    this.#failedInRun = false;
    while (this.#jobs.length) {
      const job = this.#jobs.shift()!;
      this.pending = this.#jobs.length + 1;
      try {
        await job.run();
      } catch (e) {
        this.#failedInRun = true;
        const others = new Set(this.#jobs.map((j) => j.owner));
        others.delete(job.owner);
        this.#jobs = [];
        job.owner.failed(e);
        for (const o of others) o.dropped();
      }
    }
    this.#running = false;
    this.pending = 0;
    const ok = !this.#failedInRun;
    for (const resolve of this.#idle.splice(0)) resolve(ok);
  }
}

export const writes = new WriteQueue();

addEventListener('beforeunload', (e) => {
  if (writes.pending > 0) e.preventDefault();
});
