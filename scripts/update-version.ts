import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const VERSION_FILES = [
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

export function validateVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("Expected semver like 1.2.3");
  }
  return version;
}

function replaceOrThrow(
  source: string,
  pattern: RegExp,
  replacement: string,
  label: string,
): string {
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label}`);
  }
  return source.replace(pattern, replacement);
}

async function replaceInFile(
  root: string,
  relativePath: string,
  pattern: RegExp,
  replacement: string,
  label: string,
): Promise<void> {
  const path = resolve(root, relativePath);
  const source = await readFile(path, "utf8");
  const updated = replaceOrThrow(source, pattern, replacement, label);
  await writeFile(path, updated, "utf8");
}

export async function updateProjectVersion(
  root: string,
  version: string,
): Promise<void> {
  const nextVersion = validateVersion(version);

  for (const relativePath of VERSION_FILES) {
    await replaceInFile(
      root,
      relativePath,
      /("version"\s*:\s*")[^"]+(")/g,
      `$1${nextVersion}$2`,
      `${relativePath} version`,
    );
  }

  await replaceInFile(
    root,
    "src/constants.ts",
    /(SERVER_VERSION\s*=\s*")[^"]+(")/,
    `$1${nextVersion}$2`,
    "src/constants.ts SERVER_VERSION",
  );
}

async function main(): Promise<void> {
  const version = process.argv[2];
  if (!version) {
    throw new Error("Usage: bun scripts/update-version.ts <version>");
  }
  await updateProjectVersion(process.cwd(), version);
  console.error(`Updated project version to ${version}`);
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  });
}
