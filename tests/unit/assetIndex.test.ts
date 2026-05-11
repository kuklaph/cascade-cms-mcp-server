import { describe, test, expect } from "bun:test";
import {
  accrdnFixture,
  buttonBlockFixture,
  nonPageAssets,
  pageFixture,
  storySliderFixture,
  tabsFixture,
  wysiwygFixture,
} from "../fixtures/read-response-fixtures.js";
import {
  ASSET_READ_CACHE_MAX_ENTRIES,
  CHARACTER_LIMIT,
} from "../../src/constants.js";
import { buildRawFactIndex, listScalarArtifacts } from "../../src/assetFacts.js";
import {
  buildAssetIndex,
  createAssetCache,
  getRawValue,
  getIndexedNode,
  listAssetScalarArtifacts,
  listRawFacts,
  listRawReferences,
  listIndexedChildren,
  resolveJsonPointer,
  searchRawKeys,
  searchRawValues,
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
  test("indexes every raw object, array, scalar, and object key with JSON Pointer provenance", () => {
    const raw = {
      "a/b": {
        "c~d": [null, true, 7, "", "prefix " + "x".repeat(240) + " suffix"],
      },
      repeated: { name: "first" },
      repeated2: { name: "second" },
    };
    const original = structuredClone(raw);
    const index = buildAssetIndex(raw, "a_raw_facts");

    expect(index.raw).toBe(raw);
    expect(raw).toEqual(original);
    expect(index.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(index.totalFactCount).toBe(index.rawFacts.length);

    const facts = listRawFacts(index, { limit: 100 });
    expect(facts.complete).toBe(true);
    expect(facts.total_fact_count).toBe(index.rawFacts.length);
    expect(facts.results.some((fact) => fact.fact_kind === "object" && fact.pointer === "")).toBe(true);
    expect(facts.results.some((fact) => fact.fact_kind === "array" && fact.pointer === "/a~1b/c~0d")).toBe(true);
    expect(facts.results.some((fact) => fact.fact_kind === "key" && fact.key === "c~d")).toBe(true);
    expect(facts.results.some((fact) => fact.fact_kind === "scalar" && fact.pointer === "/a~1b/c~0d/2")).toBe(true);

    for (const fact of facts.results) {
      expect(resolveJsonPointer(raw, fact.pointer)).not.toBeUndefined();
    }
  });

  test("searches full raw scalar values beyond previews and retrieves long strings by slice", () => {
    const long = "start-" + "x".repeat(220) + "-needle-at-end";
    const index = buildAssetIndex({ content: long }, "a_search");

    const matches = searchRawValues(index, { value_contains: "needle-at-end" });
    expect(matches.complete).toBe(true);
    expect(matches.results).toHaveLength(1);
    expect(matches.results[0]!.pointer).toBe("/content");
    expect(matches.results[0]!.value_preview).not.toContain("needle-at-end");
    expect(matches.results[0]!.match_offsets).toEqual([227]);

    const sliced = getRawValue(index, "/content", { offset: 227, length: 13 });
    expect(sliced.value).toBe("needle-at-end");
    expect(sliced.value_length).toBe(long.length);
    expect(sliced.has_more).toBe(false);
  });

  test("get raw value bounds omitted string length and rejects object or array values", () => {
    const long = "x".repeat(CHARACTER_LIMIT + 10);
    const index = buildAssetIndex({ content: long, nested: { title: "x" }, list: [1] }, "a_bounds");

    const defaultSlice = getRawValue(index, "/content");
    expect(defaultSlice.value).toBe("x".repeat(CHARACTER_LIMIT));
    expect(defaultSlice.has_more).toBe(true);
    expect(defaultSlice.next_offset).toBe(CHARACTER_LIMIT);

    expect(() => getRawValue(index, "")).toThrow("resolves to an object");
    expect(() => getRawValue(index, "/nested")).toThrow("resolves to an object");
    expect(() => getRawValue(index, "/list")).toThrow("resolves to an array");
  });

  test("raw fact indexing fails closed on excessive nesting", () => {
    let raw: Record<string, unknown> = {};
    const root = raw;
    for (let i = 0; i < 501; i++) {
      raw.child = {};
      raw = raw.child as Record<string, unknown>;
    }

    expect(() => buildRawFactIndex(root)).toThrow("too deep");
  });

  test("searches raw object keys anywhere in the cached response", () => {
    const index = buildAssetIndex(
      { metadata: { title: "One" }, nested: [{ title: "Two" }] },
      "a_keys",
    );

    const matches = searchRawKeys(index, { key_contains: "title" });
    expect(matches.matched_count_total).toBe(2);
    expect(matches.results.map((match) => match.pointer).sort()).toEqual([
      "/metadata/title",
      "/nested/0/title",
    ]);
  });

  test("indexes generic and page-region Cascade references with source pointers", () => {
    const index = buildAssetIndex(
      {
        asset: {
          page: {
            siteId: "site-1",
            siteName: "Main",
            contentTypeId: "ct-1",
            contentTypePath: "/content-types/default",
            pageConfigurations: [
              {
                name: "default",
                templateId: "tpl-1",
                templatePath: "/templates/main",
                pageRegions: [
                  {
                    name: "DEFAULT",
                    blockId: "blk-1",
                    blockPath: "/blocks/main",
                    formatPath: "/formats/main",
                    noBlock: false,
                    noFormat: true,
                  },
                ],
              },
            ],
            structuredData: {
              structuredDataNodes: [
                {
                  identifier: "cta",
                  type: "asset",
                  pagePath: "/about",
                  siteName: "Main",
                },
              ],
            },
          },
        },
      },
      "a_refs",
    );

    const refs = listRawReferences(index, { limit: 20 });
    expect(refs.complete).toBe(true);
    expect(refs.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference_kind: "contentType",
          id: "ct-1",
          path: "/content-types/default",
          site_id: "site-1",
          site_name: "Main",
        }),
        expect.objectContaining({
          reference_kind: "template",
          source_pointer: "/asset/page/pageConfigurations/0/templatePath",
        }),
        expect.objectContaining({
          reference_kind: "block",
          source_pointer: "/asset/page/pageConfigurations/0/pageRegions/0/blockPath",
          region_name: "DEFAULT",
        }),
        expect.objectContaining({
          reference_kind: "noFormat",
          source_pointer: "/asset/page/pageConfigurations/0/pageRegions/0/noFormat",
          value: true,
        }),
        expect.objectContaining({
          reference_kind: "page",
          source_pointer: "/asset/page/structuredData/structuredDataNodes/0/pagePath",
          path: "/about",
        }),
      ]),
    );
  });

  test("raw fact pagination ties cursors to filter hashes and reports completeness honestly", () => {
    const index = buildAssetIndex({ a: "one", b: "two", c: "three" }, "a_page");
    const first = listRawFacts(index, {
      fact_kind: "scalar",
      limit: 2,
    });

    expect(first.results).toHaveLength(2);
    expect(first.complete).toBe(false);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBeDefined();

    const second = listRawFacts(index, {
      fact_kind: "scalar",
      limit: 2,
      cursor: first.next_cursor,
    });
    expect(second.results).toHaveLength(1);
    expect(second.complete).toBe(true);

    expect(() =>
      listRawFacts(index, {
        fact_kind: "key",
        cursor: first.next_cursor,
      }),
    ).toThrow("cursor does not match");
  });

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

  test("canonicalizes known non-page envelopes from top-level and asset-wrapped responses", () => {
    const cases = [
      "page",
      "xhtmlDataDefinitionBlock",
      "symlink",
      "scriptFormat",
      "dataDefinition",
      "template",
      "indexBlock",
      "metadataSet",
      "site",
      "file",
    ] as const;
    const samples: Record<string, unknown> = {
      page: {
        page: {
          id: "fixture-page",
          name: "index",
          path: "/",
          type: "page",
          structuredData: { structuredDataNodes: [] },
        },
      },
      xhtmlDataDefinitionBlock: tabsFixture,
      symlink: {
        symlink: {
          id: "fixture-symlink",
          name: "library",
          path: "academics/library.sym",
          type: "symlink",
          linkURL: "https://library.example.edu/",
        },
      },
      ...nonPageAssets,
    };

    for (const key of cases) {
      const topLevel = buildAssetIndex(samples[key], `a_${key}_top`);
      const wrapped = buildAssetIndex({ success: true, asset: samples[key] }, `a_${key}_wrapped`);

      expect(topLevel.assetType).toBe(key);
      expect(wrapped.assetType).toBe(key);
      expect(wrapped.assetIdentity.id).toBe(topLevel.assetIdentity.id);
      if (key !== "page" && key !== "xhtmlDataDefinitionBlock") {
        expect(toAssetPreview(topLevel).node_count).toBe(0);
      }
    }
  });

  test("does not treat CLI metadata objects or ambiguous envelopes as an arbitrary asset", () => {
    const manifestLike = buildAssetIndex(
      { site: "_fixture", assets: { "index.page.json": { type: "page" } } },
      "a_manifest",
    );
    const ambiguous = buildAssetIndex(
      {
        page: {
          id: "page-id",
          type: "page",
          name: "index",
          structuredData: { structuredDataNodes: [] },
        },
        file: { id: "file-id", type: "file", name: "robots.txt", text: "hi" },
      },
      "a_ambiguous",
    );

    expect(manifestLike.assetType).toBe("unknown");
    expect(manifestLike.assetIdentity).toEqual({});
    expect(ambiguous.assetType).toBe("unknown");
    expect(ambiguous.assetIdentity).toEqual({});
  });

  test("keeps decoded inner asset fallback when the object itself has a type", () => {
    const index = buildAssetIndex(
      {
        id: "decoded-page",
        name: "index",
        path: "/",
        type: "page",
        structuredData: { structuredDataNodes: [] },
      },
      "a_decoded",
    );

    expect(index.assetType).toBe("page");
    expect(index.assetIdentity.id).toBe("decoded-page");
  });

  test("resolves exact JSON Pointers, including escaped object keys", () => {
    const raw = { "a/b": { "c~d": 42 } };

    expect(resolveJsonPointer(raw, "/a~1b/c~0d")).toBe(42);
  });

  test("does not coerce invalid array pointer segments", () => {
    const raw = { items: ["first", "second"] };

    expect(resolveJsonPointer(raw, "/items/0")).toBe("first");
    expect(resolveJsonPointer(raw, "/items/01")).toBeUndefined();
    expect(resolveJsonPointer(raw, "/items/")).toBeUndefined();
    expect(resolveJsonPointer(raw, "/items/-")).toBeUndefined();

    const index = buildAssetIndex(raw, "a_pointer");
    expect(getRawValue(index, "/items/0").value).toBe("first");
    expect(() => getRawValue(index, "/items/01")).toThrow("not found");
    expect(() => getRawValue(index, "/items/")).toThrow("not found");
    expect(() => getRawValue(index, "/items/-")).toThrow("not found");
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
    expect(preview.raw_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.index_version).toBe(1);
    expect(preview.audit_complete).toBe(false);
    expect(preview.total_fact_count).toBeGreaterThan(preview.node_count);
    expect(preview.node_count).toBe(11);
    expect("asset" in preview).toBe(false);
    expect(preview.next_actions).toContain("cascade_asset_list_facts");
    expect(preview.next_actions).toContain("cascade_asset_list_scalar_artifacts");
    expect(preview.omitted_fields).toEqual(["structuredData"]);
  });

  test("preview lists only present omitted detail fields on the inner asset body", () => {
    const preview = toAssetPreview(
      buildAssetIndex(
        {
          asset: {
            page: {
              type: "page",
              structuredData: { structuredDataNodes: [] },
              xhtml: "<p>body</p>",
              xml: "<xml/>",
              script: "alert(1)",
              text: "plain",
              data: [1, 2, 3],
              pageConfigurations: [],
            },
          },
        },
        "a_omitted",
      ),
    );

    expect(preview.omitted_fields).toEqual([
      "structuredData",
      "xhtml",
      "xml",
      "script",
      "text",
      "data",
      "pageConfigurations",
    ]);
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

  test("asset cache default retains a wider batch of read handles", () => {
    const cache = createAssetCache();
    const entries = Array.from({ length: ASSET_READ_CACHE_MAX_ENTRIES + 1 }, (_, index) =>
      cache.put({ asset: { page: { id: String(index), type: "page" } } }),
    );

    expect(cache.size()).toBe(ASSET_READ_CACHE_MAX_ENTRIES);
    expect(cache.get(entries[0]!.handle)).toBeUndefined();
    expect(cache.get(entries[1]!.handle)).toBe(entries[1]);
    expect(cache.get(entries.at(-1)!.handle)).toBe(entries.at(-1));
  });
});

describe("scalar artifact audit view", () => {
  const raw = {
    asset: {
      page: {
        name: "index",
        pagePath: "academics/library",
        rootLink: "/about/",
        html: '<a href="https://example.edu/about?x=1#top">About</a><img src="/_files/logo.svg"><a href="mailto:web@example.edu">Email</a><a href="tel:+19105551212">Call</a>',
        note: "Jump to #content and call tel:+19105550000.",
      },
    },
  };

  test("extracts link-like artifacts from raw scalar facts with exact offsets", () => {
    const index = buildAssetIndex(structuredClone(raw), "a_artifacts");
    const page = listScalarArtifacts(index, { limit: 100 });

    expect(page.complete).toBe(true);
    expect(page.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact_kind: "http_url", value: "https://example.edu/about?x=1#top" }),
        expect.objectContaining({ artifact_kind: "href", value: "https://example.edu/about?x=1#top" }),
        expect.objectContaining({ artifact_kind: "src", value: "/_files/logo.svg" }),
        expect.objectContaining({ artifact_kind: "mailto", value: "mailto:web@example.edu" }),
        expect.objectContaining({ artifact_kind: "tel", value: "tel:+19105551212" }),
        expect.objectContaining({ artifact_kind: "anchor", value: "#content" }),
        expect.objectContaining({ artifact_kind: "root_path", value: "/about/" }),
        expect.objectContaining({ artifact_kind: "site_link", value: "academics/library" }),
      ]),
    );

    for (const artifact of page.results) {
      const source = resolveJsonPointer(raw, artifact.source_pointer);
      expect(typeof source).toBe("string");
      expect((source as string).slice(artifact.start_offset, artifact.end_offset)).toBe(
        artifact.value,
      );
      expect(artifact.scalar_type).toBe("string");
      expect(artifact.value_length).toBe((source as string).length);
      expect(artifact.context_preview).toContain(artifact.value);
    }
  });

  test("filters scalar artifacts and preserves the raw JSON", () => {
    const source = structuredClone(raw);
    const index = buildAssetIndex(source, "a_filters");

    expect(
      listAssetScalarArtifacts(index, {
        pointer_prefix: "/asset/page",
        key: "html",
        artifact_kind: "href",
      }).results.map((artifact) => artifact.value),
    ).toEqual(["https://example.edu/about?x=1#top", "mailto:web@example.edu", "tel:+19105551212"]);

    expect(
      listScalarArtifacts(index, {
        key_contains: "root",
        value_contains: "about",
      }).results.map((artifact) => artifact.artifact_kind),
    ).toEqual(["root_path"]);

    expect(source).toEqual(raw);
  });

  test("paginates scalar artifacts with matching audit cursor semantics", () => {
    const index = buildAssetIndex(raw, "a_artifact_page");
    const first = listScalarArtifacts(index, { limit: 2 });

    expect(first.results).toHaveLength(2);
    expect(first.complete).toBe(false);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBeDefined();

    const second = listScalarArtifacts(index, {
      limit: 2,
      cursor: first.next_cursor,
    });
    expect(second.cursor).toBe(first.next_cursor);
    expect(second.results).toHaveLength(2);

    expect(() =>
      listScalarArtifacts(index, {
        artifact_kind: "href",
        cursor: first.next_cursor,
      }),
    ).toThrow("cursor does not match");
  });

  test("reports href and src offsets from the quoted value when values repeat attribute names", () => {
    const html = '<a href="href">Link</a><img src="src" alt="image">';
    const index = buildAssetIndex({ asset: { page: { type: "page", html } } }, "a_attr_offsets");
    const artifacts = listScalarArtifacts(index, {}).results;
    const href = artifacts.find((artifact) => artifact.artifact_kind === "href");
    const src = artifacts.find((artifact) => artifact.artifact_kind === "src");

    expect(href?.value).toBe("href");
    expect(href?.start_offset).toBe(html.indexOf('"href"') + 1);
    expect(href?.end_offset).toBe(html.indexOf('"href"') + 5);
    expect(html.slice(href!.start_offset, href!.end_offset)).toBe("href");

    expect(src?.value).toBe("src");
    expect(src?.start_offset).toBe(html.indexOf('"src"') + 1);
    expect(src?.end_offset).toBe(html.indexOf('"src"') + 4);
    expect(html.slice(src!.start_offset, src!.end_offset)).toBe("src");
  });

  test("caps scalar artifact extraction before dense strings can materialize unbounded results", () => {
    const denseHtml = Array.from({ length: 10_050 }, (_, index) => `<a href="/p${index}">x</a>`).join("");
    const index = buildAssetIndex({ asset: { page: { type: "page", html: denseHtml } } }, "a_dense");
    const page = listScalarArtifacts(index, { artifact_kind: "href", limit: 500 });

    expect(page.results).toHaveLength(500);
    expect(page.matched_count_total).toBe(10_000);
    expect(page.complete).toBe(false);
    expect(page.truncated).toBe(true);
    expect(page.next_cursor).toBeDefined();
  });
});
