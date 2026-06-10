/**
 * Configuration loader for the Cascade CMS MCP server.
 *
 * Reads and validates environment variables. Throws descriptive errors
 * when required variables are missing or invalid. Never leaks secret
 * values in error messages.
 *
 * Values prefixed with `enc:` are decrypted via `dotseal`. The dependency
 * is imported lazily — only loaded when at least one env value is encrypted.
 */

import { z } from "zod";
import { DEFAULT_TIMEOUT_MS } from "./constants.js";

export type Config = {
  apiKey: string;
  url: string;
  timeoutMs: number;
  browserUsername?: string;
  browserPassword?: string;
  browserUrl?: string;
  browserSiteId?: string;
};

const ConfigSchema = z.object({
  CASCADE_API_KEY: z
    .string("CASCADE_API_KEY is required")
    .min(1, "CASCADE_API_KEY must not be empty"),
  CASCADE_URL: z
    .string("CASCADE_URL is required")
    .min(1, "CASCADE_URL must not be empty")
    .url("CASCADE_URL must be a valid URL"),
  CASCADE_TIMEOUT_MS: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || /^\d+$/.test(v),
      "CASCADE_TIMEOUT_MS must be a positive integer (milliseconds)",
    ),
  CASCADE_BROWSER_USERNAME: z
    .string()
    .min(1, "CASCADE_BROWSER_USERNAME must not be empty")
    .optional(),
  CASCADE_BROWSER_PASSWORD: z
    .string()
    .min(1, "CASCADE_BROWSER_PASSWORD must not be empty")
    .optional(),
  CASCADE_BROWSER_URL: z
    .string()
    .url("CASCADE_BROWSER_URL must be a valid URL")
    .optional(),
  CASCADE_BROWSER_SITE_ID: z
    .string()
    .min(1, "CASCADE_BROWSER_SITE_ID must not be empty")
    .optional(),
}).superRefine((data, ctx) => {
  if (!!data.CASCADE_BROWSER_USERNAME === !!data.CASCADE_BROWSER_PASSWORD) return;
  const missing = data.CASCADE_BROWSER_USERNAME
    ? "CASCADE_BROWSER_PASSWORD"
    : "CASCADE_BROWSER_USERNAME";
  ctx.addIssue({
    code: "custom",
    path: [missing],
    message: `${missing} is required when browser login credentials are configured`,
  });
});

type dotsealModule = {
  decrypt: (encrypted: string) => string;
};

async function loaddotseal(): Promise<dotsealModule> {
  try {
    return (await import("dotseal")) as dotsealModule;
  } catch {
    throw new Error(
      "Encrypted env value detected (enc:...) but the 'dotseal' dependency is not installed. " +
      "Reinstall cascade-cms-mcp-server so its dependencies are present.",
    );
  }
}

async function decryptIfNeeded(
  fieldName: string,
  value: string | undefined,
  dotseal: dotsealModule | null,
): Promise<{ value: string | undefined; dotseal: dotsealModule | null }> {
  if (value === undefined) return { value, dotseal };
  if (!value.startsWith("enc:")) return { value, dotseal };

  const mod = dotseal ?? (await loaddotseal());

  try {
    return { value: mod.decrypt(value), dotseal: mod };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "decryption failed";
    throw new Error(`Failed to decrypt ${fieldName}: ${reason}`);
  }
}


/**
 * Load and validate server configuration from environment variables.
 *
 * Values beginning with `enc:` are decrypted via dotseal. If any
 * encrypted value is present and dotseal cannot be loaded, an actionable
 * error is thrown.
 *
 * @throws Error with an actionable message naming the missing/invalid
 *   variable. Secret values (API keys, ciphertexts) are never included
 *   in the message.
 */
export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  let dotseal: dotsealModule | null = null;
  let apiKey: string | undefined;
  let url: string | undefined;
  let timeoutMs: string | undefined;
  let browserUsername: string | undefined;
  let browserPassword: string | undefined;
  let browserUrl: string | undefined;
  let browserSiteId: string | undefined;

  ({ value: apiKey, dotseal } = await decryptIfNeeded(
    "CASCADE_API_KEY",
    env.CASCADE_API_KEY,
    dotseal,
  ));
  ({ value: url, dotseal } = await decryptIfNeeded(
    "CASCADE_URL",
    env.CASCADE_URL,
    dotseal,
  ));
  ({ value: timeoutMs, dotseal } = await decryptIfNeeded(
    "CASCADE_TIMEOUT_MS",
    env.CASCADE_TIMEOUT_MS,
    dotseal,
  ));
  ({ value: browserUsername, dotseal } = await decryptIfNeeded(
    "CASCADE_BROWSER_USERNAME",
    env.CASCADE_BROWSER_USERNAME,
    dotseal,
  ));
  ({ value: browserPassword, dotseal } = await decryptIfNeeded(
    "CASCADE_BROWSER_PASSWORD",
    env.CASCADE_BROWSER_PASSWORD,
    dotseal,
  ));
  ({ value: browserUrl, dotseal } = await decryptIfNeeded(
    "CASCADE_BROWSER_URL",
    env.CASCADE_BROWSER_URL,
    dotseal,
  ));
  ({ value: browserSiteId, dotseal } = await decryptIfNeeded(
    "CASCADE_BROWSER_SITE_ID",
    env.CASCADE_BROWSER_SITE_ID,
    dotseal,
  ));

  const parsed = ConfigSchema.safeParse({
    CASCADE_API_KEY: apiKey,
    CASCADE_URL: url,
    CASCADE_TIMEOUT_MS: timeoutMs,
    CASCADE_BROWSER_USERNAME: browserUsername,
    CASCADE_BROWSER_PASSWORD: browserPassword,
    CASCADE_BROWSER_URL: browserUrl,
    CASCADE_BROWSER_SITE_ID: browserSiteId,
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path[0] ?? "configuration";
    const reason = first?.message ?? "invalid value";
    // Do NOT include the value — only the field name and reason.
    throw new Error(`Invalid configuration: ${String(field)} — ${reason}`);
  }

  const data = parsed.data;

  return {
    apiKey: data.CASCADE_API_KEY,
    url: data.CASCADE_URL,
    timeoutMs: data.CASCADE_TIMEOUT_MS
      ? Number(data.CASCADE_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS,
    ...(data.CASCADE_BROWSER_USERNAME
      ? { browserUsername: data.CASCADE_BROWSER_USERNAME }
      : {}),
    ...(data.CASCADE_BROWSER_PASSWORD
      ? { browserPassword: data.CASCADE_BROWSER_PASSWORD }
      : {}),
    ...(data.CASCADE_BROWSER_URL
      ? { browserUrl: data.CASCADE_BROWSER_URL }
      : {}),
    ...(data.CASCADE_BROWSER_SITE_ID
      ? { browserSiteId: data.CASCADE_BROWSER_SITE_ID }
      : {}),
  };
}
