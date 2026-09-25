import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureHost } from "./helpers.mjs";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "http.mjs");

test("the process starts from the environment with a memory meter and a fake model, and answers", async () => {
  const fixture = await startFixtureHost();
  after(() => fixture.close());
  const env = { ...process.env, CHAT_MCP_URL: fixture.url, CHAT_ORIGINS: "https://site.test", CHAT_MONTH_TOKENS: "1000000", CHAT_PROJECT: "p", CHAT_REGION: "eu", CHAT_METER: "memory", PORT: "0" };
  const child = spawn(process.execPath, [bin, "--model", "fake"], { env });
  after(() => child.kill());
  const line = await new Promise((resolve) => child.stdout.on("data", (d) => { for (const l of String(d).split("\n")) if (l.includes("chat.start")) { const j = JSON.parse(l); assert.equal(j.severity, "INFO"); assert.match(j.message, /companygraph-chat-http on :/); resolve(String(j.port)); } }));
  const r = await fetch(`http://127.0.0.1:${line}/chat`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mcp_url, fixture.url);
});

test("a missing variable is one line on stderr and exit 2", async () => {
  const child = spawn(process.execPath, [bin], { env: { PATH: process.env.PATH } });
  const err = await new Promise((resolve) => { let s = ""; child.stderr.on("data", (d) => { s += d; }); child.on("exit", () => resolve(s)); });
  assert.match(err, /CHAT_MCP_URL is not set/);
  assert.ok(!err.includes("    at "), "no stack");
  assert.equal(child.exitCode, 2);
});
