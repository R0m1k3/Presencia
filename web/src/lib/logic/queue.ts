// Core of the single write queue (plan-webui §5.2), in plain TypeScript so
// that it can be unit-tested: one request at a time, in order; when one
// fails, every write still waiting is dropped and each owner is told.

export interface QueueOwner {
  /** Its own write failed: tell the user, then reload. */
  failed(e: unknown): void;
  /**
   * Its writes were dropped after another owner's failure: reload. Rare
   * (two planning screens with writes in the same queue), kept for safety.
   */
  dropped(): void;
}

type Job = { run: () => Promise<void>; owner: QueueOwner };

export class WriteQueueCore {
  #jobs: Job[] = [];
  #running = false;
  /** Failed writes since the page loaded. */
  #failures = 0;
  #idle: (() => void)[] = [];

  readonly onpending: (n: number) => void;

  /** `onpending` receives the number of writes queued or running. */
  constructor(onpending: (n: number) => void = () => {}) {
    this.onpending = onpending;
  }

  push(run: () => Promise<void>, owner: QueueOwner) {
    this.#jobs.push({ run, owner });
    this.onpending(this.#jobs.length + (this.#running ? 1 : 0));
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
      this.onpending(this.#jobs.length + 1);
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
    this.onpending(0);
    for (const resolve of this.#idle.splice(0)) resolve();
  }
}
