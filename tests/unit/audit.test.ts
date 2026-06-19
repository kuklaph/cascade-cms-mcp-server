/**
 * Tests for the audit logging helper.
 *
 * Logs MUST go to stderr only (stdout is reserved for the MCP protocol
 * stream). Format:
 *   [cascade-cms-mcp-server] read: ok in 234ms
 *   [cascade-cms-mcp-server] create: error in 123ms — "Permission denied"
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { z } from "zod";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { logToolInvocation } from "../../src/audit.js";
import { SERVER_NAME } from "../../src/constants.js";
import { registerCascadeTool } from "../../src/tools/helper.js";

// ---------------------------------------------------------------------------
// Stderr capture
// ---------------------------------------------------------------------------

let stderrWrites: string[] = [];
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  stderrWrites = [];
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((msg: string | Uint8Array) => {
    stderrWrites.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderrWrite;
});

// ---------------------------------------------------------------------------
// logToolInvocation
// ---------------------------------------------------------------------------

describe("logToolInvocation", () => {
  test("writes success line to stderr with server name, tool name, outcome, and duration", () => {
    logToolInvocation("read", "ok", 123);

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).toBe(`[${SERVER_NAME}] read: ok in 123ms\n`);
  });

  test("redacts secrets from error messages before writing to stderr", () => {
    logToolInvocation(
      "read",
      "error",
      42,
      "auth failed with token sk-abcdef123456 for user",
    );

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).not.toContain("sk-abcdef123456");
    expect(line).toContain("[REDACTED]");
  });

  test("redacts Bearer tokens from error messages", () => {
    logToolInvocation(
      "edit",
      "error",
      42,
      "Bearer abc123.def456 was rejected",
    );

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).not.toContain("abc123.def456");
    expect(line).toContain("Bearer [REDACTED]");
  });

  test("collapses newlines and escapes quotes so audit stays single-line", () => {
    logToolInvocation(
      "read",
      "error",
      1,
      'Validation failed\nfor field "name"\r\nwith reason',
    );

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    // Only one trailing newline (the one we emit), not the ones from errorMsg
    expect(line.match(/\n/g)?.length).toBe(1);
    // Inner quotes are backslash-escaped
    expect(line).toContain('\\"name\\"');
    // Newlines from the input collapsed to spaces
    expect(line).toContain("Validation failed for field");
  });

  test("caps very long error messages to avoid log flooding", () => {
    const longMsg = "x".repeat(2000);
    logToolInvocation("read", "error", 1, longMsg);

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    // Line length = prefix + 500 cap + closing quote + newline; well under 2000
    expect(line.length).toBeLessThan(700);
  });

  test("writes error line with error message suffix in quotes", () => {
    logToolInvocation("create", "error", 500, "Permission denied");

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).toBe(
      `[${SERVER_NAME}] create: error in 500ms — "Permission denied"\n`,
    );
  });

  test("writes error line without suffix when errorMsg is omitted", () => {
    logToolInvocation("remove", "error", 321);

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).toBe(`[${SERVER_NAME}] remove: error in 321ms\n`);
    // No em-dash / quote suffix
    expect(line).not.toContain("—");
    expect(line).not.toContain('"');
  });

  test("does not write to stdout (MCP protocol stream stays clean)", () => {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const stdoutWrites: string[] = [];
    process.stdout.write = ((msg: string | Uint8Array) => {
      stdoutWrites.push(typeof msg === "string" ? msg : msg.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      logToolInvocation("read", "ok", 10);
      logToolInvocation("create", "error", 20, "boom");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }

    expect(stdoutWrites.length).toBe(0);
    // And stderr got both
    expect(stderrWrites.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helper integration: audit logging wires into registerCascadeTool
// ---------------------------------------------------------------------------

const SampleSchema = z
  .object({
    name: z.string(),
  })
  .strict();

const SAMPLE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

interface MockServer {
  registerTool: ReturnType<typeof mock>;
}

function makeMockServer(): MockServer {
  return {
    registerTool: mock(() => ({})),
  };
}

describe("registerCascadeTool audit logging integration", () => {
  test("writes 'ok' audit line when handler resolves successfully", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    await wrapped({ name: "alice" });

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).toContain(`[${SERVER_NAME}]`);
    expect(line).toContain("sample");
    expect(line).toContain(": ok in ");
    expect(line).toContain("ms");
    expect(line).toMatch(/in \d+ms\n$/);
  });

  test("writes 'error' audit line with the raw error message when handler throws", async () => {
    const server = makeMockServer();
    const handler = mock(async () => {
      throw new Error("Request Failed. Request Response: Upstream boom");
    });

    registerCascadeTool(server as any, {
      name: "sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    await wrapped({ name: "alice" });

    expect(stderrWrites.length).toBe(1);
    const line = stderrWrites[0];
    expect(line).toContain("sample");
    expect(line).toContain(": error in ");
    // The audit line contains the raw thrown error message
    expect(line).toContain("Upstream boom");
  });

  test("audits only once per invocation (no duplicate lines on success)", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    await wrapped({ name: "a" });
    expect(stderrWrites.length).toBe(1);
  });
});
