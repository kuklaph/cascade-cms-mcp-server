import { describe, test, expect } from "bun:test";
import tabsFixture from "../fixtures/read-responses/tabs.xhtmlBlock.json";
import storySliderFixture from "../fixtures/read-responses/story-slider.xhtmlBlock.json";
import wysiwygFixture from "../fixtures/read-responses/wysiwyg.xhtmlBlock.json";
import buttonBlockFixture from "../fixtures/read-responses/button-block.xhtmlBlock.json";
import accrdnFixture from "../fixtures/read-responses/accrdn.xhtmlBlock.json";
import pageFixture from "../fixtures/read-responses/page-details.json";
import {
  buildAssetIndex,
  createAssetCache,
  getIndexedNode,
  listIndexedChildren,
  resolveJsonPointer,
  searchIndexedNodes,
  toAssetPreview,
} from "../../src/assetIndex.js";

describe("read-response fixtures", () => {
  test.each([
    ["tabs", tabsFixture, 11],
    ["story-slider", storySliderFixture, 62],
    ["wysiwyg", wysiwygFixture, 6],
    ["button-block", buttonBlockFixture, 10],
    ["accrdn", accrdnFixture, 30],
  ])("%s fixture indexes all recursive nodelets", (_name, fixture, count) => {
    const index = buildAssetIndex(fixture, "a_fixture");

    expect(index.nodeCount).toBe(count);
  });

  test("page fixture indexes page structured data without using unresolved PRD counts", () => {
    const index = buildAssetIndex(pageFixture, "a_page");

    expect(index.assetType).toBe("page");
    expect(index.nodeCount).toBe(152);
    expect(index.maxDepth).toBeGreaterThan(1);
  });
});

describe("asset nodelet index", () => {
  test("preserves the raw response exactly while indexing", () => {
    const original = structuredClone(storySliderFixture);
    const index = buildAssetIndex(storySliderFixture, "a_raw");

    expect(index.raw).toBe(storySliderFixture);
    expect(storySliderFixture).toEqual(original);
  });

  test("canonicalizes top-level and asset-wrapped Cascade read shapes", () => {
    const topLevel = buildAssetIndex(tabsFixture, "a_top");
    const wrapped = buildAssetIndex(
      { success: true, asset: tabsFixture },
      "a_wrapped",
    );

    expect(topLevel.assetType).toBe("xhtmlDataDefinitionBlock");
    expect(wrapped.assetType).toBe("xhtmlDataDefinitionBlock");
    expect(wrapped.nodeCount).toBe(topLevel.nodeCount);
  });

  test("resolves exact JSON Pointers, including escaped object keys", () => {
    const raw = { "a/b": { "c~d": 42 } };

    expect(resolveJsonPointer(raw, "/a~1b/c~0d")).toBe(42);
  });

  test("looks up exact nodelets by pointer", () => {
    const index = buildAssetIndex(buttonBlockFixture, "a_button");
    const first = index.rootPointers[0]!;
    const node = getIndexedNode(index, first, { depth: 0 });

    expect(node.pointer).toBe(first);
    expect(node.node.identifier).toBe("button-block");
    expect(node.node.child_count).toBeGreaterThan(0);
    expect(node.node.structuredDataNodes).toBeUndefined();
  });

  test("lists children with opaque cursors", () => {
    const index = buildAssetIndex(storySliderFixture, "a_story");
    const root = index.rootPointers[0]!;
    const firstPage = listIndexedChildren(index, root, { limit: 2 });

    expect(firstPage.children).toHaveLength(2);
    expect(firstPage.next_cursor).toMatch(/^c_[0-9]+$/);

    const secondPage = listIndexedChildren(index, root, {
      cursor: firstPage.next_cursor,
      limit: 2,
    });
    expect(secondPage.children[0]!.pointer).not.toBe(firstPage.children[0]!.pointer);
  });

  test("search finds repeated identifiers, stripped HTML text, and asset refs", () => {
    const tabs = buildAssetIndex(tabsFixture, "a_tabs");
    const story = buildAssetIndex(storySliderFixture, "a_story");

    const repeated = searchIndexedNodes(story, { query: "slide", limit: 10 });
    expect(repeated.matches.length).toBeGreaterThan(1);
    expect(new Set(repeated.matches.map((m) => m.pointer)).size).toBe(
      repeated.matches.length,
    );

    const html = searchIndexedNodes(tabs, { query: "caption", limit: 5 });
    expect(html.matches.some((m) => m.preview.includes("<"))).toBe(false);

    const assetRefs = searchIndexedNodes(story, {
      query: "page,file,symlink",
      search_in: ["asset"],
      type: "asset",
      limit: 5,
    });
    expect(assetRefs.matches[0]!.type).toBe("asset");
  });

  test("preview omits recursive structuredData and exposes follow-up actions", () => {
    const index = buildAssetIndex(tabsFixture, "a_preview");
    const preview = toAssetPreview(index);

    expect(preview.asset_handle).toBe("a_preview");
    expect(preview.raw_resource_uri).toBe("cascade://asset/a_preview/raw");
    expect(preview.node_count).toBe(11);
    expect("asset" in preview).toBe(false);
    expect(preview.next_actions).toContain("cascade_asset_search_paths");
  });

  test("asset cache validates handles and reports misses without calling Cascade", () => {
    const cache = createAssetCache({ maxEntries: 1 });
    const entry = cache.put(tabsFixture);

    expect(entry.handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(cache.get(entry.handle)).toBe(entry);
    expect(cache.get("not-a-handle")).toBeUndefined();

    cache.put(wysiwygFixture);
    expect(cache.get(entry.handle)).toBeUndefined();
  });
});
