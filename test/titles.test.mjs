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
  await host.refreshTitles();
  const titles = host.titles();
  const entities = exampleSnapshot().entities;
  assert.equal(titles.length, entities.length);
  assert.ok(titles.some((t) => t.title === EXAMPLE_ROOT));
  assert.ok(titles.every((t) => typeof t.id === "string" && typeof t.title === "string"));
});

test("the index answers at once, one walk serves every caller, and a failed walk waits out a cooldown", async () => {
  const first = host.titles();
  assert.ok(first.length > 0);
  const call = host.call;
  let calls = 0;
  host.call = async (...args) => { calls++; return call(...args); };
  try {
    assert.equal(host.titles(), first, "the same commit reads nothing");
    assert.equal(calls, 0);
    host.provenance = { ...host.provenance, commit: "moved" };
    const a = host.refreshTitles(), b = host.refreshTitles();
    assert.equal(a, b, "two callers share one walk");
    assert.equal(host.titles(), first, "a caller during the walk gets what was read before, at once");
    await a;
    const walked = calls;
    host.provenance = { ...host.provenance, commit: "moved again" };
    host.call = async () => { calls++; return { isError: true, data: null, text: "" }; };
    await host.refreshTitles();
    const failedAt = calls;
    assert.ok(host.titles().length > 0, "a failed walk keeps what was read");
    await host.refreshTitles();
    assert.equal(calls, failedAt, "a second walk waits out the cooldown");
    assert.ok(walked > 0);
  } finally {
    host.call = call;
  }
});
