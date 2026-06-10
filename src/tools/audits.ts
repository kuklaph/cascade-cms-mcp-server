/**
 * Audit and preference tools: 3 administrative operations.
 *
 *   cascade_read_audits      — query audit log entries
 *   cascade_read_preferences — fetch all Cascade system preferences
 *   cascade_edit_preference  — update a single system preference
 *
 * Each tool is a thin `registerCascadeTool` call delegating to the
 * matching `CascadeClient` method.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import {
  ReadAuditsRequestSchema,
  ReadPreferencesRequestSchema,
  EditPreferenceRequestSchema,
} from "../schemas/requests.js";
import { paginatedHandler } from "../pagination.js";

export function registerAuditTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_read_audits",
    title: "Read Audit Log",
    description: buildCascadeToolDescription(
      `Read Cascade audit log entries matching the specified filters.

Queries Cascade's system audit log for events like edits, publishes, logins, check-outs, deletes, and workflow transitions. All auditParameters fields are optional — providing none returns every recorded event (expect large volumes; always apply a date range filter). Results are always returned newest-first by Cascade; this MCP layer then slices the page.

Args:
  - auditParameters (object, required): Filter conditions matching cascade-cms-api AuditParameters
    - identifier (object, optional): Limit to events on a specific asset
    - username (string, optional): Limit to events by a specific user
    - groupname (string, optional): Limit to events by users in a group
    - rolename (string, optional): Limit to events by users with a role
    - startDate (string, optional): ISO-ish date; earliest event to include
    - endDate (string, optional): ISO-ish date; latest event to include
    - auditType (string, optional): One of: "login", "login_failed", "logout", "start_workflow", "advance_workflow", "edit", "copy", "create", "reference", "delete", "delete_unpublish", "check_in", "check_out", "activate_version", "publish", "unpublish", "recycle", "restore", "move"
  - limit (number, optional): Max results per page, 1-500 (default 50)
  - offset (number, optional): Skip N results for pagination (default 0)

Returns:
  The response is a page:
  {
    success: true,
    total: <total items available>,
    count: <items in this page>,
    offset: <current offset>,
    has_more: <bool>,
    next_offset: <offset for next page, if has_more>,
    audits: [
      { user, action, identifier?: { ... }, date },
      ...
    ]
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Who edited /about today?" -> { auditParameters: { identifier: { type: "folder", path: { path: "/about", siteName: "www" } }, auditType: "edit", startDate: "2026-04-13T00:00:00Z" } }
  - Use when: "All logins in April 2026" -> { auditParameters: { auditType: "login", startDate: "2026-04-01T00:00:00Z", endDate: "2026-04-30T23:59:59Z" } }
  - Don't use when: You want the current state — use cascade_read.
  - Don't use when: You want user inbox messages — use cascade_list_messages.

Pagination:
  - Default limit of 50 works for most queries. Increase up to 500 for larger pages.
  - If has_more is true and you need all audits, call again with offset: next_offset.
  - For a complete enumeration (e.g., all audits in a date range), loop until has_more: false.
  - For focused queries where you only need the most recent, stop as soon as you have what you need.

Error Handling:
  - "Invalid date format" when startDate/endDate don't parse
  - "Invalid auditType" when auditType isn't in the allowed set
  - "Permission denied" when credentials lack audit-read rights`,
    ),
    inputSchema: ReadAuditsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: paginatedHandler(
      (req) => client.readAudits(req as unknown as Types.ReadAuditsRequest),
      "audits",
    ),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_read_preferences",
    title: "Read System Preferences",
    description: buildCascadeToolDescription(
      `Read all Cascade system preferences.

Returns every configurable server-wide preference as name/value pairs. Preferences include things like default publish behavior, image handling defaults, API limits, and UI options. Typically useful before calling cascade_edit_preference so you know the current value. Requires system-admin-level credentials.

Args:
  (none)

Returns:
  Cascade OperationResult:
  {
    success: true,
    preferences: [ { name: "...", value: "..." }, ... ]
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "What's the current publish-on-save setting?" -> {}
  - Use when: "Inspect all server preferences" -> {}
  - Don't use when: You want user-level settings — preferences are system-wide.
  - Don't use when: You only need one preference — still call this (there's no read-single endpoint), then filter client-side.

Error Handling:
  - "Permission denied" when credentials lack system-admin rights
  - "Authentication failed" when the API key is invalid`,
    ),
    inputSchema: ReadPreferencesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.readPreferences(input as unknown as Types.ReadPreferencesRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_edit_preference",
    title: "Edit System Preference",
    description: buildCascadeToolDescription(
      `Update a single Cascade system preference.

Accepts a generated Preference object with name and value strings. The name must exactly match an existing preference key (see cascade_read_preferences for the full list). Changes take effect server-wide immediately. Requires system-admin-level credentials.

Args:
  - preference (object, required): The preference to update
    - name (string, required): Exact preference key
    - value (string, required): New preference value

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Update a text-valued server preference" -> { preference: { name: "some.preference.key", value: "some-string-value" } }
  - Use when: "Replace a configured preference value after reading the current key" -> { preference: { name: "some.preference.key", value: "new-string-value" } }
  - Don't use when: You want to read current values — use cascade_read_preferences first.
  - Don't use when: The target is user-scoped — system preferences are server-wide.

Error Handling:
  - "Preference not found" when name is not a recognized key
  - "Invalid value" when value can't be parsed for the preference's type
  - "Permission denied" when credentials lack system-admin rights`,
    ),
    inputSchema: EditPreferenceRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.editPreference(input as unknown as Types.EditPreferenceRequest),
  }, deps);
}
