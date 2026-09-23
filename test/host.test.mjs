import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "companygraph-mcp-server/http";
import { connectHost } from "../lib/host.mjs";
import { startFixtureHost, exampleSnapshot, COMMIT, EXAMPLE_ROOT } from "./helpers.mjs";

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

test("the handshake gives the instructions, the tools in the model's shape, and where the model is", () => {
  assert.match(host.instructions, /Terms the tools use/);
  assert.match(host.instructions, /adds nothing/);
  assert.equal(host.title, EXAMPLE_ROOT);
  const names = host.tools.map((t) => t.name);
  assert.ok(names.includes("search") && names.includes("get_entity") && names.includes("list_types"));
  for (const t of host.tools) {
    assert.equal(typeof t.description, "string");
    assert.equal(t.input_schema.type, "object");
  }
  assert.equal(host.provenance.commit, COMMIT);
  assert.equal(host.provenance.repo, "companygraph/meta-model");
});

test("the host's types are read at connect, kept while the commit stands, and read again when it moves", async () => {
  const types = await host.types();
  assert.ok(types.length > 0);
  for (const t of types) { assert.equal(typeof t.type, "string"); assert.equal(typeof t.count, "number"); }
  assert.ok(types.some((t) => t.count > 0));
  const again = await host.types();
  assert.strictEqual(again, types, "the same list while the commit stands");
  host.provenance = { ...host.provenance, commit: "f".repeat(40) };
  const fresh = await host.types();
  assert.notStrictEqual(fresh, types, "read again once the commit moved");
  assert.deepEqual(fresh, types);
  assert.equal(host.provenance.commit, COMMIT, "and the read put the host's real commit back");
});

test("a call answers text and data, and a refusal is data with isError", async () => {
  const r = await host.call("search", { query: EXAMPLE_ROOT, match: "name" });
  assert.equal(r.isError, false);
  assert.ok(r.data.results.length > 0);
  assert.equal(JSON.parse(r.text).model.commit, COMMIT);
  const bad = await host.call("fetch", { id: "nothing/here" });
  assert.equal(bad.isError, true);
  assert.equal(typeof bad.data.error.code, "string");
});

// The rule that sends a search with match "words" needs a host that has the mode, which is the
// server package from v0.26.0; a host below it refuses the value, and this holds the pin to it.
test("a search by words is answered, with the words the host read", async () => {
  const r = await host.call("search", { query: EXAMPLE_ROOT, match: "words" });
  assert.equal(r.isError, false);
  assert.ok(r.data.results.length > 0);
  assert.ok(r.data.words.length > 0 && r.data.words.every((w) => typeof w.stem === "string" && typeof w.common === "boolean"));
});

test("a call answers with the host's provenance as this call reports it", async () => {
  host.provenance = null;
  const r = await host.call("list_types", {});
  assert.deepEqual(host.provenance, r.data.model);
  assert.equal(host.provenance.commit, COMMIT);
});

// The fixture host behind a counter, so a reconnect can be seen: opening one costs several
// requests where a call costs one.
async function countedHost() {
  const inner = createHttpServer(exampleSnapshot());
  let requests = 0;
  const server = http.createServer((req, res) => { requests += 1; inner.emit("request", req, res); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const h = await connectHost(`http://127.0.0.1:${server.address().port}/mcp`);
  return { host: h, since: () => { const n = requests; requests = 0; return n; }, close: async () => { await h.close(); server.close(); } };
}

test("a tool the host does not have is the host refusing, not the host gone: no reconnect", async () => {
  const c = await countedHost();
  try {
    c.since();
    await c.host.call("list_types", {});
    const good = c.since();
    assert.equal(good, 1, "an answered call is one request; opening a connection is several");
    await assert.rejects(() => c.host.call("no_such_tool", {}), (e) => {
      assert.notEqual(e.code, "host_down");
      assert.match(e.message, /no_such_tool/);
      return true;
    });
    assert.equal(c.since(), good, "a refused call costs what an answered one costs, so nothing was reopened");
    assert.equal((await c.host.call("list_types", {})).isError, false, "and the connection is still the one it was");
  } finally {
    await c.close();
  }
});

test("a call after the host went away reconnects once, and a host that is gone is host_down", async () => {
  const second = await startFixtureHost();
  const h = await connectHost(second.url);
  await second.close();
  await assert.rejects(() => h.call("list_types", {}), (e) => e.code === "host_down");
  await h.close();
  await assert.rejects(() => connectHost("http://127.0.0.1:1/mcp"), (e) => e.code === "host_down");
});
