import { describe, expect, mock, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { createResponseCache } from "../../../src/cache.js";
import {
  registerSiteRemovalProtectionTool,
  registerToolBlockTool,
} from "../../../src/tools/toolBlocks.js";
import { shouldCheckToolBlocks, type ToolBlockStore } from "../../../src/toolBlocks.js";
import { createMockClient } from "../../fixtures/mock-client.js";

interface MockServer {
  registerTool: ReturnType<typeof mock>;
}

function makeMockServer(): MockServer {
  return {
    registerTool: mock(() => ({})),
  };
}

function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be text");
  }
  return block.text;
}

function parsedText(r: CallToolResult): any {
  return JSON.parse(firstText(r));
}

function makeStore(initial: unknown[] = []): ToolBlockStore {
  let rules = initial;
  return {
    path: "C:\\tmp\\tool-blocks.json",
    read: mock(async () => rules as any),
    write: mock(async (next: unknown[]) => {
      rules = next;
    }),
  };
}

describe("registerToolBlockTool", () => {
  test("registers as destructive so clients can approval-gate guardrail changes", () => {
    const server = makeMockServer();
    const store = makeStore([]);

    registerToolBlockTool(server as any, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const config = server.registerTool.mock.calls[0][1];
    expect(config.annotations.destructiveHint).toBe(true);
    expect(config.annotations.openWorldHint).toBe(false);
  });

  test("lists rules from the JSON repository", async () => {
    const server = makeMockServer();
    const store = makeStore([
      { type: "block", id: "block-1", tools: ["remove"] },
    ]);

    registerToolBlockTool(server as any, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({ action: "list" });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      success: true,
      path: "C:\\tmp\\tool-blocks.json",
      count: 1,
      rules: [{ type: "block", id: "block-1", tools: ["remove"] }],
    });
  });

  test("adds a rule to the JSON repository", async () => {
    const server = makeMockServer();
    const store = makeStore([]);

    registerToolBlockTool(server as any, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({
      action: "add",
      rule: {
        url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
        tools: ["remove", "edit"],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(store.write).toHaveBeenCalledWith([
      {
        url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
        tools: ["remove", "edit"],
      },
    ]);
    expect(parsedText(result)).toMatchObject({
      success: true,
      path: "C:\\tmp\\tool-blocks.json",
      count: 1,
    });
  });

  test("serializes concurrent add updates without dropping rules", async () => {
    const server = makeMockServer();
    let rules: unknown[] = [];
    let writes = 0;
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      const store: ToolBlockStore = {
        path: "C:\\tmp\\tool-blocks.json",
        read: mock(async () => rules as any),
        write: mock(async (next: unknown[]) => {
          writes += 1;
          if (writes === 1) {
            resolve();
            await new Promise<void>((release) => {
              releaseFirstWrite = release;
            });
          }
          rules = next;
        }),
      };

      registerToolBlockTool(server as any, {
        cache: createResponseCache(),
        toolBlockStore: store,
      });
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const first = wrapped({
      action: "add",
      rule: { type: "page", id: "page-1", tools: ["remove"] },
    });
    await firstWriteStarted;
    const second = wrapped({
      action: "add",
      rule: { type: "block", id: "block-1", tools: ["edit"] },
    });

    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(rules).toEqual([
      { type: "page", id: "page-1", tools: ["remove"] },
      { type: "block", id: "block-1", tools: ["edit"] },
    ]);
  });

  test("rejects removal and replacement actions", async () => {
    const server = makeMockServer();
    const store = makeStore([
      { type: "block", id: "block-1", tools: ["remove"] },
      { type: "page", id: "page-1", tools: ["edit"] },
    ]);

    registerToolBlockTool(server as any, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const removeResult = await wrapped({ action: "remove", index: 0 });
    const replaceResult = await wrapped({
      action: "replace",
      rules: [{ type: "page", id: "page-1", tools: ["edit"] }],
    });

    expect(removeResult.isError).toBe(true);
    expect(parsedText(removeResult).error.issues[0].valid_values).toEqual([
      "list",
      "add",
    ]);
    expect(replaceResult.isError).toBe(true);
    expect(parsedText(replaceResult).error.issues[0].valid_values).toEqual([
      "list",
      "add",
    ]);
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe("tool-block checked tool selection", () => {
  test("draft submit is checked while read cache helpers remain exempt", () => {
    expect(shouldCheckToolBlocks("local_draft_submit")).toBe(true);
    expect(shouldCheckToolBlocks("local_draft_apply_patch")).toBe(true);
    expect(shouldCheckToolBlocks("asset_get_value")).toBe(false);
    expect(shouldCheckToolBlocks("read_response")).toBe(false);
  });
});

describe("registerSiteRemovalProtectionTool", () => {
  test("registers as destructive and idempotent", () => {
    const server = makeMockServer();
    const client = createMockClient();
    const store = makeStore([]);

    registerSiteRemovalProtectionTool(server as any, client, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const config = server.registerTool.mock.calls[0][1];
    expect(config.annotations.destructiveHint).toBe(true);
    expect(config.annotations.idempotentHint).toBe(true);
    expect(config.annotations.openWorldHint).toBe(true);
  });

  test("adds generated site and root-folder removal rules while preserving other rules", async () => {
    const server = makeMockServer();
    const store = makeStore([
      { type: "block", id: "block-1", tools: ["edit"] },
    ]);
    const client = createMockClient({
      listSites: mock(async () => ({
        success: true,
        sites: [
          {
            id: "site-1",
            type: "site",
            path: { path: "Site One", siteId: "site-1" },
          },
          {
            id: "site-2",
            type: "site",
            path: { path: "Site Two", siteId: "site-2" },
          },
        ],
      })),
      read: mock(async (input: any) => {
        if (input.identifier.path.siteName === "Site One") {
          return { success: true, asset: { folder: { id: "root-1" } } };
        }
        throw new Error("Forbidden token=super-secret");
      }),
    });

    registerSiteRemovalProtectionTool(server as any, client, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({});

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      protectedSiteCount: 2,
      protectedRootFolderIdCount: 1,
      unreadableRootFolders: [
        {
          siteId: "site-2",
          siteName: "Site Two",
          message: "Forbidden token=[REDACTED]",
        },
      ],
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("super-secret");
    expect(store.write).toHaveBeenCalledWith([
      { type: "block", id: "block-1", tools: ["edit"] },
      {
        type: "site",
        id: ["site-1", "site-2"],
        path: ["Site One", "Site Two"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["root-1"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
  });

  test("replaces previous generated rules instead of appending duplicates", async () => {
    const server = makeMockServer();
    const store = makeStore([
      {
        type: "site",
        id: ["old-site"],
        path: ["Old Site"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["old-root"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
    const client = createMockClient({
      listSites: mock(async () => ({
        success: true,
        sites: [
          {
            id: "site-1",
            type: "site",
            path: { path: "Site One", siteId: "site-1" },
          },
        ],
      })),
      read: mock(async () => ({
        success: true,
        asset: { folder: { id: "root-1" } },
      })),
    });

    registerSiteRemovalProtectionTool(server as any, client, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({});

    expect(result.isError).not.toBe(true);
    expect(store.write).toHaveBeenCalledWith([
      {
        type: "site",
        id: ["site-1"],
        path: ["Site One"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["root-1"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
  });

  test("replaces legacy generated site-removal rules from cascade-prefixed tool names", async () => {
    const server = makeMockServer();
    const userRule = { type: "block", id: "block-1", tools: ["cascade_remove"] };
    const store = makeStore([
      {
        type: "site",
        id: ["old-site"],
        path: ["Old Site"],
        tools: ["cascade_remove"],
        reason: "Generated by cascade_protect_site_removal: block removal of all accessible Cascade sites",
        source: "cascade_protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["old-root"],
        path: "/",
        tools: ["cascade_remove"],
        reason: "Generated by cascade_protect_site_removal: block removal of site root folders",
        source: "cascade_protect_site_removal:root-folder",
      },
      userRule,
    ]);
    const client = createMockClient({
      listSites: mock(async () => ({
        success: true,
        sites: [
          {
            id: "site-1",
            type: "site",
            path: { path: "Site One", siteId: "site-1" },
          },
        ],
      })),
      read: mock(async () => ({
        success: true,
        asset: { folder: { id: "root-1" } },
      })),
    });

    registerSiteRemovalProtectionTool(server as any, client, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({});

    expect(result.isError).not.toBe(true);
    expect(store.write).toHaveBeenCalledWith([
      userRule,
      {
        type: "site",
        id: ["site-1"],
        path: ["Site One"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["root-1"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
  });

  test("preserves user rules that reuse generated reason text", async () => {
    const server = makeMockServer();
    const userRule = {
      type: "block",
      id: "block-1",
      tools: ["remove"],
      reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
    };
    const store = makeStore([userRule]);
    const client = createMockClient({
      listSites: mock(async () => ({
        success: true,
        sites: [
          {
            id: "site-1",
            type: "site",
            path: { path: "Site One", siteId: "site-1" },
          },
        ],
      })),
      read: mock(async () => ({
        success: true,
        asset: { folder: { id: "root-1" } },
      })),
    });

    registerSiteRemovalProtectionTool(server as any, client, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const result = await wrapped({});

    expect(result.isError).not.toBe(true);
    expect(store.write).toHaveBeenCalledWith([
      userRule,
      {
        type: "site",
        id: ["site-1"],
        path: ["Site One"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["root-1"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
  });

  test("protect site removal preserves rules added while Cascade data is loading", async () => {
    const server = makeMockServer();
    const store = makeStore([]);
    let releaseListSites: (() => void) | undefined;
    const listSitesStarted = new Promise<void>((resolve) => {
      const client = createMockClient({
        listSites: mock(async () => {
          resolve();
          await new Promise<void>((release) => {
            releaseListSites = release;
          });
          return {
            success: true,
            sites: [
              {
                id: "site-1",
                type: "site",
                path: { path: "Site One", siteId: "site-1" },
              },
            ],
          };
        }),
        read: mock(async () => ({
          success: true,
          asset: { folder: { id: "root-1" } },
        })),
      });

      registerSiteRemovalProtectionTool(server as any, client, {
        cache: createResponseCache(),
        toolBlockStore: store,
      });
    });
    registerToolBlockTool(server as any, {
      cache: createResponseCache(),
      toolBlockStore: store,
    });

    const protect = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;
    const add = server.registerTool.mock.calls[1][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const protectedSites = protect({});
    await listSitesStarted;
    await add({
      action: "add",
      rule: { type: "block", id: "block-1", tools: ["edit"] },
    });

    releaseListSites?.();
    await protectedSites;

    expect(store.write).toHaveBeenLastCalledWith([
      { type: "block", id: "block-1", tools: ["edit"] },
      {
        type: "site",
        id: ["site-1"],
        path: ["Site One"],
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of all accessible Cascade sites",
        source: "protect_site_removal:site",
      },
      {
        type: "folder",
        id: ["root-1"],
        path: "/",
        tools: ["remove"],
        reason: "Generated by protect_site_removal: block removal of site root folders",
        source: "protect_site_removal:root-folder",
      },
    ]);
  });
});
