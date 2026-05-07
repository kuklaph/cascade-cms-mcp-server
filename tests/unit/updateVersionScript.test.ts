import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  updateProjectVersion,
  validateVersion,
} from "../../scripts/update-version.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("update-version script", () => {
  test("updates every project version location", async () => {
    const root = await mkdtemp(join(tmpdir(), "cascade-version-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, ".claude-plugin"));

    await writeJson(join(root, "package.json"), {
      name: "cascade-cms-mcp-server",
      version: "0.1.0",
    });
    await writeFile(
      join(root, "src", "constants.ts"),
      'export const SERVER_VERSION = "0.1.0";\n',
      "utf8",
    );
    await writeJson(join(root, ".claude-plugin", "plugin.json"), {
      name: "cascade-cms",
      version: "0.1.0",
    });
    await writeJson(join(root, ".claude-plugin", "marketplace.json"), {
      metadata: { version: "0.1.0" },
      plugins: [{ name: "cascade-cms", version: "0.1.0" }],
    });

    await updateProjectVersion(root, "1.2.3");

    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const pluginJson = JSON.parse(
      await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const marketplaceJson = JSON.parse(
      await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
    );
    const constants = await readFile(join(root, "src", "constants.ts"), "utf8");

    expect(packageJson.version).toBe("1.2.3");
    expect(pluginJson.version).toBe("1.2.3");
    expect(marketplaceJson.metadata.version).toBe("1.2.3");
    expect(marketplaceJson.plugins[0].version).toBe("1.2.3");
    expect(constants).toContain('SERVER_VERSION = "1.2.3"');
  });

  test("rejects invalid semver input", () => {
    expect(() => validateVersion("1")).toThrow("Expected semver");
    expect(() => validateVersion("1.2")).toThrow("Expected semver");
    expect(() => validateVersion("v1.2.3")).toThrow("Expected semver");
    expect(() => validateVersion("01.2.3")).toThrow("Expected semver");
    expect(() => validateVersion("1.02.3")).toThrow("Expected semver");
    expect(() => validateVersion("1.2.03")).toThrow("Expected semver");
    expect(() => validateVersion("1.2.3-.")).toThrow("Expected semver");
    expect(() => validateVersion("1.2.3-alpha..1")).toThrow(
      "Expected semver",
    );
  });

  test("accepts valid semver prerelease and build metadata", () => {
    expect(validateVersion("1.2.3-alpha.1")).toBe("1.2.3-alpha.1");
    expect(validateVersion("1.2.3+build.7")).toBe("1.2.3+build.7");
    expect(validateVersion("1.2.3-beta.2+build.7")).toBe(
      "1.2.3-beta.2+build.7",
    );
  });
});
