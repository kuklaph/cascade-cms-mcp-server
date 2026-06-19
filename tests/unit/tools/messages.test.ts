import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { registerMessageTools } from "../../../src/tools/messages.js";
import {
  ListSubscribersRequestSchema,
  ListMessagesRequestSchema,
  MarkMessageRequestSchema,
  DeleteMessageRequestSchema,
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
const ID_MESSAGE = { id: "msg-1", type: "message" as const };

const SUBSCRIBERS_OK = {
  success: true,
  subscribers: [
    { userName: "jdoe" },
    { userName: "asmith" },
  ],
} as const;

const MESSAGES_OK = {
  success: true,
  messages: [
    { id: "m-1", subject: "Workflow notification" },
    { id: "m-2", subject: "Publish complete" },
  ],
} as const;

// =============================================================================
// list_subscribers
// =============================================================================

describe("list_subscribers tool", () => {
  test("happy path: calls client.listSubscribers with identifier and returns success response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listSubscribers: mock(() => Promise.resolve(SUBSCRIBERS_OK)),
    });

    registerMessageTools(server as any, client);

    const tool = findTool(tools, "list_subscribers");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.listSubscribers).toHaveBeenCalledTimes(1);
    expect(client.listSubscribers.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(SUBSCRIBERS_OK);
  });

  test("schema validation: rejects input missing required identifier field", () => {
    const parsed = ListSubscribersRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listSubscribers: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Not Found")),
      ),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "list_subscribers");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("list_subscribers");
    expect(text).toContain("Not Found");
  });
});

// =============================================================================
// list_messages
// =============================================================================

describe("list_messages tool", () => {
  test("happy path: calls client.listMessages (without pagination args) and returns paginated response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listMessages: mock(() => Promise.resolve(MESSAGES_OK)),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "list_messages");

    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({});

    expect(client.listMessages).toHaveBeenCalledTimes(1);
    // Library receives empty request; pagination fields are stripped.
    expect(client.listMessages.mock.calls[0][0]).toEqual({});
    expect(result.isError).not.toBe(true);

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.success).toBe(true);
    expect(sc.messages).toEqual(MESSAGES_OK.messages);
    expect(sc.total).toBe(MESSAGES_OK.messages.length);
    expect(sc.count).toBe(MESSAGES_OK.messages.length);
    expect(sc.offset).toBe(0);
    expect(sc.has_more).toBe(false);
  });

  test("applies default limit/offset when caller omits them", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listMessages: mock(() => Promise.resolve(MESSAGES_OK)),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "list_messages");

    const result = await tool.handler({});

    expect(client.listMessages.mock.calls[0][0]).toEqual({});
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.offset).toBe(0);
    expect(sc.count).toBe(MESSAGES_OK.messages.length);
    expect(sc.has_more).toBe(false);
  });

  test("slices messages with has_more=true when result larger than limit", async () => {
    const bigMessages = Array.from({ length: 6 }, (_, i) => ({
      id: `m-${i}`,
      subject: `msg ${i}`,
    }));
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listMessages: mock(() =>
        Promise.resolve({ success: true, messages: bigMessages }),
      ),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "list_messages");

    const result = await tool.handler({ limit: 2, offset: 0 });

    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.messages as unknown[]).length).toBe(2);
    expect(sc.total).toBe(6);
    expect(sc.count).toBe(2);
    expect(sc.offset).toBe(0);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(2);
  });

  test("schema validation: accepts empty body (no required fields)", () => {
    const parsed = ListMessagesRequestSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      listMessages: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Unauthorized")),
      ),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "list_messages");

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("list_messages");
  });
});

// =============================================================================
// mark_message
// =============================================================================

describe("mark_message tool", () => {
  test("happy path: calls client.markMessage with identifier + markType", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      markMessage: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "mark_message");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_MESSAGE,
      markType: "read",
    });

    expect(client.markMessage).toHaveBeenCalledTimes(1);
    expect(client.markMessage.mock.calls[0][0]).toEqual({
      identifier: ID_MESSAGE,
      markType: "read",
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects invalid markType", () => {
    const parsed = MarkMessageRequestSchema.safeParse({
      identifier: ID_MESSAGE,
      markType: "star",
    });
    expect(parsed.success).toBe(false);
  });

  test("schema validation: rejects archive because generated markType excludes it", () => {
    const parsed = MarkMessageRequestSchema.safeParse({
      identifier: ID_MESSAGE,
      markType: "archive",
    });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      markMessage: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Forbidden")),
      ),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "mark_message");

    const result = await tool.handler({
      identifier: ID_MESSAGE,
      markType: "unread",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("mark_message");
  });
});

// =============================================================================
// delete_message
// =============================================================================

describe("delete_message tool", () => {
  test("happy path: calls client.deleteMessage with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      deleteMessage: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "delete_message");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_MESSAGE,
    });

    expect(client.deleteMessage).toHaveBeenCalledTimes(1);
    expect(client.deleteMessage.mock.calls[0][0]).toEqual({ identifier: ID_MESSAGE });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = DeleteMessageRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      deleteMessage: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Not Found")),
      ),
    });

    registerMessageTools(server as any, client);
    const tool = findTool(tools, "delete_message");

    const result = await tool.handler({ identifier: ID_MESSAGE });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("delete_message");
  });
});

// =============================================================================
// Registration coverage: all 4 message tools registered
// =============================================================================

describe("registerMessageTools coverage", () => {
  test("registers all 4 message tools", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerMessageTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "delete_message",
      "list_messages",
      "list_subscribers",
      "mark_message",
    ]);
  });
});
