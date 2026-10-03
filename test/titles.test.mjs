// The title index the answer check reads names against: every entity of every type, read from a
// real host once for its commit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectHost } from "../lib/host.mjs";
import { startFixtureHost, exampleSnapshot, EXAMPLE_ROOT } from "./helpers.mjs";

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

test("the index holds every entity the model holds, by id and title", async () => {
  const titles = await host.titles();
  const entities = exampleSnapshot().entities;
  assert.equal(titles.length, entities.length);
  assert.ok(titles.some((t) => t.title === EXAMPLE_ROOT));
  assert.ok(titles.every((t) => typeof t.id === "string" && typeof t.title === "string"));
});

test("the index is read once for a commit, and a failed read keeps what was read", async () => {
  const first = await host.titles();
  const call = host.call;
  let calls = 0;
  host.call = async (...args) => { calls++; return call(...args); };
  try {
    assert.equal(await host.titles(), first);
    assert.equal(calls, 0, "no page is read again for the same commit");
    host.provenance = { ...host.provenance, commit: "moved" };
    host.call = async () => ({ isError: true, data: null, text: "" });
    assert.equal(await host.titles(), first, "a failed read keeps the titles it had");
  } finally {
    host.call = call;
  }
});
