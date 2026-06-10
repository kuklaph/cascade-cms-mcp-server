import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerPublishTools } from "../../../src/tools/publish.js";
import { PublishUnpublishRequestSchema } from "../../../src/schemas/requests.js";
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
// cascade_publish_unpublish
// =============================================================================

describe("cascade_publish_unpublish tool", () => {
  test("happy path: calls client.publishUnpublish with identifier + publishInformation (publish)", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      publishUnpublish: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerPublishTools(server as any, client);

    const tool = findTool(tools, "cascade_publish_unpublish");
    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const publishInformation = {
      destinations: [{ id: "dest-1", type: "destination" }],
      unpublish: false,
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      publishInformation,
    });

    expect(client.publishUnpublish).toHaveBeenCalledTimes(1);
    expect(client.publishUnpublish.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      publishInformation,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(OK_RESULT);
  });

  test("schema validation: rejects missing publishInformation", () => {
    const parsed = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
    });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      publishUnpublish: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Destination Unreachable")),
      ),
    });

    registerPublishTools(server as any, client);
    const tool = findTool(tools, "cascade_publish_unpublish");

    const result = await tool.handler({
      identifier: ID_PAGE,
      publishInformation: { unpublish: true },
    });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_publish_unpublish");
    expect(text).toContain("Destination Unreachable");
  });
});

// =============================================================================
// Registration coverage: 1 publish tool registered
// =============================================================================

describe("registerPublishTools coverage", () => {
  test("registers the publish tool with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerPublishTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["cascade_publish_unpublish"]);
  });
});
