import { describe, test, expect } from "bun:test";
import { translateError } from "../../src/errors.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

/** Narrow the first content block to a text block (TS-safe accessor). */
function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be of type 'text'");
  }
  return block.text;
}

describe("translateError", () => {
  const opName = "read";

  test("should strip 'Request Failed. Request Response: ' prefix and surface clean Cascade message", () => {
    const err = new Error("Request Failed. Request Response: Asset not found");

    const result = translateError(err, opName);

    const text = firstText(result);
    expect(text).toContain("Asset not found");
    expect(text).not.toContain("Request Failed. Request Response: ");
  });

  test("should translate 'Request timed out' Error into actionable timeout message mentioning CASCADE_TIMEOUT_MS and opName", () => {
    const err = new Error("Request timed out");

    const result = translateError(err, opName);

    const text = firstText(result);
    expect(text).toContain("timed out");
    expect(text).toContain("CASCADE_TIMEOUT_MS");
    expect(text).toContain(opName);
  });

  test("should translate 'Missing API key or cascade URL' into configuration error mentioning both env var names", () => {
    const err = new Error("Missing API key or cascade URL");

    const result = translateError(err, opName);

    const text = firstText(result);
    expect(text).toContain("Configuration");
    expect(text).toContain("CASCADE_API_KEY");
    expect(text).toContain("CASCADE_URL");
  });

  test("should translate a generic Error into '<opName> failed: <err.message>'", () => {
    const err = new Error("some random failure");

    const result = translateError(err, opName);

    const text = firstText(result);
    expect(text).toContain("some random failure");
    expect(text).toContain(opName);
  });

  test("should handle string input by including it verbatim with opName", () => {
    const result = translateError("network down", opName);

    const text = firstText(result);
    expect(text).toContain("network down");
    expect(text).toContain(opName);
  });

  test("should handle undefined input gracefully and return a valid error result", () => {
    const result = translateError(undefined, opName);

    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(firstText(result).length).toBeGreaterThan(0);
    expect(firstText(result)).toContain(opName);
  });

  test("should handle object input with a string representation and not crash", () => {
    const result = translateError({ foo: "bar" }, opName);

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain(opName);
  });

  test("should set isError to true for every kind of input", () => {
    const cases: unknown[] = [
      new Error("x"),
      new Error("Request timed out"),
      new Error("Missing API key or cascade URL"),
      "string err",
      undefined,
      null,
      { foo: "bar" },
    ];

    for (const c of cases) {
      const r = translateError(c, opName);
      expect(r.isError).toBe(true);
    }
  });

  test("should return exactly one content entry with type 'text' for every input", () => {
    const cases: unknown[] = [
      new Error("x"),
      "hello",
      undefined,
      null,
      { a: 1 },
    ];

    for (const c of cases) {
      const r = translateError(c, opName);
      expect(r.content).toHaveLength(1);
      expect(r.content[0]!.type).toBe("text");
    }
  });

  test("should redact anything resembling an API key pattern so secrets cannot leak", () => {
    const err = new Error(
      "Request Failed. Request Response: API key=sk-abc123 invalid",
    );

    const result = translateError(err, opName);

    const text = firstText(result);
    expect(text).not.toContain("sk-abc123");
  });
});
