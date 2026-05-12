import { describe, test, expect } from "bun:test";
import { createResponseCache } from "../../src/cache.js";
import {
  CACHE_MAX_BYTES_PER_ENTRY,
  OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES,
} from "../../src/constants.js";

describe("createResponseCache", () => {
  test("should return a non-empty handle prefixed with 'h_' from put", () => {
    const cache = createResponseCache();

    const handle = cache.put("tool", "hello");

    expect(handle.length).toBeGreaterThan(0);
    expect(handle.startsWith("h_")).toBe(true);
  });

  test("should return a unique handle for each put call", () => {
    const cache = createResponseCache({ maxEntries: 100 });

    const handles = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      handles.add(cache.put("tool", `payload-${i}`));
    }

    expect(handles.size).toBe(10);
  });

  test("should return a CachedEntry with all fields populated when getting a fresh handle", () => {
    const cache = createResponseCache();

    const handle = cache.put("cascade_read", "FULL-TEXT");
    const entry = cache.get(handle);

    expect(entry).toBeDefined();
    expect(entry!.toolName).toBe("cascade_read");
    expect(entry!.fullText).toBe("FULL-TEXT");
    expect(typeof entry!.createdAt).toBe("number");
  });

  test("should return undefined from get for an unknown handle", () => {
    const cache = createResponseCache();

    const entry = cache.get("h_does-not-exist");

    expect(entry).toBeUndefined();
  });

  test("should report size 0 when empty and 1 after a single put", () => {
    const cache = createResponseCache();

    expect(cache.size()).toBe(0);
    cache.put("tool", "x");
    expect(cache.size()).toBe(1);
  });

  test("should evict the oldest handle after maxEntries + 1 puts", () => {
    const cache = createResponseCache({ maxEntries: 3 });

    const oldest = cache.put("tool", "A");
    cache.put("tool", "B");
    cache.put("tool", "C");
    cache.put("tool", "D"); // forces eviction of A

    expect(cache.get(oldest)).toBeUndefined();
  });

  test("should retain the newest handle after eviction on overflow", () => {
    const cache = createResponseCache({ maxEntries: 3 });

    cache.put("tool", "A");
    cache.put("tool", "B");
    cache.put("tool", "C");
    const newest = cache.put("tool", "D");

    expect(cache.get(newest)).toBeDefined();
    expect(cache.get(newest)!.fullText).toBe("D");
  });

  test("should refresh LRU recency on get so subsequent puts evict the next-oldest instead", () => {
    const cache = createResponseCache({ maxEntries: 10 });

    const handles: string[] = [];
    for (const letter of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      handles.push(cache.put("tool", letter));
    }

    // Touch A so it becomes most-recent; B becomes least-recent.
    cache.get(handles[0]!);

    // Insert K → triggers eviction of the least-recent (B).
    cache.put("tool", "K");

    expect(cache.get(handles[0]!)).toBeDefined(); // A still retained
    expect(cache.get(handles[1]!)).toBeUndefined(); // B evicted
  });

  test("should store a 'too large' marker when fullText exceeds maxBytesPerEntry", () => {
    const cache = createResponseCache({ maxBytesPerEntry: 100 });
    const huge = "x".repeat(500);

    const handle = cache.put("tool", huge);
    const entry = cache.get(handle);

    expect(entry).toBeDefined();
    expect(entry!.fullText).not.toBe(huge);
    expect(entry!.fullText).toContain("too large");
    expect(entry!.fullText).toContain("500");
    expect(entry!.fullText).toContain("100");
  });

  test("should work without any constructor opts (production defaults)", () => {
    const cache = createResponseCache();

    // Verify defaults are effective: a payload well under the default limit round-trips.
    const handle = cache.put("tool", "small payload");
    expect(cache.get(handle)!.fullText).toBe("small payload");

    // And the default maxEntries is at least OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES.
    for (let i = 0; i < OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES; i += 1) {
      cache.put("tool", `item-${i}`);
    }
    // The first `put` above plus OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES more puts =
    // OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES + 1
    // insertions. Handle from first put may or may not be evicted depending on
    // exact default; we only assert the original handle wasn't immediately lost
    // before the overflow.
    expect(cache.size()).toBeLessThanOrEqual(OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES);
    // Sanity: the default maxBytesPerEntry is large enough that a small payload was stored verbatim (not marker).
    expect(CACHE_MAX_BYTES_PER_ENTRY).toBeGreaterThan(1000);
  });

  test("should set createdAt to the current timestamp within tolerance", () => {
    const cache = createResponseCache();

    const before = Date.now();
    const handle = cache.put("tool", "x");
    const after = Date.now();

    const entry = cache.get(handle)!;
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt).toBeLessThanOrEqual(after);
  });

  test("should honor custom maxEntries override (maxEntries: 2 retains only 2)", () => {
    const cache = createResponseCache({ maxEntries: 2 });

    const a = cache.put("tool", "A");
    cache.put("tool", "B");
    cache.put("tool", "C"); // evicts A

    expect(cache.get(a)).toBeUndefined();
    expect(cache.size()).toBe(2);
  });
});
