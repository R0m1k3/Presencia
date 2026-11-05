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
  /** Failed writes since the page loaded. */
  #failures = 0;
  #idle: (() => void)[] = [];

  push(run: () => Promise<void>, owner: QueueOwner) {
    this.#jobs.push({ run, owner });
    this.pending = this.#jobs.length + (this.#running ? 1 : 0);
    void this.#drain();
  }

  /** Resolves once every queued write is done (or dropped). */
  idle(): Promise<void> {
    if (!this.#running && this.#jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idle.push(resolve));
  }

  /** A mark to pass to settled() later. */
  mark(): number {
    return this.#failures;
  }

  /**
   * Waits for the queue, then tells whether every write since `mark` went
   * through. Take the mark before asking for a confirmation: a write that
   * fails while the dialog is open counts too.
   */
  async settled(mark: number): Promise<boolean> {
    await this.idle();
    return this.#failures === mark;
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    while (this.#jobs.length) {
      const job = this.#jobs.shift()!;
      this.pending = this.#jobs.length + 1;
      try {
        await job.run();
      } catch (e) {
        this.#failures++;
        const others = new Set(this.#jobs.map((j) => j.owner));
        others.delete(job.owner);
        this.#jobs = [];
        job.owner.failed(e);
        for (const o of others) o.dropped();
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
