import { describe, expect, test } from "bun:test";
import { createAssetCache, getRawValue } from "../../src/assetIndex.js";
import {
  createDraftCache,
  getDraftValue,
  isDraftHandle,
} from "../../src/assetDrafts.js";
import { ASSET_DRAFT_PATCH_MAX_OPERATIONS } from "../../src/constants.js";
import { READ_PAGE_OK } from "../fixtures/cascade-responses.js";

describe("asset draft cache", () => {
  test("creates isolated edit drafts from read cache entries", () => {
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(READ_PAGE_OK);
    const draftCache = createDraftCache();

    const draft = draftCache.createFromRead(readEntry, readEntry.rawHash);

    expect(isDraftHandle(draft.handle)).toBe(true);
    expect(draft.operation).toBe("edit");
    expect(draft.revision).toBe(1);
    expect(getDraftValue(draft, "/asset/page/type")).toBeUndefined();

    const update = draftCache.applyPatch(draft.handle, {
      expectedRevision: 1,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "draft-name" },
      ],
    });

    expect(update.revision).toBe(2);
    expect(update.draft_handle).toBe(draft.handle);
    expect(update.draft_resource_uri).toBe(`cascade://draft/${draft.handle}/raw`);
    expect(getDraftValue(draftCache.get(draft.handle)!, "/asset/page/name")).toBe("draft-name");
    expect(getRawValue(readEntry, "/asset/page/name")).toMatchObject({
      value: "index",
    });
  });

  test("maps generated transport envelope keys to Cascade entity types for edit source reads", () => {
    const assetCache = createAssetCache();
    const draftCache = createDraftCache();

    const databaseTransport = assetCache.put({
      asset: {
        databaseTransport: {
          id: "transport-db-001",
          name: "database",
        },
      },
    });
    const cloudTransport = assetCache.put({
      asset: {
        cloudTransport: {
          id: "transport-cloud-001",
          name: "cloud",
        },
      },
    });

    expect(
      draftCache.createFromRead(databaseTransport, databaseTransport.rawHash).sourceIdentifier,
    ).toEqual({ type: "transport_db", id: "transport-db-001" });
    expect(
      draftCache.createFromRead(cloudTransport, cloudTransport.rawHash).sourceIdentifier,
    ).toEqual({ type: "transport_cloud", id: "transport-cloud-001" });
  });

  test("creates create drafts from initial asset payloads", () => {
    const draftCache = createDraftCache();

    const draft = draftCache.createFromAsset("create", {
      page: {
        name: "new-page",
        parentFolderPath: "/",
        siteName: "site",
        contentTypePath: "/ct",
        xhtml: "<p>Hello</p>",
      },
    });

    expect(draft.operation).toBe("create");
    expect(getDraftValue(draft, "/asset/page/name")).toBe("new-page");
  });

  test("applies JSON Pointer add, replace, and remove atomically", () => {
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("create", { page: { name: "a" } });

    const update = draftCache.applyPatch(draft.handle, {
      expectedRevision: 1,
      operations: [
        { op: "add", path: "/asset/page/metadata", value: {} },
        { op: "add", path: "/asset/page/metadata/title", value: "Title" },
        { op: "replace", path: "/asset/page/name", value: "b" },
        { op: "remove", path: "/asset/page/metadata/title" },
      ],
    });

    expect(update.revision).toBe(2);
    const current = draftCache.get(draft.handle)!;
    expect(getDraftValue(current, "/asset/page/name")).toBe("b");
    expect(getDraftValue(current, "/asset/page/metadata/title")).toBeUndefined();

    expect(() =>
      draftCache.applyPatch(draft.handle, {
        expectedRevision: 2,
        operations: [
          { op: "replace", path: "/asset/page/name", value: "c" },
          { op: "remove", path: "/asset/page/missing" },
        ],
      }),
    ).toThrow("not found");

    expect(getDraftValue(draftCache.get(draft.handle)!, "/asset/page/name")).toBe("b");
  });

  test("rejects stale expected revisions", () => {
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("create", { page: { name: "a" } });

    expect(() =>
      draftCache.applyPatch(draft.handle, {
        expectedRevision: 2,
        operations: [
          { op: "replace", path: "/asset/page/name", value: "b" },
        ],
      }),
    ).toThrow("expected_revision");
  });

  test("rejects oversized drafts without mutating the current revision", () => {
    const draftCache = createDraftCache({ maxBytes: 80 });
    const draft = draftCache.createFromAsset("create", { page: { name: "a" } });

    expect(() =>
      draftCache.applyPatch(draft.handle, {
        expectedRevision: 1,
        operations: [
          { op: "replace", path: "/asset/page/name", value: "x".repeat(100) },
        ],
      }),
    ).toThrow("too large");

    const current = draftCache.get(draft.handle)!;
    expect(current.revision).toBe(1);
    expect(getDraftValue(current, "/asset/page/name")).toBe("a");
  });

  test("rejects unsafe patch keys and excessive operation counts", () => {
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("create", { page: { name: "a" } });

    expect(() =>
      draftCache.applyPatch(draft.handle, {
        operations: [
          { op: "add", path: "/asset/page/__proto__/polluted", value: true },
        ],
      }),
    ).toThrow("not allowed");
    expect(() =>
      draftCache.applyPatch(draft.handle, {
        operations: Array.from(
          { length: ASSET_DRAFT_PATCH_MAX_OPERATIONS + 1 },
          () => ({ op: "replace", path: "/asset/page/name", value: "b" }),
        ),
      }),
    ).toThrow("at most");
  });
});
