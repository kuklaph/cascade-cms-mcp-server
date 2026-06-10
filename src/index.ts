#!/usr/bin/env node
/**
 * Entry point for the Cascade CMS MCP server.
 *
 * Loads config from env, builds the Cascade client and MCP server,
 * and connects a stdio transport. Logs lifecycle events to stderr
 * (stdout is reserved for the MCP protocol stream).
 */

import { StdioServerTransport } from "@modelcontextprotocol/server";
import { loadConfig } from "./config.js";
import { createCascadeClient } from "./client.js";
import { createBrowserSession } from "./browserApi.js";
import { redactSecrets } from "./errors.js";
import { createServer } from "./server.js";
import { SERVER_NAME } from "./constants.js";

async function main(): Promise<void> {
  // Guard: some dependencies (including cascade-cms-api on timeout) call
  // console.log. On Node/Bun that writes to stdout, which would corrupt
  // the MCP JSON-RPC stream served over stdio. Route all console output
  // to stderr before the first tool invocation.
  const stderrWrite = (...args: unknown[]): void => {
    process.stderr.write(args.map((a) => String(a)).join(" ") + "\n");
  };
  console.log = stderrWrite;
  console.info = stderrWrite;
  console.warn = stderrWrite;
  console.debug = stderrWrite;

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
    process.exit(1);
  }

  const client = createCascadeClient(config);
  const browserSession = createBrowserSession(config);
  if (config.browserUsername && config.browserPassword && config.browserSiteId) {
    try {
      await browserSession.login({});
      process.stderr.write(
        `[${SERVER_NAME}] browser login succeeded for site_id=${config.browserSiteId}\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${SERVER_NAME}] browser login skipped: ${redactSecrets(msg)}\n`,
      );
    }
  } else if (config.browserUsername && config.browserPassword) {
    process.stderr.write(
      `[${SERVER_NAME}] browser login skipped: set CASCADE_BROWSER_SITE_ID to the production site ID to enable startup browser login\n`,
    );
  }
  const server = createServer(client, {
    browserSession,
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.stderr.write(`[${SERVER_NAME}] started on stdio\n`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`[${SERVER_NAME}] fatal: ${err}\n`);
  process.exit(1);
});
