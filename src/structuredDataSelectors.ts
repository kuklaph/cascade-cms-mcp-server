import type { IndexedAsset, IndexedNode } from "./assetIndex.js";
import type { DraftPatchOperation } from "./assetDrafts.js";

export type StructuredDataComparison =
  | "equals"
  | "contains"
  | "exists"
  | "not_exists";

export type StructuredDataNodePosition = "before" | "after";

export interface StructuredDataSelector {
  scope_pointer?: string;
  recursive?: boolean;
  node_type?: string;
  identifier?: string;
  text_equals?: string;
  text_contains?: string;
  field_equals?: Record<string, unknown>;
  field_contains?: Record<string, string>;
  where_child?: StructuredDataSelector;
  expected_matches?: number;
}

export interface StructuredDataTarget {
  child?: StructuredDataSelector;
  field: string;
}

export interface StructuredDataMatch {
  pointer: string;
  node: Record<string, unknown>;
  node_type?: string;
  identifier?: string;
  preview: unknown;
}

export interface StructuredDataResolveResult {
  matched_count: number;
  matches: StructuredDataMatch[];
}

export interface StructuredDataAssertion {
  match: StructuredDataSelector;
  target: StructuredDataTarget;
  comparison: StructuredDataComparison;
  expected?: unknown;
}

export interface StructuredDataAssertionResult {
  passed: boolean;
  match_pointer?: string;
  target_pointer?: string;
  actual?: unknown;
  expected?: unknown;
  comparison: StructuredDataComparison;
  error?: string;
}

export interface StructuredDataAssertionsResult {
  passed: boolean;
  results: StructuredDataAssertionResult[];
}

export type SemanticNodePatchInput =
  | {
      op: "insert_node";
      match: StructuredDataMatch;
      position: StructuredDataNodePosition;
      node: Record<string, unknown>;
    }
  | {
      op: "remove_node";
      match: StructuredDataMatch;
    }
  | {
      op: "move_node";
      match: StructuredDataMatch;
      destination: {
        match: StructuredDataMatch;
        position: StructuredDataNodePosition;
      };
    };

export function resolveStructuredDataNodes(
  index: IndexedAsset,
  selector: StructuredDataSelector,
): StructuredDataResolveResult {
  const matches = candidateNodes(index, selector)
    .filter((node) => nodeMatches(index, node, selector))
    .map((node) => matchForNode(index, node));

  if (
    selector.expected_matches !== undefined &&
    matches.length !== selector.expected_matches
  ) {
    throw new Error(
      `Expected ${selector.expected_matches} structuredData match, matched ${matches.length}. Candidate pointers: ${matches.map((match) => match.pointer).join(", ") || "(none)"}.`,
    );
  }

  return {
    matched_count: matches.length,
    matches,
  };
}

export function resolveStructuredDataTarget(
  index: IndexedAsset,
  match: StructuredDataMatch,
  target: StructuredDataTarget,
): { pointer: string; value: unknown; match: StructuredDataMatch } {
  const targetMatch = target.child
    ? resolveChildMatch(index, match, target.child)
    : match;
  const pointer = `${targetMatch.pointer}/${escapePointerSegment(target.field)}`;

  return {
    pointer,
    value: targetMatch.node[target.field],
    match: targetMatch,
  };
}

export function evaluateStructuredDataAssertions(
  index: IndexedAsset,
  assertions: StructuredDataAssertion[],
): StructuredDataAssertionsResult {
  const results = assertions.map((assertion): StructuredDataAssertionResult => {
    try {
      const match = resolveSingleMatch(index, assertion.match);
      const target = resolveStructuredDataTarget(index, match, assertion.target);
      const passed = compareValue(
        target.value,
        assertion.comparison,
        assertion.expected,
      );

      return {
        passed,
        match_pointer: match.pointer,
        target_pointer: target.pointer,
        actual: target.value,
        expected: assertion.expected,
        comparison: assertion.comparison,
      };
    } catch (error) {
      return {
        passed: false,
        comparison: assertion.comparison,
        expected: assertion.expected,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return {
    passed: results.every((result) => result.passed),
    results,
  };
}

export function semanticFieldPatchOperations(
  index: IndexedAsset,
  input:
    | {
        op: "add" | "replace";
        match: StructuredDataSelector;
        target: StructuredDataTarget;
        value: unknown;
      }
    | {
        op: "remove";
        match: StructuredDataSelector;
        target: StructuredDataTarget;
      },
): {
  operations: DraftPatchOperation[];
  match: StructuredDataMatch;
  target_pointer: string;
  before: unknown;
  after?: unknown;
} {
  const match = resolveSingleMatch(index, input.match);
  const target = resolveStructuredDataTarget(index, match, input.target);
  if (input.op === "remove") {
    return {
      operations: [{ op: "remove", path: target.pointer }],
      match,
      target_pointer: target.pointer,
      before: target.value,
    };
  }

  return {
    operations: [{ op: input.op, path: target.pointer, value: input.value }],
    match,
    target_pointer: target.pointer,
    before: target.value,
    after: input.value,
  };
}

export function semanticNodePatchOperations(
  _index: IndexedAsset,
  input: SemanticNodePatchInput,
): DraftPatchOperation[] {
  switch (input.op) {
    case "insert_node": {
      const { parentPointer, index } = arrayPosition(input.match.pointer);
      const addIndex = input.position === "before" ? index : index + 1;
      return [
        {
          op: "add",
          path: `${parentPointer}/${addIndex}`,
          value: input.node,
        },
      ];
    }
    case "remove_node":
      return [{ op: "remove", path: input.match.pointer }];
    case "move_node": {
      const source = arrayPosition(input.match.pointer);
      const destination = arrayPosition(input.destination.match.pointer);
      if (source.parentPointer !== destination.parentPointer) {
        throw new Error("move_node only supports moves within one structuredDataNodes array.");
      }
      if (source.index === destination.index) {
        throw new Error("move_node source and destination are the same node.");
      }

      let addIndex =
        input.destination.position === "before"
          ? destination.index
          : destination.index + 1;
      if (source.index < destination.index) addIndex -= 1;

      return [
        { op: "remove", path: input.match.pointer },
        {
          op: "add",
          path: `${source.parentPointer}/${addIndex}`,
          value: input.match.node,
        },
      ];
    }
  }
}

export function resolveSingleMatch(
  index: IndexedAsset,
  selector: StructuredDataSelector,
): StructuredDataMatch {
  assertSingleExpected(selector, "Single-target selectors");
  const result = resolveStructuredDataNodes(index, {
    ...selector,
    expected_matches: 1,
  });
  return result.matches[0]!;
}

function candidateNodes(
  index: IndexedAsset,
  selector: StructuredDataSelector,
): IndexedNode[] {
  const scope = selector.scope_pointer ?? "";
  const recursive = selector.recursive !== false;
  const nodes = [...index.nodes.values()];

  if (scope === "") {
    return recursive
      ? nodes
      : index.rootPointers
          .map((pointer) => index.nodes.get(pointer))
          .filter((node): node is IndexedNode => node !== undefined);
  }

  const scopedNode = index.nodes.get(scope);
  if (scopedNode) {
    if (recursive) {
      return nodes.filter(
        (node) =>
          node.pointer === scope ||
          node.pointer.startsWith(`${scope}/structuredDataNodes/`),
      );
    }
    return scopedNode.childPointers
      .map((pointer) => index.nodes.get(pointer))
      .filter((node): node is IndexedNode => node !== undefined);
  }

  return nodes.filter((node) =>
    recursive
      ? node.pointer.startsWith(`${scope}/`)
      : isDirectArrayChild(node.pointer, scope),
  );
}

function resolveChildMatch(
  index: IndexedAsset,
  match: StructuredDataMatch,
  selector: StructuredDataSelector,
): StructuredDataMatch {
  assertSingleExpected(selector, "Single-target child selectors");
  const indexed = index.nodes.get(match.pointer);
  if (!indexed) {
    throw new Error(`StructuredData match pointer ${match.pointer} is not indexed.`);
  }

  const childMatches = indexed.childPointers
    .map((pointer) => index.nodes.get(pointer))
    .filter((node): node is IndexedNode => node !== undefined)
    .filter((node) => nodeMatches(index, node, selector))
    .map((node) => matchForNode(index, node));
  const expected = 1;

  if (childMatches.length !== expected) {
    throw new Error(
      `Expected ${expected} child structuredData match under ${match.pointer}, matched ${childMatches.length}. Candidate pointers: ${childMatches.map((child) => child.pointer).join(", ") || "(none)"}.`,
    );
  }

  return childMatches[0]!;
}

function assertSingleExpected(
  selector: StructuredDataSelector,
  context: string,
): void {
  if (
    selector.expected_matches !== undefined &&
    selector.expected_matches !== 1
  ) {
    throw new Error(`${context} require expected_matches to be 1 when provided.`);
  }
}

function nodeMatches(
  index: IndexedAsset,
  node: IndexedNode,
  selector: StructuredDataSelector,
): boolean {
  if (selector.node_type !== undefined && node.type !== selector.node_type) {
    return false;
  }
  if (
    selector.identifier !== undefined &&
    node.identifier !== selector.identifier
  ) {
    return false;
  }
  if (
    selector.text_equals !== undefined &&
    node.node.text !== selector.text_equals
  ) {
    return false;
  }
  if (
    selector.text_contains !== undefined &&
    !String(node.node.text ?? "").includes(selector.text_contains)
  ) {
    return false;
  }
  if (
    selector.field_equals &&
    !Object.entries(selector.field_equals).every(([field, value]) =>
      hasOwn(node.node, field) && Object.is(node.node[field], value),
    )
  ) {
    return false;
  }
  if (
    selector.field_contains &&
    !Object.entries(selector.field_contains).every(([field, value]) =>
      hasOwn(node.node, field) && String(node.node[field] ?? "").includes(value),
    )
  ) {
    return false;
  }
  if (selector.where_child) {
    const matchedChildCount = node.childPointers.filter((pointer) => {
      const child = index.nodes.get(pointer);
      return child ? nodeMatches(index, child, selector.where_child!) : false;
    }).length;
    if (selector.where_child.expected_matches !== undefined) {
      if (matchedChildCount !== selector.where_child.expected_matches) return false;
    } else if (matchedChildCount === 0) {
      return false;
    }
  }

  return true;
}

function matchForNode(
  index: IndexedAsset,
  node: IndexedNode,
): StructuredDataMatch {
  return {
    pointer: node.pointer,
    node: node.node,
    node_type: node.type,
    identifier: node.identifier,
    preview: previewForNode(index, node),
  };
}

function previewForNode(index: IndexedAsset, node: IndexedNode): unknown {
  if (node.type === "text") return node.node.text ?? "";
  if (node.type === "asset") return assetPreview(node.node);

  const preview: Record<string, unknown> = {};
  for (const childPointer of node.childPointers) {
    const child = index.nodes.get(childPointer);
    if (!child?.identifier) continue;
    const value =
      child.type === "text"
        ? child.node.text ?? ""
        : child.type === "asset"
          ? assetPreview(child.node)
          : `[${child.type ?? "node"}]`;
    assignPreviewValue(preview, child.identifier, value);
  }
  return preview;
}

function assetPreview(node: Record<string, unknown>): Record<string, unknown> {
  const preview: Record<string, unknown> = {};
  for (const field of [
    "assetType",
    "blockId",
    "blockPath",
    "fileId",
    "filePath",
    "pageId",
    "pagePath",
    "symlinkId",
    "symlinkPath",
  ]) {
    if (node[field] !== undefined) preview[field] = node[field];
  }
  return preview;
}

function assignPreviewValue(
  preview: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const existing = preview[key];
  if (existing === undefined) {
    preview[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    preview[key] = [existing, value];
  }
}

function compareValue(
  actual: unknown,
  comparison: StructuredDataComparison,
  expected: unknown,
): boolean {
  switch (comparison) {
    case "equals":
      return Object.is(actual, expected);
    case "contains":
      return String(actual ?? "").includes(String(expected ?? ""));
    case "exists":
      return actual !== undefined;
    case "not_exists":
      return actual === undefined;
  }
}

function arrayPosition(pointer: string): {
  parentPointer: string;
  index: number;
} {
  const slash = pointer.lastIndexOf("/");
  if (slash <= 0) {
    throw new Error(`Pointer ${pointer} does not reference an array item.`);
  }
  const parentPointer = pointer.slice(0, slash);
  const index = Number(pointer.slice(slash + 1));
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Pointer ${pointer} does not end with an array index.`);
  }
  return { parentPointer, index };
}

function isDirectArrayChild(pointer: string, arrayPointer: string): boolean {
  if (!pointer.startsWith(`${arrayPointer}/`)) return false;
  const rest = pointer.slice(arrayPointer.length + 1);
  return /^[0-9]+$/.test(rest);
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}
