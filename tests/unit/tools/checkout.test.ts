import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerCheckoutTools } from "../../../src/tools/checkout.js";
import {
  CheckOutRequestSchema,
  CheckInRequestSchema,
} from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import { OK_RESULT } from "../../fixtures/cascade-responses.js";


// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const ID_PAGE = { id: "abc123", type: "page" as const };

// =============================================================================
// cascade_check_out
// =============================================================================

describe("cascade_check_out tool", () => {
  test("happy path: calls client.checkOut with identifier and returns success response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      checkOut: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCheckoutTools(server as any, client);

    const tool = findTool(tools, "cascade_check_out");
    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.checkOut).toHaveBeenCalledTimes(1);
    expect(client.checkOut.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(OK_RESULT);
  });

  test("schema validation: rejects input missing required identifier field", () => {
    const parsed = CheckOutRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      checkOut: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Locked")),
      ),
    });

    registerCheckoutTools(server as any, client);
    const tool = findTool(tools, "cascade_check_out");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_check_out");
    expect(text).toContain("Locked");
  });
});

// =============================================================================
// cascade_check_in
// =============================================================================

describe("cascade_check_in tool", () => {
  test("happy path: calls client.checkIn with identifier + comments", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      checkIn: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCheckoutTools(server as any, client);
    const tool = findTool(tools, "cascade_check_in");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
      comments: "Fixed typo in header",
    });

    expect(client.checkIn).toHaveBeenCalledTimes(1);
    expect(client.checkIn.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      comments: "Fixed typo in header",
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects body missing required comments field", () => {
    const parsed = CheckInRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      checkIn: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Not Checked Out")),
      ),
    });

    registerCheckoutTools(server as any, client);
    const tool = findTool(tools, "cascade_check_in");

    const result = await tool.handler({
      identifier: ID_PAGE,
      comments: "",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_check_in");
  });
});

// =============================================================================
// Registration coverage: all 2 checkout tools registered
// =============================================================================

describe("registerCheckoutTools coverage", () => {
  test("registers both checkout tools with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCheckoutTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["cascade_check_in", "cascade_check_out"]);
  });
});
