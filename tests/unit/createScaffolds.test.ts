import { describe, expect, test } from "bun:test";
import {
  ASSET_ENVELOPE_KEYS,
} from "../../src/schemas/assets.js";
import { CreateRequestSchema } from "../../src/schemas/requests.js";
import {
  buildCreateAssetScaffold,
  buildCreateAssetScaffoldFromAsset,
} from "../../src/createScaffolds.js";

describe("create asset scaffolds", () => {
  test("covers every create asset envelope key with a valid fillable scaffold", () => {
    for (const assetType of ASSET_ENVELOPE_KEYS) {
      const scaffold = buildCreateAssetScaffold({ assetType });
      expect(Object.keys(scaffold.asset)).toEqual([assetType]);
      expect(JSON.stringify(scaffold.asset)).not.toContain('"id"');
      expect(scaffold.required_value_pointers.length).toBeGreaterThan(0);

      const filled = fillRequiredValues(scaffold.asset);
      const parsed = CreateRequestSchema.safeParse({ asset: filled });
      expect(parsed.success, `${assetType} scaffold should validate after filling placeholders`).toBe(true);
    }
  });

  test("supports id-based relationships and site role scaffolds", () => {
    const page = buildCreateAssetScaffold({
      assetType: "page",
      relationshipStyle: "id",
    });

    expect(page.asset.page.parentFolderId).toBeNull();
    expect(page.asset.page.parentFolderPath).toBeUndefined();
    expect(page.asset.page.siteId).toBeNull();
    expect(page.asset.page.siteName).toBeUndefined();
    expect(page.asset.page.contentTypeId).toBeNull();
    expect(page.asset.page.contentTypePath).toBeUndefined();

    const editorConfiguration = buildCreateAssetScaffold({
      assetType: "editorConfiguration",
    });
    expect(editorConfiguration.asset.editorConfiguration.siteName).toBeNull();
    expect(editorConfiguration.relationship_groups).toEqual(
      expect.arrayContaining([
        {
          purpose: "Owning site",
          selected: "siteName",
          alternatives: ["siteId", "siteName"],
        },
      ]),
    );

    const role = buildCreateAssetScaffold({
      assetType: "role",
      roleType: "site",
    });
    expect(role.asset.role.roleType).toBe("site");
    expect(role.asset.role.siteAbilities).toEqual({});
    expect(role.asset.role.globalAbilities).toBeUndefined();
  });

  test("builds create scaffolds from an existing structured asset without mutating source", () => {
    const source = {
      xhtmlDataDefinitionBlock: {
        id: "block-001",
        type: "xhtmlDataDefinitionBlock",
        name: "cards",
        path: "/components/cards",
        lastModifiedDate: "2026-01-01T00:00:00Z",
        createdBy: "reader",
        lastPublishedBy: "publisher",
        expirationFolderRecycled: false,
        parentFolderPath: "/components",
        siteName: "my-site",
        structuredData: {
          definitionId: "definition-001",
          structuredDataNodes: [
            {
              type: "group",
              identifier: "card",
              structuredDataNodes: [
                { type: "text", identifier: "title", text: "Alpha" },
                {
                  type: "asset",
                  identifier: "link",
                  assetType: "page",
                  pagePath: "alpha",
                  recycled: false,
                },
              ],
            },
          ],
        },
      },
    };

    const scaffold = buildCreateAssetScaffoldFromAsset(source);
    const block = scaffold.asset.xhtmlDataDefinitionBlock as any;

    expect(block.id).toBeUndefined();
    expect(block.type).toBeUndefined();
    expect(block.path).toBeUndefined();
    expect(block.lastModifiedDate).toBeUndefined();
    expect(block.createdBy).toBeUndefined();
    expect(block.lastPublishedBy).toBeUndefined();
    expect(block.expirationFolderRecycled).toBeUndefined();
    expect(block.structuredData.definitionId).toBe("definition-001");
    expect(block.structuredData.structuredDataNodes[0].structuredDataNodes[0].text).toBe("");
    expect(block.structuredData.structuredDataNodes[0].structuredDataNodes[1].pagePath).toBeUndefined();
    expect(scaffold.cleared_value_pointers).toEqual(
      expect.arrayContaining([
        "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/0/text",
        "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/1/pagePath",
      ]),
    );
    expect(scaffold.replace_value_pointers).toEqual([
      "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/0/text",
    ]);
    expect(scaffold.add_value_pointers).toEqual([
      "/asset/xhtmlDataDefinitionBlock/structuredData/structuredDataNodes/0/structuredDataNodes/1/pagePath",
    ]);
    expect((source.xhtmlDataDefinitionBlock as any).id).toBe("block-001");
    expect((source.xhtmlDataDefinitionBlock as any).type).toBe("xhtmlDataDefinitionBlock");
    expect((source.xhtmlDataDefinitionBlock.structuredData.structuredDataNodes[0].structuredDataNodes[0] as any).text).toBe("Alpha");
  });

  test("strips nested page configuration and region read-only ids", () => {
    const source = {
      pageConfigurationSet: {
        id: "set-001",
        name: "Standard",
        parentContainerPath: "/sets",
        siteName: "site",
        pageConfigurations: [
          {
            id: "configuration-001",
            name: "Default",
            defaultConfiguration: true,
            templateId: "template-001",
            pageRegions: [
              {
                id: "region-001",
                name: "DEFAULT",
                blockId: "block-001",
                formatId: "format-001",
              },
            ],
          },
        ],
      },
    };

    const scaffold = buildCreateAssetScaffoldFromAsset(source);
    const configuration = (scaffold.asset.pageConfigurationSet as any).pageConfigurations[0];
    const region = configuration.pageRegions[0];

    expect(scaffold.asset.pageConfigurationSet.id).toBeUndefined();
    expect(configuration.id).toBeUndefined();
    expect(region.id).toBeUndefined();
    expect(configuration.templateId).toBe("template-001");
    expect(region.blockId).toBe("block-001");
    expect(region.formatId).toBe("format-001");
    expect((source.pageConfigurationSet as any).pageConfigurations[0].id).toBe("configuration-001");
    expect((source.pageConfigurationSet as any).pageConfigurations[0].pageRegions[0].id).toBe("region-001");
  });

  test("clears credential fields when scaffolding from existing assets", () => {
    const cases = [
      {
        source: {
          user: {
            username: "jdoe",
            fullName: "Jane Doe",
            email: "jane@example.com",
            authType: "normal",
            password: "user-secret",
          },
        },
        assetType: "user",
        fields: ["password"],
        leakedValues: ["user-secret"],
      },
      {
        source: {
          wordPressConnector: {
            name: "wp",
            parentContainerPath: "/connectors",
            siteName: "site",
            auth1: "wp-token-one",
            auth2: "wp-token-two",
          },
        },
        assetType: "wordPressConnector",
        fields: ["auth1", "auth2"],
        leakedValues: ["wp-token-one", "wp-token-two"],
      },
      {
        source: {
          ftpTransport: {
            name: "ftp",
            parentContainerPath: "/transports",
            siteName: "site",
            hostName: "ftp.example.com",
            username: "ftp-user",
            password: "ftp-password",
            privateKey: "ftp-private-key",
          },
        },
        assetType: "ftpTransport",
        fields: ["password", "privateKey"],
        leakedValues: ["ftp-password", "ftp-private-key"],
      },
      {
        source: {
          databaseTransport: {
            name: "db",
            parentContainerPath: "/transports",
            siteName: "site",
            serverName: "db.example.com",
            username: "db-user",
            password: "db-password",
          },
        },
        assetType: "databaseTransport",
        fields: ["password"],
        leakedValues: ["db-password"],
      },
      {
        source: {
          cloudTransport: {
            name: "s3",
            parentContainerPath: "/transports",
            siteName: "site",
            key: "cloud-key",
            secret: "cloud-secret",
            bucketName: "bucket",
          },
        },
        assetType: "cloudTransport",
        fields: ["key", "secret"],
        leakedValues: ["cloud-key", "cloud-secret"],
      },
    ] as const;

    for (const testCase of cases) {
      const scaffold = buildCreateAssetScaffoldFromAsset(testCase.source);
      const body = (scaffold.asset as any)[testCase.assetType];

      for (const field of testCase.fields) {
        const pointer = `/asset/${testCase.assetType}/${field}`;
        expect(body[field]).toBeNull();
        expect(scaffold.cleared_value_pointers).toContain(pointer);
        expect(scaffold.replace_value_pointers).toContain(pointer);
      }
      for (const value of testCase.leakedValues) {
        expect(JSON.stringify(scaffold.asset)).not.toContain(value);
      }
    }
  });

  test("adds required credential placeholders when hidden fields are absent", () => {
    const scaffold = buildCreateAssetScaffoldFromAsset({
      cloudTransport: {
        name: "s3",
        parentContainerPath: "/transports",
        siteName: "site",
        bucketName: "bucket",
      },
    });

    expect(scaffold.asset.cloudTransport.key).toBeNull();
    expect(scaffold.asset.cloudTransport.secret).toBeNull();
    expect(scaffold.add_value_pointers).toEqual(
      expect.arrayContaining([
        "/asset/cloudTransport/key",
        "/asset/cloudTransport/secret",
      ]),
    );
    expect(scaffold.replace_value_pointers).not.toContain("/asset/cloudTransport/key");
    expect(scaffold.replace_value_pointers).not.toContain("/asset/cloudTransport/secret");
  });
});

function fillRequiredValues<T>(value: T, key = ""): T {
  if (value === null) return sampleValueFor(key) as T;
  if (Array.isArray(value)) {
    return value.map((item) => fillRequiredValues(item, key)) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        fillRequiredValues(childValue, childKey),
      ]),
    ) as T;
  }
  return value;
}

function sampleValueFor(key: string): unknown {
  if (numberFields.has(key)) return 1;
  if (booleanFields.has(key)) return false;

  switch (key) {
    case "authType":
      return "normal";
    case "queryType":
      return "search-terms";
    case "workflowMode":
      return "none";
    case "referencedAssetType":
      return "page";
    case "namingBehavior":
      return "auto-name";
    case "recycleBinExpiration":
      return "never";
    case "ftpProtocolType":
      return "FTP";
    case "email":
      return "user@example.com";
    case "url":
    case "feedURL":
      return "https://example.com";
    case "configuration":
      return "{}";
    default:
      return key.endsWith("Path") || key === "parentFolderPath" || key === "parentContainerPath"
        ? "/path"
        : "value";
  }
}

const numberFields = new Set([
  "maxRenderedAssets",
  "depthOfIndex",
  "maxResults",
  "port",
  "transportSiteId",
  "serverPort",
]);

const booleanFields = new Set([
  "useDefaultStyle",
  "excludeJQuery",
  "defaultConfiguration",
  "unpublishOnExpiration",
  "linkCheckerEnabled",
  "externalLinkCheckOnPublish",
  "inheritDataChecksEnabled",
  "spellCheckEnabled",
  "linkCheckEnabled",
  "accessibilityCheckEnabled",
  "inheritNamingRules",
]);
