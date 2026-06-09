/**
 * Integration test for the server factory (`createServer`).
 *
 * Verifies that all tool cohorts wire up correctly and produce
 * the expected 62 tools with well-formed names (25 direct Cascade API tools,
 * 14 cached asset follow-up tools, 19 draft workflow tools, and 4 local utilities). Also exercises one
 * end-to-end handler invocation (`cascade_read`) through the real
 * pipeline that `registerCascadeTool` installs on the server, plus
 * the oversize-response round-trip through `cascade_read_response`.
 */

import { describe, test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
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

async function listToolsResultViaSdkPath(server: unknown): Promise<Record<string, any>> {
  const protocol = (server as { server: { _requestHandlers: Map<string, any> } }).server;
  const handler = protocol._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler not registered");
  return handler(
    {
      method: "tools/list",
      params: {},
    },
    {},
  );
}

async function listToolsViaSdkPath(server: unknown): Promise<Record<string, any>> {
  const result = await listToolsResultViaSdkPath(server);
  return Object.fromEntries(
    result.tools.map((tool: Record<string, any>) => [tool.name, tool]),
  );
}

function schemaTypes(schema: any): string[] {
  const types = new Set<string>();
  collectSchemaTypes(schema, types);
  return Array.from(types).sort();
}

function collectSchemaTypes(schema: any, types: Set<string>): void {
  if (!schema || typeof schema !== "object") return;
  if (typeof schema.type === "string") types.add(schema.type);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      for (const child of schema[key]) collectSchemaTypes(child, types);
    }
  }
}

function schemaHasRequiredBranch(schema: any, field: string): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (Array.isArray(schema.required) && schema.required.includes(field)) {
    return true;
  }
  return ["anyOf", "oneOf", "allOf"].some((key) =>
    Array.isArray(schema[key])
      ? schema[key].some((child: any) => schemaHasRequiredBranch(child, field))
      : false,
  );
}

function schemaHasProperty(schema: any, field: string): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (schema.properties && Object.hasOwn(schema.properties, field)) return true;
  return ["anyOf", "oneOf", "allOf"].some((key) =>
    Array.isArray(schema[key])
      ? schema[key].some((child: any) => schemaHasProperty(child, field))
      : false,
  );
}

function schemasAtPath(schema: any, path: string[]): any[] {
  if (!schema || typeof schema !== "object") return [];
  if (path.length === 0) return [schema];

  const [field, ...rest] = path;
  const matches: any[] = [];
  if (field === "[]" && schema.items) {
    matches.push(...schemasAtPath(schema.items, rest));
  }
  if (field !== "[]" && schema.properties && Object.hasOwn(schema.properties, field)) {
    matches.push(...schemasAtPath(schema.properties[field], rest));
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      for (const child of schema[key]) matches.push(...schemasAtPath(child, path));
    }
  }
  return matches;
}

function schemaPathTypes(schema: any, path: string[]): string[] {
  const types = new Set<string>();
  for (const match of schemasAtPath(schema, path)) {
    for (const type of schemaTypes(match)) types.add(type);
  }
  return Array.from(types).sort();
}

function schemaPathHasRequiredBranch(schema: any, path: string[], field: string): boolean {
  return schemasAtPath(schema, path).some((match) =>
    schemaHasRequiredBranch(match, field),
  );
}

function assertStrictObjectBranches(schema: any): void {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object" && schema.properties) {
    expect(schema.additionalProperties).toBe(false);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      for (const child of schema[key]) assertStrictObjectBranches(child);
    }
  }
  if (schema.properties) {
    for (const child of Object.values(schema.properties)) {
      assertStrictObjectBranches(child);
    }
  }
  if (schema.items) assertStrictObjectBranches(schema.items);
}

function assetPropertyEntriesFromTypes(): Array<{ key: string; optional: boolean }> {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(/export type AssetPropertiesBase = \{([\s\S]*?)\n\};/);
  if (!match) throw new Error("AssetPropertiesBase type not found");
  expect(source).toContain("export type AssetProperties = RequireExactlyOne<");
  expect(source).toContain("AssetPropertiesBase,");
  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+)(\?)?:/gm)]
    .map((item) => ({ key: item[1], optional: item[2] === "?" }))
    .filter((entry) => entry.key !== "workflowConfiguration")
    .sort((a, b) => a.key.localeCompare(b.key));
}

function assetPropertyKeysFromTypes(): string[] {
  return assetPropertyEntriesFromTypes().map((entry) => entry.key).sort();
}

/** All 62 expected tool names: 25 direct Cascade API tools, 14 cached asset follow-up tools, 19 draft workflow tools, and 4 local utilities. */
const EXPECTED_TOOL_NAMES = [
  // crud and asset follow-ups (20)
  "cascade_read",
  "cascade_asset_list_facts",
  "cascade_asset_search_values",
  "cascade_asset_search_keys",
  "cascade_asset_get_value",
  "cascade_asset_list_scalar_artifacts",
  "cascade_asset_list_references",
  "cascade_asset_list_nodelets",
  "cascade_asset_get_nodelet",
  "cascade_asset_resolve_nodes",
  "cascade_asset_assert_values",
  "cascade_file_data_info",
  "cascade_file_data_read",
  "cascade_file_data_image",
  "cascade_file_data_export",
  "cascade_create",
  "cascade_edit",
  "cascade_remove",
  "cascade_move",
  "cascade_copy",
  // draft workflow (19)
  "cascade_draft_open",
  "cascade_draft_list_facts",
  "cascade_draft_search_values",
  "cascade_draft_search_keys",
  "cascade_draft_get_value",
  "cascade_draft_list_scalar_artifacts",
  "cascade_draft_list_references",
  "cascade_draft_list_nodelets",
  "cascade_draft_get_nodelet",
  "cascade_draft_apply_patch",
  "cascade_draft_apply_semantic_patch",
  "cascade_draft_assert_values",
  "cascade_draft_mutation_plan_execute",
  "cascade_draft_resolve_nodes",
  "cascade_draft_scaffold_create",
  "cascade_draft_scaffold_from_asset",
  "cascade_draft_set_file_data",
  "cascade_draft_validate",
  "cascade_draft_submit",
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

const READ_IMAGE_FILE = {
  success: true,
  asset: {
    file: {
      id: "file123",
      type: "file",
      name: "hero.jpg",
      path: "/_files/hero.jpg",
      data: [-1, -40, -1, -31, 0, 16, 69, 120, 105, 102],
    },
  },
} as const;

describe("createServer (server factory)", () => {
  test("registers exactly 62 tools", () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const tools = getRegisteredTools(server);

    expect(Object.keys(tools)).toHaveLength(62);
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
    expect(unique.size).toBe(62);
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

  test("cascade_file_data_image returns only image content through sdk tools call", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    const readResult = await callToolViaSdkPath(server, "cascade_read", {
      identifier: { id: "file123", type: "file" },
    });
    const handle = (readResult.structuredContent as Record<string, any>).asset_handle;
    const imageResult = await callToolViaSdkPath(server, "cascade_file_data_image", {
      asset_handle: handle,
    });

    expect(CallToolResultSchema.safeParse(imageResult).success).toBe(true);
    expect(imageResult.content).toEqual([
      {
        type: "image",
        mimeType: "image/jpeg",
        data: "/9j/4QAQRXhpZg==",
      },
    ]);
    expect(imageResult.structuredContent).toBeUndefined();
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

  test("tools/list advertises exact typed schemas while tools/call keeps project validation errors", async () => {
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_OK)),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    const listResult = await listToolsResultViaSdkPath(server);
    const parsedListResult = ListToolsResultSchema.safeParse(listResult);

    expect(parsedListResult.success).toBe(true);
    for (const tool of listResult.tools) {
      expect(tool.inputSchema.type).toBe("object");
      for (const keyword of ["anyOf", "oneOf", "allOf", "enum", "not"]) {
        expect(Object.hasOwn(tool.inputSchema, keyword)).toBe(false);
      }
      assertStrictObjectBranches(tool.inputSchema);
    }

    const tools = Object.fromEntries(
      listResult.tools.map((tool: Record<string, any>) => [tool.name, tool]),
    );
    const readSchema = tools["cascade_read"].inputSchema;
    const createSchema = tools["cascade_create"].inputSchema;
    const editSchema = tools["cascade_edit"].inputSchema;
    const removeSchema = tools["cascade_remove"].inputSchema;
    const moveSchema = tools["cascade_move"].inputSchema;
    const copySchema = tools["cascade_copy"].inputSchema;
    const accessSchema = tools["cascade_edit_access_rights"].inputSchema;
    const workflowSettingsSchema =
      tools["cascade_edit_workflow_settings"].inputSchema;
    const publishSchema = tools["cascade_publish_unpublish"].inputSchema;
    const searchSchema = tools["cascade_search"].inputSchema;
    const siteCopySchema = tools["cascade_site_copy"].inputSchema;
    const nodeletSchema = tools["cascade_asset_get_nodelet"].inputSchema;
    const fileDataInfoSchema = tools["cascade_file_data_info"].inputSchema;
    const fileDataReadSchema = tools["cascade_file_data_read"].inputSchema;
    const fileDataImageSchema = tools["cascade_file_data_image"].inputSchema;
    const fileDataExportSchema = tools["cascade_file_data_export"].inputSchema;
    const draftOpenSchema = tools["cascade_draft_open"].inputSchema;
    const draftPatchSchema = tools["cascade_draft_apply_patch"].inputSchema;
    const draftScaffoldCreateSchema =
      tools["cascade_draft_scaffold_create"].inputSchema;
    const draftSetFileDataSchema = tools["cascade_draft_set_file_data"].inputSchema;
    const draftSubmitSchema = tools["cascade_draft_submit"].inputSchema;
    const transitionSchema = tools["cascade_perform_workflow_transition"].inputSchema;
    const auditSchema = tools["cascade_read_audits"].inputSchema;
    const preferenceSchema = tools["cascade_edit_preference"].inputSchema;
    const markSchema = tools["cascade_mark_message"].inputSchema;

    expect(schemaTypes(readSchema.properties.identifier)).toContain("object");
    expect(schemaHasRequiredBranch(readSchema.properties.identifier, "id")).toBe(true);
    expect(schemaHasRequiredBranch(readSchema.properties.identifier, "path")).toBe(true);
    expect(readSchema.required).toContain("identifier");
    expect(readSchema.properties.read_mode.default).toBe("preview");
    expect(JSON.stringify(readSchema.properties.read_mode)).toContain("raw");

    expect(schemaTypes(createSchema.properties.asset)).toContain("object");
    expect(schemaTypes(editSchema.properties.asset)).toContain("object");
    for (const entry of assetPropertyEntriesFromTypes()) {
      expect(entry.optional).toBe(true);
    }
    for (const key of assetPropertyKeysFromTypes()) {
      expect(schemaHasRequiredBranch(createSchema.properties.asset, key)).toBe(true);
      expect(schemaHasRequiredBranch(editSchema.properties.asset, key)).toBe(true);
    }
    expect(schemaHasProperty(createSchema.properties.asset, "workflowConfiguration")).toBe(true);
    expect(schemaHasProperty(editSchema.properties.asset, "workflowConfiguration")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["reference"], "referencedAssetId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["reference"], "referencedAssetPath")).toBe(true);
    expect(schemaPathHasRequiredBranch(editSchema.properties.asset, ["page"], "siteId")).toBe(true);
    expect(schemaPathHasRequiredBranch(editSchema.properties.asset, ["page"], "siteName")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["role"], "globalAbilities")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["role"], "siteAbilities")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["role"], "roleType")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType"], "pageConfigurationSetId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType"], "pageConfigurationSetPath")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType"], "metadataSetId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType"], "metadataSetPath")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["destination"], "transportId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["destination"], "transportPath")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["destination"], "siteId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["destination"], "siteName")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["pageConfigurationSet", "pageConfigurations", "[]"], "templateId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["pageConfigurationSet", "pageConfigurations", "[]"], "templatePath")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType", "contentTypePageConfigurations", "[]"], "pageConfigurationId")).toBe(true);
    expect(schemaPathHasRequiredBranch(createSchema.properties.asset, ["contentType", "contentTypePageConfigurations", "[]"], "pageConfigurationName")).toBe(true);
    expect(schemaPathTypes(createSchema.properties.asset, ["file", "data"])).toEqual(["array"]);
    expect(schemaPathTypes(createSchema.properties.asset, ["file", "data", "[]"])).toEqual(["number"]);
    expect(schemaPathTypes(editSchema.properties.asset, ["file", "data", "[]"])).toEqual(["number"]);
    expect(tools["cascade_create"].description).toContain(
      "asset.file.data` accepts signed Java bytes (-128..127) or unsigned file bytes (0..255)",
    );
    expect(tools["cascade_edit"].description).toContain(
      "asset.file.data` accepts signed Java bytes (-128..127) or unsigned file bytes (0..255)",
    );
    expect(schemaPathTypes(createSchema.properties.asset, ["destination", "publishIntervalHours"])).toEqual(["number"]);
    expect(schemaPathTypes(createSchema.properties.asset, ["ftpTransport", "port"])).toEqual(["number"]);
    expect(schemaPathTypes(createSchema.properties.asset, ["site", "linkCheckerEnabled"])).toEqual(["boolean"]);
    expect(schemaPathTypes(createSchema.properties.asset, ["folder", "shouldBePublished"])).toEqual(["boolean"]);
    expect(schemaTypes(removeSchema.properties.identifier)).toContain("object");
    expect(removeSchema.properties.deleteParameters.type).toBe("object");
    expect(removeSchema.properties.deleteParameters.required).toContain("doWorkflow");
    expect(schemaHasRequiredBranch(removeSchema.properties.workflowConfiguration, "workflowDefinitionId")).toBe(true);
    expect(schemaHasRequiredBranch(removeSchema.properties.workflowConfiguration, "workflowDefinitionPath")).toBe(true);
    expect(moveSchema.properties.moveParameters.type).toBe("object");
    expect(schemaHasRequiredBranch(moveSchema.properties.workflowConfiguration, "workflowDefinitionId")).toBe(true);
    expect(schemaHasRequiredBranch(moveSchema.properties.workflowConfiguration, "workflowDefinitionPath")).toBe(true);
    expect(copySchema.properties.copyParameters.type).toBe("object");
    expect(schemaHasRequiredBranch(copySchema.properties.workflowConfiguration, "workflowDefinitionId")).toBe(true);
    expect(schemaHasRequiredBranch(copySchema.properties.workflowConfiguration, "workflowDefinitionPath")).toBe(true);

    const aclEntrySchema =
      accessSchema.properties.accessRightsInformation.properties.aclEntries.items;
    expect(accessSchema.properties.accessRightsInformation.type).toBe("object");
    expect(schemaHasRequiredBranch(aclEntrySchema, "name")).toBe(true);
    expect(schemaHasRequiredBranch(aclEntrySchema, "id")).toBe(true);
    expect(accessSchema.properties.applyToChildren.type).toBe("boolean");

    expect(workflowSettingsSchema.properties.workflowSettings.type).toBe("object");
    expect(
      schemaTypes(
        workflowSettingsSchema.properties.workflowSettings.properties.workflowDefinitions,
      ),
    ).toEqual(["array"]);
    expect(
      workflowSettingsSchema.properties.workflowSettings.properties.inheritWorkflows
        .type,
    ).toBe("boolean");
    expect(
      workflowSettingsSchema.properties.workflowSettings.properties.requireWorkflow
        .type,
    ).toBe("boolean");

    expect(publishSchema.properties.publishInformation.type).toBe("object");
    expect(
      schemaTypes(publishSchema.properties.publishInformation.properties.destinations),
    ).toEqual(["array"]);
    expect(
      schemaTypes(publishSchema.properties.publishInformation.properties.unpublish),
    ).toEqual(["boolean", "null"]);

    expect(searchSchema.properties.limit.type).toBe("number");
    expect(searchSchema.properties.limit.default).toBe(50);
    expect(searchSchema.properties.offset.type).toBe("number");
    expect(searchSchema.properties.offset.default).toBe(0);
    expect(schemaHasProperty(siteCopySchema, "originalSiteId")).toBe(true);
    expect(schemaHasProperty(siteCopySchema, "originalSiteName")).toBe(true);
    expect(siteCopySchema.required).toContain("newSiteName");
    expect(nodeletSchema.properties.depth.type).toBe("number");
    expect(nodeletSchema.properties.depth.default).toBe(0);
    expect(nodeletSchema.properties.include_text.type).toBe("boolean");
    expect(nodeletSchema.properties.include_text.default).toBe(true);
    expect(schemaHasProperty(fileDataInfoSchema, "asset_handle")).toBe(true);
    expect(schemaTypes(fileDataInfoSchema.properties.identifier)).toContain("object");
    expect(schemaTypes(fileDataReadSchema.properties.identifier)).toContain("object");
    expect(fileDataReadSchema.properties.offset.type).toBe("number");
    expect(fileDataReadSchema.properties.offset.default).toBe(0);
    expect(fileDataReadSchema.properties.length.type).toBe("number");
    expect(fileDataReadSchema.properties.length.default).toBe(64);
    expect(JSON.stringify(fileDataReadSchema.properties.encoding)).toContain("base64");
    expect(schemaTypes(fileDataImageSchema.properties.identifier)).toContain("object");
    expect(schemaHasProperty(fileDataExportSchema, "output_path")).toBe(true);
    expect(fileDataExportSchema.required).toContain("output_path");
    expect(fileDataExportSchema.properties.overwrite.type).toBe("boolean");
    expect(fileDataExportSchema.properties.overwrite.default).toBe(false);
    expect(fileDataExportSchema.properties.expected_sha256.type).toBe("string");
    expect(JSON.stringify(draftOpenSchema)).toContain("edit");
    expect(JSON.stringify(draftOpenSchema)).toContain("create");
    expect(draftOpenSchema.required).toContain("operation");
    expect(schemaHasProperty(draftOpenSchema, "asset_handle")).toBe(true);
    expect(schemaHasProperty(draftOpenSchema, "expected_raw_hash")).toBe(true);
    expect(schemaHasProperty(draftOpenSchema, "asset")).toBe(true);
    expect(draftScaffoldCreateSchema.required).toContain("asset_type");
    expect(JSON.stringify(draftScaffoldCreateSchema.properties.asset_type)).toContain("page");
    expect(draftScaffoldCreateSchema.properties.relationship_style.default).toBe("path");
    expect(draftScaffoldCreateSchema.properties.role_type.default).toBe("global");
    expect(schemaHasProperty(draftSetFileDataSchema, "input_path")).toBe(true);
    expect(schemaHasProperty(draftSetFileDataSchema, "base64_data")).toBe(true);
    expect(schemaHasProperty(draftSetFileDataSchema, "expected_sha256")).toBe(true);
    expect(draftPatchSchema.required).toEqual(
      expect.arrayContaining(["draft_handle", "expected_revision", "operations"]),
    );
    expect(JSON.stringify(draftPatchSchema.properties.operations)).toContain("replace");
    expect(JSON.stringify(draftPatchSchema.properties.operations)).toContain("remove");
    expect(draftSubmitSchema.required).toContain("expected_revision");
    expect(draftSubmitSchema.properties.expected_revision.type).toBe("number");
    expect(draftSubmitSchema.properties.discard_on_success.type).toBe("boolean");

    expect(
      transitionSchema.properties.workflowTransitionInformation.type,
    ).toBe("object");
    expect(
      transitionSchema.properties.workflowTransitionInformation.required,
    ).toEqual(expect.arrayContaining(["workflowId", "actionIdentifier"]));

    expect(auditSchema.required).toContain("auditParameters");
    expect(auditSchema.properties.auditParameters.type).toBe("object");
    expect(
      auditSchema.properties.auditParameters.properties.rolename.type,
    ).toBe("string");
    expect(auditSchema.properties.auditParameters.properties.role).toBeUndefined();

    expect(preferenceSchema.required).toContain("preference");
    expect(preferenceSchema.properties.preference.type).toBe("object");
    expect(preferenceSchema.properties.preference.required).toEqual(
      expect.arrayContaining(["name", "value"]),
    );
    expect(preferenceSchema.properties.preference.properties.name.type).toBe("string");
    expect(preferenceSchema.properties.preference.properties.value.type).toBe("string");

    const markTypeSchema = JSON.stringify(markSchema.properties.markType);
    expect(markSchema.required).toEqual(
      expect.arrayContaining(["identifier", "markType"]),
    );
    expect(markTypeSchema).toContain("read");
    expect(markTypeSchema).toContain("unread");
    expect(markTypeSchema).not.toContain("archive");

    const invalid = await callToolViaSdkPath(server, "cascade_read", {
      identifier: "{\"id\":\"abc\",\"type\":\"page\"}",
    });
    const body = JSON.parse((invalid.content[0] as any).text);

    expect(invalid.isError).toBe(true);
    expect(body.error.type).toBe("validation_error");
    expect(body.error.valid_fields).toEqual(["identifier", "read_mode"]);
    expect(client.read).not.toHaveBeenCalled();
  });

  test("tools/call rejects stringified object fields across write tools", async () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });
    const identifier = { id: "abc", type: "page" };

    const cases = [
      {
        tool: "cascade_create",
        method: client.create,
        args: { asset: JSON.stringify({ page: { name: "index" } }) },
      },
      {
        tool: "cascade_edit",
        method: client.edit,
        args: { asset: JSON.stringify({ page: { id: "abc" } }) },
      },
      {
        tool: "cascade_remove",
        method: client.remove,
        args: { identifier: JSON.stringify(identifier) },
      },
      {
        tool: "cascade_move",
        method: client.move,
        args: {
          identifier,
          moveParameters: JSON.stringify({
            destinationContainerIdentifier: { id: "folder-1", type: "folder" },
            doWorkflow: false,
          }),
        },
      },
      {
        tool: "cascade_copy",
        method: client.copy,
        args: {
          identifier,
          copyParameters: JSON.stringify({
            destinationContainerIdentifier: { id: "folder-1", type: "folder" },
            doWorkflow: false,
          }),
        },
      },
      {
        tool: "cascade_publish_unpublish",
        method: client.publishUnpublish,
        args: {
          identifier,
          publishInformation: JSON.stringify({ destinations: [] }),
        },
      },
      {
        tool: "cascade_edit_access_rights",
        method: client.editAccessRights,
        args: {
          identifier,
          accessRightsInformation: JSON.stringify({
            allLevel: "read",
            aclEntries: [],
          }),
        },
      },
      {
        tool: "cascade_edit_workflow_settings",
        method: client.editWorkflowSettings,
        args: {
          identifier: { id: "folder-1", type: "folder" },
          workflowSettings: JSON.stringify({
            workflowDefinitions: [],
            inheritWorkflows: true,
            requireWorkflow: false,
          }),
        },
      },
      {
        tool: "cascade_perform_workflow_transition",
        method: client.performWorkflowTransition,
        args: {
          workflowTransitionInformation: JSON.stringify({
            workflowId: "wf-1",
            actionIdentifier: "approve",
          }),
        },
      },
      {
        tool: "cascade_draft_open",
        args: {
          operation: "create",
          asset: JSON.stringify({ page: { name: "index" } }),
        },
      },
      {
        tool: "cascade_draft_apply_patch",
        args: {
          draft_handle: "d_00000000-0000-0000-0000-000000000000",
          expected_revision: 1,
          operations: JSON.stringify([
            { op: "replace", path: "/asset/page/name", value: "next" },
          ]),
        },
        expectedIssuePath: "operations",
      },
    ];

    for (const testCase of cases) {
      const result = await callToolViaSdkPath(server, testCase.tool, testCase.args);
      const body = JSON.parse((result.content[0] as any).text);

      expect(result.isError).toBe(true);
      expect(body.error.type).toBe("validation_error");
      if (typeof testCase.expectedIssuePath === "string") {
        const expectedIssuePath = testCase.expectedIssuePath;
        expect(
          body.error.issues.some((issue: Record<string, unknown>) =>
            String(issue.path).startsWith(expectedIssuePath),
          ),
        ).toBe(true);
      }
      if ("method" in testCase) {
        expect(testCase.method).not.toHaveBeenCalled();
      }
    }
  });

  test("tools/call rejects string numeric and boolean fields", async () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    const cases = [
      {
        tool: "cascade_search",
        method: client.search,
        args: { searchInformation: { searchTerms: "x" }, limit: "50" },
      },
      {
        tool: "cascade_search",
        method: client.search,
        args: { searchInformation: { searchTerms: "x" }, offset: "0" },
      },
      {
        tool: "cascade_asset_get_nodelet",
        args: { asset_handle: "a_abc", pointer: "", depth: "2" },
      },
      {
        tool: "cascade_asset_get_nodelet",
        args: { asset_handle: "a_abc", pointer: "", include_text: "false" },
      },
      {
        tool: "cascade_remove",
        method: client.remove,
        args: {
          identifier: { id: "abc", type: "page" },
          deleteParameters: { doWorkflow: "false" },
        },
      },
      {
        tool: "cascade_move",
        method: client.move,
        args: {
          identifier: { id: "abc", type: "page" },
          moveParameters: {
            destinationContainerIdentifier: { id: "folder-1", type: "folder" },
            doWorkflow: "false",
          },
        },
      },
      {
        tool: "cascade_copy",
        method: client.copy,
        args: {
          identifier: { id: "abc", type: "page" },
          copyParameters: {
            destinationContainerIdentifier: { id: "folder-1", type: "folder" },
            doWorkflow: "false",
            newName: "copy",
          },
        },
      },
      {
        tool: "cascade_publish_unpublish",
        method: client.publishUnpublish,
        args: {
          identifier: { id: "abc", type: "page" },
          publishInformation: { unpublish: "false" },
        },
      },
      {
        tool: "cascade_edit_workflow_settings",
        method: client.editWorkflowSettings,
        args: {
          identifier: { id: "folder-1", type: "folder" },
          workflowSettings: { inheritWorkflows: "true" },
        },
      },
      {
        tool: "cascade_edit_access_rights",
        method: client.editAccessRights,
        args: {
          identifier: { id: "abc", type: "page" },
          accessRightsInformation: { allLevel: "read" },
          applyToChildren: "false",
        },
      },
    ];

    for (const testCase of cases) {
      const result = await callToolViaSdkPath(server, testCase.tool, testCase.args);
      const body = JSON.parse((result.content[0] as any).text);

      expect(result.isError).toBe(true);
      expect(body.error.type).toBe("validation_error");
      if ("method" in testCase) {
        expect(testCase.method).not.toHaveBeenCalled();
      }
    }
  });

  test("tools/call keeps cascade_remove safety policies at runtime", async () => {
    const client = createMockClient();
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    for (const args of [
      { identifier: { id: "site-1", type: "site" } },
      {
        identifier: {
          type: "folder",
          path: { path: "/", siteName: "my-site" },
        },
      },
    ]) {
      const result = await callToolViaSdkPath(server, "cascade_remove", args);
      const body = JSON.parse((result.content[0] as any).text);

      expect(result.isError).toBe(true);
      expect(body.error.type).toBe("validation_error");
    }

    expect(client.remove).not.toHaveBeenCalled();
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

  test("draft edit flow reads, clones, patches, and submits the full envelope", async () => {
    const client = createMockClient({
      read: mock(() =>
        Promise.resolve({
          ...READ_PAGE_OK,
          asset: {
            page: {
              ...READ_PAGE_OK.asset.page,
              xhtml: "<p>Home</p>",
            },
          },
        }),
      ),
      edit: mock(() => Promise.resolve({ success: true })),
    });
    const server = createServer(client, { toolBlockStore: emptyToolBlockStore() });

    const readResult = await callToolViaSdkPath(server, "cascade_read", {
      identifier: { id: "page-001", type: "page" },
    });
    const readBody = readResult.structuredContent as Record<string, any>;

    const openResult = await callToolViaSdkPath(server, "cascade_draft_open", {
      operation: "edit",
      asset_handle: readBody.asset_handle,
      expected_raw_hash: readBody.raw_hash,
    });
    const draftHandle = (openResult.structuredContent as Record<string, any>).draft_handle;

    await callToolViaSdkPath(server, "cascade_draft_apply_patch", {
      draft_handle: draftHandle,
      expected_revision: 1,
      operations: [
        { op: "replace", path: "/asset/page/name", value: "updated-index" },
      ],
    });

    const submitResult = await callToolViaSdkPath(server, "cascade_draft_submit", {
      draft_handle: draftHandle,
      expected_revision: 2,
    });

    expect(submitResult.isError).not.toBe(true);
    expect(client.edit).toHaveBeenCalledTimes(1);
    expect(client.edit.mock.calls[0][0]).toMatchObject({
      asset: { page: { id: "page-001", name: "updated-index" } },
    });
    expect(client.edit.mock.calls[0][0].asset.page.type).toBeUndefined();
  });
});
