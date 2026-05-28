import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createToolBlockStore,
  defaultToolBlockFile,
  findDeniedToolCall,
} from "../../src/toolBlocks.js";

const tempDirs: string[] = [];

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cascade-tool-blocks-"));
  tempDirs.push(dir);
  return join(dir, "tool-blocks.json");
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("tool block store", () => {
  test("returns an empty rule set when the repository file does not exist", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(store.read()).resolves.toEqual([]);
  });

  test("writes and reads tool block rules as JSON", async () => {
    const store = createToolBlockStore(await tempFile());
    const rules = [
      {
        url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
        tools: ["cascade_remove", "cascade_edit"],
        reason: "Protected block",
      },
    ];

    await store.write(rules);

    await expect(store.read()).resolves.toEqual(rules);
  });

  test("throws when the repository file is invalid JSON", async () => {
    const file = await tempFile();
    const store = createToolBlockStore(file);
    await writeFile(file, "{bad json", "utf8");

    await expect(store.read()).rejects.toThrow(/tool block repository/i);
  });

  test("throws when a non-url rule omits type", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([{ id: "asset-1", tools: ["cascade_edit"] } as any]),
    ).rejects.toThrow(/type is required/i);
  });

  test("throws when a url-only rule omits url type", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          url: "https://college.cascadecms.com/entity/open.act?id=asset-1",
          tools: ["cascade_edit"],
        },
      ]),
    ).rejects.toThrow(/url.*type/i);
  });

  test("throws when a url rule omits id", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          url: "https://college.cascadecms.com/entity/open.act?type=block",
          tools: ["cascade_edit"],
        },
      ]),
    ).rejects.toThrow(/url.*id/i);
  });

  test("throws when a mixed url and id rule omits explicit selector type", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
          id: "page-1",
          tools: ["cascade_edit"],
        } as any,
      ]),
    ).rejects.toThrow(/type is required/i);
  });

  test("throws when a url selector is not a Cascade CMS asset URL", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          url: "https://example.edu/entity/open.act?id=block-1&type=block",
          tools: ["cascade_edit"],
        },
      ]),
    ).rejects.toThrow(/Cascade CMS asset URL/i);
  });

  test("throws when a rule uses an unsupported entity type", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          type: "connectorContainer",
          id: "container-1",
          tools: ["cascade_edit"],
        } as any,
      ]),
    ).rejects.toThrow(/expected one of/i);
  });

  test("throws when a url selector uses an unsupported entity type", async () => {
    const store = createToolBlockStore(await tempFile());

    await expect(
      store.write([
        {
          url: "https://college.cascadecms.com/entity/open.act?id=container-1&type=connectorContainer",
          tools: ["cascade_edit"],
        },
      ]),
    ).rejects.toThrow(/Cascade CMS asset URL/i);
  });

  test("uses a stable default file under the user home directory", () => {
    expect(defaultToolBlockFile()).toContain(".cascade-cms-mcp-server");
    expect(defaultToolBlockFile()).toMatch(/tool-blocks\.json$/);
  });
});

describe("findDeniedToolCall", () => {
  test("matches a blocked main Cascade tool by URL-derived id and type", () => {
    const denied = findDeniedToolCall(
      "cascade_edit",
      {
        asset: {
          xhtmlDataDefinitionBlock: {
            id: "block-1",
          },
        },
      },
      [
        {
          url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
          tools: ["cascade_edit"],
        },
      ],
    );

    expect(denied?.tools).toEqual(["cascade_edit"]);
  });

  test("does not match a URL-only rule when the URL type differs from the payload type", () => {
    const denied = findDeniedToolCall(
      "cascade_edit",
      {
        identifier: {
          type: "page",
          id: "block-1",
        },
      },
      [
        {
          url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
          tools: ["cascade_edit"],
        },
      ],
    );

    expect(denied).toBeUndefined();
  });

  test("matches mixed URL and explicit selectors against their own types", () => {
    const rule = {
      url: "https://college.cascadecms.com/entity/open.act?id=block-1&type=block",
      type: "page" as const,
      id: "page-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { asset: { xhtmlDataDefinitionBlock: { id: "block-1" } } },
        [rule],
      ),
    ).toBe(rule);
    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "page", id: "page-1" } },
        [rule],
      ),
    ).toBe(rule);
    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "folder", id: "page-1" } },
        [rule],
      ),
    ).toBeUndefined();
  });

  test("matches explicit block subtype rules against asset envelope keys", () => {
    const rule = {
      type: "block_XHTML_DATADEFINITION" as const,
      id: "block-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { asset: { xhtmlDataDefinitionBlock: { id: "block-1" } } },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches valid entity types against non-identical asset envelope keys", () => {
    const rule = {
      type: "connectorcontainer" as const,
      id: "container-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { asset: { connectorContainer: { id: "container-1" } } },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches page configuration rules inside plural array fields", () => {
    const rule = {
      type: "pageconfiguration" as const,
      id: "config-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        {
          asset: {
            pageConfigurationSet: {
              pageConfigurations: [{ id: "config-1", name: "Default" }],
            },
          },
        },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches page region rules inside plural array fields", () => {
    const rule = {
      type: "pageregion" as const,
      id: "region-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        {
          asset: {
            page: {
              pageConfigurations: [
                {
                  pageRegions: [{ id: "region-1", name: "main" }],
                },
              ],
            },
          },
        },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches generic format rules against concrete format types and envelopes", () => {
    const rule = {
      type: "format" as const,
      id: "format-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "format_XSLT", id: "format-1" } },
        [rule],
      ),
    ).toBe(rule);
    expect(
      findDeniedToolCall(
        "cascade_edit",
        { asset: { xsltFormat: { id: "format-1" } } },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches concrete family rules against generic identifiers", () => {
    const blockRule = {
      type: "block_XHTML_DATADEFINITION" as const,
      id: "block-1",
      tools: ["cascade_edit"],
    };
    const formatRule = {
      type: "format_XSLT" as const,
      id: "format-1",
      tools: ["cascade_edit"],
    };
    const transportRule = {
      type: "transport_ftp" as const,
      id: "transport-1",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "block", id: "block-1" } },
        [blockRule],
      ),
    ).toBe(blockRule);
    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "format", id: "format-1" } },
        [formatRule],
      ),
    ).toBe(formatRule);
    expect(
      findDeniedToolCall(
        "cascade_edit",
        { identifier: { type: "transport", id: "transport-1" } },
        [transportRule],
      ),
    ).toBe(transportRule);
  });

  test("matches generic transport URL rules against concrete transport envelopes", () => {
    const rule = {
      url: "https://college.cascadecms.com/entity/open.act?id=transport-1&type=transport",
      tools: ["cascade_edit"],
    };

    expect(
      findDeniedToolCall(
        "cascade_edit",
        { asset: { ftpTransport: { id: "transport-1" } } },
        [rule],
      ),
    ).toBe(rule);
  });

  test("matches path arrays on site identifiers", () => {
    const rule = {
      type: "site" as const,
      path: ["Site One", "Site Two"],
      tools: ["cascade_remove"],
    };

    expect(
      findDeniedToolCall(
        "cascade_remove",
        { identifier: { type: "site", path: { path: "Site Two" } } },
        [rule],
      ),
    ).toBe(rule);
  });
});
