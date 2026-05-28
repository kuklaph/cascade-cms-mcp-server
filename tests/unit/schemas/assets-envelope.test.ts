/**
 * Regression tests for the asset envelope shape.
 *
 * The Cascade `Asset` type — which `EditRequest` and `CreateRequest` extend —
 * requires the shape `{ asset: { <typeKey>: { ...fields } } }`. Earlier
 * revisions of this schema accepted a flat `{ asset: { type, ...fields } }`
 * shape that matched no Cascade type and was rejected server-side with
 * "No schema asset was bundled with the Edit request".
 *
 * These tests lock the wrapper to Cascade's native envelope shape and verify
 * the flat shape no longer validates.
 */

import { describe, test, expect } from "bun:test";
import { AssetInputSchema } from "../../../src/schemas/assets.js";
import {
  CreateRequestSchema,
  EditRequestSchema,
} from "../../../src/schemas/requests.js";

describe("AssetInputSchema — envelope shape", () => {
  test("accepts a nested page envelope (matches Cascade Asset.page)", () => {
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

  test("accepts a nested file envelope (matches Cascade Asset.file)", () => {
    const input = {
      file: {
        name: "readme.txt",
        parentFolderPath: "/docs",
        siteName: "my-site",
        text: "hello world",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("accepts a nested folder envelope (matches Cascade Asset.folder)", () => {
    const input = {
      folder: {
        name: "docs",
        parentFolderPath: "/",
        siteName: "my-site",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("accepts a nested symlink envelope (matches Cascade Asset.symlink)", () => {
    const input = {
      symlink: {
        name: "external",
        parentFolderPath: "/links",
        siteName: "my-site",
        linkURL: "https://example.com",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("rejects the legacy flat shape for page (regression)", () => {
    const flat = {
      type: "page",
      name: "index",
      parentFolderPath: "/",
      siteName: "my-site",
      contentTypePath: "/content-types/default",
    };
    const res = AssetInputSchema.safeParse(flat);
    expect(res.success).toBe(false);
  });

  test("rejects the legacy flat shape for symlink (regression)", () => {
    const flat = {
      type: "symlink",
      name: "external",
      parentFolderPath: "/links",
      siteName: "my-site",
      linkURL: "https://example.com",
    };
    const res = AssetInputSchema.safeParse(flat);
    expect(res.success).toBe(false);
  });

  test("rejects an envelope with the wrong type key for the inner type", () => {
    // Page-only field under file envelope — mismatch.
    const input = {
      file: {
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("rejects an envelope with multiple type keys", () => {
    const input = {
      page: {
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
      file: {
        name: "readme.txt",
        parentFolderPath: "/",
        siteName: "my-site",
        text: "hi",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(false);
  });

  test("accepts workflowConfiguration beside one asset key", () => {
    const input = {
      workflowConfiguration: {
        workflowName: "Review",
        workflowDefinitionId: "workflow-definition-1",
        workflowComments: "Route for approval",
      },
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

  test("rejects workflowConfiguration without workflow definition id or path", () => {
    const res = AssetInputSchema.safeParse({
      workflowConfiguration: {
        workflowName: "Review",
        workflowComments: "Route for approval",
      },
      page: {
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
    });
    expect(res.success).toBe(false);
  });

  test("rejects workflowConfiguration without an asset key", () => {
    const res = AssetInputSchema.safeParse({
      workflowConfiguration: {
        workflowName: "Review",
        workflowDefinitionId: "workflow-definition-1",
        workflowComments: "Route for approval",
      },
    });
    expect(res.success).toBe(false);
  });

  test("rejects an empty envelope (no type key)", () => {
    const res = AssetInputSchema.safeParse({});
    expect(res.success).toBe(false);
  });

  test("accepts a page envelope without parentFolder (edit case)", () => {
    // AssetInputSchema is the shared raw envelope; create/edit wrappers add
    // operation-specific required alternatives.
    const editShape = {
      page: {
        id: "existing-page-id",
        name: "index",
        siteName: "my-site",
      },
    };
    const res = AssetInputSchema.safeParse(editShape);
    expect(res.success).toBe(true);
  });

  test("accepts a template envelope with its required xml field", () => {
    const input = {
      template: {
        name: "my-template",
        parentFolderPath: "/templates",
        siteName: "my-site",
        xml: "<xhtml/>",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(true);
  });

  test("rejects a template envelope with an unknown field (strict mirror)", () => {
    // Strict schemas reject unknown keys — every Cascade field is modelled,
    // so a stray field indicates a typo or upstream API drift.
    const input = {
      template: {
        name: "my-template",
        parentFolderPath: "/templates",
        siteName: "my-site",
        xml: "<xhtml/>",
        arbitraryField: "not allowed",
      },
    };
    const res = AssetInputSchema.safeParse(input);
    expect(res.success).toBe(false);
  });
});

describe("EditRequestSchema + CreateRequestSchema — operation-specific asset envelopes", () => {
  test("CreateRequestSchema accepts the nested envelope", () => {
    const res = CreateRequestSchema.safeParse({
      asset: {
        page: {
          name: "index",
          parentFolderPath: "/",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
          xhtml: "<p>Home</p>",
        },
      },
    });
    expect(res.success).toBe(true);
  });

  test("CreateRequestSchema rejects page create without parent folder fields", () => {
    const res = CreateRequestSchema.safeParse({
      asset: {
        page: {
          name: "index",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
          xhtml: "<p>Home</p>",
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("CreateRequestSchema rejects server-assigned id fields", () => {
    const res = CreateRequestSchema.safeParse({
      asset: {
        page: {
          id: "page-001",
          name: "index",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("CreateRequestSchema requires create placement and site alternatives", () => {
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          page: {
            name: "index",
            contentTypePath: "/content-types/default",
            xhtml: "<p>Home</p>",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          page: {
            name: "index",
            parentFolderPath: "/",
            contentTypePath: "/content-types/default",
            xhtml: "<p>Home</p>",
          },
        },
      }).success,
    ).toBe(false);
  });

  test("CreateRequestSchema requires page configuration and content alternatives", () => {
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          page: {
            name: "index",
            parentFolderPath: "/",
            siteName: "my-site",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          page: {
            name: "index",
            parentFolderPath: "/",
            siteName: "my-site",
            contentTypePath: "/content-types/default",
          },
        },
      }).success,
    ).toBe(false);
  });

  test("CreateRequestSchema requires branch-specific generated alternatives", () => {
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          reference: {
            name: "ref",
            parentFolderPath: "/references",
            siteName: "my-site",
            referencedAssetType: "page",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          role: {
            name: "editors",
            roleType: "site",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          role: {
            name: "editors",
            roleType: "site",
            globalAbilities: { createSites: true },
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          contentType: {
            name: "news",
            parentContainerPath: "/content-types",
            siteName: "my-site",
            pageConfigurationSetPath: "/page-configurations/default",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          destination: {
            name: "prod",
            parentContainerPath: "/destinations",
            siteName: "my-site",
          },
        },
      }).success,
    ).toBe(false);

    expect(
      CreateRequestSchema.safeParse({
        asset: {
          destination: {
            name: "prod",
            parentContainerPath: "/destinations",
            transportPath: "/transports/prod",
          },
        },
      }).success,
    ).toBe(false);
  });

  test("EditRequestSchema accepts a TS-compatible edit payload", () => {
    const res = EditRequestSchema.safeParse({
      asset: {
        page: {
          id: "page-001",
          name: "index",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
          xhtml: "<p>Home</p>",
          metadata: { title: "Home (edited)" },
        },
      },
    });
    expect(res.success).toBe(true);
  });

  test("EditRequestSchema rejects edit payloads without generated required name", () => {
    const res = EditRequestSchema.safeParse({
      asset: {
        page: {
          id: "page-001",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
          metadata: { title: "Home (edited)" },
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("EditRequestSchema rejects edit payloads without generated required site alternative", () => {
    const res = EditRequestSchema.safeParse({
      asset: {
        page: {
          id: "page-001",
          name: "index",
          contentTypePath: "/content-types/default",
          xhtml: "<p>Home</p>",
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("EditRequestSchema rejects read output with inner entity type fields", () => {
    const res = EditRequestSchema.safeParse({
      asset: {
        page: {
          id: "page-001",
          type: "page",
          name: "index",
          siteName: "my-site",
          contentTypePath: "/content-types/default",
        },
      },
    });
    expect(res.success).toBe(false);
  });

  test("EditRequestSchema rejects the legacy flat shape (regression)", () => {
    const res = EditRequestSchema.safeParse({
      asset: {
        type: "page",
        id: "page-001",
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
    });
    expect(res.success).toBe(false);
  });

  test("CreateRequestSchema rejects the legacy flat shape (regression)", () => {
    const res = CreateRequestSchema.safeParse({
      asset: {
        type: "page",
        name: "index",
        parentFolderPath: "/",
        siteName: "my-site",
        contentTypePath: "/content-types/default",
      },
    });
    expect(res.success).toBe(false);
  });
});
