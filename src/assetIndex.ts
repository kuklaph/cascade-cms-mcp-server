import {
  buildRawFactIndex,
  getValueAtPointer,
  listFacts,
  listReferences,
  listScalarArtifacts,
  searchKeys,
  searchValues,
  type AuditPage,
  type RawFact,
  type RawFactFilters,
  type RawKeyResult,
  type RawKeySearchFilters,
  type RawReference,
  type RawReferenceFilters,
  type ScalarArtifact,
  type ScalarArtifactFilters,
  type RawValueResult,
  type RawValueSearchFilters,
} from "./assetFacts.js";
import { ASSET_ENVELOPE_KEYS } from "./schemas/assets.js";
import {
  ASSET_READ_CACHE_MAX_BINARY_BYTES,
  ASSET_READ_CACHE_MAX_ENTRIES,
  FILE_DATA_MAX_BYTES,
} from "./constants.js";
import {
  isVerifiedImageSummary,
  isNumberArray,
  summarizeFileData,
  type BinaryFieldSummary,
} from "./fileData.js";
import type { NextAction } from "./guidance.js";

export type NodeletType = "text" | "asset" | "group" | string;

export interface NodeStub {
  pointer: string;
  identifier?: string;
  type?: NodeletType;
  preview: string;
  child_count: number;
}

export interface IndexedAsset {
  handle: string;
  raw: unknown;
  asset: Record<string, unknown> | undefined;
  assetType: string;
  assetIdentity: Record<string, unknown>;
  rawResourceUri: string;
  rawHash: string;
  indexVersion: number;
  rawFacts: RawFact[];
  rawReferences: RawReference[];
  totalFactCount: number;
  referenceCount: number;
  nodeCount: number;
  maxDepth: number;
  rootPointers: string[];
  nodes: Map<string, IndexedNode>;
  binaryFields: BinaryFieldSummary[];
}

export interface IndexedNode {
  pointer: string;
  node: Record<string, unknown>;
  identifier?: string;
  type?: NodeletType;
  preview: string;
  childPointers: string[];
  depth: number;
}

export interface AssetCacheEntry extends IndexedAsset {
  createdAt: number;
}

export interface AssetCache {
  put(raw: unknown): AssetCacheEntry;
  get(handle: string): AssetCacheEntry | undefined;
  size(): number;
}

export interface AssetCacheOptions {
  maxEntries?: number;
  maxBinaryBytes?: number;
}

export interface AssetPreview {
  asset_handle: string;
  asset_type: string;
  asset_identity: Record<string, unknown>;
  raw_resource_uri: string;
  raw_hash: string;
  index_version: number;
  audit_complete: false;
  total_fact_count: number;
  reference_count: number;
  node_count: number;
  max_depth: number;
  root_outline: NodeStub[];
  omitted_fields: string[];
  binary_fields?: BinaryFieldSummary[];
  warnings: string[];
  next_actions: NextAction[];
}

const HANDLE_PATTERN = /^a_[0-9a-f-]{36}$/i;
const DEFAULT_CHILD_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 20;
const ROOT_OUTLINE_LIMIT = 20;

export function createAssetCache(opts?: AssetCacheOptions): AssetCache {
  const maxEntries = opts?.maxEntries ?? ASSET_READ_CACHE_MAX_ENTRIES;
  const maxBinaryBytes = opts?.maxBinaryBytes ?? ASSET_READ_CACHE_MAX_BINARY_BYTES;
  const store = new Map<string, AssetCacheEntry>();
  let cachedBinaryBytes = 0;

  function put(raw: unknown): AssetCacheEntry {
    const handle = `a_${globalThis.crypto.randomUUID()}`;
    const entry: AssetCacheEntry = {
      ...buildAssetIndex(raw, handle),
      createdAt: Date.now(),
    };
    const binaryBytes = binaryByteCount(entry);
    if (binaryBytes > FILE_DATA_MAX_BYTES) {
      throw new Error(
        `Cached file.data is too large (${binaryBytes} bytes, max ${FILE_DATA_MAX_BYTES}).`,
      );
    }
    if (binaryBytes > maxBinaryBytes) {
      throw new Error(
        `Cached file.data exceeds the configured binary cache budget (${binaryBytes} bytes, max ${maxBinaryBytes}).`,
      );
    }
    store.set(handle, entry);
    cachedBinaryBytes += binaryBytes;

    while (store.size > maxEntries || cachedBinaryBytes > maxBinaryBytes) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      deleteEntry(oldest);
    }

    return entry;
  }

  function get(handle: string): AssetCacheEntry | undefined {
    if (!isAssetHandle(handle)) return undefined;
    const entry = store.get(handle);
    if (!entry) return undefined;
    store.delete(handle);
    store.set(handle, entry);
    return entry;
  }

  function deleteEntry(handle: string): void {
    const entry = store.get(handle);
    if (!entry) return;
    cachedBinaryBytes -= binaryByteCount(entry);
    store.delete(handle);
  }

  return {
    put,
    get,
    size: () => store.size,
  };
}

export function isAssetHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

export function buildAssetIndex(raw: unknown, handle: string): IndexedAsset {
  const canonical = canonicalizeAsset(raw);
  const binaryFields = binaryFieldsFor(canonical);
  const rawIndex = buildRawFactIndex(raw, { binaryFields });
  const nodes = new Map<string, IndexedNode>();
  const rootPointers: string[] = [];

  const rootArrayPointer = canonical.structuredDataNodesPointer;
  const roots = canonical.structuredDataNodes;
  if (Array.isArray(roots)) {
    roots.forEach((node, i) => {
      const pointer = `${rootArrayPointer}/${i}`;
      rootPointers.push(pointer);
      indexNode(node, pointer, 1, nodes);
    });
  }

  return {
    handle,
    raw,
    asset: canonical.asset,
    assetType: canonical.assetType,
    assetIdentity: canonical.assetIdentity,
    rawResourceUri: `cascade://asset/${handle}/raw`,
    rawHash: rawIndex.rawHash,
    indexVersion: rawIndex.indexVersion,
    rawFacts: rawIndex.rawFacts,
    rawReferences: rawIndex.rawReferences,
    totalFactCount: rawIndex.rawFacts.length,
    referenceCount: rawIndex.rawReferences.length,
    nodeCount: nodes.size,
    maxDepth: maxDepth(nodes),
    rootPointers,
    nodes,
    binaryFields,
  };
}

export function toAssetPreview(index: IndexedAsset): AssetPreview {
  const omitted = [
    "structuredData",
    "xhtml",
    "xml",
    "script",
    "text",
    "data",
    "pageConfigurations",
  ].filter((field) => index.asset && field in index.asset);
  const omittedRoots = Math.max(
    0,
    index.rootPointers.length - ROOT_OUTLINE_LIMIT,
  );
  const warnings =
    index.nodeCount === 0
      ? [
          "No structuredData. Use read_mode: \"raw\" or the raw resource for the full asset.",
        ]
      : [];
  if (omittedRoots > 0) {
    warnings.push(
      `${omittedRoots} root nodelets omitted from root_outline. Use cascade_asset_list_nodelets with pointer "" to page through all roots.`,
    );
  }

  return {
    asset_handle: index.handle,
    asset_type: index.assetType,
    asset_identity: index.assetIdentity,
    raw_resource_uri: index.rawResourceUri,
    raw_hash: index.rawHash,
    index_version: index.indexVersion,
    audit_complete: false,
    total_fact_count: index.totalFactCount,
    reference_count: index.referenceCount,
    node_count: index.nodeCount,
    max_depth: index.maxDepth,
    root_outline: index.rootPointers
      .slice(0, ROOT_OUTLINE_LIMIT)
      .map((p) => toStub(index.nodes.get(p)!)),
    omitted_fields: omitted,
    ...(index.binaryFields.length > 0 ? { binary_fields: index.binaryFields } : {}),
    warnings,
    next_actions: [
      {
        tool: "cascade_asset_list_facts",
        reason: "Browse indexed raw JSON facts for audit/debug enumeration; use cascade_asset_search_values for text/content snippets.",
        input: { asset_handle: index.handle },
      },
      {
        tool: "cascade_asset_search_values",
        reason: "Search scalar values inside this cached asset by known text/content snippet.",
        required_inputs: ["asset_handle", "value_contains"],
      },
      {
        tool: "cascade_asset_search_keys",
        reason: "Find object keys inside this cached asset.",
        input: { asset_handle: index.handle },
      },
      {
        tool: "cascade_asset_get_value",
        reason: "Fetch an exact raw JSON value by pointer.",
        required_inputs: ["asset_handle", "pointer"],
      },
      {
        tool: "cascade_asset_list_scalar_artifacts",
        reason: "List link/path-like artifacts. Use href for HTML/XHTML href values of any path style; use site_link for non-root, non-URL Cascade *Path fields.",
        input: { asset_handle: index.handle },
      },
      {
        tool: "cascade_asset_list_references",
        reason: "List Cascade-native references discovered in the cached raw response.",
        input: { asset_handle: index.handle },
      },
      {
        tool: "cascade_asset_list_nodelets",
        reason: "Browse structuredData nodelets from the root.",
        input: { asset_handle: index.handle, pointer: "" },
      },
      {
        tool: "cascade_asset_get_nodelet",
        reason: "Fetch an exact structuredData nodelet by pointer.",
        required_inputs: ["asset_handle", "pointer"],
      },
      {
        tool: "cascade_asset_resolve_nodes",
        reason: "Find structuredData nodes by identifier, text, child criteria, or asset reference fields.",
        required_inputs: ["asset_handle", "selector"],
      },
      {
        tool: "cascade_asset_assert_values",
        reason: "Verify structuredData values from this cached read before editing.",
        required_inputs: ["asset_handle", "assertions"],
      },
      {
        tool: "cascade_draft_open",
        reason: "Clone this read snapshot into a mutable edit draft without changing the cached read.",
        required_inputs: ["asset_handle", "expected_raw_hash"],
      },
      ...binaryNextActions(index),
    ],
  };
}

export function listRawFacts(
  index: IndexedAsset,
  options: RawFactFilters,
): AuditPage<RawFact> {
  return listFacts(index, options);
}

export function searchRawValues(
  index: IndexedAsset,
  options: RawValueSearchFilters,
): AuditPage<RawValueResult> {
  return searchValues(index, options);
}

export function searchRawKeys(
  index: IndexedAsset,
  options: RawKeySearchFilters,
): AuditPage<RawKeyResult> {
  return searchKeys(index, options);
}

export function getRawValue(
  index: IndexedAsset,
  pointer: string,
  options?: { offset?: number; length?: number },
): Record<string, unknown> {
  return getValueAtPointer(index, pointer, options);
}

export function listRawReferences(
  index: IndexedAsset,
  options: RawReferenceFilters,
): AuditPage<RawReference> {
  return listReferences(index, options);
}

export function listAssetScalarArtifacts(
  index: IndexedAsset,
  options: ScalarArtifactFilters,
): AuditPage<ScalarArtifact> {
  return listScalarArtifacts(index, options);
}

export function getIndexedNode(
  index: IndexedAsset,
  pointer: string,
  options?: { depth?: number; include_text?: boolean },
): { pointer: string; node: Record<string, unknown> } {
  const entry = index.nodes.get(pointer);
  if (!entry) throw new Error(`Pointer ${pointer || "<root>"} not found in asset handle ${index.handle}.`);
  return {
    pointer,
    node: cloneNode(entry.node, Math.max(0, options?.depth ?? 0), options?.include_text ?? true),
  };
}

export function listIndexedChildren(
  index: IndexedAsset,
  pointer: string,
  options?: { cursor?: string; limit?: number },
): { children: NodeStub[]; next_cursor?: string } {
  const childPointers = pointer === "" ? index.rootPointers : childPointersFor(index, pointer);
  const offset = parseCursor(options?.cursor);
  const limit = clampLimit(options?.limit, DEFAULT_CHILD_LIMIT, 100);
  const page = childPointers.slice(offset, offset + limit);
  const next = offset + page.length < childPointers.length ? `c_${offset + page.length}` : undefined;

  return {
    children: page.map((p) => toStub(index.nodes.get(p)!)),
    ...(next ? { next_cursor: next } : {}),
  };
}

export function searchIndexedNodes(
  index: IndexedAsset,
  options: {
    query: string;
    search_in?: Array<"identifier" | "text" | "asset">;
    type?: string;
    limit?: number;
  },
): { matches: Array<NodeStub & { next_action: string }> } {
  const query = options.query.trim().toLowerCase();
  if (!query) return { matches: [] };

  const fields = new Set<"identifier" | "text" | "asset">(
    options.search_in ?? ["identifier", "text", "asset"],
  );
  const limit = clampLimit(options.limit, DEFAULT_SEARCH_LIMIT, 100);
  const matches: Array<NodeStub & { next_action: string }> = [];

  for (const node of index.nodes.values()) {
    if (options.type && node.type !== options.type) continue;
    if (matchesNode(node, query, fields)) {
      matches.push({
        ...toStub(node),
        next_action: "cascade_asset_get_nodelet",
      });
      if (matches.length >= limit) break;
    }
  }

  return { matches };
}

export function resolveJsonPointer(raw: unknown, pointer: string): unknown {
  if (pointer === "") return raw;
  if (!pointer.startsWith("/")) throw new Error("JSON Pointer must start with '/'");

  let current = raw;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = unescapePointerSegment(rawSegment);
    if (Array.isArray(current)) {
      if (!isArrayIndexSegment(segment)) return undefined;
      const index = Number(segment);
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function canonicalizeAsset(raw: unknown): {
  asset: Record<string, unknown> | undefined;
  assetType: string;
  assetIdentity: Record<string, unknown>;
  assetPointer: string;
  structuredDataNodes: unknown;
  structuredDataNodesPointer: string;
} {
  const root = asRecord(raw);
  const wrapper = asRecord(root?.asset) ?? root;
  const wrapperPointer = root?.asset ? "/asset" : "";
  const typeKey = findKnownAssetKey(wrapper);
  const asset = typeKey
    ? asRecord(wrapper?.[typeKey])
    : hasMultipleKnownAssetKeys(wrapper)
      ? undefined
      : wrapper;
  const assetPointer = typeKey
    ? `${wrapperPointer}/${escapePointerSegment(typeKey)}`
    : wrapperPointer;
  const structuredData = asRecord(asset?.structuredData);

  return {
    asset,
    assetType: asset ? assetType(typeKey, asset) : "unknown",
    assetIdentity: assetIdentity(asset),
    assetPointer,
    structuredDataNodes: structuredData?.structuredDataNodes,
    structuredDataNodesPointer: `${assetPointer}/structuredData/structuredDataNodes`,
  };
}

function binaryFieldsFor(canonical: ReturnType<typeof canonicalizeAsset>): BinaryFieldSummary[] {
  const asset = canonical.asset;
  const data = asset?.data;
  if (!asset || canonical.assetType !== "file" || !isNumberArray(data)) return [];
  const name =
    typeof asset.name === "string"
      ? asset.name
      : typeof asset.path === "string"
        ? asset.path
        : undefined;
  return [summarizeFileData(data, `${canonical.assetPointer}/data`, name)];
}

function binaryByteCount(index: IndexedAsset): number {
  return index.binaryFields.reduce((total, field) => total + field.bytes_total, 0);
}

function binaryNextActions(index: IndexedAsset): NextAction[] {
  if (index.binaryFields.length === 0) return [];
  const actions: NextAction[] = [
    {
      tool: "cascade_file_data_info",
      reason: "Inspect summarized binary file data from this cached file asset.",
      input: { asset_handle: index.handle },
    },
    {
      tool: "cascade_file_data_read",
      reason: "Read a bounded byte range from this cached file data without dumping the full array.",
      input: { asset_handle: index.handle },
    },
    {
      tool: "cascade_file_data_export",
      reason: "Export this cached file data to an explicit local output_path.",
      required_inputs: ["asset_handle", "output_path"],
    },
  ];
  if (isVerifiedImageSummary(index.binaryFields[0]!)) {
    actions.splice(2, 0, {
      tool: "cascade_file_data_image",
      reason: "Return image file data as image-only MCP content when the cached file has a verified image signature.",
      input: { asset_handle: index.handle },
    });
  }
  return actions;
}

function findKnownAssetKey(wrapper: Record<string, unknown> | undefined): string | undefined {
  if (!wrapper) return undefined;
  const knownKeys = ASSET_ENVELOPE_KEYS.filter((key) => asRecord(wrapper[key]));
  if (knownKeys.length === 1) return knownKeys[0];
  if (knownKeys.length > 1) return undefined;

  const keys = Object.keys(wrapper).filter((key) => asRecord(wrapper[key])?.structuredData);
  return keys.length === 1 ? keys[0] : undefined;
}

function hasMultipleKnownAssetKeys(wrapper: Record<string, unknown> | undefined): boolean {
  if (!wrapper) return false;
  return ASSET_ENVELOPE_KEYS.filter((key) => asRecord(wrapper[key])).length > 1;
}

function assetType(typeKey: string | undefined, asset: Record<string, unknown> | undefined): string {
  const rawType = typeof asset?.type === "string" ? asset.type : undefined;
  return rawType ?? typeKey ?? "unknown";
}

function assetIdentity(asset: Record<string, unknown> | undefined): Record<string, unknown> {
  const fields = [
    "id",
    "name",
    "path",
    "siteName",
    "siteId",
    "type",
    "lastModifiedDate",
    "metadata",
  ];
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (asset && field in asset) out[field] = asset[field];
  }
  return out;
}

function indexNode(
  rawNode: unknown,
  pointer: string,
  depth: number,
  nodes: Map<string, IndexedNode>,
): void {
  const node = asRecord(rawNode);
  if (!node) return;

  const childPointers: string[] = [];
  const children = node.structuredDataNodes;
  if (Array.isArray(children)) {
    children.forEach((child, i) => {
      childPointers.push(`${pointer}/structuredDataNodes/${i}`);
    });
  }

  nodes.set(pointer, {
    pointer,
    node,
    identifier: typeof node.identifier === "string" ? node.identifier : undefined,
    type: typeof node.type === "string" ? node.type : undefined,
    preview: summarizeNode(node),
    childPointers,
    depth,
  });

  childPointers.forEach((childPointer, i) => {
    indexNode((children as unknown[])[i], childPointer, depth + 1, nodes);
  });
}

function maxDepth(nodes: Map<string, IndexedNode>): number {
  let max = 0;
  for (const node of nodes.values()) max = Math.max(max, node.depth);
  return max;
}

function childPointersFor(index: IndexedAsset, pointer: string): string[] {
  const entry = index.nodes.get(pointer);
  if (!entry) throw new Error(`Pointer ${pointer} not found in asset handle ${index.handle}.`);
  return entry.childPointers;
}

function toStub(node: IndexedNode): NodeStub {
  return {
    pointer: node.pointer,
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.type ? { type: node.type } : {}),
    preview: node.preview,
    child_count: node.childPointers.length,
  };
}

function cloneNode(
  node: Record<string, unknown>,
  depth: number,
  includeText: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "structuredDataNodes") continue;
    if (!includeText && key === "text") continue;
    out[key] = value;
  }

  const children = node.structuredDataNodes;
  if (Array.isArray(children)) {
    if (depth > 0) {
      out.structuredDataNodes = children.map((child) =>
        cloneNode(asRecord(child) ?? {}, depth - 1, includeText),
      );
    } else {
      out.child_count = children.length;
      out.children_omitted = children.length;
    }
  }
  return out;
}

function summarizeNode(node: Record<string, unknown>): string {
  if (node.type === "text") {
    return previewText(typeof node.text === "string" ? node.text : "");
  }
  if (node.type === "asset") {
    return assetReferenceText(node);
  }
  if (node.type === "group") {
    const children = Array.isArray(node.structuredDataNodes)
      ? node.structuredDataNodes.length
      : 0;
    return `${children} child nodelet${children === 1 ? "" : "s"}`;
  }
  return "";
}

function matchesNode(
  node: IndexedNode,
  query: string,
  fields: Set<"identifier" | "text" | "asset">,
): boolean {
  const haystacks: string[] = [];
  if (fields.has("identifier")) haystacks.push(node.identifier ?? "");
  if (fields.has("text") && node.type === "text") haystacks.push(node.preview);
  if (fields.has("asset") && node.type === "asset") haystacks.push(node.preview);
  return haystacks.some((value) => value.toLowerCase().includes(query));
}

function assetReferenceText(node: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "identifier" || key === "recycled") continue;
    if (typeof value === "string" && value.length > 0) {
      parts.push(`${key}: ${value}`);
    }
  }
  return previewText(parts.join(", "));
}

function previewText(text: string): string {
  const stripped = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 160 ? `${stripped.slice(0, 157)}...` : stripped;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^c_(\d+)$/.exec(cursor);
  if (!match) throw new Error("Invalid cursor. Use next_cursor returned by cascade_asset_list_nodelets.");
  return Number(match[1]);
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isArrayIndexSegment(segment: string): boolean {
  return segment === "0" || /^[1-9][0-9]*$/.test(segment);
}
