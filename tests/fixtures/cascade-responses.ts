/**
 * Canned responses from the Cascade API for use in unit tests.
 *
 * These mirror the shapes returned by cascade-cms-api's operations
 * (OperationResult + per-op response types). Reuse these to keep
 * tests consistent and to catch drift in a single place.
 */

/** Bare OperationResult success. */
export const OK_RESULT = { success: true } as const;

/** Success with a short message. */
export const OK_WITH_MESSAGE = {
  success: true,
  message: "Operation completed",
} as const;

/** Create returned a new asset id. */
export const CREATE_OK = {
  success: true,
  createdAssetId: "abc123",
} as const;

/** Read returned a page asset body. */
export const READ_PAGE_OK = {
  success: true,
  asset: {
    page: {
      id: "page-001",
      name: "index",
      path: "/index",
      type: "page",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    },
  },
} as const;

/** Search returned two matches. */
export const SEARCH_OK = {
  success: true,
  matches: [
    { id: "a-1", type: "page", path: { path: "/about" } },
    { id: "a-2", type: "file", path: { path: "/assets/logo.png" } },
  ],
} as const;

/** Library returned a failure object (rare; library usually throws). */
export const FAILURE_NOT_FOUND = {
  success: false,
  message: "Asset not found",
} as const;

/**
 * Read returned a page asset body with heavy fields included.
 *
 * Serves two purposes:
 *   1. Drives the `cascade_read` preview/raw mode tests. Preview mode returns
 *      a compact handle-based outline; raw mode returns this full payload.
 *   2. Exercises the oversize-response cache pathway — the inflated `xhtml` body
 *      and repeated `structuredDataNodes` push the rendered payload well past
 *      `CHARACTER_LIMIT` so a handle is minted.
 */
export const READ_PAGE_HUGE = {
  success: true,
  asset: {
    page: {
      id: "huge-page-id",
      name: "huge-page",
      path: "/huge",
      type: "page",
      lastModifiedDate: "2026-01-01T00:00:00Z",
      metadata: {
        title: "Huge Page",
        displayName: "Huge",
        summary: "A page used to exercise the cache",
      },
      xhtml: "<div>" + "x".repeat(150_000) + "</div>",
      structuredData: {
        structuredDataNodes: Array.from({ length: 100 }, (_, i) => ({
          identifier: `node-${i}`,
          type: "text",
          text: "y".repeat(500),
        })),
      },
      pageConfigurations: [
        { id: "pc1", configurationName: "Standard" },
      ],
    },
  },
} as const;
