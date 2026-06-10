/**
 * Checkout tools: 2 asset-locking operations.
 *
 *   cascade_check_out — lock an asset for exclusive editing
 *   cascade_check_in  — release a lock and commit a comment
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
  CheckOutRequestSchema,
  CheckInRequestSchema,
} from "../schemas/requests.js";

export function registerCheckoutTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "cascade_check_out",
    title: "Check Out Asset",
    description: buildCascadeToolDescription(
      `Lock a Cascade asset for exclusive editing.

Check-out creates a working copy of the asset that only the authenticated user can edit; other users see the previously committed version until check-in. Required for some asset types (especially files and binary content types) before cascade_edit will succeed. The response includes a workingCopyIdentifier that represents the locked working copy for subsequent calls. Always pair with cascade_check_in when editing finishes to release the lock.

Args:
  - identifier (object, required): The asset to check out
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known

Returns:
  Cascade OperationResult:
  {
    success: true,
    workingCopyIdentifier?: { id, type, path: { path, siteId, siteName } }
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Lock a page before editing" -> { identifier: { type: "page", id: "..." } }
  - Use when: "Check out a file for binary replacement" -> { identifier: { type: "file", path: { path: "/assets/logo.png", siteName: "www" } } }
  - Don't use when: You've finished editing — use cascade_check_in to release.
  - Don't use when: Read-only operations — checkout isn't needed for cascade_read.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Already checked out" when another user holds the lock
  - "Permission denied" when credentials lack edit rights`,
    ),
    inputSchema: CheckOutRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.checkOut(input as unknown as Types.CheckOutRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "cascade_check_in",
    title: "Check In Asset",
    description: buildCascadeToolDescription(
      `Release a checked-out Cascade asset and commit the working copy with a comment.

Completes the pair opened by cascade_check_out: the working copy becomes the new committed version, the lock is released, and the comments string is stored in the asset's version history. Must be called by the same user who performed the check-out. The asset (identified by id/path) must be currently checked out — Cascade will reject check-in of an asset that isn't locked.

Args:
  - identifier (object, required): The asset to check in
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known
  - comments (string, required): Description of the changes — stored in version history

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Commit working changes with a note" -> { identifier: { type: "page", id: "..." }, comments: "Fixed broken links in footer." }
  - Don't use when: The asset isn't checked out — you'll get "Asset not checked out".
  - Don't use when: Someone else checked it out — only the owner can check in.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Asset not checked out" when the asset isn't currently locked
  - "Checked out by another user" when a different user holds the lock
  - "Permission denied" when credentials lack edit rights`,
    ),
    inputSchema: CheckInRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.checkIn(input as unknown as Types.CheckInRequest),
  }, deps);
}
