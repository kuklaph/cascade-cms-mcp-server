import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerSiteTools } from "../../../src/tools/sites.js";
import {
  ListSitesRequestSchema,
  SiteCopyRequestSchema,
} from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import { OK_RESULT } from "../../fixtures/cascade-responses.js";


/** A canned list-sites response (array of site records). */
const LIST_SITES_OK = {
  success: true,
  sites: [
    { id: "s-1", name: "site-one" },
    { id: "s-2", name: "site-two" },
  ],
} as const;

// =============================================================================
// cascade_list_sites
// =============================================================================

describe("cascade_list_sites tool", () => {
  test("happy path: calls client.listSites and returns success response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listSites: mock(() => Promise.resolve(LIST_SITES_OK)),
    });

    registerSiteTools(server as any, client);

    const tool = findTool(tools, "cascade_list_sites");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({});

    expect(client.listSites).toHaveBeenCalledTimes(1);
    expect(client.listSites.mock.calls[0][0]).toEqual({});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(LIST_SITES_OK);
  });

  test("schema validation: rejects unknown extra fields", () => {
    const parsed = ListSitesRequestSchema.safeParse({ unknownField: "nope" });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listSites: mock(() => Promise.reject(new Error("Request Failed. Request Response: ServerDown"))),
    });

    registerSiteTools(server as any, client);
    const tool = findTool(tools, "cascade_list_sites");

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_list_sites");
  });
});

// =============================================================================
// cascade_site_copy
// =============================================================================

describe("cascade_site_copy tool", () => {
  test("happy path: calls client.siteCopy with correct args", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      siteCopy: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerSiteTools(server as any, client);
    const tool = findTool(tools, "cascade_site_copy");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const payload = {
      originalSiteName: "existing",
      newSiteName: "copy-of-existing",
    };
    const result = await tool.handler({
      ...payload,
    });

    expect(client.siteCopy).toHaveBeenCalledTimes(1);
    expect(client.siteCopy.mock.calls[0][0]).toEqual(payload);
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects when neither originalSiteId nor originalSiteName is provided", () => {
    const parsed = SiteCopyRequestSchema.safeParse({ newSiteName: "new-site" });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      siteCopy: mock(() => Promise.reject(new Error("Request Failed. Request Response: Duplicate Site"))),
    });

    registerSiteTools(server as any, client);
    const tool = findTool(tools, "cascade_site_copy");

    const result = await tool.handler({
      originalSiteName: "existing",
      newSiteName: "copy",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_site_copy");
  });

  test("boundary check: rejects payload missing both originalSiteId and originalSiteName", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      siteCopy: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerSiteTools(server as any, client);
    const tool = findTool(tools, "cascade_site_copy");

    const result = await tool.handler({ newSiteName: "copy-only" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("originalSiteId");
    expect(firstText(result)).toContain("originalSiteName");
    expect(client.siteCopy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Registration coverage
// =============================================================================

describe("registerSiteTools coverage", () => {
  test("registers both site tools", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerSiteTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["cascade_list_sites", "cascade_site_copy"]);
  });
});
