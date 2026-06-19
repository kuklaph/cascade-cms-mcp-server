/**
 * Publishing tools: 1 combined publish/unpublish operation.
 *
 *   publish_unpublish — publish or unpublish an asset to its destinations
 *
 * The tool is a thin `registerCascadeTool` call delegating to the
 * `CascadeClient.publishUnpublish` method.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "../client.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
  type CascadeDeps,
} from "./helper.js";
import { PublishUnpublishRequestSchema } from "../schemas/requests.js";

export function registerPublishTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  registerCascadeTool(server, {
    name: "publish_unpublish",
    title: "Publish or Unpublish Asset",
    description: buildCascadeToolDescription(
      `Publish a Cascade asset to its configured destinations, or unpublish it from those destinations.

The operation is controlled by the publishInformation payload: by default it publishes; set unpublish: true to remove the asset from its destinations instead. Publishing propagates changes to external systems (HTTP, FTP, filesystem targets). This can affect production websites — use with care. Publishing is asynchronous on Cascade's side; this call queues the job and returns quickly.

Args:
  - identifier (object, required): The asset to publish or unpublish
    - id (string, optional): Asset ID (preferred)
    - path (object, optional): { path, siteId OR siteName }
    - type (string, required): Entity type of the asset
    - requires type plus either id or path; prefer id when known
  - publishInformation (object, required): Parameters matching cascade-cms-api PublishInformation
    - destinations (array, optional): Specific destination identifiers. Omit for "all enabled destinations".
    - unpublish (boolean | null, optional, default false): When true, unpublish instead of publish.
    - publishRelatedAssets (boolean | null, optional): Also publish referenced assets.
    - publishRelatedPublishSet (boolean | null, optional): Also publish related publish sets.
    - scheduledDate (string | null, optional): ISO-ish date for scheduled (future) publish.

Returns:
  Cascade OperationResult:
  { success: true }
  On failure: { success: false, message: "<error>" }

Examples:
  - Use when: "Publish a page now" -> { identifier: { type: "page", id: "..." }, publishInformation: {} }
  - Use when: "Unpublish a page" -> { identifier: { type: "page", id: "..." }, publishInformation: { unpublish: true } }
  - Use when: "Schedule publish for next week" -> { identifier: { ... }, publishInformation: { scheduledDate: "2026-04-20T12:00:00Z" } }
  - Don't use when: You want to delete entirely — use remove (which can unpublish too).
  - Don't use when: You haven't yet committed edits — Cascade publishes the last committed version.

Error Handling:
  - "Asset not found" when the identifier doesn't resolve
  - "No destinations configured" when the asset has no destinations and none were supplied
  - "Permission denied" when credentials lack publish rights
  - "Workflow required" when the asset's container demands workflow approval before publish`,
    ),
    inputSchema: PublishUnpublishRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: (input) => client.publishUnpublish(input as unknown as Types.PublishUnpublishRequest),
  }, deps);
}
