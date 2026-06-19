/**
 * Audit logging for the Cascade CMS MCP server.
 *
 * Emits a single line to stderr for every tool invocation. Format:
 *   [cascade-cms-mcp-server] read: ok in 234ms
 *   [cascade-cms-mcp-server] create: error in 123ms — "Permission denied"
 *
 * Logs go to stderr only; stdout is reserved for the MCP JSON-RPC protocol
 * stream and must never receive ad-hoc text or the transport breaks.
 *
 * Error messages are passed through `redactSecrets` (same pipeline as
 * user-facing errors) and sanitized against newlines/quotes so a single
 * line per invocation is guaranteed and log parsers don't corrupt.
 */

import { SERVER_NAME } from "./constants.js";
import { redactSecrets } from "./errors.js";

const MAX_AUDIT_ERROR_CHARS = 500;

/** Redact + normalize a raw error message for a single-line audit record. */
function sanitizeErrorForAudit(raw: string): string {
  return redactSecrets(raw)
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, '\\"')
    .slice(0, MAX_AUDIT_ERROR_CHARS);
}

/**
 * Log a single tool invocation.
 *
 * @param toolName   - The MCP tool name (e.g. `read`).
 * @param outcome    - `"ok"` on success, `"error"` when the handler threw.
 * @param durationMs - Wall-clock duration of the invocation in milliseconds.
 * @param errorMsg   - Optional raw error message (only used when outcome is `"error"`).
 *                     Secrets are redacted, newlines collapsed, and length capped.
 */
export function logToolInvocation(
  toolName: string,
  outcome: "ok" | "error",
  durationMs: number,
  errorMsg?: string,
): void {
  const suffix =
    outcome === "error" && errorMsg
      ? ` — "${sanitizeErrorForAudit(errorMsg)}"`
      : "";
  process.stderr.write(
    `[${SERVER_NAME}] ${toolName}: ${outcome} in ${durationMs}ms${suffix}\n`,
  );
}
