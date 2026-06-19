import { describe, test, expect } from "bun:test";
import { SERVER_NAME, SERVER_VERSION } from "../../../src/constants.js";
import { ServerVersionRequestSchema } from "../../../src/schemas/requests.js";
import { registerServerVersionTool } from "../../../src/tools/version.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";

function parsedText(result: { content: Array<{ type: string; text?: string }> }): any {
  return JSON.parse(firstText(result as any));
}

describe("server_version tool", () => {
  test("registers as a read-only local utility tool", () => {
    const { server, tools } = makeMockServer();

    registerServerVersionTool(server as any);

    const tool = findTool(tools, "server_version");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(false);
    expect(tool.config.description).toContain("server_version");
  });

  test("returns the MCP server name and version", async () => {
    const { server, tools } = makeMockServer();

    registerServerVersionTool(server as any);

    const tool = findTool(tools, "server_version");
    const result = await tool.handler({});
    const body = parsedText(result);

    expect(result.isError).not.toBe(true);
    expect(body).toEqual({
      success: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    expect(result.structuredContent).toEqual(body);
  });
});

describe("ServerVersionRequestSchema", () => {
  test("accepts an empty request", () => {
    expect(ServerVersionRequestSchema.safeParse({}).success).toBe(true);
  });

  test("rejects unknown fields", () => {
    expect(
      ServerVersionRequestSchema.safeParse({ response_format: "json" }).success,
    ).toBe(false);
  });
});
