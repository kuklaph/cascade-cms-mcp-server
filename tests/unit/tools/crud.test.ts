import { describe, test, expect, mock } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerCrudTools } from "../../../src/tools/crud.js";
import {
  ReadRequestSchema,
  AssetListFactsRequestSchema,
  AssetSearchValuesRequestSchema,
  AssetSearchKeysRequestSchema,
  AssetGetValueRequestSchema,
  AssetListScalarArtifactsRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
  FileDataExportRequestSchema,
  FileDataInfoRequestSchema,
  FileDataImageRequestSchema,
  FileDataReadRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
} from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import {
  OK_RESULT,
  CREATE_OK,
  READ_PAGE_OK,
  READ_PAGE_HUGE,
} from "../../fixtures/cascade-responses.js";


// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const ID_PAGE = { id: "abc123", type: "page" as const };
const ID_FILE = { id: "file123", type: "file" as const };
const VALID_ASSET = {
  page: {
    name: "index",
    parentFolderPath: "/",
    siteName: "my-site",
    contentTypePath: "/content-types/default",
    xhtml: "<p>Home</p>",
  },
};
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
};
const READ_EXTENSION_IMAGE_FILE = {
  success: true,
  asset: {
    file: {
      id: "file456",
      type: "file",
      name: "not-really.png",
      path: "/_files/not-really.png",
      data: [1, 2, 3, 4],
    },
  },
};

function assetPropertyKeysFromTypes(): string[] {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(/export type AssetPropertiesBase = \{([\s\S]*?)\n\};/);
  if (!match) throw new Error("AssetPropertiesBase type not found");
  expect(source).toContain("export type AssetProperties = RequireExactlyOne<");
  expect(source).toContain("AssetPropertiesBase,");
  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+)\?:/gm)]
    .map((item) => item[1])
    .filter((key) => key !== "workflowConfiguration")
    .sort((a, b) => a.localeCompare(b));
}

// =============================================================================
// cascade_read
// =============================================================================

describe("cascade_read tool", () => {
  test("preview default: calls client.read and returns compact handle-based preview", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);

    const tool = findTool(tools, "cascade_read");
    expect(tool.config.annotations.readOnlyHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset_type).toBe("page");
    expect(structured.raw_resource_uri).toBe(
      `cascade://asset/${structured.asset_handle}/raw`,
    );
    expect(structured.raw_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(structured.index_version).toBe(1);
    expect(structured.audit_complete).toBe(false);
    expect(structured.total_fact_count).toBeGreaterThan(100);
    expect(structured.node_count).toBe(100);
    expect(structured.asset).toBeUndefined();
    expect(structured.root_outline).toHaveLength(20);

    const link = result.content.find((block) => block.type === "resource_link");
    expect(link).toMatchObject({
      type: "resource_link",
      uri: structured.raw_resource_uri,
      name: "Cascade raw asset JSON",
      mimeType: "application/json",
    });
  });

  test("schema validation: rejects input missing required identifier field", () => {
    const parsed = ReadRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.reject(new Error("Request Failed. Request Response: Not Found"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_read");
    expect(text).toContain("Not Found");
  });

  test("read_mode: 'raw' returns bounded cache metadata for oversize raw responses", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");

    const result = await tool.handler({
      identifier: { id: "huge-page-id", type: "page" },
      read_mode: "raw",
    });

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.success).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.asset).toBeUndefined();
    expect(structured._cache.handle).toMatch(/^h_[0-9a-f-]+$/);
  });

  test("SDK-validated omitted read_mode uses preview by default", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");
    const parsedInput = (tool.config.inputSchema as any).parse({
      identifier: { id: "huge-page-id", type: "page" },
    });

    const result = await tool.handler(parsedInput);

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset).toBeUndefined();
  });

  test("audit and nodelet follow-up tools inspect the cached asset handle without calling Cascade again", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const read = findTool(tools, "cascade_read");
    const listFacts = findTool(tools, "cascade_asset_list_facts");
    const searchValues = findTool(tools, "cascade_asset_search_values");
    const searchKeys = findTool(tools, "cascade_asset_search_keys");
    const getValue = findTool(tools, "cascade_asset_get_value");
    const listArtifacts = findTool(tools, "cascade_asset_list_scalar_artifacts");
    const listReferences = findTool(tools, "cascade_asset_list_references");
    const listNodelets = findTool(tools, "cascade_asset_list_nodelets");
    const getNodelet = findTool(tools, "cascade_asset_get_nodelet");
    const resolveNodes = findTool(tools, "cascade_asset_resolve_nodes");
    const assertValues = findTool(tools, "cascade_asset_assert_values");

    const result = await read.handler({
      identifier: { id: "huge-page-id", type: "page" },
    });
    const handle = (result.structuredContent as Record<string, any>).asset_handle;

    const factsResult = await listFacts.handler({
      asset_handle: handle,
      fact_kind: "scalar",
      limit: 5,
    });
    const valuesResult = await searchValues.handler({
      asset_handle: handle,
      value_contains: "xxxxx",
    });
    const keysResult = await searchKeys.handler({
      asset_handle: handle,
      key: "xhtml",
    });
    const valueResult = await getValue.handler({
      asset_handle: handle,
      pointer: "/asset/page/xhtml",
      offset: 5,
      length: 5,
    });
    const artifactsResult = await listArtifacts.handler({
      asset_handle: handle,
      artifact_kind: "root_path",
    });
    const refsResult = await listReferences.handler({
      asset_handle: handle,
    });
    const listResult = await listNodelets.handler({
      asset_handle: handle,
      pointer: "",
      limit: 5,
    });
    const firstPointer = (listResult.structuredContent as Record<string, any>)
      .nodelets[0].pointer;
    const getResult = await getNodelet.handler({
      asset_handle: handle,
      pointer: firstPointer,
      depth: 0,
    });
    const resolveResult = await resolveNodes.handler({
      asset_handle: handle,
      selector: {
        node_type: "text",
        identifier: "node-1",
        text_contains: "yyy",
      },
    });
    const assertResult = await assertValues.handler({
      asset_handle: handle,
      assertions: [
        {
          match: { node_type: "text", identifier: "node-1" },
          target: { field: "text" },
          comparison: "contains",
          expected: "yyy",
        },
      ],
    });

    expect(factsResult.isError).not.toBe(true);
    expect(valuesResult.isError).not.toBe(true);
    expect(keysResult.isError).not.toBe(true);
    expect(valueResult.isError).not.toBe(true);
    expect(artifactsResult.isError).not.toBe(true);
    expect(refsResult.isError).not.toBe(true);
    expect((factsResult.structuredContent as Record<string, any>).results).toHaveLength(5);
    expect((valuesResult.structuredContent as Record<string, any>).results[0].pointer).toBe("/asset/page/xhtml");
    expect((keysResult.structuredContent as Record<string, any>).results[0].pointer).toBe("/asset/page/xhtml");
    expect((valueResult.structuredContent as Record<string, any>).value).toBe("xxxxx");
    expect((artifactsResult.structuredContent as Record<string, any>).source_scope).toBe("raw_scalar_artifacts");
    expect((listResult.structuredContent as Record<string, any>).nodelets).toHaveLength(5);
    expect((getResult.structuredContent as Record<string, any>).pointer).toBe(
      firstPointer,
    );
    expect((resolveResult.structuredContent as Record<string, any>).matched_count).toBe(1);
    expect((assertResult.structuredContent as Record<string, any>).passed).toBe(true);
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  test("follow-up tools return actionable errors for missing handles", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_asset_get_nodelet");

    const result = await tool.handler({
      asset_handle: "a_00000000-0000-0000-0000-000000000000",
      pointer: "",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_asset_get_nodelet");
    expect(firstText(result)).toContain("not found");
  });

  test("asset follow-up schemas require asset_handle", () => {
    expect(AssetListFactsRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetSearchValuesRequestSchema.safeParse({ value_contains: "x" }).success).toBe(false);
    expect(AssetSearchKeysRequestSchema.safeParse({ key: "x" }).success).toBe(false);
    expect(AssetGetValueRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
    expect(AssetListScalarArtifactsRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetListReferencesRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetListNodeletsRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
    expect(AssetGetNodeletRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
  });

  test("file data helper schemas require exactly one source", () => {
    expect(FileDataInfoRequestSchema.safeParse({ asset_handle: "a_123" }).success).toBe(true);
    expect(FileDataInfoRequestSchema.safeParse({ identifier: ID_FILE }).success).toBe(true);
    expect(FileDataInfoRequestSchema.safeParse({}).success).toBe(false);
    expect(
      FileDataInfoRequestSchema.safeParse({
        asset_handle: "a_123",
        identifier: ID_FILE,
      }).success,
    ).toBe(false);
    expect(FileDataInfoRequestSchema.safeParse({ identifier: ID_PAGE }).success).toBe(false);
    expect(FileDataImageRequestSchema.safeParse({ asset_handle: "a_123" }).success).toBe(true);
    expect(
      FileDataExportRequestSchema.safeParse({
        asset_handle: "a_123",
        output_path: "hero.jpg",
      }).success,
    ).toBe(true);
    expect(
      FileDataReadRequestSchema.safeParse({
        asset_handle: "a_123",
        offset: 0,
        length: 8193,
      }).success,
    ).toBe(false);
  });

  test("file data helpers inspect cached file data without calling Cascade again", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
    });

    registerCrudTools(server as any, client);
    const read = findTool(tools, "cascade_read");
    const info = findTool(tools, "cascade_file_data_info");
    const readData = findTool(tools, "cascade_file_data_read");

    const readResult = await read.handler({ identifier: ID_FILE });
    const handle = (readResult.structuredContent as Record<string, any>).asset_handle;
    const infoResult = await info.handler({ asset_handle: handle });
    const rangeResult = await readData.handler({
      asset_handle: handle,
      offset: 0,
      length: 4,
      encoding: "hex",
    });

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(infoResult.isError).not.toBe(true);
    expect(rangeResult.isError).not.toBe(true);
    expect(infoResult.structuredContent).toEqual(
      expect.objectContaining({
        success: true,
        asset_handle: handle,
        pointer: "/asset/file/data",
        bytes_total: 10,
        detected_kind: "jpeg",
        mime_type: "image/jpeg",
      }),
    );
    expect(rangeResult.structuredContent).toEqual(
      expect.objectContaining({
        success: true,
        asset_handle: handle,
        offset: 0,
        length: 4,
        bytes_total: 10,
        encoding: "hex",
        encoded_bytes: "ff d8 ff e1",
      }),
    );
  });

  test("file data helper direct identifier mode reads Cascade once and returns a follow-up handle", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
    });

    registerCrudTools(server as any, client);
    const info = findTool(tools, "cascade_file_data_info");

    const result = await info.handler({ identifier: ID_FILE });
    const structured = result.structuredContent as Record<string, any>;

    expect(result.isError).not.toBe(true);
    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read.mock.calls[0][0]).toEqual({ identifier: ID_FILE });
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.bytes_total).toBe(10);
    expect(structured.next_actions.map((action: any) => action.tool)).toContain(
      "cascade_file_data_read",
    );
  });

  test("file data image helper returns MCP image content without dumping base64 into JSON text", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
    });

    registerCrudTools(server as any, client);
    const read = findTool(tools, "cascade_read");
    const image = findTool(tools, "cascade_file_data_image");

    const readResult = await read.handler({ identifier: ID_FILE });
    const handle = (readResult.structuredContent as Record<string, any>).asset_handle;
    const result = await image.handler({ asset_handle: handle });
    const text = firstText(result);
    const imageBlock = result.content.find((block) => block.type === "image");

    expect(result.isError).not.toBe(true);
    expect(imageBlock).toEqual({
      type: "image",
      mimeType: "image/jpeg",
      data: "/9j/4QAQRXhpZg==",
    });
    expect(text).toContain('"mime_type": "image/jpeg"');
    expect(text).not.toContain("/9j/4QAQRXhpZg==");
    expect((result.structuredContent as Record<string, any>)._content_blocks).toBeUndefined();
  });

  test("file data image helper rejects extension-only image guesses", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_EXTENSION_IMAGE_FILE)),
    });

    registerCrudTools(server as any, client);
    const info = findTool(tools, "cascade_file_data_info");
    const image = findTool(tools, "cascade_file_data_image");

    const infoResult = await info.handler({ identifier: ID_FILE });
    const handle = (infoResult.structuredContent as Record<string, any>).asset_handle;
    const result = await image.handler({ asset_handle: handle });

    expect(infoResult.isError).not.toBe(true);
    expect((infoResult.structuredContent as Record<string, any>).mime_source).toBe("extension");
    expect(
      (infoResult.structuredContent as Record<string, any>).next_actions.map(
        (action: any) => action.tool,
      ),
    ).not.toContain("cascade_file_data_image");
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not a magic-byte verified image");
  });

  test("file data export writes exact bytes and refuses overwrite by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-file-data-"));
    const outputPath = join(dir, "hero.jpg");
    try {
      const { server, tools } = makeMockServer();
      const client = createMockClient({
        read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
      });

      registerCrudTools(server as any, client);
      const read = findTool(tools, "cascade_read");
      const exportFile = findTool(tools, "cascade_file_data_export");

      expect(exportFile.config.annotations.destructiveHint).toBe(true);
      const readResult = await read.handler({ identifier: ID_FILE });
      const handle = (readResult.structuredContent as Record<string, any>).asset_handle;
      const result = await exportFile.handler({
        asset_handle: handle,
        output_path: outputPath,
      });
      const second = await exportFile.handler({
        asset_handle: handle,
        output_path: outputPath,
      });

      expect(result.isError).not.toBe(true);
      expect([...readFileSync(outputPath)]).toEqual([
        255,
        216,
        255,
        225,
        0,
        16,
        69,
        120,
        105,
        102,
      ]);
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          success: true,
          asset_handle: handle,
          output_path: outputPath,
          bytes_written: 10,
          detected_kind: "jpeg",
          mime_type: "image/jpeg",
        }),
      );
      expect(second.isError).toBe(true);
      expect(firstText(second)).toContain("already exists");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("file data export validates expected hash and parent directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cascade-file-data-"));
    const mismatchPath = join(dir, "mismatch.jpg");
    const missingParentPath = join(dir, "missing", "hero.jpg");
    try {
      const { server, tools } = makeMockServer();
      const client = createMockClient({
        read: mock(() => Promise.resolve(READ_IMAGE_FILE)),
      });

      registerCrudTools(server as any, client);
      const read = findTool(tools, "cascade_read");
      const exportFile = findTool(tools, "cascade_file_data_export");

      const readResult = await read.handler({ identifier: ID_FILE });
      const handle = (readResult.structuredContent as Record<string, any>).asset_handle;
      const mismatch = await exportFile.handler({
        asset_handle: handle,
        output_path: mismatchPath,
        expected_sha256: "0".repeat(64),
      });
      const missingParent = await exportFile.handler({
        asset_handle: handle,
        output_path: missingParentPath,
      });

      expect(mismatch.isError).toBe(true);
      expect(firstText(mismatch)).toContain("expected_sha256 mismatch");
      expect(existsSync(mismatchPath)).toBe(false);
      expect(missingParent.isError).toBe(true);
      expect(firstText(missingParent)).toContain("Parent directory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// cascade_create
// =============================================================================

describe("cascade_create tool", () => {
  test("happy path: calls client.create and returns created id", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      create: mock(() => Promise.resolve(CREATE_OK)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_create");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const result = await tool.handler({
      asset: VALID_ASSET,
    });

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create.mock.calls[0][0]).toEqual({ asset: VALID_ASSET });
    expect(result.structuredContent).toEqual(CREATE_OK);
  });

  test("schema validation: rejects input with missing asset", () => {
    const parsed = CreateRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("description lists current generated asset branches", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_create");

    for (const key of assetPropertyKeysFromTypes()) {
      expect(tool.config.description).toContain(key);
    }
    expect(tool.config.description).not.toMatch(/(^|[ (,])target([, )]|$)/);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      create: mock(() => Promise.reject(new Error("Request Failed. Request Response: Duplicate"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_create");

    const result = await tool.handler({ asset: VALID_ASSET });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_create");
  });
});

// =============================================================================
// cascade_edit
// =============================================================================

describe("cascade_edit tool", () => {
  test("happy path: calls client.edit with asset wrapper", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      edit: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_edit");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const assetWithId = { page: { ...VALID_ASSET.page, id: "page-001" } };
    const result = await tool.handler({
      asset: assetWithId,
    });

    expect(client.edit).toHaveBeenCalledTimes(1);
    expect(client.edit.mock.calls[0][0]).toEqual({ asset: assetWithId });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects empty body", () => {
    const parsed = EditRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      edit: mock(() => Promise.reject(new Error("Request Failed. Request Response: Forbidden"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_edit");

    const result = await tool.handler({ asset: { page: { ...VALID_ASSET.page, id: "p1" } } });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_edit");
  });
});

// =============================================================================
// cascade_remove
// =============================================================================

describe("cascade_remove tool", () => {
  test("happy path: calls client.remove with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    expect(tool.config.annotations.destructiveHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
    });

    expect(client.remove).toHaveBeenCalledTimes(1);
    expect(client.remove.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
  });

  test("rejects site removal before calling client.remove", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    const result = await tool.handler({
      identifier: { id: "site-1", type: "site" },
    });

    expect(result.isError).toBe(true);
    expect(client.remove).not.toHaveBeenCalled();
    expect(firstText(result)).toContain("Cascade sites cannot be removed");
  });

  test("rejects root folder path removal before calling client.remove", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    const result = await tool.handler({
      identifier: {
        type: "folder",
        path: { path: "/", siteName: "my-site" },
      },
    });

    expect(result.isError).toBe(true);
    expect(client.remove).not.toHaveBeenCalled();
    expect(firstText(result)).toContain("Cascade site root folder path");
  });

  test("rejects root folder path removal with siteId before calling client.remove", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    const result = await tool.handler({
      identifier: {
        type: "folder",
        path: { path: "/", siteId: "site-1" },
      },
    });

    expect(result.isError).toBe(true);
    expect(client.remove).not.toHaveBeenCalled();
    expect(firstText(result)).toContain("Cascade site root folder path");
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = RemoveRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.reject(new Error("Request Failed. Request Response: Locked"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_remove");
  });
});

// =============================================================================
// cascade_move
// =============================================================================

describe("cascade_move tool", () => {
  test("happy path: calls client.move with identifier + moveParameters", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      move: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_move");

    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const moveParameters = {
      destinationContainerIdentifier: { id: "folder-1", type: "folder" as const },
      doWorkflow: false,
      newName: "new-index",
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      moveParameters,
    });

    expect(client.move).toHaveBeenCalledTimes(1);
    expect(client.move.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      moveParameters,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing moveParameters", () => {
    const parsed = MoveRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      move: mock(() => Promise.reject(new Error("Request Failed. Request Response: Name Collision"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_move");

    const result = await tool.handler({
      identifier: ID_PAGE,
      moveParameters: { doWorkflow: false },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_move");
  });
});

// =============================================================================
// cascade_copy
// =============================================================================

describe("cascade_copy tool", () => {
  test("happy path: calls client.copy with identifier + copyParameters", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      copy: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_copy");

    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const copyParameters = {
      destinationContainerIdentifier: { id: "folder-2", type: "folder" as const },
      doWorkflow: false,
      newName: "index-copy",
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      copyParameters,
    });

    expect(client.copy).toHaveBeenCalledTimes(1);
    expect(client.copy.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      copyParameters,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing copyParameters", () => {
    const parsed = CopyRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      copy: mock(() => Promise.reject(new Error("Request Failed. Request Response: Quota Exceeded"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_copy");

    const result = await tool.handler({
      identifier: ID_PAGE,
      copyParameters: {
        destinationContainerIdentifier: { id: "f", type: "folder" },
        doWorkflow: false,
        newName: "dup",
      },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_copy");
  });
});

// =============================================================================
// Registration coverage: CRUD tools plus handle-based asset follow-ups
// =============================================================================

describe("registerCrudTools coverage", () => {
  test("registers CRUD tools and asset follow-up tools with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "cascade_asset_assert_values",
      "cascade_asset_get_nodelet",
      "cascade_asset_get_value",
      "cascade_asset_list_facts",
      "cascade_asset_list_nodelets",
      "cascade_asset_list_references",
      "cascade_asset_list_scalar_artifacts",
      "cascade_asset_resolve_nodes",
      "cascade_asset_search_keys",
      "cascade_asset_search_values",
      "cascade_copy",
      "cascade_create",
      "cascade_edit",
      "cascade_file_data_export",
      "cascade_file_data_image",
      "cascade_file_data_info",
      "cascade_file_data_read",
      "cascade_move",
      "cascade_read",
      "cascade_remove",
    ]);
  });

  test("asset follow-up tool descriptions guide scalar search and artifact selection", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);

    expect(findTool(tools, "cascade_asset_list_facts").config.description).toContain(
      "prefer cascade_asset_search_values",
    );
    expect(findTool(tools, "cascade_asset_search_values").config.description).toContain(
      "Best first choice for finding text/content by known snippet",
    );
    const artifacts = findTool(tools, "cascade_asset_list_scalar_artifacts");
    expect(artifacts.config.description).toContain("Use href for any value found in an HTML/XHTML href attribute");
    expect(artifacts.config.description).toContain("use site_link for non-root, non-URL Cascade *Path fields");
    expect((artifacts.config.inputSchema as any).shape.artifact_kind.description).toContain(
      "Use href for any value found in an HTML/XHTML href attribute",
    );
  });
});
