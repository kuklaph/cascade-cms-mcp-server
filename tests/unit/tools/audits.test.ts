import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAuditTools } from "../../../src/tools/audits.js";
import {
  ReadAuditsRequestSchema,
  ReadPreferencesRequestSchema,
  EditPreferenceRequestSchema,
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

const AUDITS_OK = {
  success: true,
  audits: [
    { action: "login", userName: "jdoe" },
    { action: "edit", userName: "asmith" },
  ],
} as const;

const PREFERENCES_OK = {
  success: true,
  preferences: [
    { name: "system_site_name", value: "My Site" },
    { name: "system_default_access", value: "read" },
  ],
} as const;

// =============================================================================
// cascade_read_audits
// =============================================================================

describe("cascade_read_audits tool", () => {
  test("happy path: calls client.readAudits (without pagination args) and returns paginated response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAudits: mock(() => Promise.resolve(AUDITS_OK)),
    });

    registerAuditTools(server as any, client);

    const tool = findTool(tools, "cascade_read_audits");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const auditParameters = {
      username: "jdoe",
      auditType: "login",
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    };
    const result = await tool.handler({
      auditParameters,
    });

    expect(client.readAudits).toHaveBeenCalledTimes(1);
    // Library receives auditParameters only — pagination fields stripped.
    expect(client.readAudits.mock.calls[0][0]).toEqual({ auditParameters });
    expect(result.isError).not.toBe(true);

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.success).toBe(true);
    expect(sc.audits).toEqual(AUDITS_OK.audits);
    expect(sc.total).toBe(AUDITS_OK.audits.length);
    expect(sc.count).toBe(AUDITS_OK.audits.length);
    expect(sc.offset).toBe(0);
    expect(sc.has_more).toBe(false);
  });

  test("applies default limit/offset when caller omits them", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAudits: mock(() => Promise.resolve(AUDITS_OK)),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_read_audits");

    const result = await tool.handler({ auditParameters: {} });

    expect(client.readAudits.mock.calls[0][0]).toEqual({ auditParameters: {} });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.offset).toBe(0);
    expect(sc.count).toBe(AUDITS_OK.audits.length);
    expect(sc.has_more).toBe(false);
  });

  test("slices audits with has_more=true when result larger than limit", async () => {
    const bigAudits = Array.from({ length: 8 }, (_, i) => ({
      action: "edit",
      userName: `u-${i}`,
    }));
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAudits: mock(() =>
        Promise.resolve({ success: true, audits: bigAudits }),
      ),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_read_audits");

    const result = await tool.handler({
      auditParameters: {},
      limit: 3,
      offset: 1,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc.audits as unknown[]).length).toBe(3);
    expect(sc.total).toBe(8);
    expect(sc.count).toBe(3);
    expect(sc.offset).toBe(1);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(4);
  });

  test("schema validation: rejects missing auditParameters", () => {
    const parsed = ReadAuditsRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readAudits: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Forbidden")),
      ),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_read_audits");

    const result = await tool.handler({ auditParameters: {} });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_read_audits");
    expect(text).toContain("Forbidden");
  });
});

// =============================================================================
// cascade_read_preferences
// =============================================================================

describe("cascade_read_preferences tool", () => {
  test("happy path: calls client.readPreferences and returns success response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readPreferences: mock(() => Promise.resolve(PREFERENCES_OK)),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_read_preferences");

    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const result = await tool.handler({});

    expect(client.readPreferences).toHaveBeenCalledTimes(1);
    expect(client.readPreferences.mock.calls[0][0]).toEqual({});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(PREFERENCES_OK);
  });

  test("schema validation: accepts empty body (no required fields)", () => {
    const parsed = ReadPreferencesRequestSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      readPreferences: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Unauthorized")),
      ),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_read_preferences");

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_read_preferences");
  });
});

// =============================================================================
// cascade_edit_preference
// =============================================================================

describe("cascade_edit_preference tool", () => {
  test("happy path: calls client.editPreference with preference body", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editPreference: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_edit_preference");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(true);

    const preference = {
      name: "system_default_access",
      value: "write",
    };
    const result = await tool.handler({
      preference,
    });

    expect(client.editPreference).toHaveBeenCalledTimes(1);
    expect(client.editPreference.mock.calls[0][0]).toEqual({ preference });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing preference", () => {
    const parsed = EditPreferenceRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      editPreference: mock(() =>
        Promise.reject(new Error("Request Failed. Request Response: Invalid Preference")),
      ),
    });

    registerAuditTools(server as any, client);
    const tool = findTool(tools, "cascade_edit_preference");

    const result = await tool.handler({
      preference: { name: "unknown", value: "x" },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_edit_preference");
  });
});

// =============================================================================
// Registration coverage: all 3 audit tools registered
// =============================================================================

describe("registerAuditTools coverage", () => {
  test("registers all 3 audit tools with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerAuditTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "cascade_edit_preference",
      "cascade_read_audits",
      "cascade_read_preferences",
    ]);
  });
});
