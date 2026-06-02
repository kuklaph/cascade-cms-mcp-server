import { createHash } from "node:crypto";
import {
  buildAssetIndex,
  resolveJsonPointer,
  type AssetCacheEntry,
  type IndexedAsset,
} from "./assetIndex.js";
import {
  ASSET_DRAFT_CACHE_MAX_ENTRIES,
  ASSET_DRAFT_MAX_BYTES,
  ASSET_DRAFT_PATCH_MAX_OPERATIONS,
} from "./constants.js";

export type DraftOperation = "create" | "edit";

export type DraftPatchOperation =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string };

export interface DraftChange {
  op: DraftPatchOperation["op"];
  path: string;
  old_value_type: string;
  new_value_type?: string;
  old_length?: number;
  new_length?: number;
}

export interface DraftCacheEntry {
  handle: string;
  operation: DraftOperation;
  root: Record<string, unknown>;
  index: IndexedAsset;
  revision: number;
  draftHash: string;
  createdAt: number;
  updatedAt: number;
  sourceAssetHandle?: string;
  sourceRawHash?: string;
  sourceIdentifier?: DraftSourceIdentifier;
}

export interface DraftPatchInput {
  expectedRevision?: number;
  operations: DraftPatchOperation[];
}

export interface DraftPatchResult {
  draft_handle: string;
  draft_resource_uri: string;
  operation: DraftOperation;
  revision: number;
  draft_hash: string;
  changes: DraftChange[];
}

export interface DraftPatchPreview {
  entry: DraftCacheEntry;
  baseRevision: number;
  nextRoot: Record<string, unknown>;
  nextHash: string;
  changes: DraftChange[];
}

export interface DraftSourceIdentifier {
  type: string;
  id?: string;
  path?: {
    path: string;
    siteId?: string;
    siteName?: string;
  };
}

export interface DraftCache {
  createFromRead(readEntry: AssetCacheEntry, expectedRawHash: string): DraftCacheEntry;
  createFromAsset(operation: DraftOperation, asset?: unknown): DraftCacheEntry;
  get(handle: string): DraftCacheEntry | undefined;
  previewPatch(handle: string, input: DraftPatchInput): DraftPatchPreview;
  commitPatch(preview: DraftPatchPreview): DraftPatchResult;
  applyPatch(handle: string, input: DraftPatchInput): DraftPatchResult;
  delete(handle: string): boolean;
  size(): number;
}

export interface DraftCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
}

const HANDLE_PATTERN = /^d_[0-9a-f-]{36}$/i;

export function createDraftCache(opts?: DraftCacheOptions): DraftCache {
  const maxEntries = opts?.maxEntries ?? ASSET_DRAFT_CACHE_MAX_ENTRIES;
  const maxBytes = opts?.maxBytes ?? ASSET_DRAFT_MAX_BYTES;
  const store = new Map<string, DraftCacheEntry>();

  function put(
    operation: DraftOperation,
    root: Record<string, unknown>,
    source?: Pick<
      DraftCacheEntry,
      "sourceAssetHandle" | "sourceRawHash" | "sourceIdentifier"
    >,
  ): DraftCacheEntry {
    const handle = `d_${globalThis.crypto.randomUUID()}`;
    const now = Date.now();
    assertDraftSize(root, maxBytes);
    const entry: DraftCacheEntry = {
      handle,
      operation,
      root,
      index: buildDraftIndex(handle, root),
      revision: 1,
      draftHash: hashJson(root),
      createdAt: now,
      updatedAt: now,
      ...source,
    };
    store.set(handle, entry);

    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }

    return entry;
  }

  function createFromRead(
    readEntry: AssetCacheEntry,
    expectedRawHash: string,
  ): DraftCacheEntry {
    if (readEntry.rawHash !== expectedRawHash) {
      throw new Error(
        `expected_raw_hash mismatch for asset handle ${readEntry.handle}. Re-run cascade_read or use the current raw_hash.`,
      );
    }
    const readRoot = asRecord(readEntry.raw);
    const asset = asRecord(readRoot?.asset);
    if (!asset) {
      throw new Error(
        `Asset handle ${readEntry.handle} does not contain an asset envelope.`,
      );
    }

    const clonedAsset = cloneJson(asset) as Record<string, unknown>;
    removeDirectAssetType(clonedAsset);
    return put("edit", { asset: clonedAsset }, {
      sourceAssetHandle: readEntry.handle,
      sourceRawHash: readEntry.rawHash,
      sourceIdentifier: sourceIdentifierFor(readEntry),
    });
  }

  function createFromAsset(
    operation: DraftOperation,
    asset: unknown = {},
  ): DraftCacheEntry {
    return put(operation, { asset: cloneJson(asset) });
  }

  function get(handle: string): DraftCacheEntry | undefined {
    if (!isDraftHandle(handle)) return undefined;
    const entry = store.get(handle);
    if (!entry) return undefined;
    store.delete(handle);
    store.set(handle, entry);
    return entry;
  }

  function previewPatch(handle: string, input: DraftPatchInput): DraftPatchPreview {
    const entry = get(handle);
    if (!entry) {
      throw new Error(
        `Draft handle ${handle} not found. Re-open the draft before applying changes.`,
      );
    }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== entry.revision
    ) {
      throw new Error(
        `expected_revision ${input.expectedRevision} does not match current draft revision ${entry.revision}.`,
      );
    }
    if (input.operations.length === 0) {
      throw new Error("operations must contain at least one patch operation.");
    }
    if (input.operations.length > ASSET_DRAFT_PATCH_MAX_OPERATIONS) {
      throw new Error(
        `operations must contain at most ${ASSET_DRAFT_PATCH_MAX_OPERATIONS} patch operations.`,
      );
    }

    const nextRoot = cloneJson(entry.root) as Record<string, unknown>;
    const changes = input.operations.map((operation) =>
      applyOne(nextRoot, operation),
    );
    assertDraftSize(nextRoot, maxBytes);
    const nextHash = hashJson(nextRoot);

    return {
      entry,
      baseRevision: entry.revision,
      nextRoot,
      nextHash,
      changes,
    };
  }

  function commitPatch(preview: DraftPatchPreview): DraftPatchResult {
    const current = store.get(preview.entry.handle);
    if (!current || current !== preview.entry) {
      throw new Error(
        `Draft handle ${preview.entry.handle} not found. Re-open the draft before applying changes.`,
      );
    }
    if (current.revision !== preview.baseRevision) {
      throw new Error(
        `Draft revision changed before patch commit. Expected ${preview.baseRevision}, found ${current.revision}.`,
      );
    }
    const nextIndex = buildDraftIndex(current.handle, preview.nextRoot);

    current.root = preview.nextRoot;
    current.index = nextIndex;
    current.revision += 1;
    current.draftHash = preview.nextHash;
    current.updatedAt = Date.now();

    return {
      draft_handle: current.handle,
      draft_resource_uri: draftResourceUri(current.handle),
      operation: current.operation,
      revision: current.revision,
      draft_hash: current.draftHash,
      changes: preview.changes,
    };
  }

  return {
    createFromRead,
    createFromAsset,
    get,
    previewPatch,
    commitPatch,
    applyPatch: (handle, input) => commitPatch(previewPatch(handle, input)),
    delete: (handle) => store.delete(handle),
    size: () => store.size,
  };
}

export function isDraftHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

export function getDraftValue(
  draft: DraftCacheEntry,
  pointer: string,
): unknown {
  return resolveJsonPointer(draft.root, pointer);
}

export function draftResourceUri(handle: string): string {
  return `cascade://draft/${handle}/raw`;
}

export function draftSummary(entry: DraftCacheEntry): Record<string, unknown> {
  return {
    draft_handle: entry.handle,
    operation: entry.operation,
    revision: entry.revision,
    draft_hash: entry.draftHash,
    draft_resource_uri: draftResourceUri(entry.handle),
    source_asset_handle: entry.sourceAssetHandle,
    source_raw_hash: entry.sourceRawHash,
    asset_type: entry.index.assetType,
    asset_identity: entry.index.assetIdentity,
  };
}

function buildDraftIndex(handle: string, root: Record<string, unknown>): IndexedAsset {
  return {
    ...buildAssetIndex(root, handle),
    rawResourceUri: draftResourceUri(handle),
  };
}

function applyOne(root: Record<string, unknown>, operation: DraftPatchOperation): DraftChange {
  if (operation.path === "") {
    throw new Error("Root patch operations are not supported.");
  }

  const target = resolvePatchTarget(root, operation.path);
  const oldValue = readTargetValue(target);
  const exists = oldValue !== MISSING;

  switch (operation.op) {
    case "remove":
      if (!exists) throw new Error(`Path ${operation.path} not found.`);
      removeTarget(target);
      return changeSummary(operation, oldValue, undefined);
    case "replace":
      if (!exists) throw new Error(`Path ${operation.path} not found.`);
      writeTargetValue(target, operation.value, operation.op);
      return changeSummary(operation, oldValue, operation.value);
    case "add":
      writeTargetValue(target, operation.value, operation.op);
      return changeSummary(operation, oldValue, operation.value);
  }
}

const MISSING = Symbol("missing");

type PatchTarget = {
  parent: Record<string, unknown> | unknown[];
  key: string;
};

function resolvePatchTarget(root: unknown, pointer: string): PatchTarget {
  if (!pointer.startsWith("/")) {
    throw new Error("JSON Pointer must start with '/'");
  }
  const segments = pointer.slice(1).split("/").map(unescapePointerSegment);
  for (const segment of segments) assertSafeObjectKey(segment);
  const key = segments.pop();
  if (key === undefined) throw new Error("JSON Pointer must not be empty");
  assertSafeObjectKey(key);

  let parent = root;
  for (const segment of segments) {
    parent = readChild(parent, segment);
    if (parent === MISSING) throw new Error(`Path ${pointer} not found.`);
  }
  if (!Array.isArray(parent) && !isRecord(parent)) {
    throw new Error(`Parent path for ${pointer} is not an object or array.`);
  }

  return { parent, key };
}

function assertSafeObjectKey(key: string): void {
  if (key === "__proto__" || key === "prototype" || key === "constructor") {
    throw new Error(`JSON Pointer segment ${key} is not allowed in draft patches.`);
  }
}

function readChild(parent: unknown, key: string): unknown {
  if (Array.isArray(parent)) {
    if (!isArrayIndex(key)) return MISSING;
    return parent[Number(key)] ?? MISSING;
  }
  if (isRecord(parent)) {
    return Object.hasOwn(parent, key) ? parent[key] : MISSING;
  }
  return MISSING;
}

function readTargetValue(target: PatchTarget): unknown {
  if (Array.isArray(target.parent)) {
    if (!isArrayIndex(target.key)) return MISSING;
    const index = Number(target.key);
    return index >= 0 && index < target.parent.length
      ? target.parent[index]
      : MISSING;
  }
  return Object.hasOwn(target.parent, target.key)
    ? target.parent[target.key]
    : MISSING;
}

function writeTargetValue(
  target: PatchTarget,
  value: unknown,
  op: "add" | "replace",
): void {
  if (Array.isArray(target.parent)) {
    if (op === "add" && target.key === "-") {
      target.parent.push(value);
      return;
    }
    if (!isArrayIndex(target.key)) {
      throw new Error(`Array patch path segment ${target.key} is not a valid index.`);
    }
    const index = Number(target.key);
    const max = op === "add" ? target.parent.length : target.parent.length - 1;
    if (index < 0 || index > max) {
      throw new Error(`Array patch index ${index} is out of bounds.`);
    }
    if (op === "add") target.parent.splice(index, 0, value);
    else target.parent[index] = value;
    return;
  }

  target.parent[target.key] = value;
}

function removeTarget(target: PatchTarget): void {
  if (Array.isArray(target.parent)) {
    if (!isArrayIndex(target.key)) {
      throw new Error(`Array patch path segment ${target.key} is not a valid index.`);
    }
    target.parent.splice(Number(target.key), 1);
    return;
  }

  delete target.parent[target.key];
}

function changeSummary(
  operation: DraftPatchOperation,
  oldValue: unknown,
  newValue: unknown,
): DraftChange {
  const change: DraftChange = {
    op: operation.op,
    path: operation.path,
    old_value_type: oldValue === MISSING ? "missing" : valueType(oldValue),
  };
  if (operation.op !== "remove") {
    change.new_value_type = valueType(newValue);
  }
  if (typeof oldValue === "string") change.old_length = oldValue.length;
  if (typeof newValue === "string") change.new_length = newValue.length;
  return change;
}

function removeDirectAssetType(assetEnvelope: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(assetEnvelope)) {
    if (key === "workflowConfiguration") continue;
    if (isRecord(value)) {
      delete value.type;
      return;
    }
  }
}

function sourceIdentifierFor(readEntry: AssetCacheEntry): DraftSourceIdentifier {
  const identity = readEntry.assetIdentity;
  const type = entityTypeFor(identity.type, readEntry.assetType);
  const id = typeof identity.id === "string" ? identity.id : undefined;
  if (id) return { type, id };

  const path = typeof identity.path === "string" ? identity.path : undefined;
  if (path) {
    const pathIdentifier: {
      path: string;
      siteId?: string;
      siteName?: string;
    } = { path };
    if (typeof identity.siteId === "string") pathIdentifier.siteId = identity.siteId;
    if (typeof identity.siteName === "string") {
      pathIdentifier.siteName = identity.siteName;
    }
    return { type, path: pathIdentifier };
  }

  throw new Error(
    `Cannot open edit draft from asset handle ${readEntry.handle}: source asset has no id or path identifier.`,
  );
}

function entityTypeFor(rawType: unknown, assetType: string): string {
  if (typeof rawType === "string") return rawType;
  return ENTITY_TYPE_BY_ASSET_TYPE[assetType] ?? assetType;
}

const ENTITY_TYPE_BY_ASSET_TYPE: Record<string, string> = {
  assetFactory: "assetfactory",
  assetFactoryContainer: "assetfactorycontainer",
  contentType: "contenttype",
  contentTypeContainer: "contenttypecontainer",
  connectorContainer: "connectorcontainer",
  dataDefinition: "datadefinition",
  dataDefinitionContainer: "datadefinitioncontainer",
  editorConfiguration: "editorconfiguration",
  facebookConnector: "facebookconnector",
  feedBlock: "block_FEED",
  cloudTransport: "transport_cloud",
  databaseTransport: "transport_db",
  fileSystemTransport: "transport_fs",
  ftpTransport: "transport_ftp",
  googleAnalyticsConnector: "googleanalyticsconnector",
  indexBlock: "block_INDEX",
  metadataSet: "metadataset",
  metadataSetContainer: "metadatasetcontainer",
  pageConfigurationSet: "pageconfigurationset",
  pageConfigurationSetContainer: "pageconfigurationsetcontainer",
  publishSet: "publishset",
  publishSetContainer: "publishsetcontainer",
  scriptFormat: "format_SCRIPT",
  sharedField: "sharedfield",
  sharedFieldContainer: "sharedfieldcontainer",
  siteDestinationContainer: "sitedestinationcontainer",
  textBlock: "block_TEXT",
  transportContainer: "transportcontainer",
  twitterFeedBlock: "block_TWITTER_FEED",
  wordPressConnector: "wordpressconnector",
  workflowDefinition: "workflowdefinition",
  workflowDefinitionContainer: "workflowdefinitioncontainer",
  workflowEmail: "workflowemail",
  workflowEmailContainer: "workflowemailcontainer",
  xhtmlDataDefinitionBlock: "block_XHTML_DATADEFINITION",
  xmlBlock: "block_XML",
  xsltFormat: "format_XSLT",
};

function cloneJson(value: unknown): unknown {
  return structuredClone(value);
}

function assertDraftSize(value: unknown, maxBytes: number): void {
  const serialized = JSON.stringify(value) ?? "undefined";
  if (serialized.length > maxBytes) {
    throw new Error(
      `Draft payload is too large to cache safely (${serialized.length} bytes, max ${maxBytes}). Use direct create/edit for large payloads or reduce the draft size.`,
    );
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "undefined")
    .digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayIndex(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value);
}

function unescapePointerSegment(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
