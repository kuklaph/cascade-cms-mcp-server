export const BROWSER_REQUEST_THROTTLE_MS = 3000;
export const BROWSER_REQUEST_MAX_QUEUED = 20;

export type BrowserRequestThrottleOptions = {
  intervalMs?: number;
  maxQueuedRequests?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class BrowserRequestThrottle {
  private readonly intervalMs: number;
  private readonly maxQueuedRequests: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextStartAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private queuedRequests = 0;

  constructor({
    intervalMs = BROWSER_REQUEST_THROTTLE_MS,
    maxQueuedRequests = BROWSER_REQUEST_MAX_QUEUED,
    now = Date.now,
    sleep = defaultSleep,
  }: BrowserRequestThrottleOptions = {}) {
    this.intervalMs = intervalMs;
    this.maxQueuedRequests = maxQueuedRequests;
    this.now = now;
    this.sleep = sleep;
  }

  async run<T>(startRequest: () => Promise<T>): Promise<T> {
    if (this.queuedRequests >= this.maxQueuedRequests) {
      throw new Error(
        "Too many browser requests are queued. Wait for current browser requests to start, then retry.",
      );
    }

    this.queuedRequests += 1;
    let releasedQueueSlot = false;
    const releaseQueueSlot = () => {
      if (releasedQueueSlot) return;
      releasedQueueSlot = true;
      this.queuedRequests -= 1;
    };

    const previous = this.queue;
    let release = () => {};
    this.queue = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await previous;

    let released = false;
    const releaseNext = () => {
      if (released) return;
      released = true;
      release();
    };

    try {
      const waitMs = Math.max(0, this.nextStartAt - this.now());
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
      const startedAt = this.now();
      this.nextStartAt = startedAt + this.intervalMs;
      const result = startRequest();
      releaseQueueSlot();
      releaseNext();
      return await result;
    } finally {
      releaseQueueSlot();
      releaseNext();
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
