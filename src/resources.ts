/**
 * MCP resource registrations for the Cascade CMS server.
 *
 * Resources complement the tools by exposing URI-addressable reference data
 * that agents can fetch without invoking a tool. Five resources/templates are
 * registered:
 *
 *   cascade://entity-types   (static,  JSON)     — Cascade entity type strings.
 *   cascade://sites          (dynamic, JSON)     — live `client.listSites()` result.
 *   cascade://text-encoding  (static,  Markdown) — how to encode text for each
 *                                                  field category (rich-text/XML,
 *                                                  format source, plain text).
 *   cascade://asset/{handle}/raw (dynamic, JSON) — exact cached raw asset JSON.
 *   cascade://draft/{handle}/raw (dynamic, JSON) — exact cached draft JSON
 *                                                  unless blocked by draft read
 *                                                  tool-block rules or the
 *                                                  tool-block repository cannot
 *                                                  be read, or the handle is
 *                                                  invalid/missing.
 *
 * Live Cascade site failures use `translateError`; local cache and guardrail
 * failures return JSON error bodies.
 */

import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";
import type {
  ReadResourceResult,
  TextResourceContents,
} from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import type { CascadeClient } from "./client.js";
import {
  createAssetCache,
  isAssetHandle,
  type AssetCache,
} from "./assetIndex.js";
import {
  createDraftCache,
  isDraftHandle,
  type DraftCache,
} from "./assetDrafts.js";
import { EntityTypeSchema } from "./schemas/common.js";
import { redactSecrets, translateError } from "./errors.js";
import {
  describeToolBlockRule,
  findDeniedToolCall,
  type ToolBlockStore,
} from "./toolBlocks.js";

const DRAFT_RAW_RESOURCE_BLOCK_TOOLS = [
  "cascade_draft_get_value",
  "cascade_draft_list_facts",
  "cascade_draft_search_values",
  "cascade_draft_search_keys",
  "cascade_draft_list_references",
  "cascade_draft_list_scalar_artifacts",
  "cascade_draft_list_nodelets",
  "cascade_draft_get_nodelet",
  "cascade_draft_resolve_nodes",
  "cascade_draft_assert_values",
  "cascade_draft_validate",
];

/** Short human-readable descriptions for each Cascade entity type. */
const ENTITY_TYPE_DESCRIPTIONS: Record<string, string> = {
  assetfactory: "Template defining how new assets of a given type are created",
  assetfactorycontainer: "Folder-like container holding asset factories",
  block: "Reusable content block embeddable in pages or templates",
  block_FEED: "Block sourced from an external feed (e.g., RSS)",
  block_INDEX: "Block listing assets from an index or query",
  block_TEXT: "Plain-text content block",
  block_XHTML_DATADEFINITION: "Structured XHTML block backed by a data definition",
  block_XML: "Block holding raw XML content",
  block_TWITTER_FEED: "Block pulling posts from a Twitter/X feed",
  connectorcontainer: "Container grouping external-service connectors",
  twitterconnector: "Connector to a Twitter/X account",
  facebookconnector: "Connector to a Facebook page",
  wordpressconnector: "Connector to a WordPress site",
  googleanalyticsconnector: "Connector to a Google Analytics property",
  contenttype: "Definition of a page's content schema and templates",
  contenttypecontainer: "Folder-like container holding content types",
  destination: "Publish destination (server, path, transport binding)",
  editorconfiguration: "Rich-text editor configuration preset",
  file: "A file asset (images, documents, binaries, etc.)",
  folder: "A folder that groups other assets",
  group: "A user group for permissions and workflows",
  message: "An in-app message for a user's inbox",
  metadataset: "Schema defining metadata fields for assets",
  metadatasetcontainer: "Folder-like container holding metadata sets",
  page: "A web page asset",
  pageconfigurationset: "A set of page configurations (regions, templates)",
  pageconfiguration: "A single page configuration within a set",
  pageregion: "A named region inside a page configuration",
  pageconfigurationsetcontainer: "Folder-like container for page configuration sets",
  publishset: "A named group of assets published together",
  publishsetcontainer: "Folder-like container holding publish sets",
  reference: "A reference (link) to another asset",
  role: "A named role granting capabilities to users",
  datadefinition: "Structured-data schema used by pages and blocks",
  datadefinitioncontainer: "Folder-like container holding data definitions",
  sharedfield: "A reusable field definition shared across data definitions",
  sharedfieldcontainer: "Folder-like container holding shared fields",
  format: "A generic format/transform definition",
  format_XSLT: "An XSLT-based format transform",
  format_SCRIPT: "A script-based format transform (Velocity, etc.)",
  site: "A Cascade site (top-level container for assets)",
  sitedestinationcontainer: "Container grouping a site's publish destinations",
  symlink: "A symbolic link asset pointing at an external URL",
  template: "A page template (layout skeleton with regions)",
  transport: "A generic transport binding for publishing",
  transport_fs: "Filesystem transport (local or mounted path)",
  transport_ftp: "FTP/SFTP transport",
  transport_db: "Database transport",
  transport_cloud: "Cloud-storage transport (S3, etc.)",
  transportcontainer: "Folder-like container holding transports",
  user: "A Cascade user account",
  workflow: "A running workflow instance",
  workflowdefinition: "A definition describing workflow steps and transitions",
  workflowdefinitioncontainer: "Folder-like container holding workflow definitions",
  workflowemail: "An email template used by workflows",
  workflowemailcontainer: "Folder-like container holding workflow emails",
};

/**
 * Build the JSON payload for `cascade://entity-types`.
 *
 * Derives the complete list of entity types from `EntityTypeSchema.options`
 * (the local Zod enum mirror of cascade-cms-api's EntityTypeString) so adding a new type in `common.ts`
 * automatically surfaces here. Descriptions MUST exist for every type in
 * `ENTITY_TYPE_DESCRIPTIONS` — if a type is missing, an explicit placeholder
 * is emitted so drift is visible in the resource body (rather than silently
 * masked by an empty string).
 */
function buildEntityTypesPayload(): string {
  const entityTypes = EntityTypeSchema.options.map((type) => ({
    type,
    description:
      ENTITY_TYPE_DESCRIPTIONS[type] ?? `(no description — add to resources.ts)`,
  }));
  return JSON.stringify({ entityTypes }, null, 2);
}

/** Build a text-content resource result for a URI. */
function textResource(
  uri: URL,
  text: string,
  mimeType: string = "application/json",
): ReadResourceResult {
  const contents: TextResourceContents = {
    uri: uri.toString(),
    mimeType,
    text,
  };
  return { contents: [contents] };
}

/**
 * Markdown body of the `cascade://text-encoding` resource.
 *
 * Documents how agents must encode text when writing to Cascade across the
 * three field categories. Kept here as a single const so the content is easy
 * to edit and the resource callback is trivial. Ship as-is — no templating.
 */
const TEXT_ENCODING_MARKDOWN = `# Text encoding in Cascade

Cascade stores text across several kinds of fields with different encoding
requirements. The right rule depends on the field category.

## Content fields (XHTML / XML)

Fields: \`page.xhtml\`, \`xhtmlDataDefinitionBlock.xhtml\`, structuredData \`text\`
nodes that hold HTML markup (WYSIWYG-bound in the data definition), and
\`xmlBlock.xml\`.

Cascade parses this content as strict XML at render time. Malformed content
crashes the whole page template, not just the affected field.

- Emit well-formed XHTML/XML: balanced tags, quoted attributes.
- Escape \`&\`, \`<\`, \`>\`, \`"\` using ONLY the five XML built-in entities:
  \`&amp;\`, \`&lt;\`, \`&gt;\`, \`&quot;\`, \`&apos;\`.
- For other special characters (non-breaking space, smart quotes, em dash,
  currency, accented letters, non-Latin scripts, ...): use numeric character
  references (decimal \`&#160;\` or hex \`&#xA0;\`) OR literal Unicode characters.
- Do NOT use HTML named entities (\`&nbsp;\`, \`&mdash;\`, \`&copy;\`, ...). XML
  declares only the five built-ins above; everything else requires a DTD
  Cascade doesn't provide, so the SAX parser crashes the render.
- Do NOT use astral-plane Unicode (codepoints above U+FFFF — includes emoji).
  Cascade's database rejects it.

## Format / template source

Fields: \`xsltFormat.xml\`, \`scriptFormat.script\`, \`dataDefinition.xml\`,
\`sharedField.xml\`, \`template.xml\`, \`workflowDefinition.xml\`.

These hold template / schema source — Velocity or XSLT with embedded HTML
fragments, or Cascade's structured-data-definition XML. Standard Velocity /
XSLT / XML conventions apply, including CDATA sections where useful (e.g.,
wrapping \`<script>\` blocks in a Velocity template).

## Plain text

Fields: \`metadata.*\`, \`name\`, \`tags[].name\`, \`linkURL\`, \`parentFolderPath\`,
structuredData \`text\` nodes bound to plain-text (non-WYSIWYG) data-definition
fields.

Raw strings. No escaping. Literal \`&\`, \`<\`, \`>\`, \`"\`, \`'\` are all stored and
rendered fine — Cascade's format templates apply their own escaping at render
time.
`;

/**
 * Register the Cascade MCP resources on the given server.
 *
 * Idempotent per server: the SDK throws on duplicate URIs, so call this
 * exactly once per `McpServer` instance.
 */
export function registerCascadeResources(
  server: McpServer,
  client: CascadeClient,
  deps?: {
    assetCache?: AssetCache;
    draftCache?: DraftCache;
    toolBlockStore?: ToolBlockStore;
  },
): void {
  const assetCache = deps?.assetCache ?? createAssetCache();
  const draftCache = deps?.draftCache ?? createDraftCache();
  // Static: all Cascade entity types with short descriptions. The count is
  // derived from the Zod enum so it stays in sync automatically.
  const entityTypeCount = EntityTypeSchema.options.length;
  server.registerResource(
    "Cascade Entity Types",
    "cascade://entity-types",
    {
      description: `List of all ${entityTypeCount} Cascade CMS entity type strings (page, file, folder, block, template, etc.) used as the \`type\` field in asset identifiers.`,
      mimeType: "application/json",
    },
    async (uri: URL) => textResource(uri, buildEntityTypesPayload()),
  );

  // Static: how to encode text when writing to Cascade's various field
  // categories. Agents should fetch this before emitting content to rich-text
  // or XML fields. Markdown body so it reads well when displayed.
  server.registerResource(
    "Cascade Text Encoding Guide",
    "cascade://text-encoding",
    {
      description:
        "How to encode text for Cascade CMS field categories (XHTML/XML content, format source, plain text). Read before writing rich-text or XML content — explains which entities are safe, why HTML named entities crash the render, and Unicode limits.",
      mimeType: "text/markdown",
    },
    async (uri: URL) =>
      textResource(uri, TEXT_ENCODING_MARKDOWN, "text/markdown"),
  );

  // Dynamic: live list of sites fetched from Cascade on read.
  server.registerResource(
    "Cascade Sites",
    "cascade://sites",
    {
      description:
        "Live list of all Cascade CMS sites accessible with the current API credentials. Fetched on read.",
      mimeType: "application/json",
    },
    async (uri: URL) => {
      try {
        const result = await client.listSites(
          {} as unknown as Types.ListSitesRequest,
        );
        return textResource(uri, JSON.stringify(result, null, 2));
      } catch (err) {
        // Translate via the shared error pipeline so secret redaction and
        // actionable messaging are identical to tool-invocation errors.
        // Wrap in a JSON envelope so the advertised application/json
        // mimeType is honest and agents can reliably JSON.parse the body.
        const translated = translateError(err, "cascade://sites");
        const firstBlock = translated.content[0];
        const errorText =
          firstBlock && firstBlock.type === "text"
            ? firstBlock.text
            : "cascade://sites failed: unknown error";
        return textResource(
          uri,
          JSON.stringify({ error: errorText }, null, 2),
        );
      }
    },
  );

  server.registerResource(
    "Cascade Raw Asset JSON",
    new ResourceTemplate("cascade://asset/{handle}/raw", { list: undefined }),
    {
      description:
        "Exact raw JSON cached from a prior cascade_read preview. Replace {handle} with structuredContent.asset_handle.",
      mimeType: "application/json",
    },
    async (uri: URL, variables) => {
      const rawHandle = variables.handle;
      const handle = Array.isArray(rawHandle) ? rawHandle[0] : rawHandle;
      if (!handle || !isAssetHandle(handle)) {
        return textResource(
          uri,
          JSON.stringify({ error: "Invalid asset handle" }, null, 2),
        );
      }
      const entry = assetCache.get(handle);
      if (!entry) {
        return textResource(
          uri,
          JSON.stringify(
            {
              error:
                "Asset handle not found. Re-run cascade_read to create a fresh asset_handle.",
            },
            null,
            2,
          ),
        );
      }
      return textResource(uri, JSON.stringify(entry.raw, null, 2));
    },
  );

  server.registerResource(
    "Cascade Draft JSON",
    new ResourceTemplate("cascade://draft/{handle}/raw", { list: undefined }),
    {
      description:
        "Exact JSON for a mutable draft created by draft workflow tools unless blocked by draft read tool-block rules, the tool-block repository cannot be read, or the handle is invalid/missing. Replace {handle} with structuredContent.draft_handle.",
      mimeType: "application/json",
    },
    async (uri: URL, variables) => {
      const rawHandle = variables.handle;
      const handle = Array.isArray(rawHandle) ? rawHandle[0] : rawHandle;
      if (!handle || !isDraftHandle(handle)) {
        return textResource(
          uri,
          JSON.stringify({ error: "Invalid draft handle" }, null, 2),
        );
      }
      const entry = draftCache.get(handle);
      if (!entry) {
        return textResource(
          uri,
          JSON.stringify(
            {
              error:
                "Draft handle not found. Re-open the draft to create a fresh draft_handle.",
            },
            null,
            2,
          ),
        );
      }
      let denied: Awaited<ReturnType<typeof deniedDraftResourceRule>>;
      try {
        denied = await deniedDraftResourceRule(entry.root, deps?.toolBlockStore);
      } catch (error) {
        return textResource(
          uri,
          JSON.stringify(
            {
              error: redactSecrets(
                "Failed to read draft tool-block rules. Fix or remove the local tool-block repository before reading this draft resource.",
              ),
            },
            null,
            2,
          ),
        );
      }
      if (denied) {
        const reason = denied.reason ? ` ${denied.reason}` : "";
        return textResource(
          uri,
          JSON.stringify(
            {
              error: redactSecrets(
                `Resource read denied by tool block repository for cascade://draft/{handle}/raw ${describeToolBlockRule(denied)}.${reason}`,
              ),
            },
            null,
            2,
          ),
        );
      }
      return textResource(uri, JSON.stringify(entry.root, null, 2));
    },
  );
}

async function deniedDraftResourceRule(
  draftRoot: unknown,
  store: ToolBlockStore | undefined,
) {
  if (!store) return undefined;
  const rules = await store.read();
  for (const tool of DRAFT_RAW_RESOURCE_BLOCK_TOOLS) {
    const denied = findDeniedToolCall(tool, draftRoot, rules);
    if (denied) return denied;
  }
  return undefined;
}
