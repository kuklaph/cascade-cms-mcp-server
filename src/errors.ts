/**
 * Error translation for the Cascade CMS MCP server.
 *
 * Converts any thrown value into an MCP-compliant `CallToolResult`
 * with `isError: true`. Normalizes a handful of well-known Cascade
 * library error messages into actionable guidance for agents.
 *
 * Security:
 *   - Never includes stack traces.
 *   - Never includes API key values, even if the upstream error text
 *     somehow embeds one (defensive redaction via `redactSecrets`).
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

// Prefix that cascade-cms-api wraps around any failed request.
// See main.js handleRequest: `throw new Error("Request Failed. Request Response: " + msg)`
const REQUEST_FAILED_PREFIX = "Request Failed. Request Response: ";
const TIMEOUT_MESSAGE = "Request timed out";
const MISSING_CONFIG_MESSAGE = "Missing API key or cascade URL";

/**
 * Defensive redaction of anything that looks like a secret. Applied to
 * every outgoing message text (including audit-log error messages) so a
 * malformed upstream response can't accidentally leak credentials into
 * either the agent transcript or operator stderr logs.
 *
 * Patterns are deliberately narrow to avoid false positives on legitimate
 * Cascade identifiers (asset paths, entity type names, UUIDs). Only strings
 * that clearly label themselves as secrets or match known key prefixes are
 * redacted.
 */
export function redactSecrets(msg: string): string {
  return (
    msg
      // Known API key prefixes: sk-, pk-, ak-, rk-, ghp-, gho-, ghs-, ghr-
      // (Stripe, Anthropic, GitHub, etc.). Requires 6+ token chars after prefix.
      .replace(
        /\b(sk|pk|ak|rk|ghp|gho|ghs|ghr)[-_][A-Za-z0-9_.-]{6,}\b/gi,
        "[REDACTED]",
      )
      // Bearer tokens in Authorization headers
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      // Explicit api_key / apikey / token / secret assignments
      .replace(
        /\b(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi,
        "$1=[REDACTED]",
      )
  );
}

function toMcpError(text: string, opName: string): CallToolResult {
  const message = redactSecrets(text);
  const structuredContent = {
    success: false,
    error: {
      type: "tool_error",
      tool: opName,
      message,
      ...suggestedRecovery(message),
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/**
 * Translate any thrown value into an MCP error result.
 *
 * @param err - The thrown value (Error, string, object, undefined, etc.).
 * @param opName - The MCP tool name for context in the message.
 */
export function translateError(err: unknown, opName: string): CallToolResult {
  if (err instanceof Error) {
    const msg = err.message;

    // Cascade library throws wrapped messages via handleRequest.
    if (msg.startsWith(REQUEST_FAILED_PREFIX)) {
      const clean = msg.slice(REQUEST_FAILED_PREFIX.length);
      return toMcpError(`${opName} failed: ${clean}`, opName);
    }

    // Upstream timeout ("Request timed out") or any message mentioning "timeout".
    if (msg === TIMEOUT_MESSAGE || /timeout/i.test(msg)) {
      return toMcpError(
        `The Cascade request timed out for ${opName}. Please try again or increase CASCADE_TIMEOUT_MS.`,
        opName,
      );
    }

    // Missing env vars — thrown by cascade-cms-api sendRequest.
    if (msg.includes(MISSING_CONFIG_MESSAGE)) {
      return toMcpError(
        `Configuration error: ${opName} could not run — Cascade credentials are missing. Check CASCADE_API_KEY and CASCADE_URL.`,
        opName,
      );
    }

    return toMcpError(`${opName} failed: ${msg}`, opName);
  }

  // Non-Error inputs: string, object, undefined, null, etc.
  const asString =
    err === undefined
      ? "undefined error"
      : err === null
      ? "null error"
      : typeof err === "string"
      ? err
      : safeStringify(err);

  return toMcpError(`${opName} failed: ${asString}`, opName);
}

function suggestedRecovery(message: string): Record<string, unknown> {
  if (/asset handle .* not found/i.test(message)) {
    return {
      suggested_tool: "read",
      hints: ["Re-run read to create a fresh asset_handle."],
    };
  }
  if (/Browser API login is not configured/i.test(message)) {
    return {
      hints: [
        "Set CASCADE_BROWSER_USERNAME and CASCADE_BROWSER_PASSWORD to enable browser login.",
        "Set CASCADE_BROWSER_SITE_ID to the production site ID for startup/automatic browser login.",
        "Without CASCADE_BROWSER_SITE_ID, run browser_login with site_id before calling other browser-backed tools.",
        "To find the site ID, select the production site in Cascade, open Manage Site, and copy the site ID from the browser URL.",
      ],
    };
  }
  if (/browser_login/i.test(message)) {
    return {
      suggested_tool: "browser_login",
      hints: [
        "Recommended setup: set CASCADE_BROWSER_SITE_ID to the production site ID and restart the MCP server.",
        "To find the site ID, select the production site in Cascade, open Manage Site, and copy the site ID from the browser URL.",
        "Temporary recovery: run browser_login with the target site_id.",
      ],
    };
  }
  return {};
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
