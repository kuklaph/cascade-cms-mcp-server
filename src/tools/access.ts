/**
 * Access rights tools: 2 permission operations exposed to MCP clients.
 *
 *   cascade_read_access_rights — fetch ACL for an asset
 *   cascade_edit_access_rights — modify ACL (optionally cascade to children)
 *
 * Each tool is a thin `registerCascadeTool` call delegating to the
 * matching `CascadeClient` method. The helper handles the
 * validate → call → format → error-translate pipeline.
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
  ReadAccessRightsRequestSchema,
  EditAccessRightsRequestSchema,
} from "../schemas/requests.js";

export function registerAccessTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_read_access_rights",
    title: "Read Access Rights",
    description: buildCascadeToolDescription(
      `Read access rights (users/groups + permission levels) for a Cascade asset.

Returns the complete ACL (access control list) for an asset: which users and groups can read or write it, and what the default level is for everyone else. Access levels are "none", "read", and "write" for allLevel, and "read" or "write" for explicit ACL entries. Useful for auditing permissions before sharing content or before a bulk edit.

Args:
  - identifier (object, required): The asset whose ACL to read
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known

Returns:
  Cascade OperationResult:
  {
    success: true,
    accessRightsInformation: {
      identifier: { ... },
      aclEntries: [ { id, name, type: "user"|"group", level }, ... ],
      allLevel: "none"|"read"|"write"
    }
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Who has edit access to /about?" -> { identifier: { type: "folder", path: { path: "/about", siteName: "www" } } }
  - Use when: "Audit page permissions" -> { identifier: { type: "page", id: "..." } }
  - Don't use when: You want to change permissions — use cascade_edit_access_rights.
  - Don't use when: You want workflow settings — use cascade_read_workflow_settings.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Permission denied" when credentials lack admin/read-acl rights`,
    ),
    inputSchema: ReadAccessRightsRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.readAccessRights(input as unknown as Types.ReadAccessRightsRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_edit_access_rights",
    title: "Edit Access Rights",
    description: buildCascadeToolDescription(
      `Modify access rights (ACL) for a Cascade asset. Optionally apply to all descendants.

Replaces the asset's ACL wholesale — include every user/group you want to keep; anyone omitted loses their explicit entry and falls back to allLevel. For folders or containers, setting applyToChildren: true propagates the new ACL recursively. Typical workflow: call cascade_read_access_rights first to get the current ACL, modify the array, then pass it here.

Args:
  - identifier (object, required): The asset whose ACL to modify
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known
  - accessRightsInformation (object, required):
    - aclEntries (array, optional): Full explicit ACL. Each entry: { name? OR id?, type: "user"|"group", level: "read"|"write" }; prefer id when Cascade provides it.
    - allLevel (string): Default for everyone not listed. One of "none" | "read" | "write".
  - applyToChildren (boolean, optional): For containers only. Default false. Propagates the ACL to all descendants.

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Grant group 'editors' write access" -> { identifier: { type: "folder", id: "..." }, accessRightsInformation: { aclEntries: [{ name: "editors", type: "group", level: "write" }], allLevel: "read" } }
  - Use when: "Lock a folder tree down" -> pass applyToChildren: true alongside the restricted ACL.
  - Don't use when: You only want to read — use cascade_read_access_rights.
  - Don't use when: You want to change workflow policy — use cascade_edit_workflow_settings.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "User/group not found" when an aclEntries name is invalid
  - "Permission denied" when credentials lack admin/edit-acl rights`,
    ),
    inputSchema: EditAccessRightsRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.editAccessRights(input as unknown as Types.EditAccessRightsRequest),
  }, deps);
}
