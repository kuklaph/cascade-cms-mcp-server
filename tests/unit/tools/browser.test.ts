import { describe, expect, mock, test } from "bun:test";
import { createResponseCache } from "../../../src/cache.js";
import { registerBrowserTools } from "../../../src/tools/browser.js";
import {
  BrowserCheckDraftRequestSchema,
  BrowserCreateSnippetRequestSchema,
  BrowserDeleteSnippetsRequestSchema,
  BrowserListSnippetsRequestSchema,
  BrowserLoginRequestSchema,
  BrowserUpdateSnippetRequestSchema,
} from "../../../src/schemas/requests.js";
import {
  findTool,
  firstText,
  makeMockServer,
} from "../../fixtures/mock-server.js";

describe("cascade_browser_login tool", () => {
  test("calls the browser session login without accepting credentials in tool input", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      login: mock(async ({ siteId }: { siteId?: string }) => ({
        success: true,
        authenticated: true,
        browser_url: "https://example.cascadecms.com",
        site_id: siteId ?? "default-site",
        cookie_names: ["JSESSIONID"],
        logged_in_at: "2026-06-10T00:00:00.000Z",
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const tool = findTool(tools, "cascade_browser_login");
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);
    expect(Object.keys((tool.config.inputSchema as any).shape)).toEqual(["site_id"]);

    const result = await tool.handler({ site_id: "site-123" });

    expect(browserSession.login).toHaveBeenCalledWith({ siteId: "site-123" });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      authenticated: true,
      site_id: "site-123",
      cookie_names: ["JSESSIONID"],
    });
  });

  test("allows login without site_id when CASCADE_BROWSER_SITE_ID is configured in the session", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      login: mock(async ({ siteId }: { siteId?: string }) => ({
        success: true,
        authenticated: true,
        browser_url: "https://example.cascadecms.com",
        site_id: siteId ?? "default-site",
        cookie_names: ["JSESSIONID"],
        logged_in_at: "2026-06-10T00:00:00.000Z",
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const result = await findTool(tools, "cascade_browser_login").handler({});

    expect(browserSession.login).toHaveBeenCalledWith({});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      site_id: "default-site",
    });
  });

  test("returns a configuration error when no browser session is registered", async () => {
    const { server, tools } = makeMockServer();

    registerBrowserTools(server as any, { cache: createResponseCache() });

    const result = await findTool(tools, "cascade_browser_login").handler({
      site_id: "site-123",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("CASCADE_BROWSER_USERNAME");
    expect(firstText(result)).toContain("CASCADE_BROWSER_SITE_ID");
    expect(firstText(result)).toContain("CASCADE_BROWSER_URL");
    expect((result.structuredContent as any).error.hints).toContain(
      "Set CASCADE_BROWSER_SITE_ID to the production site ID for startup/automatic browser login.",
    );
  });

  test("schema rejects credentials in tool input", () => {
    expect(BrowserLoginRequestSchema.safeParse({}).success).toBe(true);
    const parsed = BrowserLoginRequestSchema.safeParse({
      site_id: "site-123",
      password: "do-not-send-this",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("cascade_browser_check_draft tool", () => {
  test("calls the browser session checkDraft with asset id and type", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      checkDraft: mock(async (
        { assetId, assetType }: { assetId: string; assetType: string },
      ) => ({
        success: true,
        asset_id: assetId,
        asset_type: assetType,
        has_draft: true,
        message: "Draft is active",
        status: 200,
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const tool = findTool(tools, "cascade_browser_check_draft");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(Object.keys((tool.config.inputSchema as any).shape)).toEqual([
      "asset_id",
      "asset_type",
    ]);

    const result = await tool.handler({
      asset_id: "asset-123",
      asset_type: "page",
    });

    expect(browserSession.checkDraft).toHaveBeenCalledWith({
      assetId: "asset-123",
      assetType: "page",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      asset_id: "asset-123",
      asset_type: "page",
      has_draft: true,
    });
  });

  test("returns a configuration error when no browser session is registered", async () => {
    const { server, tools } = makeMockServer();

    registerBrowserTools(server as any, { cache: createResponseCache() });

    const result = await findTool(tools, "cascade_browser_check_draft").handler({
      asset_id: "asset-123",
      asset_type: "page",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("CASCADE_BROWSER_USERNAME");
    expect(firstText(result)).toContain("CASCADE_BROWSER_SITE_ID");
    expect((result.structuredContent as any).error.hints).toContain(
      "Set CASCADE_BROWSER_SITE_ID to the production site ID for startup/automatic browser login.",
    );
  });

  test("returns a re-login recovery hint when the browser session expires", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      checkDraft: mock(async () => {
        throw new Error(
          "Browser session expired. Run cascade_browser_login, then retry cascade_browser_check_draft.",
        );
      }),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const result = await findTool(tools, "cascade_browser_check_draft").handler({
      asset_id: "asset-123",
      asset_type: "page",
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).error).toMatchObject({
      suggested_tool: "cascade_browser_login",
    });
  });

  test("schema requires asset type and rejects credentials in tool input", () => {
    expect(
      BrowserCheckDraftRequestSchema.safeParse({ asset_id: "asset-123" }).success,
    ).toBe(false);
    expect(
      BrowserCheckDraftRequestSchema.safeParse({
        asset_id: "asset-123",
        asset_type: "page",
        cookie: "do-not-send-this",
      }).success,
    ).toBe(false);
  });
});

describe("browser snippet tools", () => {
  test("lists snippets through the browser session", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      listSnippets: mock(async ({ limit, offset }: { limit: number; offset: number }) => ({
        success: true,
        snippets: [{ id: "snippet-1", name: "catalog-id" }],
        total: 1,
        count: 1,
        offset,
        has_more: false,
        status: 200,
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const tool = findTool(tools, "cascade_browser_list_snippets");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);

    const result = await tool.handler({ limit: 10, offset: 5 });

    expect(browserSession.listSnippets).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      count: 1,
      offset: 5,
    });
  });

  test("creates snippets through the browser session", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      createSnippet: mock(async () => ({
        success: true,
        message: "Snippet created successfully.",
        status: 200,
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const result = await findTool(tools, "cascade_browser_create_snippet").handler({
      title: "Catalog ID",
      name: "catalog-id",
      value: "81",
    });

    expect(browserSession.createSnippet).toHaveBeenCalledWith({
      title: "Catalog ID",
      name: "catalog-id",
      value: "81",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      message: "Snippet created successfully.",
    });
  });

  test("updates snippets through the browser session", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      updateSnippet: mock(async () => ({
        success: true,
        message: "Snippet updated successfully.",
        status: 200,
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const result = await findTool(tools, "cascade_browser_update_snippet").handler({
      id: "snippet-id",
      title: "Catalog ID",
      value: "82",
    });

    expect(browserSession.updateSnippet).toHaveBeenCalledWith({
      id: "snippet-id",
      title: "Catalog ID",
      value: "82",
    });
    expect(result.isError).not.toBe(true);
  });

  test("deletes snippets through the browser session with destructive annotation", async () => {
    const { server, tools } = makeMockServer();
    const browserSession = {
      deleteSnippets: mock(async () => ({
        success: true,
        message: "Snippets deleted successfully!",
        results: [{ success: true, id: "snippet-id" }],
        status: 200,
      })),
    };

    registerBrowserTools(server as any, {
      cache: createResponseCache(),
      browserSession: browserSession as any,
    });

    const tool = findTool(tools, "cascade_browser_delete_snippets");
    expect(tool.config.annotations.destructiveHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);

    const result = await tool.handler({ ids: ["snippet-id"] });

    expect(browserSession.deleteSnippets).toHaveBeenCalledWith({
      ids: ["snippet-id"],
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      success: true,
      results: [{ success: true, id: "snippet-id" }],
    });
  });

  test("snippet schemas reject credentials, cookies, unknown fields, and empty delete ids", () => {
    expect(BrowserListSnippetsRequestSchema.safeParse({ cookie: "x" }).success).toBe(
      false,
    );
    expect(
      BrowserCreateSnippetRequestSchema.safeParse({
        title: "Title",
        name: "name",
        value: "value",
        password: "nope",
      }).success,
    ).toBe(false);
    expect(
      BrowserUpdateSnippetRequestSchema.safeParse({
        id: "id",
        title: "Title",
        value: "value",
        extra: true,
      }).success,
    ).toBe(false);
    expect(BrowserDeleteSnippetsRequestSchema.safeParse({ ids: [] }).success).toBe(
      false,
    );
  });
});
