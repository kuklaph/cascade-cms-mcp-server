/**
 * Message tools: 4 user-mailbox and subscription operations.
 *
 *   list_subscribers — list an asset's relationships (what references it) and notification subscribers
 *   list_messages    — list the authenticated user's messages
 *   mark_message     — change a message's read state
 *   delete_message   — permanently delete a message
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
  ListSubscribersRequestSchema,
  ListMessagesRequestSchema,
  MarkMessageRequestSchema,
  DeleteMessageRequestSchema,
} from "../schemas/requests.js";
import { paginatedHandler } from "../pagination.js";

export function registerMessageTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "list_subscribers",
    title: "List Asset Relationships & Subscribers",
    description: buildCascadeToolDescription(
      `List the relationships an asset has — the other assets that reference it (\"what is using this?\") and the users subscribed to its notifications.

Cascade exposes two related discovery questions through this single endpoint:

  1. "What relationships does this asset have?" — i.e. what references it: "which pages use this block?", "which pages link to this file?", "which content-types use this data definition?". The referenced asset is the query target; the assets that point at it show up in the response.
  2. "Who gets notified when this asset changes?" — user/group subscribers, both auto (ownership/workflow/group) and manual (opt-in).

Directionality matters: the lookup runs against the asset being referenced, NOT the asset doing the referencing. If a page embeds a block, query the BLOCK to find the page. Querying the page will NOT list its embedded blocks — it will list the assets that reference the page.

Args:
  - identifier (object, required): The asset whose relationships/subscribers to list
    - id (string, optional): Asset ID. Prefer id when known; Cascade auto-resolves path→id server-side when only path is given.
    - path (object, optional): { path, siteId OR siteName } — valid fallback when id is unknown.
    - type (string, required): Entity type of the asset. Use the EntityType string (e.g. "page", "block_XHTML_DATADEFINITION", "contenttype") — NOT the camelCase envelope key ("xhtmlDataDefinitionBlock", "contentType"). Most asset kinds differ between the two schemes; see IdentifierSchema.type / cascade://entity-types.
    - requires type plus either id or path; prefer id when known

Returns:
  Cascade OperationResult:
  {
    success: true,
    subscribers: [ { id, type, path: { path, siteId, siteName } }, ... ],
    manualSubscribers: [ { id, type, path: { path, siteId, siteName } }, ... ]
  }
  Entries may be related assets (pages, content-types, ...) that reference this one, users subscribed to notifications, or both — distinguish by \`type\`.
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "What relationships does this block have?" / "Which pages use this block?" -> { identifier: { type: "block_XHTML_DATADEFINITION", id: "<blockId>" } } then inspect response entries.
  - Use when: "Which assets link to this file?" -> { identifier: { type: "file", id: "<fileId>" } }.
  - Use when: "Who gets notified when /about changes?" -> { identifier: { type: "folder", path: { path: "/about", siteName: "www" } } }.
  - Don't use when: You want outbound relationships — i.e. "which blocks does this page embed?". That direction isn't queryable; read the page and inspect its body.
  - Don't use when: You want to read messages sent — use list_messages.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "Permission denied" when credentials lack read access`,
    ),
    inputSchema: ListSubscribersRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.listSubscribers(input as unknown as Types.ListSubscribersRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "list_messages",
    title: "List User Messages",
    description: buildCascadeToolDescription(
      `List in-Cascade mailbox messages for the authenticated user.

Cascade has an internal message center — workflow requests, publish notifications, system alerts, and peer messages all land here. Returns all messages visible to the authenticated user (both unread and read, active inbox and archived, depending on your Cascade server's defaults). Message IDs from this list can be passed to mark_message or delete_message.

Args:
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
    messages: [
      { id, type: "message", to, from?, subject, date?, body },
      ...
    ]
  }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "What's in my Cascade inbox?" -> {}
  - Use when: "Check if workflow messages are waiting" -> {} then filter messages by subject.
  - Don't use when: You want an asset's relationships or subscribers — use list_subscribers.
  - Don't use when: You want audit events — use read_audits.

Pagination:
  - Default limit of 50 works for most inboxes. Increase up to 500 for larger ones.
  - If has_more is true and you need all messages, call again with offset: next_offset.
  - For focused queries (most recent only), stop as soon as you have what you need.

Error Handling:
  - "Authentication failed" when credentials are invalid
  - "Permission denied" when the user has no mailbox configured`,
    ),
    inputSchema: ListMessagesRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: paginatedHandler(
      (req) => client.listMessages(req as unknown as Types.ListMessagesRequest),
      "messages",
    ),
  }, deps);

  registerCascadeTool(server, {
    name: "mark_message",
    title: "Mark Message",
    description: buildCascadeToolDescription(
      `Mark a Cascade inbox message as read or unread.

Toggles the read status of a single message. markType controls the action: "read" or "unread". This is idempotent — marking an already-read message as "read" is a no-op.

Args:
  - identifier (object, required): The message to mark
    - id (string, required): Message ID (from list_messages)
    - type (string, required): Must be "message"
  - markType (string, required): One of "read" | "unread"

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Mark a workflow notice as read" -> { identifier: { type: "message", id: "..." }, markType: "read" }
  - Don't use when: You want to delete — use delete_message.
  - Don't use when: You want to list — use list_messages.

Error Handling:
  - "Message not found" when the identifier doesn't resolve
  - "Invalid markType" when markType is outside the allowed set
  - "Permission denied" when the message belongs to another user`,
    ),
    inputSchema: MarkMessageRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.markMessage(input as unknown as Types.MarkMessageRequest),
  }, deps);

  registerCascadeTool(server, {
    name: "delete_message",
    title: "Delete Message",
    description: buildCascadeToolDescription(
      `Permanently delete a message from the authenticated user's Cascade mailbox.

This is a DESTRUCTIVE operation — once deleted, the message cannot be recovered. Messages must belong to the authenticated user; you cannot delete messages in another user's mailbox.

Args:
  - identifier (object, required): The message to delete
    - id (string, required): Message ID (from list_messages)
    - type (string, required): Must be "message"

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Permanently clear spam-like notifications" -> { identifier: { type: "message", id: "..." } }
  - Don't use when: You only want to mark it read/unread — use mark_message.
  - Don't use when: You want to delete in bulk — this deletes one message per call.

Error Handling:
  - "Message not found" when the identifier doesn't resolve
  - "Permission denied" when the message belongs to another user`,
    ),
    inputSchema: DeleteMessageRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: (input) => client.deleteMessage(input as unknown as Types.DeleteMessageRequest),
  }, deps);
}
