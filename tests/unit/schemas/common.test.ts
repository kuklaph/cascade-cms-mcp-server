import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EntityTypeSchema,
  PathSchema,
  IdentifierSchema,
} from "../../../src/schemas/common.js";
import { EntityTypeStringSchema } from "../../../src/schemas/assets/enums.js";

function entityTypeStringsFromTypes(): string[] {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(/export type EntityTypeString =([\s\S]*?);/);
  if (!match) throw new Error("EntityTypeString union not found");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

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
    // `xhtmlDataDefinitionBlock` is an asset envelope key, not an identifier type.
    expect(EntityTypeSchema.safeParse("xhtmlDataDefinitionBlock").success).toBe(false);
    expect(EntityTypeSchema.safeParse("xsltFormat").success).toBe(false);
    expect(EntityTypeSchema.safeParse("ftpTransport").success).toBe(false);
    expect(EntityTypeSchema.safeParse("wordPressConnector").success).toBe(false);
  });

  test("should reject an unknown type value", () => {
    const res = EntityTypeSchema.safeParse("invalid_type");
    expect(res.success).toBe(false);
  });

  test("matches cascade-cms-api EntityTypeString literals", () => {
    const expected = entityTypeStringsFromTypes();
    const entityTypeOptions: string[] = [...EntityTypeSchema.options].sort();
    const entityTypeStringOptions: string[] = [
      ...EntityTypeStringSchema.options,
    ].sort();

    expect(entityTypeOptions).toEqual(expected);
    expect(entityTypeStringOptions).toEqual(expected);
    expect(expected).not.toContain("target");
    expect(expected).not.toContain("xhtmlDataDefinitionBlock");
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

  test("should reject unknown path fields", () => {
    const res = PathSchema.safeParse({ path: "/foo/bar", extra: true });
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

  test("should reject bare string paths on identifiers", () => {
    const res = IdentifierSchema.safeParse({
      path: "/foo",
      type: "page",
    });
    expect(res.success).toBe(false);
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
    const options = (IdentifierSchema as any).options;
    expect(options[0].shape.id.description).toBeTruthy();
    expect(options[0].shape.type.description).toBeTruthy();
  });
});
