/**
 * Unit tests for `registerCascadeResources`.
 *
 * The server exposes five MCP resources/templates:
 *   - cascade://entity-types  : static JSON listing the Cascade entity types
 *   - cascade://sites         : dynamic; fetches via `client.listSites()` at read time
 *   - cascade://text-encoding : static Markdown documenting field-category
 *                               text encoding rules for content writes
 *   - cascade://asset/{handle}/raw : exact cached read JSON
 *   - cascade://draft/{handle}/raw : exact cached draft JSON unless blocked
 *                                    or local rule reads fail
 *
 * We verify registration metadata, live site read errors, cached asset/draft
 * success paths, missing handles, and draft resource tool-block denials.
 */

import { describe, test, expect, mock } from "bun:test";
import type { ResourceMetadata, ReadResourceResult } from "@modelcontextprotocol/server";
import { registerCascadeResources } from "../../src/resources.js";
import { createAssetCache } from "../../src/assetIndex.js";
import { createDraftCache } from "../../src/assetDrafts.js";
import { EntityTypeSchema } from "../../src/schemas/common.js";
import { createMockClient } from "../fixtures/mock-client.js";
import { tabsFixture } from "../fixtures/read-response-fixtures.js";

/** A captured `server.registerResource(name, uri, config, readCallback)` call. */
interface RegisteredResource {
  name: string;
  uri: string;
  config: ResourceMetadata;
  readCallback: (
    uri: URL,
    variables?: Record<string, string>,
    extra?: unknown,
  ) => Promise<ReadResourceResult>;
}

interface MockMcpServer {
  registerResource: ReturnType<typeof mock>;
}

function makeMockServer(): {
  server: MockMcpServer;
  resources: RegisteredResource[];
} {
  const resources: RegisteredResource[] = [];
  const server: MockMcpServer = {
    registerResource: mock(
      (name: string, uri: any, config: ResourceMetadata, readCallback: any) => {
        resources.push({
          name,
          uri: typeof uri === "string" ? uri : uri.uriTemplate.toString(),
          config,
          readCallback,
        });
        return {};
      },
    ),
  };
  return { server, resources };
}

/** Extract the text payload of the first content entry. */
function firstContentText(result: ReadResourceResult): string {
  const first = result.contents[0];
  if (!first || typeof (first as { text?: unknown }).text !== "string") {
    throw new Error("Expected first content entry to have a string `text` field");
  }
  return (first as { text: string }).text;
}

// =============================================================================
// Registration coverage
// =============================================================================

describe("registerCascadeResources", () => {
  test("registers exactly 5 resources", () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();

    registerCascadeResources(server as any, client);

    expect(resources).toHaveLength(5);
  });

  test("resource URIs include entity-types, sites, text-encoding, raw asset, and draft templates", () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();

    registerCascadeResources(server as any, client);

    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "cascade://asset/{handle}/raw",
      "cascade://draft/{handle}/raw",
      "cascade://entity-types",
      "cascade://sites",
      "cascade://text-encoding",
    ]);
  });

  test("each resource has a name, description, and mimeType", () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();

    registerCascadeResources(server as any, client);

    for (const r of resources) {
      expect(typeof r.name).toBe("string");
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.config.description).toBe("string");
      expect((r.config.description as string).length).toBeGreaterThan(0);
      expect(typeof r.config.mimeType).toBe("string");
    }
  });

  test("JSON resources use application/json, text-encoding uses text/markdown", () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();

    registerCascadeResources(server as any, client);

    const byUri = new Map(resources.map((r) => [r.uri, r]));
    expect(byUri.get("cascade://entity-types")!.config.mimeType).toBe(
      "application/json",
    );
    expect(byUri.get("cascade://sites")!.config.mimeType).toBe(
      "application/json",
    );
    expect(byUri.get("cascade://text-encoding")!.config.mimeType).toBe(
      "text/markdown",
    );
    expect(byUri.get("cascade://asset/{handle}/raw")!.config.mimeType).toBe(
      "application/json",
    );
    expect(byUri.get("cascade://draft/{handle}/raw")!.config.mimeType).toBe(
      "application/json",
    );
  });
});

// =============================================================================
// cascade://entity-types (static)
// =============================================================================

describe("cascade://entity-types resource", () => {
  test("fetch returns JSON listing all 56 entity types", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client);

    const entityTypes = resources.find((r) => r.uri === "cascade://entity-types");
    expect(entityTypes).toBeDefined();

    const result = await entityTypes!.readCallback(
      new URL("cascade://entity-types"),
    );

    expect(result.contents).toHaveLength(1);
    const first = result.contents[0];
    expect(first!.uri).toBe("cascade://entity-types");
    expect(first!.mimeType).toBe("application/json");

    const body = JSON.parse(firstContentText(result)) as {
      entityTypes: Array<{ type: string; description: string }>;
    };
    expect(Array.isArray(body.entityTypes)).toBe(true);
    // The count must match the EntityTypeSchema enum (the source of truth);
    // the enum currently holds all Cascade entity type strings.
    expect(body.entityTypes).toHaveLength(EntityTypeSchema.options.length);
    // Every entity type has a non-empty description so the resource body
    // is self-documenting.
    for (const entry of body.entityTypes) {
      expect(entry.type.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  test("fetch includes common entity types (page, file, folder) with descriptions", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client);

    const entityTypes = resources.find((r) => r.uri === "cascade://entity-types")!;
    const result = await entityTypes.readCallback(new URL("cascade://entity-types"));

    const body = JSON.parse(firstContentText(result)) as {
      entityTypes: Array<{ type: string; description: string }>;
    };
    const byType = new Map(body.entityTypes.map((e) => [e.type, e.description]));

    for (const t of ["page", "file", "folder", "block", "template"]) {
      expect(byType.has(t)).toBe(true);
      expect((byType.get(t) as string).length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// cascade://text-encoding (static)
// =============================================================================

describe("cascade://text-encoding resource", () => {
  test("fetch returns Markdown documenting the three field categories", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client);

    const encoding = resources.find(
      (r) => r.uri === "cascade://text-encoding",
    );
    expect(encoding).toBeDefined();

    const result = await encoding!.readCallback(
      new URL("cascade://text-encoding"),
    );

    expect(result.contents).toHaveLength(1);
    const first = result.contents[0];
    expect(first!.uri).toBe("cascade://text-encoding");
    expect(first!.mimeType).toBe("text/markdown");

    const body = firstContentText(result);
    // Three field-category headings anchor the contract.
    expect(body).toContain("Content fields (XHTML / XML)");
    expect(body).toContain("Format / template source");
    expect(body).toContain("Plain text");
  });

  test("body states the core write-side rules agents must follow", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client);

    const encoding = resources.find(
      (r) => r.uri === "cascade://text-encoding",
    )!;
    const body = firstContentText(
      await encoding.readCallback(new URL("cascade://text-encoding")),
    );

    // XML built-in entities listed explicitly so agents can find them.
    for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"]) {
      expect(body).toContain(entity);
    }
    // Named-entity prohibition surfaced with concrete examples.
    expect(body).toContain("&nbsp;");
    expect(body).toContain("&mdash;");
    // Astral-plane restriction called out.
    expect(body).toContain("U+FFFF");
    // Numeric character references shown in both forms.
    expect(body).toContain("&#160;");
    expect(body).toContain("&#xA0;");
  });
});

// =============================================================================
// cascade://sites (dynamic)
// =============================================================================

describe("cascade://sites resource", () => {
  test("fetch calls client.listSites() and returns its result as JSON", async () => {
    const SITES_RESPONSE = {
      success: true,
      sites: [
        { id: "s-1", name: "alpha" },
        { id: "s-2", name: "beta" },
      ],
    };
    const { server, resources } = makeMockServer();
    const client = createMockClient({
      listSites: mock(() => Promise.resolve(SITES_RESPONSE)),
    });
    registerCascadeResources(server as any, client);

    const sites = resources.find((r) => r.uri === "cascade://sites");
    expect(sites).toBeDefined();

    const result = await sites!.readCallback(new URL("cascade://sites"));

    expect(client.listSites).toHaveBeenCalledTimes(1);
    expect(client.listSites.mock.calls[0][0]).toEqual({});

    expect(result.contents).toHaveLength(1);
    const first = result.contents[0];
    expect(first!.uri).toBe("cascade://sites");
    expect(first!.mimeType).toBe("application/json");

    const parsed = JSON.parse(firstContentText(result));
    expect(parsed).toEqual(SITES_RESPONSE);
  });

  test("fetch returns an error content entry when client.listSites throws", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient({
      listSites: mock(() =>
        Promise.reject(
          new Error("Request Failed. Request Response: Service Down"),
        ),
      ),
    });
    registerCascadeResources(server as any, client);

    const sites = resources.find((r) => r.uri === "cascade://sites")!;

    // Must not crash — translates the error into a resource-shaped response.
    const result = await sites.readCallback(new URL("cascade://sites"));

    expect(result.contents).toHaveLength(1);
    const first = result.contents[0];
    expect(first!.uri).toBe("cascade://sites");
    expect(first!.mimeType).toBe("application/json");

    // Error body is a valid JSON envelope — agents can safely JSON.parse.
    const text = firstContentText(result);
    const parsed = JSON.parse(text) as { error: string };
    expect(typeof parsed.error).toBe("string");
    expect(parsed.error).toContain("cascade://sites");
    expect(parsed.error.toLowerCase()).toContain("failed");
    expect(parsed.error).not.toContain("Request Failed. Request Response:");
  });
});

// =============================================================================
// cascade://asset/{handle}/raw (dynamic template)
// =============================================================================

describe("cascade://asset/{handle}/raw resource", () => {
  test("fetch returns exact cached raw JSON for a valid handle", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    const assetCache = createAssetCache();
    const entry = assetCache.put(tabsFixture);

    registerCascadeResources(server as any, client, { assetCache });

    const raw = resources.find((r) => r.uri === "cascade://asset/{handle}/raw");
    expect(raw).toBeDefined();

    const result = await raw!.readCallback(
      new URL(`cascade://asset/${entry.handle}/raw`),
      { handle: entry.handle },
    );

    expect(result.contents).toHaveLength(1);
    const first = result.contents[0]!;
    expect(first.uri).toBe(`cascade://asset/${entry.handle}/raw`);
    expect(first.mimeType).toBe("application/json");
    expect(JSON.parse(firstContentText(result))).toEqual(tabsFixture);
  });

  test("fetch returns JSON error body for missing or invalid handles", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client, {
      assetCache: createAssetCache(),
    });

    const raw = resources.find((r) => r.uri === "cascade://asset/{handle}/raw")!;
    const result = await raw.readCallback(
      new URL("cascade://asset/not-a-handle/raw"),
      { handle: "not-a-handle" },
    );

    const parsed = JSON.parse(firstContentText(result)) as { error: string };
    expect(parsed.error).toContain("Invalid asset handle");
  });
});

describe("cascade://draft/{handle}/raw resource", () => {
  test("fetch returns exact cached draft JSON for a valid handle", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("create", {
      page: { name: "draft" },
    });

    registerCascadeResources(server as any, client, { draftCache });

    const raw = resources.find((r) => r.uri === "cascade://draft/{handle}/raw");
    expect(raw).toBeDefined();

    const result = await raw!.readCallback(
      new URL(`cascade://draft/${draft.handle}/raw`),
      { handle: draft.handle },
    );

    expect(JSON.parse(firstContentText(result))).toEqual(draft.root);
  });

  test("fetch respects draft read tool-block rules", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("edit", {
      page: { id: "blocked-page", name: "draft" },
    });

    registerCascadeResources(server as any, client, {
      draftCache,
      toolBlockStore: {
        path: "test-tool-blocks.json",
        read: async () => [
          {
            type: "page",
            id: "blocked-page",
            tools: ["cascade_draft_get_value"],
            reason: "Sensitive draft token=super-secret",
          },
        ],
        write: async () => {},
      },
    });

    const raw = resources.find((r) => r.uri === "cascade://draft/{handle}/raw")!;
    const result = await raw.readCallback(
      new URL(`cascade://draft/${draft.handle}/raw`),
      { handle: draft.handle },
    );

    const parsed = JSON.parse(firstContentText(result)) as { error: string };
    expect(parsed.error).toContain("Resource read denied");
    expect(parsed.error).toContain("Sensitive draft");
    expect(parsed.error).not.toContain("super-secret");
  });

  test("fetch returns JSON error body when draft tool-block repository read fails", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    const draftCache = createDraftCache();
    const draft = draftCache.createFromAsset("create", {
      page: { name: "draft" },
    });

    registerCascadeResources(server as any, client, {
      draftCache,
      toolBlockStore: {
        path: "C:\\secret\\broken-tool-blocks.json",
        read: async () => {
          throw new Error("tool block repo unreadable token=super-secret");
        },
        write: async () => {},
      },
    });

    const raw = resources.find((r) => r.uri === "cascade://draft/{handle}/raw")!;
    const result = await raw.readCallback(
      new URL(`cascade://draft/${draft.handle}/raw`),
      { handle: draft.handle },
    );

    const parsed = JSON.parse(firstContentText(result)) as { error: string };
    expect(parsed.error).toContain("Failed to read draft tool-block rules");
    expect(parsed.error).not.toContain("super-secret");
    expect(parsed.error).not.toContain("C:\\secret");
  });

  test("fetch returns JSON error body for missing or invalid draft handles", async () => {
    const { server, resources } = makeMockServer();
    const client = createMockClient();
    registerCascadeResources(server as any, client, {
      draftCache: createDraftCache(),
    });

    const raw = resources.find((r) => r.uri === "cascade://draft/{handle}/raw")!;
    const result = await raw.readCallback(
      new URL("cascade://draft/not-a-handle/raw"),
      { handle: "not-a-handle" },
    );

    const parsed = JSON.parse(firstContentText(result)) as { error: string };
    expect(parsed.error).toContain("Invalid draft handle");
  });
});
