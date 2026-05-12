/**
 * Integration test for the server factory (`createServer`).
 *
 * Verifies that all tool cohorts wire up correctly and produce
 * the expected 37 tools with well-formed names (33 Cascade-backed +
 * 4 MCP-native local tools). Also exercises one
 * end-to-end handler invocation (`cascade_read`) through the real
 * pipeline that `registerCascadeTool` installs on the server, plus
 * the oversize-response round-trip through `cascade_read_response`.
 */

import { describe, test, expect, mock } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/server.js";
import { createMockClient } from "../fixtures/mock-client.js";
import type { ToolBlockStore } from "../../src/toolBlocks.js";
import {
  READ_PAGE_OK,
  READ_PAGE_HUGE,
} from "../fixtures/cascade-responses.js";
import {
  CHARACTER_LIMIT,
  SERVER_NAME,
  SERVER_VERSION,
} from "../../src/constants.js";

/**
 * Extract the runtime `_registeredTools` map from an `McpServer`.
 *
 * The SDK stores each `server.registerTool(name, config, cb)` under
 * `server._registeredTools[name]` as `{ title, description, inputSchema,
 * annotations, handler, ... }`. TypeScript flags `_registeredTools` as
 * private, but it's a plain runtime property on the instance.
 */
function getRegisteredTools(server: unknown): Record<string, {
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
  annotations: { readOnlyHint?: boolean };
}> {
  return (server as { _registeredTools: Record<string, any> })._registeredTools;
}

function emptyToolBlockStore(): ToolBlockStore {
  return {
    path: "C:\\tmp\\tool-blocks.json",
    read: async () => [],
    write: async () => {},
  };
}

async function callToolViaSdkPath(
  server: unknown,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const protocol = (server as { server: { _requestHandlers: Map<string, any> } }).server;
  const handler = protocol._requestHandlers.get("tools/call");
  if (!handler) throw new Error("tools/call handler not registered");
  return handler(
    {
      method: "tools/call",
      params: { name, arguments: args },
    },
    {},
  );
}

/** All 37 expected tool names: 33 Cascade-backed tools + 4 local tools. */
const EXPECTED_TOOL_NAMES = [
  // crud and asset follow-ups (14)
  "cascade_read",
  "cascade_asset_list_facts",
  "cascade_asset_search_values",
  "cascade_asset_search_keys",
  "cascade_asset_get_value",
  "cascade_asset_list_scalar_artifacts",
  "cascade_asset_list_references",
  "cascade_asset_list_nodelets",
  "cascade_asset_get_nodelet",
  "cascade_create",
  "cascade_edit",
  "cascade_remove",
  "cascade_move",
  "cascade_copy",
  // search (1)
  "cascade_search",
  // sites (2)
  "cascade_list_sites",
  "cascade_site_copy",
  // access (2)
  "cascade_read_access_rights",
  "cascade_edit_access_rights",
  // workflow (4)
  "cascade_read_workflow_settings",
  "cascade_edit_workflow_settings",
  "cascade_read_workflow_information",
  "cascade_perform_workflow_transition",
  // messages (4)
  "cascade_list_subscribers",
  "cascade_list_messages",
  "cascade_mark_message",
  "cascade_delete_message",
  // checkout (2)
  "cascade_check_out",
  "cascade_check_in",
  // audits (3)
  "cascade_read_audits",
  "cascade_read_preferences",
  "cascade_edit_preference",
  // publish (1)
  "cascade_publish_unpublish",
  // local MCP tools (4)
  "cascade_tool_blocks",
  "cascade_protect_site_removal",
  "cascade_server_version",
  "cascade_read_response",
];

describe("createServer (server factory)", () => {
  test("registers exactly 37 tools", () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    expect(Object.keys(tools)).toHaveLength(37);
  });

  test("all tool names use snake_case with cascade_ prefix", () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    const namePattern = /^cascade_[a-z]+(?:_[a-z]+)*$/;
    for (const name of Object.keys(tools)) {
      expect(name).toMatch(namePattern);
    }
  });

  test("no duplicate tool names are registered", () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    const names = Object.keys(tools);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(unique.size).toBe(37);
  });

  test("every expected tool from each cohort is present", () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);
    const registered = new Set(Object.keys(tools));

    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(registered.has(expected)).toBe(true);
    }
  });

  test("cascade_server_version reports server metadata without reading tool blocks", async () => {
    const client = createMockClient();
    const toolBlockStore: ToolBlockStore = {
      path: "C:\\tmp\\tool-blocks.json",
      read: mock(() => {
        throw new Error("tool block store should not be read");
      }),
      write: async () => {},
    };
    const server = createServer(client, { toolBlockStore });
    const tools = getRegisteredTools(server);

    const result = await tools["cascade_server_version"].handler({});
    const body = JSON.parse((result.content[0] as any).text);

    expect(result.isError).not.toBe(true);
    expect(body).toEqual({
      success: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    expect(toolBlockStore.read).not.toHaveBeenCalled();
  });

  test("cascade_read handler invokes client.read and returns preview result", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_OK)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    const readTool = tools["cascade_read"];
    expect(readTool).toBeDefined();

    const result = await readTool.handler({
      identifier: { id: "abc", type: "page" },
    });

    // client.read should have been called once with read input only.
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read.mock.calls[0][0]).toEqual({
      identifier: { id: "abc", type: "page" },
    });

    // The registerCascadeTool pipeline formats the preview and keeps raw data
    // out of structuredContent.
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset_type).toBe("page");
    expect(structured.asset).toBeUndefined();
  });

  test("cascade_read with oversize response mints handle, cascade_read_response retrieves slices", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    const readTool = tools["cascade_read"];
    const readResponseTool = tools["cascade_read_response"];
    expect(readTool).toBeDefined();
    expect(readResponseTool).toBeDefined();

    // Act 1: cascade_read with oversize result should mint a handle.
    const oversize = await readTool.handler({
      identifier: { id: "huge-page-id", type: "page" },
      read_mode: "raw",
    });

    expect(oversize.isError).not.toBe(true);

    const firstBlock = oversize.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      throw new Error("expected first content block to be text");
    }
    expect(firstBlock.text).toContain("cascade_read_response");
    expect(firstBlock.text).toMatch(/h_[a-z0-9-]+/i);

    const structured = oversize.structuredContent as Record<string, any>;
    const envelope = structured._cache;
    expect(envelope).toBeDefined();
    expect(typeof envelope.handle).toBe("string");
    expect(envelope.handle.length).toBeGreaterThan(0);
    expect(envelope.bytes_total).toBeGreaterThan(CHARACTER_LIMIT);
    expect(structured.success).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.asset).toBeUndefined();

    const handle = envelope.handle;

    // Act 2: cascade_read_response {handle, offset: 0, length: 100}.
    const firstSlice = await readResponseTool.handler({
      handle,
      offset: 0,
      length: 100,
    });

    expect(firstSlice.isError).not.toBe(true);
    const firstSliceStructured = firstSlice.structuredContent as Record<
      string,
      any
    >;
    expect(firstSliceStructured.bytes_returned).toBe(100);
    expect(firstSliceStructured.has_more).toBe(true);
    expect(firstSliceStructured.offset).toBe(0);
    expect(firstSliceStructured.next_offset).toBe(100);

    const firstSliceBlock = firstSlice.content[0];
    if (!firstSliceBlock || firstSliceBlock.type !== "text") {
      throw new Error("expected first slice content block to be text");
    }
    const firstSliceText = JSON.parse(firstSliceBlock.text);
    expect(firstSliceText.slice_text.length).toBe(100);

    // Act 3: cascade_read_response {handle, offset: 100, length: 100}.
    const secondSlice = await readResponseTool.handler({
      handle,
      offset: 100,
      length: 100,
    });

    expect(secondSlice.isError).not.toBe(true);
    const secondSliceStructured = secondSlice.structuredContent as Record<
      string,
      any
    >;
    expect(secondSliceStructured.offset).toBe(100);
    expect(secondSliceStructured.next_offset).toBe(200);

    const secondSliceBlock = secondSlice.content[0];
    if (!secondSliceBlock || secondSliceBlock.type !== "text") {
      throw new Error("expected second slice content block to be text");
    }
    const secondSliceText = JSON.parse(secondSliceBlock.text);
    expect(secondSliceText.slice_text.length).toBe(100);

    // Sequential slices must be contiguous — i.e. second slice != first slice.
    expect(secondSliceText.slice_text).not.toBe(firstSliceText.slice_text);
  });

  test("tools/call path returns project JSON validation errors for removed and invalid fields", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_OK)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    const removedField = await callToolViaSdkPath(server, "cascade_read", {
      identifier: { id: "abc", type: "page" },
      response_format: "json",
    });
    const removedBody = JSON.parse((removedField.content[0] as any).text);

    expect(removedField.isError).toBe(true);
    expect(removedBody.error.type).toBe("validation_error");
    expect(removedBody.error.issues[0].code).toBe("unrecognized_keys");
    expect(removedBody.error.issues[0].hint).toContain("response_format");

    const invalidEnum = await callToolViaSdkPath(server, "cascade_read", {
      identifier: { id: "abc", type: "page" },
      read_mode: "sk-testsecret123456",
    });
    const invalidBody = JSON.parse((invalidEnum.content[0] as any).text);

    expect(invalidEnum.isError).toBe(true);
    expect(invalidBody.error.type).toBe("validation_error");
    expect(JSON.stringify(invalidBody)).not.toContain("sk-testsecret123456");
    expect(client.read).not.toHaveBeenCalled();
  });

  test("cascade_read default preview omits heavy recursive fields", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    const readTool = tools["cascade_read"];
    const result = await readTool.handler({
      identifier: { id: "huge-page-id", type: "page" },
    });

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_identity.id).toBe("huge-page-id");
    expect(structured.asset_identity.name).toBe("huge-page");
    expect(structured.asset_identity.path).toBe("/huge");
    expect(structured.asset_identity.lastModifiedDate).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(structured.asset).toBeUndefined();
    expect(structured.root_outline.length).toBeLessThanOrEqual(20);
    expect(structured.warnings[0]).toContain("root nodelets omitted");
  });
});
