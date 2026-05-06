/**
 * Configuration loader for the Cascade CMS MCP server.
 *
 * Reads and validates environment variables. Throws descriptive errors
 * when required variables are missing or invalid. Never leaks secret
 * values in error messages.
 *
 * Values prefixed with `enc:` are decrypted via the optional `envlock`
 * peer dependency. envlock is imported lazily — only loaded when at
 * least one env value is encrypted.
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

type EnvlockModule = {
  decrypt: (encrypted: string) => string;
};

async function loadEnvlock(): Promise<EnvlockModule> {
  try {
    return (await import("envlock")) as EnvlockModule;
  } catch {
    throw new Error(
      "Encrypted env value detected (enc:...) but the 'envlock' peer dependency is not installed. " +
      "Install it: `bun add envlock` (or `npm install envlock`).",
    );
  }
}

async function decryptIfNeeded(
  fieldName: string,
  value: string | undefined,
  envlock: EnvlockModule | null,
): Promise<{ value: string | undefined; envlock: EnvlockModule | null }> {
  if (value === undefined) return { value, envlock };
  if (!value.startsWith("enc:")) return { value, envlock };

  const mod = envlock ?? (await loadEnvlock());

  try {
    return { value: mod.decrypt(value), envlock: mod };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "decryption failed";
    throw new Error(`Failed to decrypt ${fieldName}: ${reason}`);
  }
}


/**
 * Load and validate server configuration from environment variables.
 *
 * Values beginning with `enc:` are decrypted via envlock. If any
 * encrypted value is present and envlock is not installed, an
 * actionable error is thrown.
 *
 * @throws Error with an actionable message naming the missing/invalid
 *   variable. Secret values (API keys, ciphertexts) are never included
 *   in the message.
 */
export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  let envlock: EnvlockModule | null = null;
  let apiKey: string | undefined;
  let url: string | undefined;
  let timeoutMs: string | undefined;

  ({ value: apiKey, envlock } = await decryptIfNeeded(
    "CASCADE_API_KEY",
    env.CASCADE_API_KEY,
    envlock,
  ));
  ({ value: url, envlock } = await decryptIfNeeded(
    "CASCADE_URL",
    env.CASCADE_URL,
    envlock,
  ));
  ({ value: timeoutMs, envlock } = await decryptIfNeeded(
    "CASCADE_TIMEOUT_MS",
    env.CASCADE_TIMEOUT_MS,
    envlock,
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
