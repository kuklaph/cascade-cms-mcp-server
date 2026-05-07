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
};

const ConfigSchema = z.object({
  CASCADE_API_KEY: z
    .string({ required_error: "CASCADE_API_KEY is required" })
    .min(1, "CASCADE_API_KEY must not be empty"),
  CASCADE_URL: z
    .string({ required_error: "CASCADE_URL is required" })
    .min(1, "CASCADE_URL must not be empty")
    .url("CASCADE_URL must be a valid URL"),
  CASCADE_TIMEOUT_MS: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || /^\d+$/.test(v),
      "CASCADE_TIMEOUT_MS must be a positive integer (milliseconds)",
    ),
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

  const parsed = ConfigSchema.safeParse({
    CASCADE_API_KEY: apiKey,
    CASCADE_URL: url,
    CASCADE_TIMEOUT_MS: timeoutMs,
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
  };
}
