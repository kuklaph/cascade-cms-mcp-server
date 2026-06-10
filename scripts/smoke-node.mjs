#!/usr/bin/env node
/**
 * Node-runtime smoke test for the compiled dist/index.js.
 *
 * Spawns `node dist/index.js` with dummy credentials, completes MCP
 * initialization over stdio, then verifies basic protocol requests that do not
 * require live Cascade access.
 */

import { spawn } from "node:child_process";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";

const TIMEOUT_MS = 8000;
const EXPECTED_BANNER = "started on stdio";

const child = spawn("node", ["dist/index.js"], {
  env: {
    ...process.env,
    CASCADE_API_KEY: "smoke-test-key",
    CASCADE_URL: "https://smoke-test.invalid/api/v1/",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = "";
let stderrText = "";
let gotBanner = false;
let finished = false;
let nextId = 1;
const pending = new Map();

const timer = setTimeout(() => {
  fail(
    `timed out after ${TIMEOUT_MS}ms. Captured stderr: ${stderrText.slice(0, 500)}`,
  );
}, TIMEOUT_MS);

child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString("utf8");
  drainStdout();
});

child.stderr.on("data", (chunk) => {
  stderrText += chunk.toString("utf8");
  if (stderrText.includes(EXPECTED_BANNER)) gotBanner = true;
});

child.stdin.on("error", (error) => {
  if (!finished) fail(`stdin error: ${error.message}`);
});

child.on("error", (error) => {
  fail(`spawn error: ${error.message}`);
});

child.on("exit", (code, signal) => {
  if (finished) return;
  fail(`server exited before smoke completed: code=${code} signal=${signal}`);
});

sendRequest("initialize", {
  protocolVersion: LATEST_PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "cascade-cms-mcp-server-smoke", version: "0.0.0" },
}).then((result) => {
  assert(result && typeof result === "object", "initialize returned an object");
  assert(typeof result.protocolVersion === "string", "initialize returned protocolVersion");
  sendNotification("notifications/initialized");
  return Promise.all([
    sendRequest("tools/list", {}).then(assertToolsList),
    sendRequest("resources/list", {}).then(assertResourcesList),
    sendRequest("resources/templates/list", {}).then(assertResourceTemplatesList),
    sendRequest("resources/read", { uri: "cascade://entity-types" }).then(
      assertEntityTypesResource,
    ),
  ]);
}).then(() => {
  assert(gotBanner, `stderr included "${EXPECTED_BANNER}"`);
  finished = true;
  clearTimeout(timer);
  console.log("[smoke] PASS: node dist/index.js completed MCP stdio checks");
  child.kill("SIGINT");
}).catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

function sendRequest(method, params) {
  const id = nextId++;
  writeMessage({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { method, resolve, reject });
  });
}

function sendNotification(method, params = {}) {
  writeMessage({ jsonrpc: "2.0", method, params });
}

function writeMessage(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function drainStdout() {
  let newlineIndex = stdoutBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    if (line) handleStdoutLine(line);
    newlineIndex = stdoutBuffer.indexOf("\n");
  }
}

function handleStdoutLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(`stdout line was not JSON: ${line.slice(0, 200)}`);
    return;
  }

  if (!Object.hasOwn(message, "id")) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);

  if (message.error) {
    entry.reject(
      new Error(`${entry.method} returned error: ${JSON.stringify(message.error)}`),
    );
    return;
  }

  entry.resolve(message.result);
}

function assertToolsList(result) {
  assert(Array.isArray(result?.tools), "tools/list returned tools array");
  assert(
    result.tools.some((tool) => tool.name === "cascade_server_version"),
    "tools/list included cascade_server_version",
  );
}

function assertResourcesList(result) {
  assert(Array.isArray(result?.resources), "resources/list returned resources array");
  assert(
    result.resources.some((resource) => resource.uri === "cascade://entity-types"),
    "resources/list included cascade://entity-types",
  );
}

function assertResourceTemplatesList(result) {
  assert(
    Array.isArray(result?.resourceTemplates),
    "resources/templates/list returned resourceTemplates array",
  );
  assert(
    result.resourceTemplates.some((template) =>
      String(template.uriTemplate).includes("cascade://asset/{handle}/raw"),
    ),
    "resources/templates/list included asset raw template",
  );
}

function assertEntityTypesResource(result) {
  assert(Array.isArray(result?.contents), "resources/read returned contents array");
  const first = result.contents[0];
  assert(first?.uri === "cascade://entity-types", "resources/read returned entity-types");
  assert(typeof first.text === "string", "entity-types content was text");
  const body = JSON.parse(first.text);
  assert(Array.isArray(body.entityTypes), "entity-types body contained entityTypes");
  assert(body.entityTypes.some((entry) => entry.type === "page"), "entity-types included page");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fail(message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.error(`[smoke] FAIL: ${message}`);
  child.kill("SIGKILL");
  process.exit(1);
}
