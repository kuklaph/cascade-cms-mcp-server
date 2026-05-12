import { describe, test, expect } from "bun:test";
import {
  PageAssetSchema,
  FileAssetSchema,
  FolderAssetSchema,
  SymlinkAssetSchema,
  ReferenceAssetSchema,
  TextBlockAssetSchema,
  FeedBlockAssetSchema,
  XmlBlockAssetSchema,
  TemplateAssetSchema,
  UserAssetSchema,
  GroupAssetSchema,
  RoleAssetSchema,
  AssetInputSchema,
} from "../../../src/schemas/assets.js";
import { EntityTypeStringSchema } from "../../../src/schemas/assets/enums.js";

// ─── Inner asset schemas (content) ──────────────────────────────────────────

describe("PageAssetSchema (inner page shape)", () => {
  test("should parse a valid page asset body", () => {
    const input = {
      type: "page",
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
      type: "page",
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
      type: "page",
      id: "existing-id",
      name: "index",
      siteName: "my-site",
    };
    const res = PageAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject extra top-level fields (strict variant)", () => {
    const input = {
      type: "page",
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
      type: "page",
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
});

describe("FileAssetSchema (inner file shape)", () => {
  test("should parse a valid file asset body", () => {
    const input = {
      type: "file",
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
      type: "folder",
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
      type: "symlink",
      name: "external",
      parentFolderPath: "/links",
      siteName: "my-site",
      linkURL: "https://example.com",
    };
    const res = SymlinkAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should accept a symlink without linkURL (field is optional per OpenAPI)", () => {
    // Cascade's OpenAPI marks linkURL optional; validation happens server-side.
    const input = {
      type: "symlink",
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
      type: "reference",
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
      type: "reference",
      name: "ref",
      parentFolderPath: "/references",
      siteName: "my-site",
      referencedAssetId: "abc123",
    };
    const res = ReferenceAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

// ─── Inner block schemas ────────────────────────────────────────────────────

describe("Block inner schemas", () => {
  test("TextBlockAssetSchema accepts a text block with the required `text` field", () => {
    const input = {
      type: "block_TEXT",
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
      type: "block_TEXT",
      name: "my-text",
      parentFolderPath: "/blocks",
      siteName: "my-site",
    };
    const res = TextBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("FeedBlockAssetSchema accepts a feed block with the required `feedURL` field", () => {
    const input = {
      type: "block_FEED",
      name: "my-feed",
      parentFolderPath: "/blocks",
      siteName: "my-site",
      feedURL: "https://example.com/feed.xml",
    };
    const res = FeedBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("XmlBlockAssetSchema rejects a block missing the required `xml` field", () => {
    const input = {
      type: "block_XML",
      name: "my-xml",
      parentFolderPath: "/blocks",
      siteName: "my-site",
    };
    const res = XmlBlockAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

// ─── Template / admin principal schemas ─────────────────────────────────────

describe("TemplateAssetSchema", () => {
  test("should accept a valid template asset body", () => {
    const input = {
      type: "template",
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
      type: "template",
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
      authType: "normal",
      password: "correct-horse-battery-staple",
      groups: "editors;authors",
      role: "site-manager",
    };
    const res = UserAssetSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("should reject a user missing the required `authType` field", () => {
    const input = {
      username: "alice",
      password: "secret",
      groups: "editors",
      role: "site-manager",
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

  test("should reject a role missing the required `roleType` field", () => {
    const input = { name: "rogue-role" };
    const res = RoleAssetSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

// ─── AssetInputSchema (envelope union) ──────────────────────────────────────

describe("AssetInputSchema (envelope union)", () => {
  test("should accept a nested page envelope", () => {
    const input = {
      page: {
        type: "page",
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
        type: "file",
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

  test("should reject a flat (non-envelope) shape — regression for cascade_edit bug", () => {
    const input = {
      type: "page",
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

// ─── EntityTypeStringSchema (identifier-level — not envelope keys) ──────────

describe("EntityTypeStringSchema (Reference.referencedAssetType)", () => {
  test("accepts native EntityType strings", () => {
    expect(EntityTypeStringSchema.safeParse("page").success).toBe(true);
    expect(EntityTypeStringSchema.safeParse("block_XHTML_DATADEFINITION").success).toBe(true);
    expect(EntityTypeStringSchema.safeParse("format_XSLT").success).toBe(true);
    expect(EntityTypeStringSchema.safeParse("transport_ftp").success).toBe(true);
  });

  test("rejects camelCase envelope keys", () => {
    // Envelope keys live on the Asset body, not in identifier-level type fields.
    expect(EntityTypeStringSchema.safeParse("xhtmlDataDefinitionBlock").success).toBe(false);
    expect(EntityTypeStringSchema.safeParse("xsltFormat").success).toBe(false);
    expect(EntityTypeStringSchema.safeParse("ftpTransport").success).toBe(false);
  });
});
