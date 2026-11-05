// The single write queue (plan-webui §5.2): one request at a time, in order.
// The screen is updated before a write is sent; when one fails, every write
// still waiting is dropped and the owner reloads what the server really has.

type Job = { run: () => Promise<void>; onFail: (e: unknown) => void; generation: number };

class WriteQueue {
  pending = $state(0);
  #jobs: Job[] = [];
  #running = false;
  #generation = 0;
  #idle: (() => void)[] = [];

  push(run: () => Promise<void>, onFail: (e: unknown) => void) {
    this.#jobs.push({ run, onFail, generation: this.#generation });
    this.pending = this.#jobs.length + (this.#running ? 1 : 0);
    void this.#drain();
  }

  /** Resolves once every queued write is done (or dropped). */
  idle(): Promise<void> {
    if (!this.#running && this.#jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    while (this.#jobs.length) {
      const job = this.#jobs.shift()!;
      this.pending = this.#jobs.length + 1;
      if (job.generation !== this.#generation) continue;
      try {
        await job.run();
      } catch (e) {
        this.#generation++;
        this.#jobs = [];
        job.onFail(e);
      }
    }
    this.#running = false;
    this.pending = 0;
    for (const resolve of this.#idle.splice(0)) resolve();
  }
}

export const writes = new WriteQueue();

addEventListener('beforeunload', (e) => {
  if (writes.pending > 0) e.preventDefault();
});
