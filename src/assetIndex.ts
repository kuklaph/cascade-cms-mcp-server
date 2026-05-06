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
  nodeCount: number;
  maxDepth: number;
  rootPointers: string[];
  nodes: Map<string, IndexedNode>;
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
}

export interface AssetPreview {
  asset_handle: string;
  asset_type: string;
  asset_identity: Record<string, unknown>;
  raw_resource_uri: string;
  node_count: number;
  max_depth: number;
  root_outline: NodeStub[];
  omitted_fields: string[];
  warnings: string[];
  next_actions: string[];
}

const HANDLE_PATTERN = /^a_[0-9a-f-]{36}$/i;
const DEFAULT_MAX_ENTRIES = 10;
const DEFAULT_CHILD_LIMIT = 25;
const DEFAULT_SEARCH_LIMIT = 20;
const ROOT_OUTLINE_LIMIT = 20;

export function createAssetCache(opts?: AssetCacheOptions): AssetCache {
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const store = new Map<string, AssetCacheEntry>();

  function put(raw: unknown): AssetCacheEntry {
    const handle = `a_${globalThis.crypto.randomUUID()}`;
    const entry: AssetCacheEntry = {
      ...buildAssetIndex(raw, handle),
      createdAt: Date.now(),
    };
    store.set(handle, entry);

    while (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
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
    nodeCount: nodes.size,
    maxDepth: maxDepth(nodes),
    rootPointers,
    nodes,
  };
}

export function toAssetPreview(index: IndexedAsset): AssetPreview {
  const omitted = ["structuredData"];
  if (index.asset && "xhtml" in index.asset) omitted.push("xhtml");
  if (index.asset && "pageConfigurations" in index.asset) {
    omitted.push("pageConfigurations");
  }
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
      `${omittedRoots} root nodelets omitted from root_outline. Use cascade_asset_list_children with pointer "" to page through all roots.`,
    );
  }

  return {
    asset_handle: index.handle,
    asset_type: index.assetType,
    asset_identity: index.assetIdentity,
    raw_resource_uri: index.rawResourceUri,
    node_count: index.nodeCount,
    max_depth: index.maxDepth,
    root_outline: index.rootPointers
      .slice(0, ROOT_OUTLINE_LIMIT)
      .map((p) => toStub(index.nodes.get(p)!)),
    omitted_fields: omitted,
    warnings,
    next_actions: [
      "cascade_asset_search_paths",
      "cascade_asset_list_children",
      "cascade_asset_get_node",
      "cascade://asset/{handle}/raw",
    ],
  };
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
        next_action: "cascade_asset_get_node",
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
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
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
  structuredDataNodes: unknown;
  structuredDataNodesPointer: string;
} {
  const root = asRecord(raw);
  const wrapper = asRecord(root?.asset) ?? root;
  const wrapperPointer = root?.asset ? "/asset" : "";
  const typeKey = findAssetKey(wrapper);
  const asset = typeKey ? asRecord(wrapper?.[typeKey]) : wrapper;
  const assetPointer = typeKey
    ? `${wrapperPointer}/${escapePointerSegment(typeKey)}`
    : wrapperPointer;
  const structuredData = asRecord(asset?.structuredData);

  return {
    asset,
    assetType: assetType(typeKey, asset),
    assetIdentity: assetIdentity(asset),
    structuredDataNodes: structuredData?.structuredDataNodes,
    structuredDataNodesPointer: `${assetPointer}/structuredData/structuredDataNodes`,
  };
}

function findAssetKey(wrapper: Record<string, unknown> | undefined): string | undefined {
  if (!wrapper) return undefined;
  if (asRecord(wrapper.page)) return "page";
  if (asRecord(wrapper.xhtmlDataDefinitionBlock)) return "xhtmlDataDefinitionBlock";

  const keys = Object.keys(wrapper).filter((key) => asRecord(wrapper[key])?.structuredData);
  return keys.length === 1 ? keys[0] : undefined;
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
  if (!match) throw new Error("Invalid cursor. Use next_cursor returned by cascade_asset_list_children.");
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
