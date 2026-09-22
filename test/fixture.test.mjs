import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startFixtureHost, EXAMPLE_ROOT, COMMIT } from "./helpers.mjs";

test("the fixture host is a real MCP host over the worked example", async () => {
  const host = await startFixtureHost();
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(host.url)));
  assert.equal(client.getServerVersion().title, EXAMPLE_ROOT);
  const r = await client.callTool({ name: "list_types", arguments: {} });
  assert.equal(r.structuredContent.model.commit, COMMIT);
  await client.close();
  await host.close();
});
