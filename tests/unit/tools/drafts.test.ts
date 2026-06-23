import { describe, expect, mock, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { createAssetCache } from "../../../src/assetIndex.js";
import { createResponseCache } from "../../../src/cache.js";
import { createDraftCache } from "../../../src/assetDrafts.js";
import { registerDraftTools } from "../../../src/tools/drafts.js";
import type { ToolBlockStore } from "../../../src/toolBlocks.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import { CREATE_OK, OK_RESULT, READ_PAGE_OK } from "../../fixtures/cascade-responses.js";
import { inputJsonSchema } from "../../fixtures/mock-server.js";

interface MockServer {
  registerTool: ReturnType<typeof mock>;
}

function makeMockServer(): {
  server: MockServer;
  tools: Array<{ name: string; config: any; handler: (input: unknown) => Promise<CallToolResult> }>;
} {
  const tools: Array<{ name: string; config: any; handler: (input: unknown) => Promise<CallToolResult> }> = [];
  const server: MockServer = {
    registerTool: mock((name: string, config: any, handler: any) => {
      tools.push({ name, config, handler });
      return {};
    }),
  };
  return { server, tools };
}

function findTool(tools: ReturnType<typeof makeMockServer>["tools"], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool;
}

function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") throw new Error("Expected text block");
  return block.text;
}

function makeStore(initial: unknown[] = []): ToolBlockStore {
  return {
    path: "C:\\tmp\\tool-blocks.json",
    read: mock(async () => initial as any),
    write: mock(async () => {}),
  };
}

const CREATE_ASSET = {
  page: {
    name: "new-page",
    parentFolderPath: "/",
    siteName: "my-site",
    contentTypePath: "/content-types/default",
    xhtml: "<p>New</p>",
  },
};

const SECRET_USER_ASSET = {
  user: {
    username: "jdoe",
    fullName: "Jane Doe",
    email: "jane@example.com",
    authType: "normal",
    password: "user-password-secret",
    groups: "Editors",
    roles: "Contributor",
  },
};

const EDIT_READ_PAGE = {
  ...READ_PAGE_OK,
  asset: {
    page: {
      ...READ_PAGE_OK.asset.page,
      xhtml: "<p>Home</p>",
    },
  },
};

const STRUCTURED_BLOCK_READ = {
  success: true,
  asset: {
    xhtmlDataDefinitionBlock: {
      id: "block-001",
      name: "cards",
      path: "/cards",
      parentFolderPath: "/components",
      siteName: "my-site",
      structuredData: {
        definitionPath: "/Blocks/Card Set",
        structuredDataNodes: [
          {
            type: "group",
            identifier: "card",
            structuredDataNodes: [
              { type: "text", identifier: "title", text: "Alpha" },
              { type: "text", identifier: "description", text: "First card" },
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
                pagePath: "beta",
                recycled: false,
              },
            ],
          },
        ],
      },
    },
  },
};

describe("draft tools", () => {
  test("registers draft workflow tools with draft-specific annotations", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "local_draft_apply_patch",
      "local_draft_apply_semantic_patch",
      "local_draft_assert_values",
      "local_draft_get_nodelet",
      "local_draft_get_value",
      "local_draft_list_facts",
      "local_draft_list_nodelets",
      "local_draft_list_references",
      "local_draft_list_scalar_artifacts",
      "local_draft_mutation_plan_execute",
      "local_draft_open",
      "local_draft_resolve_nodes",
      "local_draft_scaffold_create",
      "local_draft_scaffold_from_asset",
      "local_draft_search_keys",
      "local_draft_search_values",
      "local_draft_set_file_data",
      "local_draft_submit",
      "local_draft_validate",
    ]);
    expect(findTool(tools, "local_draft_get_value").config.annotations.readOnlyHint).toBe(true);
    expect(findTool(tools, "local_draft_apply_patch").config.annotations.readOnlyHint).toBe(false);
    expect(findTool(tools, "local_draft_open").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_scaffold_create").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_scaffold_from_asset").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_apply_patch").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_apply_semantic_patch").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_mutation_plan_execute").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_set_file_data").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_set_file_data").config.annotations.openWorldHint).toBe(true);
    expect(findTool(tools, "local_draft_submit").config.annotations.destructiveHint).toBe(true);
    expect(findTool(tools, "local_draft_submit").config.annotations.openWorldHint).toBe(true);
  });

  test("draft read helper descriptions guide scalar search and artifact selection", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    expect(findTool(tools, "local_draft_list_facts").config.description).toContain(
      "prefer local_draft_search_values",
    );
    expect(findTool(tools, "local_draft_search_values").config.description).toContain(
      "Best first choice for finding text/content by known snippet",
    );
    const artifacts = findTool(tools, "local_draft_list_scalar_artifacts");
    expect(artifacts.config.description).toContain("Use href for any value found in an HTML/XHTML href attribute");
    expect(artifacts.config.description).toContain("use site_link for non-root, non-URL Cascade *Path fields");
    expect(
      inputJsonSchema(artifacts.config.inputSchema).properties.artifact_kind
        .description,
    ).toContain(
      "Use href for any value found in an HTML/XHTML href attribute",
    );
  });

  test("resolves, semantically patches, and asserts repeated structuredData nodes", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const draftCache = createDraftCache();
    const client = createMockClient({
      read: mock(async () => STRUCTURED_BLOCK_READ),
      edit: mock(async () => OK_RESULT),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const match = {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
    };
    const resolved = await findTool(tools, "local_draft_resolve_nodes").handler({
      draft_handle: draftHandle,
      selector: match,
    });
    expect((resolved.structuredContent as Record<string, any>).matched_count).toBe(1);

    const patched = await findTool(tools, "local_draft_apply_semantic_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      match,
      target: { child: { node_type: "text", identifier: "description" }, field: "text" },
      op: "replace",
      value: "Updated second card",
    });
    expect((patched.structuredContent as Record<string, any>).revision).toBe(2);
    expect((patched.structuredContent as Record<string, any>).target_pointer).toContain("/text");
    expect((patched.structuredContent as Record<string, any>).before).toBe("Second card");
    expect((patched.structuredContent as Record<string, any>).after).toBe("Updated second card");

    const asserted = await findTool(tools, "local_draft_assert_values").handler({
      draft_handle: draftHandle,
      assertions: [
        {
          match,
          target: { child: { node_type: "text", identifier: "description" }, field: "text" },
          comparison: "contains",
          expected: "Updated",
        },
      ],
    });
    expect((asserted.structuredContent as Record<string, any>).passed).toBe(true);
  });

  test("semantic node insert and remove compile through draft patching", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const beta = {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
    };
    const inserted = await findTool(tools, "local_draft_apply_semantic_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      match: beta,
      op: "insert_node",
      position: "after",
      node: {
        type: "group",
        identifier: "card",
        structuredDataNodes: [{ type: "text", identifier: "title", text: "Gamma" }],
      },
    });
    expect((inserted.structuredContent as Record<string, any>).revision).toBe(2);

    const removed = await findTool(tools, "local_draft_apply_semantic_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 2,
      match: {
        node_type: "group",
        identifier: "card",
        where_child: { node_type: "text", identifier: "title", text_equals: "Gamma" },
      },
      op: "remove_node",
    });
    expect((removed.structuredContent as Record<string, any>).revision).toBe(3);
  });

  test("opens an edit draft from a read snapshot without mutating the read cache", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const client = createMockClient({
      read: mock(async () => EDIT_READ_PAGE),
      edit: mock(async () => OK_RESULT),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const open = findTool(tools, "local_draft_open");
    const patch = findTool(tools, "local_draft_apply_patch");
    const getValue = findTool(tools, "local_draft_get_value");
    const submit = findTool(tools, "local_draft_submit");

    const opened = await open.handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const openedBody = opened.structuredContent as Record<string, any>;

    expect(openedBody.draft_handle).toMatch(/^d_[0-9a-f-]+$/);
    expect(openedBody.revision).toBe(1);

    await patch.handler({
      draft_handle: openedBody.draft_handle,
      expected_revision: 1,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "draft-name" },
      ],
    });
    const patchResult = await patch.handler({
      draft_handle: openedBody.draft_handle,
      expected_revision: 2,
      operations: [
        { op: "replace", path: "/asset/page/xhtml", value: "<p>Draft body</p>" },
      ],
    });
    const patchBody = patchResult.structuredContent as Record<string, any>;
    expect(patchBody.draft).toBeUndefined();
    expect(JSON.stringify(patchBody)).not.toContain("structuredDataNodes");

    const readValue = await getValue.handler({
      draft_handle: openedBody.draft_handle,
      pointer: "/asset/page/name",
    });
    expect((readValue.structuredContent as Record<string, any>).value).toBe("draft-name");
    expect((readEntry.raw as any).asset.page.name).toBe("index");

    const submitted = await submit.handler({
      draft_handle: openedBody.draft_handle,
      expected_revision: 3,
    });

    expect(submitted.isError).not.toBe(true);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.edit).toHaveBeenCalledTimes(1);
    expect(client.edit.mock.calls[0][0]).toMatchObject({
      asset: { page: { id: "page-001", name: "draft-name", xhtml: "<p>Draft body</p>" } },
    });
    expect(client.edit.mock.calls[0][0].asset.page.type).toBeUndefined();
  });

  test("rejects stale edit drafts before calling Cascade edit", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const client = createMockClient({
      read: mock(async () => ({
        ...EDIT_READ_PAGE,
        asset: {
          page: {
            ...EDIT_READ_PAGE.asset.page,
            xhtml: "<p>Changed elsewhere</p>",
          },
        },
      })),
      edit: mock(async () => OK_RESULT),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });

    expect(submitted.isError).toBe(true);
    expect(firstText(submitted)).toContain("Source asset changed");
    expect(client.edit).not.toHaveBeenCalled();
  });

  test("rejects edit drafts whose target identity changed before submit", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const client = createMockClient({
      read: mock(async () => EDIT_READ_PAGE),
      edit: mock(async () => OK_RESULT),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    await findTool(tools, "local_draft_apply_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      operations: [
        { op: "replace", path: "/asset/page/id", value: "different-page-id" },
      ],
    });

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 2,
    });

    expect(submitted.isError).toBe(true);
    expect(firstText(submitted)).toContain("Edit draft target changed");
    expect(client.edit).not.toHaveBeenCalled();
  });

  test("draft-aware tool blocks reject open and patch before mutating local draft state", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const draftCache = createDraftCache();
    const client = createMockClient();
    const toolBlockStore = makeStore([
      { type: "page", id: "page-001", tools: ["local_draft_open"] },
      { type: "page", id: "blocked-page", tools: ["local_draft_apply_patch"] },
    ]);

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache,
      toolBlockStore,
    });

    const blockedOpen = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    expect(blockedOpen.isError).toBe(true);
    expect(draftCache.size()).toBe(0);

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const blockedPatch = await findTool(tools, "local_draft_apply_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      operations: [
        { op: "add", path: "/asset/page/id", value: "blocked-page" },
      ],
    });
    expect(blockedPatch.isError).toBe(true);
    const draft = draftCache.get(draftHandle)!;
    expect(draft.revision).toBe(1);
    expect(draft.root).toMatchObject({ asset: CREATE_ASSET });
  });

  test("final create and edit tool blocks reject local draft open before creating drafts", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const draftCache = createDraftCache();
    const client = createMockClient();
    const toolBlockStore = makeStore([
      { type: "page", id: "page-001", tools: ["edit"] },
      { type: "page", path: "/new-page", tools: ["create"] },
    ]);

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache,
      toolBlockStore,
    });

    const blockedEdit = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });

    expect(blockedEdit.isError).toBe(true);
    expect(firstText(blockedEdit)).toContain("edit page");
    expect(draftCache.size()).toBe(0);

    const blockedCreate = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });

    expect(blockedCreate.isError).toBe(true);
    expect(firstText(blockedCreate)).toContain("create page");
    expect(draftCache.size()).toBe(0);
  });

  test("direct scaffold create fails closed when generated-payload rules cannot be read", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    const read = mock(async () => {
      if (read.mock.calls.length === 1) return [];
      throw new Error("generated payload blocked");
    });
    const toolBlockStore: ToolBlockStore = {
      path: "C:\\tmp\\tool-blocks.json",
      read,
      write: mock(async () => {}),
    };

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
      toolBlockStore,
    });

    const result = await findTool(tools, "local_draft_scaffold_create").handler({
      asset_type: "page",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("generated payload blocked");
    expect(draftCache.size()).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("create path tool blocks reject scaffold patches before mutating local draft state", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    const toolBlockStore = makeStore([
      { type: "page", path: "/blocked-page", tools: ["create"] },
    ]);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
      toolBlockStore,
    });

    const opened = await findTool(tools, "local_draft_scaffold_create").handler({
      asset_type: "page",
    });
    const body = opened.structuredContent as Record<string, any>;

    const blockedPatch = await findTool(tools, "local_draft_apply_patch").handler({
      draft_handle: body.draft_handle,
      expected_revision: body.revision,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "blocked-page" },
        { op: "replace", path: "/asset/page/parentFolderPath", value: "/" },
        { op: "replace", path: "/asset/page/siteName", value: "my-site" },
      ],
    });

    expect(blockedPatch.isError).toBe(true);
    expect(firstText(blockedPatch)).toContain("create page");
    const draft = draftCache.get(body.draft_handle)!;
    expect(draft.revision).toBe(body.revision);
    expect(draft.root).toMatchObject({
      asset: {
        page: {
          name: null,
          parentFolderPath: null,
        },
      },
    });
  });

  test("create path tool blocks reject scaffold-from-asset before creating drafts", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const draftCache = createDraftCache();
    const toolBlockStore = makeStore([
      { type: "block_XHTML_DATADEFINITION", path: "/components/cards", tools: ["create"] },
    ]);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache,
      draftCache,
      toolBlockStore,
    });

    const blocked = await findTool(tools, "local_draft_scaffold_from_asset").handler({
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });

    expect(blocked.isError).toBe(true);
    expect(firstText(blocked)).toContain("create block_XHTML_DATADEFINITION");
    expect(draftCache.size()).toBe(0);
  });

  test("final create tool blocks reject draft file data before reading local input", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    const rules: Array<{ type: "file"; path: string; tools: string[] }> = [];
    const toolBlockStore = makeStore(rules);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
      toolBlockStore,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/assets",
          siteName: "my-site",
        },
      },
    });
    const body = opened.structuredContent as Record<string, any>;

    rules.push({ type: "file", path: "/assets/hero.jpg", tools: ["create"] });
    const blocked = await findTool(tools, "local_draft_set_file_data").handler({
      draft_handle: body.draft_handle,
      expected_revision: body.revision,
      input_path: "C:\\tmp\\missing-hero.jpg",
    });

    expect(blocked.isError).toBe(true);
    expect(firstText(blocked)).toContain("create file");
    const draft = draftCache.get(body.draft_handle)!;
    expect(draft.revision).toBe(body.revision);
    expect(draft.fileData).toBeUndefined();
  });

  test("draft read and validate tools check resolved draft payloads against tool blocks", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();
    const toolBlockStore = makeStore([
      { type: "page", id: "blocked-read", tools: ["local_draft_get_value"] },
      { type: "page", id: "blocked-validate", tools: ["local_draft_validate"] },
    ]);

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
      toolBlockStore,
    });

    const readBlockedDraft = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        page: {
          ...CREATE_ASSET.page,
          id: "blocked-read",
        },
      },
    });
    const readBlocked = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: (readBlockedDraft.structuredContent as Record<string, any>).draft_handle,
      pointer: "/asset/page/name",
    });
    expect(readBlocked.isError).toBe(true);
    expect(firstText(readBlocked)).toContain("Tool call denied");

    const validateBlockedDraft = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        page: {
          ...CREATE_ASSET.page,
          id: "blocked-validate",
        },
      },
    });
    const validateBlocked = await findTool(tools, "local_draft_validate").handler({
      draft_handle: (validateBlockedDraft.structuredContent as Record<string, any>).draft_handle,
    });
    expect(validateBlocked.isError).toBe(true);
    expect(firstText(validateBlocked)).toContain("local_draft_validate");
  });

  test("direct scaffold create fails closed when tool-block rules cannot be read", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    const toolBlockStore: ToolBlockStore = {
      path: "C:\\tmp\\tool-blocks.json",
      read: mock(async () => {
        throw new Error("repository unreadable");
      }),
      write: mock(async () => {}),
    };

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
      toolBlockStore,
    });

    const result = await findTool(tools, "local_draft_scaffold_create").handler({
      asset_type: "page",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("repository unreadable");
    expect(draftCache.size()).toBe(0);
  });

  test("lists draft nodelets with the same public shape as asset nodelets", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const listed = await findTool(tools, "local_draft_list_nodelets").handler({
      draft_handle: draftHandle,
      pointer: "",
      limit: 1,
    });
    const body = listed.structuredContent as Record<string, any>;

    expect(listed.isError).not.toBe(true);
    expect(body.success).toBe(true);
    expect(body.draft_handle).toBe(draftHandle);
    expect(body.nodelets).toHaveLength(1);
    expect(body.children).toBeUndefined();
    expect(body.next_cursor).toMatch(/^c_[0-9]+$/);
    expect(body.next_actions[0]).toMatchObject({
      tool: "local_draft_list_nodelets",
      input: { draft_handle: draftHandle, pointer: "", cursor: body.next_cursor, limit: 1 },
    });
    expect(body.next_actions[1]).toMatchObject({
      tool: "local_draft_get_nodelet",
      input: { draft_handle: draftHandle, pointer: body.nodelets[0].pointer },
    });
  });

  test("opens, patches, validates, and submits create drafts", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({ create: mock(async () => CREATE_OK) });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    await findTool(tools, "local_draft_apply_patch").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "created-name" },
      ],
    });

    const validation = await findTool(tools, "local_draft_validate").handler({
      draft_handle: draftHandle,
    });
    expect((validation.structuredContent as Record<string, any>).valid).toBe(true);

    const facts = await findTool(tools, "local_draft_list_facts").handler({
      draft_handle: draftHandle,
      limit: 1,
    });
    const nextActions = (facts.structuredContent as Record<string, any>).next_actions;
    expect(nextActions.every((action: any) => action.tool.startsWith("local_draft_"))).toBe(true);
    expect(nextActions.every((action: any) => action.input?.draft_handle === draftHandle)).toBe(true);
    expect(nextActions.some((action: any) => "asset_handle" in action.input)).toBe(false);

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 2,
    });

    expect(submitted.isError).not.toBe(true);
    expect(client.create).toHaveBeenCalledWith({
      asset: { page: { ...CREATE_ASSET.page, name: "created-name" } },
    });
  });

  test("sets draft file data from base64 and preserves existing text", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({ create: mock(async () => CREATE_OK) });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/",
          siteName: "my-site",
          text: "metadata text",
        },
      },
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;
    const setData = await findTool(tools, "local_draft_set_file_data").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      base64_data: "/9j/4Q==",
    });

    expect(setData.isError).not.toBe(true);
    expect(setData.structuredContent).toEqual(
      expect.objectContaining({
        success: true,
        bytes_total: 4,
        byte_preview_hex: "ff d8 ff e1",
        text_removed: false,
        revision: 2,
      }),
    );

    const data = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: draftHandle,
      pointer: "/asset/file/data",
    });
    const text = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: draftHandle,
      pointer: "/asset/file/text",
    });

    expect(data.structuredContent).toEqual(
      expect.objectContaining({
        file_data_attached: true,
        bytes_total: 4,
        byte_preview_hex: "ff d8 ff e1",
      }),
    );
    expect((data.structuredContent as Record<string, any>).value).toBeUndefined();
    expect((text.structuredContent as Record<string, any>).value).toBe("metadata text");

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 2,
    });

    expect(submitted.isError).not.toBe(true);
    expect(client.create).toHaveBeenCalledWith({
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/",
          siteName: "my-site",
          text: "metadata text",
          data: [-1, -40, -1, -31],
        },
      },
    });
  });

  test("sets draft file data from a local path and removes only null text placeholders", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-draft-file-data-"));
    const inputPath = join(dir, "hero.jpg");
    try {
      writeFileSync(inputPath, Uint8Array.from([255, 216, 255, 225]));
      const { server, tools } = makeMockServer();

      registerDraftTools(server as any, createMockClient(), {
        cache: createResponseCache(),
        assetCache: createAssetCache(),
        draftCache: createDraftCache(),
      });

      const opened = await findTool(tools, "local_draft_open").handler({
        operation: "create",
        asset: {
          file: {
            name: "hero.jpg",
            parentFolderPath: "/",
            siteName: "my-site",
            text: null,
          },
        },
      });
      const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;
      const setData = await findTool(tools, "local_draft_set_file_data").handler({
        draft_handle: draftHandle,
        expected_revision: 1,
        input_path: inputPath,
      });
      const text = await findTool(tools, "local_draft_get_value").handler({
        draft_handle: draftHandle,
        pointer: "/asset/file/text",
      });

      expect(setData.isError).not.toBe(true);
      expect((setData.structuredContent as Record<string, any>).text_removed).toBe(true);
      expect(text.isError).toBe(true);
      expect(firstText(text)).toContain("Pointer /asset/file/text not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sets large draft file data without storing it in draft JSON", async () => {
    const { server, tools } = makeMockServer();
    const bytes = Buffer.alloc(525_000, 255);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        file: {
          name: "large.bin",
          parentFolderPath: "/",
          siteName: "my-site",
        },
      },
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;
    const setData = await findTool(tools, "local_draft_set_file_data").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      base64_data: bytes.toString("base64"),
    });
    const validate = await findTool(tools, "local_draft_validate").handler({
      draft_handle: draftHandle,
    });
    const data = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: draftHandle,
      pointer: "/asset/file/data",
    });

    expect(setData.isError).not.toBe(true);
    expect((setData.structuredContent as Record<string, any>).bytes_total).toBe(bytes.length);
    expect(validate.structuredContent).toEqual(
      expect.objectContaining({
        valid: true,
        file_data_attached: true,
        file_data_bytes_total: bytes.length,
      }),
    );
    expect(data.structuredContent).toEqual(
      expect.objectContaining({
        file_data_attached: true,
        bytes_total: bytes.length,
      }),
    );
  });

  test("rejects stale draft file data revisions before reading local input", async () => {
    const { server, tools } = makeMockServer();

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/",
          siteName: "my-site",
        },
      },
    });
    const result = await findTool(tools, "local_draft_set_file_data").handler({
      draft_handle: (opened.structuredContent as Record<string, any>).draft_handle,
      expected_revision: 2,
      input_path: "C:\\tmp\\does-not-exist.jpg",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("expected_revision");
    expect(firstText(result)).not.toContain("does-not-exist");
  });

  test("submits manually patched unsigned draft file data as signed bytes", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({ create: mock(async () => CREATE_OK) });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/",
          siteName: "my-site",
          data: [255, 216],
        },
      },
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;
    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });

    expect(submitted.isError).not.toBe(true);
    expect(client.create).toHaveBeenCalledWith({
      asset: {
        file: {
          name: "hero.jpg",
          parentFolderPath: "/",
          siteName: "my-site",
          data: [-1, -40],
        },
      },
    });
  });

  test("scaffolds create drafts with required placeholders", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({ create: mock(async () => CREATE_OK) });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_scaffold_create").handler({
      asset_type: "page",
    });
    const body = opened.structuredContent as Record<string, any>;
    expect(body.scaffold).toMatchObject({
      page: {
        name: null,
        parentFolderPath: null,
        siteName: null,
        contentTypePath: null,
        xhtml: null,
      },
    });
    expect(body.required_value_pointers).toEqual(
      expect.arrayContaining([
        "/asset/page/name",
        "/asset/page/parentFolderPath",
        "/asset/page/siteName",
        "/asset/page/contentTypePath",
        "/asset/page/xhtml",
      ]),
    );
    const patchAction = body.next_actions.find(
      (action: Record<string, any>) => action.tool === "local_draft_apply_patch",
    );
    expect(patchAction.input).toMatchObject({
      draft_handle: body.draft_handle,
      expected_revision: body.revision,
    });
    expect(patchAction.input.placeholder_paths).toBeUndefined();
    expect(patchAction.placeholder_paths).toEqual(body.required_value_pointers);

    const invalid = await findTool(tools, "local_draft_validate").handler({
      draft_handle: body.draft_handle,
    });
    expect((invalid.structuredContent as Record<string, any>).valid).toBe(false);

    await findTool(tools, "local_draft_apply_patch").handler({
      draft_handle: body.draft_handle,
      expected_revision: body.revision,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "new-page" },
        { op: "replace", path: "/asset/page/parentFolderPath", value: "/" },
        { op: "replace", path: "/asset/page/siteName", value: "my-site" },
        { op: "replace", path: "/asset/page/contentTypePath", value: "/ct" },
        { op: "replace", path: "/asset/page/xhtml", value: "<p>New</p>" },
      ],
    });

    const validation = await findTool(tools, "local_draft_validate").handler({
      draft_handle: body.draft_handle,
    });
    expect((validation.structuredContent as Record<string, any>).valid).toBe(true);
  });

  test("validate does not echo credential-bearing draft payloads", async () => {
    const { server, tools } = makeMockServer();

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: SECRET_USER_ASSET,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const validation = await findTool(tools, "local_draft_validate").handler({
      draft_handle: draftHandle,
    });
    const validationBody = validation.structuredContent as Record<string, any>;
    expect(validationBody.valid).toBe(true);
    expect(validationBody.request).toBeUndefined();
    expect(firstText(validation)).not.toContain("user-password-secret");

    const plan = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: { operation: "create", asset: SECRET_USER_ASSET },
          save_as: "draft",
        },
        {
          tool: "local_draft_validate",
          input: { draft_ref: "draft" },
        },
      ],
    });
    const planBody = plan.structuredContent as Record<string, any>;
    expect(planBody.success).toBe(true);
    expect(planBody.completed_steps[1].result.valid).toBe(true);
    expect(planBody.completed_steps[1].result.request).toBeUndefined();
    expect(firstText(plan)).not.toContain("user-password-secret");
  });

  test("scaffolds create drafts from an existing cached asset shape", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_scaffold_from_asset").handler({
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    const body = opened.structuredContent as Record<string, any>;

    expect(body.success).toBe(true);
    expect(body.source_asset_handle).toBe(readEntry.handle);
    expect(body.scaffold.xhtmlDataDefinitionBlock.id).toBeUndefined();
    expect(body.scaffold.xhtmlDataDefinitionBlock.structuredData.definitionPath).toBe("/Blocks/Card Set");
    expect(body.scaffold.xhtmlDataDefinitionBlock.structuredData.structuredDataNodes[0].structuredDataNodes[0].text).toBe("");
    expect(body.scaffold.xhtmlDataDefinitionBlock.structuredData.structuredDataNodes[1].structuredDataNodes[2].pagePath).toBeUndefined();
    expect(body.cleared_value_pointers).toEqual(
      expect.arrayContaining([
        "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/0/text",
        "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/1/structuredDataNodes/2/pagePath",
      ]),
    );
    expect(body.replace_value_pointers).toContain(
      "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/0/text",
    );
    expect(body.add_value_pointers).toContain(
      "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/1/structuredDataNodes/2/pagePath",
    );
    expect(body.add_value_pointers).not.toContain(
      "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/1/structuredDataNodes/2/recycled",
    );
    expect((readEntry.raw as any).asset.xhtmlDataDefinitionBlock.id).toBe("block-001");
  });

  test("executes mutation plans sequentially and stops on first error", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          name: "open",
          tool: "local_draft_open",
          input: {
            operation: "edit",
            asset_handle: readEntry.handle,
            expected_raw_hash: readEntry.rawHash,
          },
          save_as: "draft",
        },
        {
          name: "bad assert",
          tool: "local_draft_assert_values",
          input: {
            draft_ref: "draft",
            assertions: [
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
            ],
          },
        },
        {
          name: "validate should not run",
          tool: "local_draft_validate",
          input: { draft_ref: "draft" },
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(false);
    expect(body.completed_steps).toHaveLength(1);
    expect(body.failed_step.index).toBe(1);
    expect(body.failed_step.name).toBe("bad assert");
    expect(body.current_drafts[0].draft_handle).toMatch(/^d_[0-9a-f-]+$/);
  });

  test("mutation plans can set draft file data", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: {
            operation: "create",
            asset: {
              file: {
                name: "hero.jpg",
                parentFolderPath: "/",
                siteName: "my-site",
              },
            },
          },
          save_as: "draft",
        },
        {
          tool: "local_draft_set_file_data",
          input: {
            draft_ref: "draft",
            base64_data: "/9j/4Q==",
          },
        },
        {
          tool: "local_draft_validate",
          input: { draft_ref: "draft" },
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(true);
    expect(body.completed_steps[1].result.bytes_total).toBe(4);
    expect(body.completed_steps[2].result.valid).toBe(true);
  });

  test("validates each mutation plan step against the selected tool schema", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: {
            operation: "edit",
            asset_handle: readEntry.handle,
            expected_raw_hash: readEntry.rawHash,
          },
          save_as: "draft",
        },
        {
          tool: "local_draft_apply_semantic_patch",
          input: {
            draft_ref: "draft",
            match: { node_type: "group", identifier: "card" },
            op: "replace",
            value: "missing target",
          },
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(false);
    expect(body.completed_steps).toHaveLength(1);
    expect(body.failed_step.index).toBe(1);
    expect(body.failed_step.error).toContain(
      "local_draft_apply_semantic_patch input validation failed",
    );
  });

  test("mutation plans check resolved payloads against plan tool-block rules", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const client = createMockClient();
    const toolBlockStore = makeStore([
      {
        type: "block_XHTML_DATADEFINITION",
        id: "block-001",
        tools: ["local_draft_mutation_plan_execute"],
        reason: "Plan edits are blocked token=super-secret",
      },
    ]);

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
      toolBlockStore,
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          name: "open blocked edit",
          tool: "local_draft_open",
          input: {
            operation: "edit",
            asset_handle: readEntry.handle,
            expected_raw_hash: readEntry.rawHash,
          },
          save_as: "draft",
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(false);
    expect(body.completed_steps).toHaveLength(0);
    expect(body.failed_step.index).toBe(0);
    expect(body.failed_step.error).toContain("local_draft_mutation_plan_execute");
    expect(body.failed_step.error).toContain("Plan edits are blocked");
    expect(body.failed_step.error).not.toContain("super-secret");
  });

  test("mutation plan open steps stop before saving drafts blocked for final edit", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const draftCache = createDraftCache();
    const toolBlockStore = makeStore([
      { type: "page", id: "page-001", tools: ["edit"] },
    ]);

    registerDraftTools(server as any, createMockClient(), {
      cache: createResponseCache(),
      assetCache,
      draftCache,
      toolBlockStore,
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: {
            operation: "edit",
            asset_handle: readEntry.handle,
            expected_raw_hash: readEntry.rawHash,
          },
          save_as: "draft",
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(false);
    expect(body.completed_steps).toHaveLength(0);
    expect(body.failed_step.index).toBe(0);
    expect(body.failed_step.error).toContain("edit page");
    expect(draftCache.size()).toBe(0);
  });

  test("mutation plans stop when Cascade submit returns success false", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(STRUCTURED_BLOCK_READ);
    const client = createMockClient({
      read: mock(async () => STRUCTURED_BLOCK_READ),
      edit: mock(async () => ({ success: false, message: "Rejected" })),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: {
            operation: "edit",
            asset_handle: readEntry.handle,
            expected_raw_hash: readEntry.rawHash,
          },
          save_as: "draft",
        },
        {
          tool: "local_draft_submit",
          input: { draft_ref: "draft" },
        },
        {
          tool: "local_draft_validate",
          input: { draft_ref: "draft" },
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(false);
    expect(body.completed_steps).toHaveLength(1);
    expect(body.failed_step.index).toBe(1);
    expect(body.failed_step.reason).toBe("cascade_result success false");
  });

  test("mutation plans report current drafts from the live draft cache", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({ create: mock(async () => CREATE_OK) });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_open",
          input: { operation: "create", asset: CREATE_ASSET },
          save_as: "draft",
        },
        {
          tool: "local_draft_submit",
          input: { draft_ref: "draft", discard_on_success: true },
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(true);
    expect(body.current_drafts).toEqual([]);
  });

  test("mutation plans report live draft revisions when submit keeps an in-flight change", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    let draftHandle = "";
    const client = createMockClient({
      create: mock(async () => {
        draftCache.applyPatch(draftHandle, {
          expectedRevision: 1,
          operations: [
            { op: "replace", path: "/asset/page/name", value: "changed-during-plan" },
          ],
        });
        return CREATE_OK;
      }),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const result = await findTool(tools, "local_draft_mutation_plan_execute").handler({
      steps: [
        {
          tool: "local_draft_submit",
          input: {
            draft_handle: draftHandle,
            expected_revision: 1,
            discard_on_success: true,
          },
          save_as: "draft",
        },
      ],
    });
    const body = result.structuredContent as Record<string, any>;

    expect(body.success).toBe(true);
    expect(body.completed_steps[0].result.discard_skipped_reason).toContain(
      "Draft changed while submit was in flight",
    );
    expect(body.current_drafts).toMatchObject([
      { ref: "draft", draft_handle: draftHandle, revision: 2, operation: "create" },
    ]);
  });

  test("submit rejects invalid drafts before calling Cascade", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: { page: { name: "missing-placement" } },
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });

    expect(submitted.isError).toBe(true);
    expect(firstText(submitted)).toContain("local_draft_submit");
    expect(client.create).not.toHaveBeenCalled();
  });

  test("submit rejects drafts that change during awaited pre-submit checks", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const draftCache = createDraftCache();
    let draftHandle = "";
    let patchedDuringSubmit = false;
    const client = createMockClient({
      read: mock(async () => {
        if (!patchedDuringSubmit && draftHandle) {
          patchedDuringSubmit = true;
          draftCache.applyPatch(draftHandle, {
            expectedRevision: 1,
            operations: [
              { op: "replace", path: "/asset/page/name", value: "changed-during-submit" },
            ],
          });
        }
        return EDIT_READ_PAGE;
      }),
      edit: mock(async () => OK_RESULT),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });
    draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });

    expect(submitted.isError).toBe(true);
    expect(firstText(submitted)).toContain("Draft revision changed before submit");
    expect(client.edit).not.toHaveBeenCalled();
  });

  test("submit checks tool-block rules against the complete create/edit and draft-submit payload", async () => {
    const { server, tools } = makeMockServer();
    const assetCache = createAssetCache();
    const readEntry = assetCache.put(EDIT_READ_PAGE);
    const client = createMockClient();
    const rules = [
      { type: "page", id: "page-002", tools: ["local_draft_submit"] },
    ];
    const toolBlockStore = makeStore(rules);

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache,
      draftCache: createDraftCache(),
      toolBlockStore,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntry.handle,
      expected_raw_hash: readEntry.rawHash,
    });

    rules.push({ type: "page", id: "page-001", tools: ["edit"] });
    const result = await findTool(tools, "local_draft_submit").handler({
      draft_handle: (opened.structuredContent as Record<string, any>).draft_handle,
      expected_revision: 1,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Tool call denied");
    expect(client.edit).not.toHaveBeenCalled();

    const readEntryForDraftSubmitBlock = assetCache.put({
      ...EDIT_READ_PAGE,
      asset: {
        page: {
          ...EDIT_READ_PAGE.asset.page,
          id: "page-002",
        },
      },
    });
    const openedForDraftSubmitBlock = await findTool(tools, "local_draft_open").handler({
      operation: "edit",
      asset_handle: readEntryForDraftSubmitBlock.handle,
      expected_raw_hash: readEntryForDraftSubmitBlock.rawHash,
    });

    const draftSubmitBlocked = await findTool(tools, "local_draft_submit").handler({
      draft_handle: (openedForDraftSubmitBlock.structuredContent as Record<string, any>).draft_handle,
      expected_revision: 1,
    });

    expect(draftSubmitBlocked.isError).toBe(true);
    expect(firstText(draftSubmitBlocked)).toContain("local_draft_submit");
    expect(client.edit).not.toHaveBeenCalled();
  });

  test("discard_on_success keeps drafts when Cascade returns success false", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      create: mock(async () => ({ success: false, message: "Rejected" })),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache: createDraftCache(),
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      discard_on_success: true,
    });

    expect(submitted.isError).not.toBe(true);
    expect((submitted.structuredContent as Record<string, any>).success).toBe(false);
    expect((submitted.structuredContent as Record<string, any>).cascade_result).toMatchObject({
      success: false,
    });
    const stillPresent = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: draftHandle,
      pointer: "/asset/page/name",
    });
    expect(stillPresent.isError).not.toBe(true);
  });

  test("discard_on_success keeps drafts changed while Cascade submit is in flight", async () => {
    const { server, tools } = makeMockServer();
    const draftCache = createDraftCache();
    let draftHandle = "";
    const client = createMockClient({
      create: mock(async () => {
        draftCache.applyPatch(draftHandle, {
          expectedRevision: 1,
          operations: [
            { op: "replace", path: "/asset/page/name", value: "changed-during-create" },
          ],
        });
        return CREATE_OK;
      }),
    });

    registerDraftTools(server as any, client, {
      cache: createResponseCache(),
      assetCache: createAssetCache(),
      draftCache,
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const submitted = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
      discard_on_success: true,
    });

    expect(submitted.isError).not.toBe(true);
    expect((submitted.structuredContent as Record<string, any>).success).toBe(true);
    expect((submitted.structuredContent as Record<string, any>).discard_skipped_reason).toContain(
      "Draft changed while submit was in flight",
    );

    const stillPresent = await findTool(tools, "local_draft_get_value").handler({
      draft_handle: draftHandle,
      pointer: "/asset/page/name",
    });
    expect(stillPresent.isError).not.toBe(true);
    expect((stillPresent.structuredContent as Record<string, any>).value).toBe(
      "changed-during-create",
    );
  });

  test("submit rejects a second concurrent submit for the same draft", async () => {
    const { server, tools } = makeMockServer();
    let createCalls = 0;
    let releaseCreate: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      const client = createMockClient({
        create: mock(async () => {
          createCalls += 1;
          resolve();
          await new Promise<void>((release) => {
            releaseCreate = release;
          });
          return CREATE_OK;
        }),
      });

      registerDraftTools(server as any, client, {
        cache: createResponseCache(),
        assetCache: createAssetCache(),
        draftCache: createDraftCache(),
      });
    });

    const opened = await findTool(tools, "local_draft_open").handler({
      operation: "create",
      asset: CREATE_ASSET,
    });
    const draftHandle = (opened.structuredContent as Record<string, any>).draft_handle;

    const first = findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });
    await createStarted;
    const second = await findTool(tools, "local_draft_submit").handler({
      draft_handle: draftHandle,
      expected_revision: 1,
    });

    expect(second.isError).toBe(true);
    expect(firstText(second)).toContain("already being submitted");
    expect(createCalls).toBe(1);

    releaseCreate?.();
    const firstResult = await first;
    expect(firstResult.isError).not.toBe(true);
  });
});
