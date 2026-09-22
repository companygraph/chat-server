// chat.json names an MCP host on the deployment's own domain and at least one page origin, and
// the ceiling is a whole number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, chat } from "../build/config.mjs";

export function registerConfigTests() {
  const c = chat();
  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));

  test("chat.json names its domain, its site, the host it reads, its origins and its ceiling", () => {
    for (const k of ["domain", "site_id", "mcp_url", "origins", "month_tokens"]) assert.ok(k in c, `chat.json has ${k}`);
    assert.ok(Array.isArray(c.origins) && c.origins.length > 0);
    for (const o of c.origins) assert.match(o, /^https:\/\/[^/]+$/, `${o} is an origin, scheme and host only`);
    assert.ok(Number.isInteger(c.month_tokens) && c.month_tokens > 0);
  });

  test("the host it reads is this deployment's own, and the chat's site is not the host's site", () => {
    assert.equal(new URL(c.mcp_url).host, deployment.domain);
    assert.equal(new URL(c.mcp_url).pathname, "/mcp");
    assert.notEqual(c.site_id, deployment.site_id, "two Hosting sites in one project must differ, or the chat's apply takes the host's site");
  });
}
