/**
 * In-memory LRU response cache for oversize Cascade MCP tool responses.
 *
 * When a tool's rendered text exceeds the MCP content limit, the full
 * rendered payload is stored here under a handle. The matching companion
 * tool (`cascade_read_response`) retrieves slices by handle.
 *
 * Design: closure over `Map<string, CachedEntry>` — insertion order is
 * LRU order. `get` refreshes recency by re-inserting the entry.
 */

import {
  CACHE_MAX_BYTES_PER_ENTRY,
  OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES,
} from "./constants.js";

export interface CachedEntry {
  toolName: string;
  format: "markdown" | "json";
  fullText: string;
  createdAt: number;
}

export interface ResponseCache {
  put(toolName: string, format: "markdown" | "json", fullText: string): string;
  get(handle: string): CachedEntry | undefined;
  size(): number;
}

export interface ResponseCacheOptions {
  maxEntries?: number;
  maxBytesPerEntry?: number;
}

export function createResponseCache(
  opts?: ResponseCacheOptions,
): ResponseCache {
  const maxEntries = opts?.maxEntries ?? OVERSIZE_RESPONSE_CACHE_MAX_ENTRIES;
  const maxBytesPerEntry = opts?.maxBytesPerEntry ?? CACHE_MAX_BYTES_PER_ENTRY;
  const store = new Map<string, CachedEntry>();

  function put(
    toolName: string,
    format: "markdown" | "json",
    fullText: string,
  ): string {
    const handle = `h_${globalThis.crypto.randomUUID()}`;
    const safeText =
      fullText.length > maxBytesPerEntry
        ? `[entry too large to cache: ${fullText.length} bytes exceeds limit ${maxBytesPerEntry}]`
        : fullText;

    store.set(handle, {
      toolName,
      format,
      fullText: safeText,
      createdAt: Date.now(),
    });

    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }

    return handle;
  }

  function get(handle: string): CachedEntry | undefined {
    const entry = store.get(handle);
    if (entry === undefined) return undefined;
    // Refresh recency: delete + re-insert moves it to the tail.
    store.delete(handle);
    store.set(handle, entry);
    return entry;
  }

  function size(): number {
    return store.size;
  }

  return { put, get, size };
}
