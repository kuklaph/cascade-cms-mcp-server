import { createHash } from "node:crypto";
import { CHARACTER_LIMIT } from "./constants.js";
import type { NextAction } from "./guidance.js";

export const RAW_FACT_INDEX_VERSION = 1;

export type RawFactKind = "object" | "array" | "key" | "scalar";
export type RawScalarType = "string" | "number" | "boolean" | "null";

export interface RawFact {
  pointer: string;
  fact_kind: RawFactKind;
  parent_pointer?: string;
  key?: string;
  scalar_type?: RawScalarType;
  value_length?: number;
  value_preview?: string;
  value_hash?: string;
  child_count?: number;
  reference_kinds?: string[];
}

export interface RawReference {
  source_pointer: string;
  reference_kind: string;
  id?: string;
  path?: string;
  site_id?: string;
  site_name?: string;
  region_name?: string;
  value?: boolean;
}

export type ScalarArtifactKind =
  | "http_url"
  | "site_link"
  | "href"
  | "src"
  | "anchor"
  | "mailto"
  | "tel"
  | "root_path";

export interface ScalarArtifact {
  source_pointer: string;
  key?: string;
  scalar_type: "string";
  value_length: number;
  artifact_kind: ScalarArtifactKind;
  value: string;
  start_offset: number;
  end_offset: number;
  context_preview: string;
}

export interface RawFactIndex {
  rawHash: string;
  indexVersion: number;
  rawFacts: RawFact[];
  rawReferences: RawReference[];
}

export interface IndexedForAudit {
  handle: string;
  raw: unknown;
  rawResourceUri: string;
  rawHash: string;
  indexVersion: number;
  rawFacts: RawFact[];
  rawReferences: RawReference[];
  totalFactCount: number;
}

export interface RawFactFilters {
  pointer_prefix?: string;
  fact_kind?: RawFactKind;
  key?: string;
  key_contains?: string;
  value_contains?: string;
  scalar_type?: RawScalarType;
  non_empty?: boolean;
  reference_kind?: string;
  limit?: number;
  cursor?: string;
}

export interface RawReferenceFilters {
  pointer_prefix?: string;
  reference_kind?: string;
  value_contains?: string;
  limit?: number;
  cursor?: string;
}

export interface ScalarArtifactFilters {
  artifact_kind?: ScalarArtifactKind;
  pointer_prefix?: string;
  key?: string;
  key_contains?: string;
  value_contains?: string;
  limit?: number;
  cursor?: string;
}

export interface RawValueSearchFilters {
  pointer_prefix?: string;
  key?: string;
  key_contains?: string;
  value_contains: string;
  scalar_type?: RawScalarType;
  non_empty?: boolean;
  limit?: number;
  cursor?: string;
}

export interface RawKeySearchFilters {
  pointer_prefix?: string;
  key?: string;
  key_contains?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditPage<T> {
  asset_handle: string;
  raw_resource_uri: string;
  raw_hash: string;
  index_version: number;
  source_scope: string;
  filter_hash: string;
  limit: number;
  returned_count: number;
  matched_count_total: number;
  total_fact_count: number;
  cursor?: string;
  next_cursor?: string;
  complete: boolean;
  truncated: boolean;
  next_actions: NextAction[];
  results: T[];
}

export interface RawValueResult {
  pointer: string;
  key?: string;
  scalar_type: RawScalarType;
  value_length: number;
  value_preview: string;
  match_offsets: number[];
}

export interface RawKeyResult {
  pointer: string;
  key: string;
  parent_pointer?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const VALUE_PREVIEW_LIMIT = 160;
const CURSOR_PREFIX = "af_";
const MAX_RAW_BYTES = 10 * 1024 * 1024;
const MAX_FACTS = 250_000;
const MAX_DEPTH = 500;
const MAX_SCALAR_ARTIFACTS = 10_000;

const REFERENCE_PATH_KINDS = new Set([
  "assetFactory",
  "block",
  "contentType",
  "dataDefinition",
  "destination",
  "file",
  "folder",
  "format",
  "metadataSet",
  "page",
  "pageConfigurationSet",
  "reference",
  "symlink",
  "template",
  "workflowDefinition",
]);

export function buildRawFactIndex(raw: unknown): RawFactIndex {
  const serialized = JSON.stringify(raw) ?? "undefined";
  if (serialized.length > MAX_RAW_BYTES) {
    throw new Error(
      `Raw asset response is too large to index safely (${serialized.length} bytes, max ${MAX_RAW_BYTES}). Use read_mode: "raw" or narrow the source asset before audit indexing.`,
    );
  }

  const rawFacts: RawFact[] = [];
  indexRawValue(raw, "", undefined, undefined, 0, rawFacts);

  const rawReferences = indexReferences(raw);
  annotateReferenceFacts(rawFacts, rawReferences);

  return {
    rawHash: hashString(serialized),
    indexVersion: RAW_FACT_INDEX_VERSION,
    rawFacts,
    rawReferences,
  };
}

export function listFacts(
  index: IndexedForAudit,
  filters: RawFactFilters,
): AuditPage<RawFact> {
  return pageResults(
    index,
    "cascade_asset_list_facts",
    "raw_fact_index",
    filters,
    (fact) => matchesFact(index.raw, fact, filters),
    index.rawFacts,
    [
      "cascade_asset_get_value",
      "cascade_asset_search_values",
      "cascade_asset_search_keys",
      "cascade_asset_list_references",
    ],
  );
}

export function searchValues(
  index: IndexedForAudit,
  filters: RawValueSearchFilters,
): AuditPage<RawValueResult> {
  const page = pageResults(
    index,
    "cascade_asset_search_values",
    "raw_scalar_values",
    filters,
    (fact) => fact.fact_kind === "scalar" && matchesFact(index.raw, fact, filters),
    index.rawFacts,
    ["cascade_asset_get_value", "cascade_asset_list_facts"],
  );

  return {
    ...page,
    results: page.results.map((fact) => toValueResult(index.raw, fact, filters.value_contains)),
  };
}

export function searchKeys(
  index: IndexedForAudit,
  filters: RawKeySearchFilters,
): AuditPage<RawKeyResult> {
  const page = pageResults(
    index,
    "cascade_asset_search_keys",
    "raw_object_keys",
    filters,
    (fact) =>
      fact.fact_kind === "key" &&
      pointerMatches(fact.pointer, filters.pointer_prefix) &&
      keyMatches(fact.key, filters.key, filters.key_contains),
    index.rawFacts,
    ["cascade_asset_get_value", "cascade_asset_list_facts"],
  );

  return {
    ...page,
    results: page.results.map((fact) => ({
      pointer: fact.pointer,
      key: fact.key ?? "",
      ...(fact.parent_pointer ? { parent_pointer: fact.parent_pointer } : {}),
    })),
  };
}

export function listReferences(
  index: IndexedForAudit,
  filters: RawReferenceFilters,
): AuditPage<RawReference> {
  return pageResults(
    index,
    "cascade_asset_list_references",
    "cascade_references",
    filters,
    (ref) =>
      pointerMatches(ref.source_pointer, filters.pointer_prefix) &&
      (!filters.reference_kind || ref.reference_kind === filters.reference_kind) &&
      (!filters.value_contains || referenceText(ref).toLowerCase().includes(filters.value_contains.toLowerCase())),
    index.rawReferences,
    ["cascade_asset_get_value", "cascade_asset_list_facts"],
  );
}

export function listScalarArtifacts(
  index: IndexedForAudit,
  filters: ScalarArtifactFilters,
): AuditPage<ScalarArtifact> {
  const extraction = extractScalarArtifacts(index.raw, index.rawFacts, filters);
  const page = pageResults(
    index,
    "cascade_asset_list_scalar_artifacts",
    "raw_scalar_artifacts",
    filters,
    (artifact) =>
      pointerMatches(artifact.source_pointer, filters.pointer_prefix) &&
      keyMatches(artifact.key, filters.key, filters.key_contains) &&
      (!filters.artifact_kind || artifact.artifact_kind === filters.artifact_kind) &&
      (!filters.value_contains || artifact.value.toLowerCase().includes(filters.value_contains.toLowerCase())),
    extraction.artifacts,
    ["cascade_asset_get_value", "cascade_asset_search_values", "cascade_asset_list_facts"],
  );
  return {
    ...page,
    complete: page.complete && !extraction.truncated,
    truncated: page.truncated || extraction.truncated,
  };
}

export function getValueAtPointer(
  index: IndexedForAudit,
  pointer: string,
  options?: { offset?: number; length?: number },
): Record<string, unknown> {
  const value = resolveRawPointer(index.raw, pointer);
  if (value === undefined) {
    throw new Error(`Pointer ${pointer || "<root>"} not found in asset handle ${index.handle}.`);
  }

  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null) {
      throw new Error(
        `Pointer ${pointer || "<root>"} resolves to ${Array.isArray(value) ? "an array" : "an object"}. Use cascade_asset_list_facts for indexed subvalues or ${index.rawResourceUri} for exact raw JSON.`,
      );
    }
    return {
      asset_handle: index.handle,
      raw_resource_uri: index.rawResourceUri,
      raw_hash: index.rawHash,
      index_version: index.indexVersion,
      source_scope: "raw_value",
      pointer,
      value,
    };
  }

  const offset = clampOffset(options?.offset, value.length);
  const requestedLength =
    options?.length === undefined
      ? CHARACTER_LIMIT
      : Math.min(CHARACTER_LIMIT, Math.max(1, Math.floor(options.length)));
  const end = Math.min(value.length, offset + requestedLength);
  const sliced = value.slice(offset, end);
  return {
    asset_handle: index.handle,
    raw_resource_uri: index.rawResourceUri,
    raw_hash: index.rawHash,
    index_version: index.indexVersion,
    source_scope: "raw_value",
    pointer,
    scalar_type: "string",
    offset,
    length: sliced.length,
    value_length: value.length,
    has_more: end < value.length,
    ...(end < value.length ? { next_offset: end } : {}),
    value: sliced,
  };
}

export function resolveRawPointer(raw: unknown, pointer: string): unknown {
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

function indexRawValue(
  value: unknown,
  pointer: string,
  parentPointer: string | undefined,
  key: string | undefined,
  depth: number,
  facts: RawFact[],
): void {
  if (depth > MAX_DEPTH) {
    throw new Error(`Raw asset response is too deep to index safely (max depth ${MAX_DEPTH}).`);
  }
  if (facts.length >= MAX_FACTS) {
    throw new Error(`Raw asset response has too many facts to index safely (max ${MAX_FACTS}).`);
  }

  if (Array.isArray(value)) {
    facts.push({
      pointer,
      fact_kind: "array",
      ...(parentPointer !== undefined ? { parent_pointer: parentPointer } : {}),
      ...(key !== undefined ? { key } : {}),
      child_count: value.length,
    });
    value.forEach((child, index) => {
      indexRawValue(child, `${pointer}/${index}`, pointer, String(index), depth + 1, facts);
    });
    return;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    facts.push({
      pointer,
      fact_kind: "object",
      ...(parentPointer !== undefined ? { parent_pointer: parentPointer } : {}),
      ...(key !== undefined ? { key } : {}),
      child_count: entries.length,
    });
    for (const [childKey, childValue] of entries) {
      const childPointer = `${pointer}/${escapePointerSegment(childKey)}`;
      facts.push({
        pointer: childPointer,
        fact_kind: "key",
        parent_pointer: pointer,
        key: childKey,
      });
      indexRawValue(childValue, childPointer, pointer, childKey, depth + 1, facts);
    }
    return;
  }

  const scalar = scalarType(value);
  facts.push({
    pointer,
    fact_kind: "scalar",
    ...(parentPointer !== undefined ? { parent_pointer: parentPointer } : {}),
    ...(key !== undefined ? { key } : {}),
    scalar_type: scalar,
    value_length: scalarLength(value),
    value_preview: scalarPreview(value),
    value_hash: hashString(JSON.stringify(value)),
  });
}

function indexReferences(raw: unknown): RawReference[] {
  const refs: RawReference[] = [];
  const seen = new Set<string>();

  function add(ref: RawReference): void {
    const key = `${ref.source_pointer}|${ref.reference_kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  }

  function walk(value: unknown, pointer: string): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${pointer}/${index}`));
      return;
    }
    if (typeof value !== "object" || value === null) return;

    const object = value as Record<string, unknown>;
    const site = siteFields(object);
    const regionName = stringValue(object.name) ?? stringValue(object.regionName);

    for (const [key, rawId] of Object.entries(object)) {
      if (!key.endsWith("Id") || typeof rawId !== "string" || rawId.length === 0) {
        continue;
      }
      const kind = key.slice(0, -2);
      const pathKey = `${kind}Path`;
      const path = stringValue(object[pathKey]);
      if (!path) continue;
      add({
        source_pointer: `${pointer}/${escapePointerSegment(pathKey)}`,
        reference_kind: kind,
        id: rawId,
        path,
        ...site,
        ...(regionName ? { region_name: regionName } : {}),
      });
    }

    for (const [key, rawPath] of Object.entries(object)) {
      if (!key.endsWith("Path")) continue;
      const kind = key.slice(0, -4);
      const path = stringValue(rawPath);
      if (!path || !REFERENCE_PATH_KINDS.has(kind)) continue;
      add({
        source_pointer: `${pointer}/${escapePointerSegment(key)}`,
        reference_kind: kind,
        ...(stringValue(object[`${kind}Id`]) ? { id: stringValue(object[`${kind}Id`]) } : {}),
        path,
        ...site,
        ...(regionName ? { region_name: regionName } : {}),
      });
    }

    for (const key of ["noBlock", "noFormat"]) {
      if (typeof object[key] === "boolean") {
        add({
          source_pointer: `${pointer}/${key}`,
          reference_kind: key,
          value: object[key] as boolean,
          ...(regionName ? { region_name: regionName } : {}),
        });
      }
    }

    for (const [key, child] of Object.entries(object)) {
      walk(child, `${pointer}/${escapePointerSegment(key)}`);
    }
  }

  walk(raw, "");
  return refs;
}

function annotateReferenceFacts(facts: RawFact[], refs: RawReference[]): void {
  const byPointer = new Map<string, string[]>();
  for (const ref of refs) {
    const list = byPointer.get(ref.source_pointer) ?? [];
    list.push(ref.reference_kind);
    byPointer.set(ref.source_pointer, list);
  }
  for (const fact of facts) {
    const kinds = byPointer.get(fact.pointer);
    if (kinds) fact.reference_kinds = [...new Set(kinds)].sort();
  }
}

function pageResults<T extends { pointer?: string; source_pointer?: string }>(
  index: IndexedForAudit,
  selfTool: string,
  sourceScope: string,
  filters: { limit?: number; cursor?: string },
  matches: (item: T) => boolean,
  allItems: T[],
  nextActionTools: string[],
): AuditPage<T> {
  const limit = clampLimit(filters.limit);
  const filterHash = hashString(stableStringify({ sourceScope, ...withoutPaging(filters) }));
  const offset = parseAuditCursor(filters.cursor, filterHash);
  const matched = allItems.filter(matches);
  const results = matched.slice(offset, offset + limit);
  const nextOffset = offset + results.length;
  const nextCursor =
    nextOffset < matched.length ? makeAuditCursor(nextOffset, filterHash) : undefined;

  return {
    asset_handle: index.handle,
    raw_resource_uri: index.rawResourceUri,
    raw_hash: index.rawHash,
    index_version: index.indexVersion,
    source_scope: sourceScope,
    filter_hash: filterHash,
    limit,
    returned_count: results.length,
    matched_count_total: matched.length,
    total_fact_count: index.totalFactCount,
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
    complete: nextCursor === undefined,
    truncated: nextCursor !== undefined,
    next_actions: buildAuditNextActions(index, nextActionTools, nextCursor, selfTool, {
      ...withoutPaging(filters),
      limit,
    }),
    results,
  };
}

function buildAuditNextActions(
  index: IndexedForAudit,
  tools: string[],
  nextCursor: string | undefined,
  selfTool: string,
  continuationFilters: Record<string, unknown>,
): NextAction[] {
  return [
    ...tools.map((tool) => ({
      tool,
      reason: "Use this cached asset handle for related raw JSON inspection.",
      input: { asset_handle: index.handle },
    })),
    ...(nextCursor
      ? [
          {
            tool: selfTool,
            reason: "Continue this paginated query with the returned cursor.",
            input: {
              asset_handle: index.handle,
              ...continuationFilters,
              cursor: nextCursor,
            },
          },
        ]
      : []),
  ];
}

function matchesFact(raw: unknown, fact: RawFact, filters: RawFactFilters): boolean {
  if (!pointerMatches(fact.pointer, filters.pointer_prefix)) return false;
  if (filters.fact_kind && fact.fact_kind !== filters.fact_kind) return false;
  if (filters.scalar_type && fact.scalar_type !== filters.scalar_type) return false;
  if (!keyMatches(fact.key, filters.key, filters.key_contains)) return false;
  if (filters.reference_kind && !fact.reference_kinds?.includes(filters.reference_kind)) {
    return false;
  }
  if (filters.non_empty && fact.fact_kind === "scalar") {
    const value = resolveRawPointer(raw, fact.pointer);
    if (value === "" || value === null) return false;
  }
  if (filters.value_contains) {
    const value = resolveRawPointer(raw, fact.pointer);
    if (!scalarSearchText(value).toLowerCase().includes(filters.value_contains.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function toValueResult(
  raw: unknown,
  fact: RawFact,
  needle: string,
): RawValueResult {
  const value = resolveRawPointer(raw, fact.pointer);
  return {
    pointer: fact.pointer,
    ...(fact.key ? { key: fact.key } : {}),
    scalar_type: fact.scalar_type ?? scalarType(value),
    value_length: fact.value_length ?? scalarLength(value),
    value_preview: fact.value_preview ?? scalarPreview(value),
    match_offsets: matchOffsets(scalarSearchText(value), needle),
  };
}

function extractScalarArtifacts(
  raw: unknown,
  facts: RawFact[],
  filters: ScalarArtifactFilters,
): { artifacts: ScalarArtifact[]; truncated: boolean } {
  const artifacts: ScalarArtifact[] = [];
  const seen = new Set<string>();
  let truncated = false;

  function add(fact: RawFact, kind: ScalarArtifactKind, start: number, end: number, source: string): boolean {
    const key = `${fact.pointer}|${kind}|${start}|${end}`;
    const value = source.slice(start, end);
    if (
      !pointerMatches(fact.pointer, filters.pointer_prefix) ||
      !keyMatches(fact.key, filters.key, filters.key_contains) ||
      (filters.artifact_kind && kind !== filters.artifact_kind) ||
      (filters.value_contains && !value.toLowerCase().includes(filters.value_contains.toLowerCase()))
    ) {
      return true;
    }
    if (seen.has(key)) return true;
    if (artifacts.length >= MAX_SCALAR_ARTIFACTS) {
      truncated = true;
      return false;
    }
    seen.add(key);
    artifacts.push({
      source_pointer: fact.pointer,
      ...(fact.key ? { key: fact.key } : {}),
      scalar_type: "string",
      value_length: source.length,
      artifact_kind: kind,
      value,
      start_offset: start,
      end_offset: end,
      context_preview: contextPreview(source, start, end),
    });
    return true;
  }

  for (const fact of facts) {
    if (fact.fact_kind !== "scalar" || fact.scalar_type !== "string") continue;
    if (
      !pointerMatches(fact.pointer, filters.pointer_prefix) ||
      !keyMatches(fact.key, filters.key, filters.key_contains)
    ) {
      continue;
    }
    const value = resolveRawPointer(raw, fact.pointer);
    if (typeof value !== "string" || value.length === 0) continue;

    if (wantsArtifact(filters, "http_url")) {
      for (const match of matchRegex(value, /\bhttps?:\/\/[^\s"'<>]+/gi)) {
        if (!add(fact, "http_url", match.start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "mailto")) {
      for (const match of matchRegex(value, /\bmailto:[^\s"'<>]+/gi)) {
        if (!add(fact, "mailto", match.start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "tel")) {
      for (const match of matchRegex(value, /\btel:[^\s"'<>]+/gi)) {
        if (!add(fact, "tel", match.start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "href")) {
      for (const match of matchAttributeValues(value, "href")) {
        if (!add(fact, "href", match.start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "src")) {
      for (const match of matchAttributeValues(value, "src")) {
        if (!add(fact, "src", match.start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "anchor")) {
      for (const match of matchRegex(value, /(^|[^A-Za-z0-9_])#[A-Za-z][A-Za-z0-9_-]*/g)) {
        const start = value[match.start] === "#" ? match.start : match.start + 1;
        if (!add(fact, "anchor", start, match.end, value)) return { artifacts, truncated };
      }
    }
    if (wantsArtifact(filters, "root_path")) {
      for (const match of matchRegex(value, /(^|[\s"'=])\/(?!\/)[A-Za-z0-9._~/%+-]*(?:[A-Za-z0-9/_~-])?/g)) {
        const start = value[match.start] === "/" ? match.start : match.start + 1;
        if (match.end > start + 1 && !add(fact, "root_path", start, match.end, value)) {
          return { artifacts, truncated };
        }
      }
    }
    if (wantsArtifact(filters, "site_link") && isSiteLinkFact(fact, value)) {
      if (!add(fact, "site_link", 0, value.length, value)) return { artifacts, truncated };
    }
  }

  return { artifacts, truncated };
}

function wantsArtifact(filters: ScalarArtifactFilters, kind: ScalarArtifactKind): boolean {
  return !filters.artifact_kind || filters.artifact_kind === kind;
}

function* matchRegex(
  value: string,
  regex: RegExp,
): Iterable<{ start: number; end: number }> {
  for (const match of value.matchAll(regex)) {
    const text = match[0];
    if (!text || match.index === undefined) continue;
    yield { start: match.index, end: match.index + text.length };
  }
}

function* matchAttributeValues(
  value: string,
  attribute: "href" | "src",
): Iterable<{ start: number; end: number }> {
  const regex = new RegExp(`\\b${attribute}\\s*=\\s*(["'])`, "gi");
  for (const match of value.matchAll(regex)) {
    if (match.index === undefined || !match[1]) continue;
    const start = match.index + match[0].length;
    const end = value.indexOf(match[1], start);
    if (end >= start) yield { start, end };
  }
}

function isSiteLinkFact(fact: RawFact, value: string): boolean {
  if (!fact.key?.endsWith("Path")) return false;
  if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return /^[A-Za-z0-9._~/-]+$/.test(value) && value.includes("/");
}

function contextPreview(value: string, start: number, end: number): string {
  const contextStart = Math.max(0, start - 40);
  const contextEnd = Math.min(value.length, end + 40);
  const prefix = contextStart > 0 ? "..." : "";
  const suffix = contextEnd < value.length ? "..." : "";
  return `${prefix}${value.slice(contextStart, contextEnd)}${suffix}`;
}

function scalarType(value: unknown): RawScalarType {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "null";
}

function scalarLength(value: unknown): number {
  if (typeof value === "string") return value.length;
  return scalarSearchText(value).length;
}

function scalarPreview(value: unknown): string {
  const text = scalarSearchText(value);
  return text.length > VALUE_PREVIEW_LIMIT
    ? `${text.slice(0, VALUE_PREVIEW_LIMIT)}...`
    : text;
}

function scalarSearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  return String(value);
}

function pointerMatches(pointer: string, prefix: string | undefined): boolean {
  return !prefix || pointer === prefix || pointer.startsWith(`${prefix}/`);
}

function keyMatches(
  key: string | undefined,
  exact: string | undefined,
  contains: string | undefined,
): boolean {
  if (exact && key !== exact) return false;
  if (contains && !key?.toLowerCase().includes(contains.toLowerCase())) return false;
  return true;
}

function referenceText(ref: RawReference): string {
  return [ref.reference_kind, ref.id, ref.path, ref.site_id, ref.site_name, ref.region_name]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function matchOffsets(haystack: string, needle: string): number[] {
  const offsets: number[] = [];
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let start = 0;
  while (lowerNeedle.length > 0) {
    const found = lowerHaystack.indexOf(lowerNeedle, start);
    if (found === -1) break;
    offsets.push(found);
    start = found + lowerNeedle.length;
    if (offsets.length >= 20) break;
  }
  return offsets;
}

function parseAuditCursor(cursor: string | undefined, filterHash: string): number {
  if (!cursor) return 0;
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new Error("Invalid cursor. Use next_cursor returned by the same audit tool.");
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"),
    ) as { v?: number; o?: number; h?: string };
    if (decoded.v !== 1 || !Number.isInteger(decoded.o) || decoded.o! < 0 || typeof decoded.h !== "string") {
      throw new Error("bad cursor");
    }
    if (decoded.h !== filterHash) {
      throw new Error("cursor does not match this query filter. Restart without cursor, then use the returned next_cursor.");
    }
    return decoded.o!;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("cursor does not match")) throw err;
    throw new Error("Malformed cursor. Use next_cursor returned by the same audit tool.");
  }
}

function makeAuditCursor(offset: number, filterHash: string): string {
  const body = Buffer.from(
    JSON.stringify({ v: 1, o: offset, h: filterHash }),
    "utf8",
  ).toString("base64url");
  return `${CURSOR_PREFIX}${body}`;
}

function withoutPaging<T extends { limit?: number; cursor?: string }>(filters: T): Omit<T, "limit" | "cursor"> {
  const { limit: _limit, cursor: _cursor, ...rest } = filters;
  return rest;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function clampOffset(value: number | undefined, max: number): number {
  if (value === undefined) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function hashString(value: string | undefined): string {
  return createHash("sha256").update(value ?? "").digest("hex");
}

function siteFields(object: Record<string, unknown>): Pick<RawReference, "site_id" | "site_name"> {
  return {
    ...(stringValue(object.siteId) ? { site_id: stringValue(object.siteId) } : {}),
    ...(stringValue(object.siteName) ? { site_name: stringValue(object.siteName) } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
