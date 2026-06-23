import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { EntityTypeSchema } from "./schemas/common.js";

type EntityType = z.infer<typeof EntityTypeSchema>;

const SelectorSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export const ToolBlockRuleSchema = z
  .object({
    type: EntityTypeSchema.optional(),
    id: SelectorSchema.optional(),
    path: SelectorSchema.optional(),
    url: SelectorSchema.optional(),
    tools: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if ((rule.id || rule.path) && !rule.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "type is required when id or path is used",
        path: ["type"],
      });
    }
    if (!rule.id && !rule.path && !rule.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "one of id, path, or url is required",
      });
    }
    if (rule.url) {
      for (const url of selectors(rule.url)) {
        if (!parseCascadeUrlSelector(url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "url must be an https Cascade CMS asset URL at /entity/open.act with id and type",
            path: ["url"],
          });
        }
      }
    }
  });

export const ToolBlockRulesSchema = z.array(ToolBlockRuleSchema);

export type ToolBlockRule = z.infer<typeof ToolBlockRuleSchema>;

export type ToolBlockStore = {
  path: string;
  read: () => Promise<ToolBlockRule[]>;
  write: (rules: ToolBlockRule[]) => Promise<void>;
};

const toolBlockUpdateQueues = new WeakMap<ToolBlockStore, Promise<void>>();

export function defaultToolBlockFile(): string {
  return join(homedir(), ".cascade-cms-mcp-server", "tool-blocks.json");
}

export function createToolBlockStore(
  filePath: string = defaultToolBlockFile(),
): ToolBlockStore {
  return {
    path: filePath,
    read: async () => readRulesFile(filePath),
    write: async (rules) => writeRulesFile(filePath, rules),
  };
}

export function parseToolBlockRules(value: unknown): ToolBlockRule[] {
  const parsed = ToolBlockRulesSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.length ? ` at ${first.path.join(".")}` : "";
    const reason = first?.message ?? "invalid rule";
    throw new Error(`Tool block repository is invalid${path}: ${reason}`);
  }

  return parsed.data;
}

export async function updateToolBlockRules(
  store: ToolBlockStore,
  updater: (
    current: readonly ToolBlockRule[],
  ) => ToolBlockRule[] | Promise<ToolBlockRule[]>,
): Promise<ToolBlockRule[]> {
  const previous = toolBlockUpdateQueues.get(store) ?? Promise.resolve();
  const nextUpdate = previous.catch(() => undefined).then(async () => {
    const current = parseToolBlockRules(await store.read());
    const next = parseToolBlockRules(await updater(current));
    await store.write(next);
    return next;
  });
  toolBlockUpdateQueues.set(
    store,
    nextUpdate.then(
      () => undefined,
      () => undefined,
    ),
  );
  return nextUpdate;
}

export function findDeniedToolCall(
  tool: string,
  input: unknown,
  rules: readonly ToolBlockRule[] | undefined,
): ToolBlockRule | undefined {
  if (!rules?.length) return undefined;
  return rules.find((rule) => ruleToolsInclude(rule, tool) && inputMatchesRule(input, rule));
}

export function shouldCheckToolBlocks(tool: string): boolean {
  return (
    tool !== "tool_blocks" &&
    tool !== "read_response" &&
    !tool.startsWith("asset_")
  );
}

export function describeToolBlockRule(rule: ToolBlockRule): string {
  if (rule.type) return rule.type;
  const firstUrl = rule.url ? selectors(rule.url)[0] : undefined;
  const parsed = firstUrl ? parseCascadeUrlSelector(firstUrl) : null;
  return parsed?.type ?? "asset";
}

async function readRulesFile(filePath: string): Promise<ToolBlockRule[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return [];
    throw err;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`Tool block repository ${filePath} must be valid JSON`);
  }

  return parseToolBlockRules(parsedJson);
}

async function writeRulesFile(
  filePath: string,
  rules: ToolBlockRule[],
): Promise<void> {
  const parsed = parseToolBlockRules(rules);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function inputMatchesRule(input: unknown, rule: ToolBlockRule): boolean {
  if (!isRecord(input)) return false;

  const stack: Array<{ value: unknown; impliedType?: string }> = [{ value: input }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { value, impliedType } = current;
    if (isRecord(value)) {
      if (objectMatchesRule(value, rule, impliedType)) return true;
      for (const [key, child] of Object.entries(value)) {
        stack.push({
          value: child,
          impliedType: isRecord(child) || Array.isArray(child) ? key : undefined,
        });
      }
    } else if (Array.isArray(value)) {
      stack.push(...value.map((child) => ({ value: child, impliedType })));
    }
  }

  return false;
}

function objectMatchesRule(
  obj: Record<string, unknown>,
  rule: ToolBlockRule,
  impliedType: string | undefined,
): boolean {
  if (rule.url && urlMatches(obj, impliedType, rule.url)) {
    return true;
  }

  if (rule.type && objectTypeMatches(rule.type, obj, impliedType)) {
    if (rule.id && selectorIncludes(rule.id, obj.id)) return true;
    if (rule.path && objectPathMatches(obj, rule.path)) return true;
  }

  return false;
}

function objectPathMatches(
  obj: Record<string, unknown>,
  expected: string | string[],
): boolean {
  if (pathMatches(obj.path, expected)) return true;
  const targetPath = createTargetPath(obj);
  return targetPath ? selectorIncludes(expected, targetPath) : false;
}

function objectTypeMatches(
  expected: string,
  obj: Record<string, unknown>,
  impliedType: string | undefined,
): boolean {
  return typeMatches(expected, obj.type) || typeMatches(expected, impliedType);
}

function typeMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  if (actual === expected) return true;
  if (typeAliases(expected).includes(actual)) return true;
  if (actual === "format" && isFormatType(expected)) return true;
  if (actual === "transport" && isTransportType(expected)) return true;
  if (actual === "block" && isBlockType(expected)) return true;
  if (expected === "format" && isFormatType(actual)) return true;
  if (expected === "transport" && isTransportType(actual)) return true;
  return expected === "block" && isBlockType(actual);
}

function typeAliases(expected: string): string[] {
  switch (expected) {
    case "assetfactory":
      return ["assetFactory"];
    case "assetfactorycontainer":
      return ["assetFactoryContainer"];
    case "block_FEED":
      return ["feedBlock"];
    case "block_INDEX":
      return ["indexBlock"];
    case "block_TEXT":
      return ["textBlock"];
    case "block_TWITTER_FEED":
      return ["twitterFeedBlock"];
    case "block_XHTML_DATADEFINITION":
      return ["xhtmlDataDefinitionBlock"];
    case "block_XML":
      return ["xmlBlock"];
    case "contenttype":
      return ["contentType"];
    case "contenttypecontainer":
      return ["contentTypeContainer"];
    case "connectorcontainer":
      return ["connectorContainer"];
    case "datadefinition":
      return ["dataDefinition"];
    case "datadefinitioncontainer":
      return ["dataDefinitionContainer"];
    case "editorconfiguration":
      return ["editorConfiguration"];
    case "facebookconnector":
      return ["facebookConnector"];
    case "format_SCRIPT":
      return ["scriptFormat"];
    case "format_XSLT":
      return ["xsltFormat"];
    case "googleanalyticsconnector":
      return ["googleAnalyticsConnector"];
    case "metadataset":
      return ["metadataSet"];
    case "metadatasetcontainer":
      return ["metadataSetContainer"];
    case "pageconfiguration":
      return ["pageConfiguration", "pageConfigurations"];
    case "pageconfigurationset":
      return ["pageConfigurationSet"];
    case "pageconfigurationsetcontainer":
      return ["pageConfigurationSetContainer"];
    case "pageregion":
      return ["pageRegion", "pageRegions"];
    case "publishset":
      return ["publishSet"];
    case "publishsetcontainer":
      return ["publishSetContainer"];
    case "sharedfield":
      return ["sharedField"];
    case "sharedfieldcontainer":
      return ["sharedFieldContainer"];
    case "sitedestinationcontainer":
      return ["siteDestinationContainer"];
    case "transport_cloud":
      return ["cloudTransport"];
    case "transport_db":
      return ["databaseTransport"];
    case "transport_ftp":
      return ["ftpTransport"];
    case "transport_fs":
      return ["fileSystemTransport"];
    case "transportcontainer":
      return ["transportContainer"];
    case "twitterconnector":
      return ["twitterConnector"];
    case "workflowdefinition":
      return ["workflowDefinition"];
    case "workflowdefinitioncontainer":
      return ["workflowDefinitionContainer"];
    case "workflowemail":
      return ["workflowEmail"];
    case "workflowemailcontainer":
      return ["workflowEmailContainer"];
    case "wordpressconnector":
      return ["wordPressConnector"];
    default:
      return [];
  }
}

function isBlockType(value: string): boolean {
  return (
    value === "block" ||
    value.startsWith("block_") ||
    value.endsWith("Block") ||
    value === "xhtmlDataDefinitionBlock"
  );
}

function isFormatType(value: string): boolean {
  return (
    value === "format" ||
    value === "format_XSLT" ||
    value === "format_SCRIPT" ||
    value === "xsltFormat" ||
    value === "scriptFormat"
  );
}

function isTransportType(value: string): boolean {
  return (
    value === "transport" ||
    value === "transport_fs" ||
    value === "transport_ftp" ||
    value === "transport_db" ||
    value === "transport_cloud" ||
    value === "fileSystemTransport" ||
    value === "ftpTransport" ||
    value === "databaseTransport" ||
    value === "cloudTransport"
  );
}

function pathMatches(value: unknown, expected: string | string[]): boolean {
  if (selectorIncludes(expected, value)) return true;
  return isRecord(value) && selectorIncludes(expected, value.path);
}

function createTargetPath(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.name !== "string") return undefined;
  const parentPath =
    typeof obj.parentFolderPath === "string"
      ? obj.parentFolderPath
      : typeof obj.parentContainerPath === "string"
        ? obj.parentContainerPath
        : undefined;
  if (!parentPath) return undefined;
  const parent = parentPath.endsWith("/") && parentPath !== "/"
    ? parentPath.slice(0, -1)
    : parentPath;
  return parent === "/" ? `/${obj.name}` : `${parent}/${obj.name}`;
}

function urlMatches(
  obj: Record<string, unknown>,
  impliedType: string | undefined,
  expected: string | string[],
): boolean {
  const selectors = Array.isArray(expected) ? expected : [expected];
  return selectors.some((url) => cascadeUrlMatchesObject(url, obj, impliedType));
}

function selectorIncludes(expected: string | string[], value: unknown): boolean {
  if (typeof value !== "string") return false;
  return Array.isArray(expected) ? expected.includes(value) : expected === value;
}

function cascadeUrlMatchesObject(
  url: string,
  obj: Record<string, unknown>,
  impliedType: string | undefined,
): boolean {
  const selector = parseCascadeUrlSelector(url);
  if (!selector) return false;
  if (!objectTypeMatches(selector.type, obj, impliedType)) return false;
  return obj.id === selector.id;
}

function parseCascadeUrlSelector(
  url: string,
): { id: string; type: EntityType } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".cascadecms.com") ||
    parsed.pathname !== "/entity/open.act"
  ) {
    return null;
  }

  const id = parsed.searchParams.get("id") ?? "";
  const type = parsed.searchParams.get("type") ?? "";
  const parsedType = EntityTypeSchema.safeParse(type);

  return id && parsedType.success ? { id, type: parsedType.data } : null;
}

function selectors(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function ruleToolsInclude(rule: ToolBlockRule, tool: string): boolean {
  return rule.tools.some((candidate) => normalizeToolName(candidate) === tool);
}

function normalizeToolName(tool: string): string {
  if (tool.startsWith("cascade_draft_")) {
    return `local_draft_${tool.slice("cascade_draft_".length)}`;
  }
  if (tool.startsWith("cascade_")) {
    return tool.slice("cascade_".length);
  }
  return tool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
