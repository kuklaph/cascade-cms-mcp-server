import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerSearchTools } from "../../../src/tools/search.js";
import { SearchRequestSchema } from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import { SEARCH_OK } from "../../fixtures/cascade-responses.js";


// =============================================================================
// search
// =============================================================================

describe("search tool", () => {
  test("happy path: calls client.search with input minus limit/offset and returns paginated response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      search: mock(() => Promise.resolve(SEARCH_OK)),
    });

    registerSearchTools(server as any, client);

    const tool = findTool(tools, "search");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const searchInformation = {
      searchTerms: "hello world",
      siteName: "my-site",
    };
    const result = await tool.handler({
      searchInformation,
      limit: 50,
      offset: 0,
    });

    expect(client.search).toHaveBeenCalledTimes(1);
    // Library receives searchInformation only — pagination fields are stripped.
    expect(client.search.mock.calls[0][0]).toEqual({ searchInformation });
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.success).toBe(true);
    expect(sc.matches).toEqual(SEARCH_OK.matches); // both fit under limit 50
    expect(sc.total).toBe(SEARCH_OK.matches.length);
    expect(sc.count).toBe(SEARCH_OK.matches.length);
    expect(sc.offset).toBe(0);
    expect(sc.has_more).toBe(false);
  });

  test("applies default limit/offset when caller omits them", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      search: mock(() => Promise.resolve(SEARCH_OK)),
    });

    registerSearchTools(server as any, client);
    const tool = findTool(tools, "search");

    const result = await tool.handler({
      searchInformation: { searchTerms: "x" },
    });

    // Library still called with searchInformation only (no pagination fields).
    expect(client.search.mock.calls[0][0]).toEqual({
      searchInformation: { searchTerms: "x" },
    });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.offset).toBe(0);
    expect(sc.count).toBe(SEARCH_OK.matches.length);
  });

  test("slices with has_more=true when result larger than limit", async () => {
    const bigMatches = Array.from({ length: 7 }, (_, i) => ({
      id: `a-${i}`,
      type: "page" as const,
      path: { path: `/x/${i}` },
    }));
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      search: mock(() =>
        Promise.resolve({ success: true, matches: bigMatches }),
      ),
    });

    registerSearchTools(server as any, client);
    const tool = findTool(tools, "search");

    const result = await tool.handler({
      searchInformation: { searchTerms: "x" },
      limit: 3,
      offset: 2,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.matches as unknown[]).length).toBe(3);
    expect(sc.total).toBe(7);
    expect(sc.count).toBe(3);
    expect(sc.offset).toBe(2);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(5);
  });

  test("schema validation: rejects input missing required searchInformation field", () => {
    const parsed = SearchRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      search: mock(() => Promise.reject(new Error("Request Failed. Request Response: Unauthorized"))),
    });

    registerSearchTools(server as any, client);
    const tool = findTool(tools, "search");

    const result = await tool.handler({
      searchInformation: { searchTerms: "x" },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("search");
    expect(text).toContain("Unauthorized");
  });
});

// =============================================================================
// Registration coverage
// =============================================================================

describe("registerSearchTools coverage", () => {
  test("registers the search tool", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerSearchTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["search"]);
  });
});
