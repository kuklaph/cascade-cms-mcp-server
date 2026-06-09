import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PageAssetSchema,
  FileAssetSchema,
  FolderAssetSchema,
  SymlinkAssetSchema,
  ReferenceAssetSchema,
  TextBlockAssetSchema,
  FeedBlockAssetSchema,
  IndexBlockAssetSchema,
  TwitterFeedBlockAssetSchema,
  XmlBlockAssetSchema,
  TemplateAssetSchema,
  UserAssetSchema,
  GroupAssetSchema,
  RoleAssetSchema,
  FacebookConnectorEnvelopeSchema,
  WordPressConnectorEnvelopeSchema,
  AssetFactoryAssetSchema,
  ContentTypeAssetSchema,
  DestinationAssetSchema,
  PageConfigurationSetAssetSchema,
  PublishSetAssetSchema,
  SiteAssetSchema,
  FtpTransportAssetSchema,
  DatabaseTransportAssetSchema,
  AssetInputSchema,
  CreateAssetInputSchema,
  EditAssetInputSchema,
  ASSET_ENVELOPE_KEYS,
} from "../../../src/schemas/assets.js";
import * as AssetEnums from "../../../src/schemas/assets/enums.js";

function stringUnionFromTypes(typeName: string): string[] {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(
    new RegExp(`export type ${typeName} =([\\s\\S]*?);`),
  );
  if (!match) throw new Error(`${typeName} union not found`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

function assetPropertyEntriesFromTypes(): Array<{ key: string; optional: boolean }> {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(/export type AssetPropertiesBase = \{([\s\S]*?)\n\};/);
  if (!match) throw new Error("AssetPropertiesBase type not found");
  expect(source).toContain("export type AssetProperties = RequireExactlyOne<");
  expect(source).toContain("AssetPropertiesBase,");
  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+)(\?)?:/gm)]
    .map((item) => ({ key: item[1], optional: item[2] === "?" }))
    .filter((entry) => entry.key !== "workflowConfiguration")
    .sort((a, b) => a.key.localeCompare(b.key));
}

function assetPropertyKeysFromTypes(): string[] {
  return assetPropertyEntriesFromTypes().map((entry) => entry.key).sort();
}

// ─── Inner asset schemas (content) ──────────────────────────────────────────

describe("PageAssetSchema (inner page shape)", () => {
  test("should parse a valid page asset body", () => {
    const input = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a page asset missing name", () => {
    const input = {
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
    if (!res.success) {
      const issueText = JSON.stringify(res.error.issues);
      expect(issueText).toContain("name");
    }
  });

  test("should accept a page asset without parentFolderPath (edit use case)", () => {
    // Cascade requires parentFolder on CREATE but not on EDIT — schema accepts both.
    const input = {
      id: "existing-id",
      name: "index",
      siteName: "my-site",
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject extra top-level fields (strict variant)", () => {
    const input = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
      randomField: "should-not-exist",
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should accept structured metadata with dynamic fields", () => {
    const input = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
      metadata: {
        title: "My Page",
        dynamicFields: [{ name: "foo", fieldValues: [{ value: "bar" }] }],
      },
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should validate structuredData node shapes", () => {
    const validPage = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
      structuredData: {
        definitionPath: "/data-definitions/page",
        structuredDataNodes: [
          {
            type: "text",
            identifier: "headline",
            text: "Welcome",
          },
        ],
      },
    };

    expect(PageAssetSchema.safeParse(validPage).success).toBe(true);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: {
          structuredDataNodes: [{ type: "text", identifier: "headline" }],
        },
      }).success,
    ).toBe(true);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: {
          structuredDataNodes: [{ type: "asset", identifier: "related" }],
        },
      }).success,
    ).toBe(true);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: {
          structuredDataNodes: [{ type: "group", identifier: "group" }],
        },
      }).success,
    ).toBe(true);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: "<xml/>",
      }).success,
    ).toBe(false);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: { structuredDataNodes: {} },
      }).success,
    ).toBe(false);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: {
          structuredDataNodes: [{ type: "text", text: "Missing identifier" }],
        },
      }).success,
    ).toBe(false);
    expect(
      PageAssetSchema.safeParse({
        ...validPage,
        structuredData: {
          structuredDataNodes: [
            {
              type: "asset",
              identifier: "related",
              assetType: "page",
              pageId: "page-1",
              recycled: "false",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

describe("FileAssetSchema (inner file shape)", () => {
  test("should parse a valid file asset body", () => {
    const input = {
      name: "readme.txt",
      parentFolderPath: "/docs",
      siteName: "my-site",
      text: "hello world",
    };
    const res = FileAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });
});

describe("FolderAssetSchema (inner folder shape)", () => {
  test("should parse a valid folder asset body", () => {
    const input = {
      name: "docs",
      parentFolderPath: "/",
      siteName: "my-site",
      shouldBePublished: true,
    };
    const res = FolderAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });
});

describe("SymlinkAssetSchema (inner symlink shape)", () => {
  test("should parse a valid symlink asset body", () => {
    const input = {
      name: "external",
      parentFolderPath: "/links",
      siteName: "my-site",
      linkURL: "https://example.com",
    };
    const res = SymlinkAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a symlink without linkURL (field is optional in generated types)", () => {
    // Cascade validates create-side linkURL requirements server-side.
    const input = {
      name: "external",
      parentFolderPath: "/links",
      siteName: "my-site",
    };
    const res = SymlinkAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });
});

describe("ReferenceAssetSchema (inner reference shape)", () => {
  test("should parse a valid reference asset body", () => {
    const input = {
      name: "ref-to-page",
      parentFolderPath: "/references",
      siteName: "my-site",
      referencedAssetId: "abc123",
      referencedAssetType: "page",
    };
    const res = ReferenceAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a reference missing the required referencedAssetType field", () => {
    const input = {
      name: "ref",
      parentFolderPath: "/references",
      siteName: "my-site",
      referencedAssetId: "abc123",
    };
    const res = ReferenceAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject a reference missing the generated required target alternative", () => {
    const input = {
      name: "ref",
      parentFolderPath: "/references",
      siteName: "my-site",
      referencedAssetType: "page",
    };
    const res = ReferenceAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

// ─── Inner block schemas ────────────────────────────────────────────────────

describe("Block inner schemas", () => {
  test("TextBlockAssetSchema accepts a text block with the required `text` field", () => {
    const input = {
      name: "my-text",
      parentFolderPath: "/blocks",
      siteName: "my-site",
      text: "block body content",
    };
    const res = TextBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("TextBlockAssetSchema rejects a text block missing the required `text` field", () => {
    const input = {
      name: "my-text",
      parentFolderPath: "/blocks",
      siteName: "my-site",
    };
    const res = TextBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("FeedBlockAssetSchema accepts a feed block with the required `feedURL` field", () => {
    const input = {
      name: "my-feed",
      parentFolderPath: "/blocks",
      siteName: "my-site",
      feedURL: "https://example.com/feed.xml",
    };
    const res = FeedBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("XmlBlockAssetSchema rejects a block without required xml", () => {
    const input = {
      name: "my-xml",
      parentFolderPath: "/blocks",
      siteName: "my-site",
    };
    const res = XmlBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("XmlBlockAssetSchema accepts a block with required xml", () => {
    const input = {
      name: "my-xml",
      parentFolderPath: "/blocks",
      siteName: "my-site",
      xml: "<root/>",
    };
    const res = XmlBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });
});

// ─── Template / admin principal schemas ─────────────────────────────────────

describe("TemplateAssetSchema", () => {
  test("should accept a valid template asset body", () => {
    const input = {
      name: "standard",
      parentFolderPath: "/templates",
      siteName: "my-site",
      xml: "<xhtml/>",
    };
    const res = TemplateAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a template missing the required `xml` field", () => {
    const input = {
      name: "standard",
      parentFolderPath: "/templates",
      siteName: "my-site",
    };
    const res = TemplateAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

describe("UserAssetSchema", () => {
  test("should accept a valid user asset body", () => {
    const input = {
      username: "alice",
      fullName: "Alice Example",
      email: "alice@example.com",
      authType: "normal",
      password: "correct-horse-battery-staple",
      groups: "editors;authors",
      roles: "site-manager",
    };
    const res = UserAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a user missing the required `authType` field", () => {
    const input = {
      username: "alice",
      fullName: "Alice Example",
      email: "alice@example.com",
      password: "secret",
      groups: "editors",
      roles: "site-manager",
    };
    const res = UserAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject invalid authType and stale singular role", () => {
    expect(
      UserAssetSchema.safeParse({
        username: "alice",
        fullName: "Alice Example",
        email: "alice@example.com",
        authType: "local",
        password: "secret",
        roles: "site-manager",
      }).success,
    ).toBe(false);
    expect(
      UserAssetSchema.safeParse({
        username: "alice",
        fullName: "Alice Example",
        email: "alice@example.com",
        authType: "normal",
        password: "secret",
        role: "site-manager",
      }).success,
    ).toBe(false);
  });

  test("should reject a user missing generated required fullName and email fields", () => {
    const input = {
      username: "alice",
      authType: "normal",
      password: "secret",
      groups: "editors",
      roles: "site-manager",
    };
    const res = UserAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

describe("GroupAssetSchema", () => {
  test("should accept a valid group asset body", () => {
    const input = {
      groupName: "editors",
      role: "editor",
      users: "alice;bob",
    };
    const res = GroupAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a group missing the required `groupName` field", () => {
    const input = { role: "editor" };
    const res = GroupAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

describe("RoleAssetSchema", () => {
  test("should accept a site role with site abilities", () => {
    const input = {
      name: "editor",
      roleType: "site",
      siteAbilities: { editAccessRights: true, bypassWorkflow: false },
    };
    const res = RoleAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a global role with global abilities", () => {
    const input = {
      name: "admin",
      roleType: "global",
      globalAbilities: { createSites: true, accessRoles: false },
    };
    const res = RoleAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a role missing the required `roleType` field", () => {
    const input = { name: "rogue-role" };
    const res = RoleAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject a role missing the generated required abilities alternative", () => {
    const input = { name: "rogue-role", roleType: "site" };
    const res = RoleAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject role abilities that do not match roleType", () => {
    expect(
      RoleAssetSchema.safeParse({
        name: "bad-site",
        roleType: "site",
        globalAbilities: { createSites: true },
      }).success,
    ).toBe(false);
    expect(
      RoleAssetSchema.safeParse({
        name: "bad-global",
        roleType: "global",
        siteAbilities: { editAccessRights: true },
      }).success,
    ).toBe(false);
    expect(
      RoleAssetSchema.safeParse({
        name: "both",
        roleType: "site",
        globalAbilities: { createSites: true },
        siteAbilities: { editAccessRights: true },
      }).success,
    ).toBe(false);
  });
});

// ─── AssetInputSchema (envelope union) ──────────────────────────────────────

describe("AssetInputSchema (envelope union)", () => {
  test("should accept a nested page envelope", () => {
    const input = {
      page: {
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a nested file envelope", () => {
    const input = {
      file: {
        name: "readme.txt",
        parentFolderPath: "/docs",
        siteName: "my-site",
        text: "hello",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a nested textBlock envelope", () => {
    const input = {
      textBlock: {
        name: "my-text",
        parentFolderPath: "/blocks",
        siteName: "my-site",
        text: "body",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a nested template envelope", () => {
    const input = {
      template: {
        name: "default",
        parentFolderPath: "/templates",
        siteName: "my-site",
        xml: "<xhtml/>",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept facebookConnector envelope from generated AssetProperties", () => {
    expect(
      AssetInputSchema.safeParse({
        facebookConnector: {
          name: "facebook",
          parentContainerPath: "/connectors",
          siteName: "my-site",
          destinationId: "destination-1",
          connectorContentTypeLinks: [{ contentTypeId: "content-type-1" }],
        },
      }).success,
    ).toBe(true);
  });

  test("asset envelope keys match cascade-cms-api AssetProperties", () => {
    const envelopeKeys: string[] = [...ASSET_ENVELOPE_KEYS].sort();
    expect(envelopeKeys).toEqual(assetPropertyKeysFromTypes());
  });

  test("AssetProperties branch extractor should fail if a branch becomes required", () => {
    for (const entry of assetPropertyEntriesFromTypes()) {
      expect(entry.optional).toBe(true);
    }
  });

  test("should reject removed target envelope", () => {
    expect(
      AssetInputSchema.safeParse({
        target: {
          name: "production",
          baseFolderId: "folder-1",
          outputExtension: ".html",
          serializationType: "HTML",
        },
      }).success,
    ).toBe(false);
  });

  test("should reject a flat (non-envelope) shape — regression for cascade_edit bug", () => {
    const input = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject an unknown envelope key", () => {
    const input = {
      madeUpEnvelope: {
        type: "page",
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("should reject an empty object (no envelope key)", () => {
    const res = AssetInputSchema.safeParse({});
    expect(res.success).toBe(false);
  });
});

// ─── Description presence (MCP client help) ─────────────────────────────────

describe("AssetInputSchema description", () => {
  test("carries a description for agent guidance", () => {
    expect(AssetInputSchema.description).toBeTruthy();
  });
});

describe("Generated asset drift corrections", () => {
  test("direct facebookConnector envelope schema parses generated shape", () => {
    expect(
      FacebookConnectorEnvelopeSchema.safeParse({
        facebookConnector: {
          name: "facebook",
          parentContainerPath: "/connectors",
          siteName: "my-site",
          destinationPath: "/destinations/prod",
          connectorContentTypeLinks: [{ contentTypePath: "/content-types/news" }],
        },
      }).success,
    ).toBe(true);
  });

  test("facebookConnector content type links are optional in generated 2.0.2 shape", () => {
    expect(
      FacebookConnectorEnvelopeSchema.safeParse({
        facebookConnector: {
          name: "facebook",
          parentContainerPath: "/connectors",
          siteName: "my-site",
          destinationPath: "/destinations/prod",
        },
      }).success,
    ).toBe(true);
  });

  test("wordPressConnector requires generated content type links", () => {
    expect(
      WordPressConnectorEnvelopeSchema.safeParse({
        wordPressConnector: {
          name: "wordpress",
          parentContainerPath: "/connectors",
          siteName: "my-site",
        },
      }).success,
    ).toBe(false);

    expect(
      WordPressConnectorEnvelopeSchema.safeParse({
        wordPressConnector: {
          name: "wordpress",
          parentContainerPath: "/connectors",
          siteName: "my-site",
          connectorContentTypeLinks: [{ contentTypePath: "/content-types/news" }],
        },
      }).success,
    ).toBe(true);
  });

  test("site namingRuleAssets uses generated string-array shape", () => {
    expect(
      SiteAssetSchema.safeParse({
        name: "site",
        url: "https://example.com",
        recycleBinExpiration: "30",
        unpublishOnExpiration: false,
        linkCheckerEnabled: true,
        externalLinkCheckOnPublish: false,
        inheritDataChecksEnabled: true,
        spellCheckEnabled: true,
        linkCheckEnabled: true,
        accessibilityCheckEnabled: true,
        inheritNamingRules: false,
        namingRuleAssets: ["page"],
      }).success,
    ).toBe(true);
    expect(
      SiteAssetSchema.safeParse({
        name: "site",
        url: "https://example.com",
        recycleBinExpiration: "30",
        unpublishOnExpiration: false,
        linkCheckerEnabled: true,
        externalLinkCheckOnPublish: false,
        inheritDataChecksEnabled: true,
        spellCheckEnabled: true,
        linkCheckEnabled: true,
        accessibilityCheckEnabled: true,
        inheritNamingRules: false,
        namingRuleAssets: [{ namingRuleAsset: "page" }],
      }).success,
    ).toBe(false);
  });

  test("publish set write identifiers require id or path", () => {
    expect(
      PublishSetAssetSchema.safeParse({
        name: "nightly",
        parentContainerPath: "/",
        siteName: "site",
        pages: [{ type: "page", id: "page-1" }],
      }).success,
    ).toBe(true);
    expect(
      PublishSetAssetSchema.safeParse({
        name: "nightly",
        parentContainerPath: "/",
        siteName: "site",
        pages: [{ type: "page" }],
      }).success,
    ).toBe(false);
  });

  test("content type requires generated page configuration set and metadata set alternatives", () => {
    const valid = {
      name: "news",
      parentContainerPath: "/content-types",
      siteName: "site",
      pageConfigurationSetPath: "/page-configurations/default",
      metadataSetPath: "/metadata/default",
    };

    expect(ContentTypeAssetSchema.safeParse(valid).success).toBe(true);
    expect(
      ContentTypeAssetSchema.safeParse({
        ...valid,
        pageConfigurationSetPath: undefined,
      }).success,
    ).toBe(false);
    expect(
      ContentTypeAssetSchema.safeParse({
        ...valid,
        metadataSetPath: undefined,
      }).success,
    ).toBe(false);
  });

  test("content type page configuration entries require id or name", () => {
    const valid = {
      name: "news",
      parentContainerPath: "/content-types",
      siteName: "site",
      pageConfigurationSetPath: "/page-configurations/default",
      metadataSetPath: "/metadata/default",
      contentTypePageConfigurations: [
        {
          pageConfigurationName: "Default",
          publishMode: "all-destinations",
        },
      ],
    };

    expect(ContentTypeAssetSchema.safeParse(valid).success).toBe(true);
    expect(
      ContentTypeAssetSchema.safeParse({
        ...valid,
        contentTypePageConfigurations: [{ publishMode: "all-destinations" }],
      }).success,
    ).toBe(false);
  });

  test("destination requires generated parent container, transport, and site alternatives", () => {
    const valid = {
      name: "prod",
      parentContainerPath: "/destinations",
      transportPath: "/transports/prod",
      siteName: "site",
    };

    expect(DestinationAssetSchema.safeParse(valid).success).toBe(true);
    expect(
      DestinationAssetSchema.safeParse({
        ...valid,
        parentContainerPath: undefined,
      }).success,
    ).toBe(false);
    expect(
      DestinationAssetSchema.safeParse({
        ...valid,
        transportPath: undefined,
      }).success,
    ).toBe(false);
    expect(
      DestinationAssetSchema.safeParse({
        ...valid,
        siteName: undefined,
      }).success,
    ).toBe(false);
  });

  test("page configuration set optional fields reject explicit null", () => {
    const valid = {
      name: "config-set",
      parentContainerPath: "/",
      siteName: "site",
      pageConfigurations: [
        {
          name: "default",
          defaultConfiguration: true,
          templatePath: "/templates/default",
        },
      ],
    };

    expect(PageConfigurationSetAssetSchema.safeParse(valid).success).toBe(true);
    for (const field of [
      "outputExtension",
      "serializationType",
      "includeXMLDeclaration",
      "publishable",
    ]) {
      expect(
        PageConfigurationSetAssetSchema.safeParse({
          ...valid,
          pageConfigurations: [{ ...valid.pageConfigurations[0], [field]: null }],
        }).success,
      ).toBe(false);
    }
  });

  test("page configuration set entries require generated template alternative", () => {
    expect(
      PageConfigurationSetAssetSchema.safeParse({
        name: "config-set",
        parentContainerPath: "/",
        siteName: "site",
        pageConfigurations: [
          {
            name: "default",
            defaultConfiguration: true,
            templatePath: "/templates/default",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      PageConfigurationSetAssetSchema.safeParse({
        name: "config-set",
        parentContainerPath: "/",
        siteName: "site",
        pageConfigurations: [
          {
            name: "default",
            defaultConfiguration: true,
          },
        ],
      }).success,
    ).toBe(false);
  });

  test("shared inherited asset fields reject explicit null", () => {
    const basePage = {
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    };

    for (const [field, value] of [
      ["siteName", null],
      ["lastModifiedDate", null],
      ["tags", null],
      ["reviewOnSchedule", null],
      ["reviewEvery", null],
    ] as const) {
      expect(
        PageAssetSchema.safeParse({
          ...basePage,
          [field]: value,
        }).success,
      ).toBe(false);
    }
  });

  test("file data normalizes unsigned bytes to signed Cascade bytes", () => {
    const parsed = FileAssetSchema.safeParse({
      name: "data.bin",
      parentFolderPath: "/",
      siteName: "my-site",
      data: [255, 216, 128, 127, -1, -128],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("expected valid file data");
    expect(parsed.data.data).toEqual([-1, -40, -128, 127, -1, -128]);
  });

  test("file data rejects non-byte values", () => {
    for (const data of [[1.5], [256], [-129], [Number.POSITIVE_INFINITY]]) {
      expect(
        FileAssetSchema.safeParse({
          name: "data.bin",
          parentFolderPath: "/",
          siteName: "my-site",
          data,
        }).success,
      ).toBe(false);
    }
  });

  test("file data normalizes through asset create and edit schemas", () => {
    const create = CreateAssetInputSchema.safeParse({
      file: {
        name: "data.bin",
        parentFolderPath: "/",
        siteName: "my-site",
        data: [255, 216],
      },
    });
    const edit = EditAssetInputSchema.safeParse({
      file: {
        id: "file-001",
        name: "data.bin",
        parentFolderPath: "/",
        siteName: "my-site",
        data: [128, 127],
      },
    });

    expect(create.success).toBe(true);
    expect(edit.success).toBe(true);
    if (!create.success || !edit.success) throw new Error("expected valid file data");
    expect((create.data.file as { data?: number[] }).data).toEqual([-1, -40]);
    expect((edit.data.file as { data?: number[] }).data).toEqual([-128, 127]);
  });

  test("plain number fields follow generated number shape", () => {
    expect(
      PageAssetSchema.safeParse({
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
        reviewEvery: 1.5,
      }).success,
    ).toBe(true);
    expect(
      AssetFactoryAssetSchema.safeParse({
        name: "factory",
        parentContainerPath: "/",
        siteName: "site",
        assetType: "page",
        folderPlacementPosition: 1.5,
        workflowMode: "none",
      }).success,
    ).toBe(true);
    expect(
      IndexBlockAssetSchema.safeParse({
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        indexBlockType: "folder",
        indexedFolderPath: "/",
        maxRenderedAssets: 1.5,
        depthOfIndex: 0.5,
      }).success,
    ).toBe(true);
    expect(
      TwitterFeedBlockAssetSchema.safeParse({
        name: "twitter",
        parentFolderPath: "/",
        siteName: "my-site",
        accountName: "example",
        maxResults: 1.5,
        useDefaultStyle: true,
        excludeJQuery: false,
        queryType: "user-only",
      }).success,
    ).toBe(true);
    expect(
      FtpTransportAssetSchema.safeParse({
        name: "ftp",
        parentContainerPath: "/",
        siteName: "my-site",
        hostName: "ftp.example.com",
        port: 21.5,
        username: "publisher",
        ftpProtocolType: "FTP",
      }).success,
    ).toBe(true);
    expect(
      DatabaseTransportAssetSchema.safeParse({
        name: "database",
        parentContainerPath: "/",
        siteName: "my-site",
        transportSiteId: 1.5,
        serverName: "db.example.com",
        serverPort: 5432.5,
        databaseName: "cascade",
        username: "publisher",
      }).success,
    ).toBe(true);
  });

  test("scheduled publish interval hours follow generated number shape", () => {
    const validSite = {
      name: "site",
      url: "https://example.com",
      recycleBinExpiration: "30",
      unpublishOnExpiration: false,
      linkCheckerEnabled: true,
      externalLinkCheckOnPublish: false,
      inheritDataChecksEnabled: true,
      spellCheckEnabled: true,
      linkCheckEnabled: true,
      accessibilityCheckEnabled: true,
      inheritNamingRules: false,
    };

    expect(
      DestinationAssetSchema.safeParse({
        name: "prod",
        parentContainerPath: "/destinations",
        transportPath: "/transports/prod",
        siteName: "site",
        publishIntervalHours: 1,
      }).success,
    ).toBe(true);
    expect(
      DestinationAssetSchema.safeParse({
        name: "prod",
        parentContainerPath: "/destinations",
        transportPath: "/transports/prod",
        siteName: "site",
        publishIntervalHours: 0,
      }).success,
    ).toBe(true);
    expect(
      DestinationAssetSchema.safeParse({
        name: "prod",
        parentContainerPath: "/destinations",
        transportPath: "/transports/prod",
        siteName: "site",
        publishIntervalHours: "4",
      }).success,
    ).toBe(false);
    expect(
      PublishSetAssetSchema.safeParse({
        name: "nightly",
        parentContainerPath: "/",
        siteName: "site",
        publishIntervalHours: 23,
      }).success,
    ).toBe(true);
    expect(
      PublishSetAssetSchema.safeParse({
        name: "nightly",
        parentContainerPath: "/",
        siteName: "site",
        publishIntervalHours: 1.5,
      }).success,
    ).toBe(true);
    expect(
      PublishSetAssetSchema.safeParse({
        name: "nightly",
        parentContainerPath: "/",
        siteName: "site",
        publishIntervalHours: "4",
      }).success,
    ).toBe(false);
    expect(
      SiteAssetSchema.safeParse({
        ...validSite,
        publishIntervalHours: 23,
      }).success,
    ).toBe(true);
    expect(
      SiteAssetSchema.safeParse({
        ...validSite,
        publishIntervalHours: 0,
      }).success,
    ).toBe(true);
    expect(
      SiteAssetSchema.safeParse({
        ...validSite,
        publishIntervalHours: 24,
      }).success,
    ).toBe(true);
    expect(
      SiteAssetSchema.safeParse({
        ...validSite,
        publishIntervalHours: 1.5,
      }).success,
    ).toBe(true);
    expect(
      SiteAssetSchema.safeParse({
        ...validSite,
        publishIntervalHours: "4",
      }).success,
    ).toBe(false);
  });
});

// ─── EntityTypeStringSchema (identifier-level — not envelope keys) ──────────

describe("EntityTypeStringSchema (Reference.referencedAssetType)", () => {
  test("accepts native EntityType strings", () => {
    expect(AssetEnums.EntityTypeStringSchema.safeParse("page").success).toBe(true);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("block_XHTML_DATADEFINITION").success).toBe(true);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("format_XSLT").success).toBe(true);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("transport_ftp").success).toBe(true);
  });

  test("rejects camelCase envelope keys", () => {
    // Envelope keys live on the Asset body, not in identifier-level type fields.
    expect(AssetEnums.EntityTypeStringSchema.safeParse("xhtmlDataDefinitionBlock").success).toBe(false);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("target").success).toBe(false);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("xsltFormat").success).toBe(false);
    expect(AssetEnums.EntityTypeStringSchema.safeParse("ftpTransport").success).toBe(false);
  });
});

describe("asset enum schemas", () => {
  const enumParityCases = [
    ["RoleTypes", AssetEnums.RoleTypeSchema],
    ["UserAuthTypes", AssetEnums.UserAuthTypeSchema],
    ["NamingRuleCase", AssetEnums.NamingRuleCaseSchema],
    ["NamingRuleSpacing", AssetEnums.NamingRuleSpacingSchema],
    ["NamingRuleAsset", AssetEnums.NamingRuleAssetSchema],
    ["RecycleBinExpiration", AssetEnums.RecycleBinExpirationSchema],
    ["ScheduledDestinationMode", AssetEnums.ScheduledDestinationModeSchema],
    ["DayOfWeek", AssetEnums.DayOfWeekSchema],
    ["AssetFactoryWorkflowMode", AssetEnums.AssetFactoryWorkflowModeSchema],
    ["WorkflowNamingBehavior", AssetEnums.WorkflowNamingBehaviorSchema],
    [
      "ContentTypePageConfigurationPublishMode",
      AssetEnums.ContentTypePageConfigurationPublishModeSchema,
    ],
    ["InlineEditableFieldType", AssetEnums.InlineEditableFieldTypeSchema],
    ["MetadataFieldVisibility", AssetEnums.MetadataFieldVisibilitySchema],
    ["DynamicMetadataFieldType", AssetEnums.DynamicMetadataFieldTypeSchema],
    ["SerializationType", AssetEnums.SerializationTypeSchema],
    ["LinkRewriting", AssetEnums.LinkRewritingSchema],
    ["SiteLinkRewriting", AssetEnums.SiteLinkRewritingSchema],
    ["AuthMode", AssetEnums.AuthModeSchema],
    ["FtpProtocolType", AssetEnums.FtpProtocolTypeSchema],
    ["IndexBlockType", AssetEnums.IndexBlockTypeSchema],
    ["IndexBlockSortMethod", AssetEnums.IndexBlockSortMethodSchema],
    ["IndexBlockSortOrder", AssetEnums.IndexBlockSortOrderSchema],
    ["IndexBlockPageXml", AssetEnums.IndexBlockPageXmlSchema],
    ["IndexBlockRenderingBehavior", AssetEnums.IndexBlockRenderingBehaviorSchema],
    ["TwitterQueryType", AssetEnums.TwitterQueryTypeSchema],
    ["StructuredDataType", AssetEnums.StructuredDataTypeSchema],
    ["StructuredDataAssetType", AssetEnums.StructuredDataAssetTypeSchema],
    ["EntityTypeString", AssetEnums.EntityTypeStringSchema],
  ] as const;

  test.each(enumParityCases)("%s matches cascade-cms-api types", (typeName, schema) => {
    const actual: string[] = [...schema.options].sort();
    expect(actual).toEqual(stringUnionFromTypes(typeName));
  });
});
