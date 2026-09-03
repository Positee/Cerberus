/**
 * Starts keyed background jobs while preventing duplicate work for the same key.
 * A slow job never delays dispatching a different key.
 */
export class InFlightJobs<Key> {
  private readonly active = new Set<Key>();

  keys(): Key[] {
    return [...this.active];
  }

  has(key: Key): boolean {
    return this.active.has(key);
  }

  start(key: Key, job: () => Promise<void>, onError: (error: unknown) => void): boolean {
    if (this.active.has(key)) return false;

    this.active.add(key);
    void Promise.resolve()
      .then(job)
      .catch(onError)
      .finally(() => this.active.delete(key));

    return true;
  }
}

/** Limits concurrent work without holding a slot while callers do other work. */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Concurrency limit must be a positive integer.');
    }
  }

  async run<Result>(job: () => Promise<Result>): Promise<Result> {
    await this.acquire();
    try {
      return await job();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }

    this.active -= 1;
  }
}
