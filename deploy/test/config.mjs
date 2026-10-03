// chat.json names what its platform needs, an MCP host on the deployment's own domain and at
// least one page origin, and the ceiling is a whole number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, chat, chatProblems, platformOf } from "../build/config.mjs";

export function registerConfigTests() {
  const c = chat();
  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));
  const platform = platformOf(deployment);

  test("chat.json names what a chat on its platform needs, and nothing of the other platform", () => {
    assert.deepEqual(chatProblems(c, platform), []);
    assert.ok(Array.isArray(c.origins) && c.origins.length > 0);
    for (const o of c.origins) assert.match(o, /^https:\/\/[^/]+$/, `${o} is an origin, scheme and host only`);
    assert.ok(Number.isInteger(c.month_tokens) && c.month_tokens > 0);
  });

  test("the host it reads is this deployment's own", () => {
    assert.equal(new URL(c.mcp_url).host, deployment.domain);
    assert.equal(new URL(c.mcp_url).pathname, "/mcp");
    if (platform === "google") assert.notEqual(c.site_id, deployment.site_id, "two Hosting sites in one project must differ, or the chat's apply takes the host's site");
  });
}
