import { describe, test, expect } from "bun:test";
import {
  EntityTypeSchema,
  PathSchema,
  IdentifierSchema,
} from "../../../src/schemas/common.js";

describe("EntityTypeSchema", () => {
  test("should accept well-known entity types (page, file, folder, block)", () => {
    expect(EntityTypeSchema.safeParse("page").success).toBe(true);
    expect(EntityTypeSchema.safeParse("file").success).toBe(true);
    expect(EntityTypeSchema.safeParse("folder").success).toBe(true);
    expect(EntityTypeSchema.safeParse("block").success).toBe(true);
  });

  test("should accept native block / format / transport / connector variants", () => {
    expect(EntityTypeSchema.safeParse("block_XHTML_DATADEFINITION").success).toBe(true);
    expect(EntityTypeSchema.safeParse("format_XSLT").success).toBe(true);
    expect(EntityTypeSchema.safeParse("transport_ftp").success).toBe(true);
    expect(EntityTypeSchema.safeParse("wordpressconnector").success).toBe(true);
  });

  test("should reject camelCase envelope keys that are not valid identifier types", () => {
    // Envelope keys belong on the Asset body (asset.<key>), not in identifier.type.
    // `xhtmlDataDefinitionBlock` is the most confusing: upstream EntityTypeString
    // lists it by mistake, but Cascade does not accept it as an identifier type.
    expect(EntityTypeSchema.safeParse("xhtmlDataDefinitionBlock").success).toBe(false);
    expect(EntityTypeSchema.safeParse("xsltFormat").success).toBe(false);
    expect(EntityTypeSchema.safeParse("ftpTransport").success).toBe(false);
    expect(EntityTypeSchema.safeParse("wordPressConnector").success).toBe(false);
  });

  test("should reject an unknown type value", () => {
    const res = EntityTypeSchema.safeParse("invalid_type");
    expect(res.success).toBe(false);
  });
});

describe("PathSchema", () => {
  test("should accept the minimum valid path object", () => {
    const res = PathSchema.safeParse({ path: "/foo/bar" });
    expect(res.success).toBe(true);
  });

  test("should accept path with siteName", () => {
    const res = PathSchema.safeParse({ path: "/foo/bar", siteName: "example" });
    expect(res.success).toBe(true);
  });

  test("should reject an empty path string", () => {
    const res = PathSchema.safeParse({ path: "" });
    expect(res.success).toBe(false);
  });
});

describe("IdentifierSchema", () => {
  test("should accept id-only identifier with type", () => {
    const res = IdentifierSchema.safeParse({ id: "abc", type: "page" });
    expect(res.success).toBe(true);
  });

  test("should accept path-only identifier with type", () => {
    const res = IdentifierSchema.safeParse({
      path: { path: "/foo" },
      type: "page",
    });
    expect(res.success).toBe(true);
  });

  test("should reject when both id and path are missing (refinement)", () => {
    const res = IdentifierSchema.safeParse({ type: "page" });
    expect(res.success).toBe(false);
  });

  test("should reject when type is missing", () => {
    const res = IdentifierSchema.safeParse({ id: "abc" });
    expect(res.success).toBe(false);
  });
});

describe("Schema descriptions (MCP client help)", () => {
  test("IdentifierSchema fields have .describe() metadata", () => {
    const shape = IdentifierSchema.shape;
    expect(shape.id.description).toBeTruthy();
    expect(shape.type.description).toBeTruthy();
  });
});
