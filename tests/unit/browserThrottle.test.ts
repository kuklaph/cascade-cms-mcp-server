import { describe, expect, test } from "bun:test";
import {
  BROWSER_REQUEST_THROTTLE_MS,
  BrowserRequestThrottle,
} from "../../src/browser/throttle.js";

const fakeClock = () => {
  let current = 0;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
    get current() {
      return current;
    },
    sleeps,
  };
};

describe("BrowserRequestThrottle", () => {
  test("starts the first request immediately", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];

    await throttle.run(async () => {
      starts.push(clock.current);
      return true;
    });

    expect(starts).toEqual([0]);
    expect(clock.sleeps).toEqual([]);
  });

  test("spaces concurrent request starts by the browser interval", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];

    await Promise.all([
      throttle.run(async () => starts.push(clock.current)),
      throttle.run(async () => starts.push(clock.current)),
      throttle.run(async () => starts.push(clock.current)),
    ]);

    expect(starts).toEqual([
      0,
      BROWSER_REQUEST_THROTTLE_MS,
      BROWSER_REQUEST_THROTTLE_MS * 2,
    ]);
    expect(clock.sleeps).toEqual([
      BROWSER_REQUEST_THROTTLE_MS,
      BROWSER_REQUEST_THROTTLE_MS,
    ]);
  });

  test("does not add post-completion delay for long-running requests", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];
    let finishFirst: (() => void) | undefined;

    const first = throttle.run(
      () =>
        new Promise<void>((resolve) => {
          starts.push(clock.current);
          finishFirst = resolve;
        }),
    );
    const second = throttle.run(async () => {
      starts.push(clock.current);
    });

    await second;
    finishFirst?.();
    await first;

    expect(starts).toEqual([0, BROWSER_REQUEST_THROTTLE_MS]);
  });

  test("failed requests still reserve their start slot without poisoning the queue", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];

    await expect(
      throttle.run(async () => {
        starts.push(clock.current);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await throttle.run(async () => {
      starts.push(clock.current);
    });

    expect(starts).toEqual([0, BROWSER_REQUEST_THROTTLE_MS]);
  });

  test("does not wait once the interval has already elapsed", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];

    await throttle.run(async () => {
      starts.push(clock.current);
    });
    clock.advance(BROWSER_REQUEST_THROTTLE_MS + 1);
    await throttle.run(async () => {
      starts.push(clock.current);
    });

    expect(starts).toEqual([0, BROWSER_REQUEST_THROTTLE_MS + 1]);
    expect(clock.sleeps).toEqual([]);
  });

  test("rejects new requests when the queued start limit is reached", async () => {
    const clock = fakeClock();
    const throttle = new BrowserRequestThrottle({
      maxQueuedRequests: 2,
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts: number[] = [];

    const first = throttle.run(async () => {
      starts.push(clock.current);
    });
    const second = throttle.run(async () => {
      starts.push(clock.current);
    });

    await expect(
      throttle.run(async () => {
        starts.push(clock.current);
      }),
    ).rejects.toThrow("Too many browser requests are queued");
    await Promise.all([first, second]);

    expect(starts).toEqual([0, BROWSER_REQUEST_THROTTLE_MS]);
  });
});
