import { describe, expect, test } from "bun:test";
import { buildAssetIndex } from "../../src/assetIndex.js";
import {
  evaluateStructuredDataAssertions,
  resolveStructuredDataNodes,
  resolveStructuredDataTarget,
  semanticFieldPatchOperations,
  semanticNodePatchOperations,
} from "../../src/structuredDataSelectors.js";

const raw = {
  asset: {
    xhtmlDataDefinitionBlock: {
      structuredData: {
        definitionPath: "/Blocks/Card Set",
        structuredDataNodes: [
          {
            type: "group",
            identifier: "card",
            structuredDataNodes: [
              { type: "text", identifier: "title", text: "Alpha" },
              { type: "text", identifier: "description", text: "First card" },
              {
                type: "asset",
                identifier: "link",
                assetType: "page",
                pagePath: "alpha",
              },
            ],
          },
          {
            type: "group",
            identifier: "card",
            structuredDataNodes: [
              { type: "text", identifier: "title", text: "Beta" },
              { type: "text", identifier: "description", text: "Second card" },
              {
                type: "asset",
                identifier: "link",
                assetType: "page",
                pageId: "page-beta",
              },
            ],
          },
          { type: "asset", identifier: "profile", assetType: "page", pagePath: "people/jane" },
        ],
      },
    },
  },
};

const index = buildAssetIndex(raw, "a_test");

describe("structuredDataSelectors", () => {
  test("resolves repeated group by child text and returns stable pointers", () => {
    const result = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: {
        node_type: "text",
        identifier: "title",
        text_equals: "Beta",
      },
      expected_matches: 1,
    });

    expect(result.matched_count).toBe(1);
    expect(result.matches[0]).toMatchObject({
      pointer:
        "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/1",
      node_type: "group",
      identifier: "card",
    });
    expect(result.matches[0].preview).toEqual(
      expect.objectContaining({ title: "Beta", description: "Second card" }),
    );
  });

  test("resolves by child asset field and own asset field", () => {
    const byChild = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: {
        node_type: "asset",
        identifier: "link",
        field_equals: { pageId: "page-beta" },
      },
      expected_matches: 1,
    });
    expect(byChild.matches[0].pointer).toEndWith("/structuredDataNodes/1");

    const byOwnField = resolveStructuredDataNodes(index, {
      node_type: "asset",
      identifier: "profile",
      field_equals: { pagePath: "people/jane" },
      expected_matches: 1,
    });
    expect(byOwnField.matches[0].pointer).toEndWith("/structuredDataNodes/2");
  });

  test("where_child expected_matches is enforced against matching children", () => {
    expect(
      resolveStructuredDataNodes(index, {
        node_type: "group",
        identifier: "card",
        where_child: {
          node_type: "text",
          identifier: "title",
          text_contains: "Alpha",
          expected_matches: 0,
        },
      }).matched_count,
    ).toBe(1);

    expect(
      resolveStructuredDataNodes(index, {
        node_type: "group",
        identifier: "card",
        where_child: {
          node_type: "text",
          identifier: "title",
          text_contains: "Alpha",
          expected_matches: 1,
        },
      }).matched_count,
    ).toBe(1);
  });

  test("respects scope pointer and recursive false", () => {
    const card = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Alpha" },
      expected_matches: 1,
    }).matches[0];

    expect(
      resolveStructuredDataNodes(index, {
        scope_pointer: `${card.pointer}/structuredDataNodes`,
        recursive: false,
        node_type: "text",
        identifier: "description",
        expected_matches: 1,
      }).matches[0].pointer,
    ).toBe(`${card.pointer}/structuredDataNodes/1`);

    expect(() =>
      resolveStructuredDataNodes(index, {
        scope_pointer: `${card.pointer}/structuredDataNodes`,
        recursive: false,
        node_type: "asset",
        identifier: "profile",
        expected_matches: 1,
      }),
    ).toThrow(/Expected 1 structuredData match/);
  });

  test("throws on ambiguous expected match and includes candidate pointers", () => {
    expect(() =>
      resolveStructuredDataNodes(index, {
        node_type: "group",
        identifier: "card",
        expected_matches: 1,
      }),
    ).toThrow(/matched 2/);
  });

  test("field filters only inspect own node fields", () => {
    expect(() =>
      resolveStructuredDataNodes(index, {
        node_type: "text",
        field_contains: { constructor: "native" },
        expected_matches: 1,
      }),
    ).toThrow(/Expected 1 structuredData match, matched 0/);
  });

  test("resolves child target fields", () => {
    const match = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Alpha" },
      expected_matches: 1,
    }).matches[0];

    const target = resolveStructuredDataTarget(index, match, {
      child: { node_type: "text", identifier: "description" },
      field: "text",
    });

    expect(target.pointer).toBe(`${match.pointer}/structuredDataNodes/1/text`);
    expect(target.value).toBe("First card");
  });

  test("single-target patch resolution always requires exactly one match", () => {
    expect(() =>
      semanticFieldPatchOperations(index, {
        op: "replace",
        match: {
          node_type: "group",
          identifier: "card",
          expected_matches: 2,
        },
        target: { child: { node_type: "text", identifier: "description" }, field: "text" },
        value: "Updated",
      }),
    ).toThrow(/Single-target selectors require expected_matches to be 1/);

    expect(() =>
      semanticFieldPatchOperations(index, {
        op: "replace",
        match: {
          node_type: "group",
          identifier: "card",
          where_child: { node_type: "text", identifier: "title", text_equals: "Alpha" },
          expected_matches: 1,
        },
        target: {
          child: {
            node_type: "text",
            expected_matches: 2,
          },
          field: "text",
        },
        value: "Updated",
      }),
    ).toThrow(/Single-target child selectors require expected_matches to be 1/);
  });

  test("builds semantic node patch operations for insert, remove, and same-parent move", () => {
    const alpha = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Alpha" },
      expected_matches: 1,
    }).matches[0];
    const beta = resolveStructuredDataNodes(index, {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
      expected_matches: 1,
    }).matches[0];
    const node = {
      type: "text" as const,
      identifier: "caption",
      text: "Inserted",
    };

    expect(semanticNodePatchOperations(index, { op: "insert_node", match: alpha, position: "after", node })).toEqual([
      { op: "add", path: "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/1", value: node },
    ]);
    expect(semanticNodePatchOperations(index, { op: "remove_node", match: beta })).toEqual([
      { op: "remove", path: beta.pointer },
    ]);
    expect(semanticNodePatchOperations(index, {
      op: "move_node",
      match: beta,
      destination: { match: alpha, position: "before" },
    })).toEqual([
      { op: "remove", path: beta.pointer },
      { op: "add", path: "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0", value: beta.node },
    ]);
  });

  test("evaluates assertions without mutating", () => {
    const result = evaluateStructuredDataAssertions(index, [
      {
        match: {
          node_type: "group",
          identifier: "card",
          where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
        },
        target: {
          child: { node_type: "text", identifier: "description" },
          field: "text",
        },
        comparison: "contains",
        expected: "Second",
      },
      {
        match: {
          node_type: "group",
          identifier: "card",
          where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
        },
        target: { child: { node_type: "text", identifier: "description" }, field: "text" },
        comparison: "equals",
        expected: "Wrong",
      },
    ]);

    expect(result.passed).toBe(false);
    expect(result.results.map((item) => item.passed)).toEqual([true, false]);
    expect(result.results[0].target_pointer).toContain("/text");
  });
});
