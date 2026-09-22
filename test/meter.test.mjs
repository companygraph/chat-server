import { test } from "node:test";
import assert from "node:assert/strict";
import { units, Meter, MemoryStore, ESTIMATE } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/firestore.mjs";

test("usage is weighed in input-equivalent tokens and rounded up", () => {
  assert.equal(units({ input_tokens: 100, output_tokens: 10 }), 150);
  assert.equal(units({ input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 0 }), 225);
  assert.equal(units({ input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 0 }), 2);
  assert.equal(units({}), 0);
});

const at = (iso) => () => new Date(iso);

test("the day's share is a tenth of the month, and reserve refuses when either is spent", async () => {
  const store = new MemoryStore();
  const m = new Meter(store, { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  const s0 = await m.state();
  assert.deepEqual([s0.day, s0.month, s0.dayShare, s0.monthCeiling, s0.dayTokens, s0.monthTokens, s0.closed], ["2026-09-22", "2026-09", 100, 1000, 0, 0, false]);
  await m.reserve(60);
  await m.settle(60, 90);
  assert.equal((await m.state()).dayTokens, 90);
  await assert.rejects(() => m.reserve(20), (e) => e.code === "over_day");
  assert.equal((await m.state()).dayTokens, 90, "a refused reserve leaves the counter as it was");
});

test("a new day resets the day and keeps the month; a new month resets both", async () => {
  const store = new MemoryStore();
  let clock = at("2026-09-21T10:00:00Z");
  const m = new Meter(store, { monthTokens: 900, now: () => clock() });
  await m.reserve(90); await m.settle(90, 90);
  clock = at("2026-09-22T00:00:01Z");
  const s1 = await m.state();
  assert.equal(s1.dayTokens, 0); assert.equal(s1.monthTokens, 90);
  for (let d = 22; d <= 30; d++) { clock = at(`2026-09-${d}T10:00:00Z`); await m.reserve(90); await m.settle(90, 90); }
  assert.equal((await m.state()).monthTokens, 900);
  await assert.rejects(() => m.reserve(1), (e) => e.code === "over_month");
  clock = at("2026-10-01T00:00:00Z");
  assert.equal((await m.state()).monthTokens, 0);
  await m.reserve(1);
});

test("the switch closes the chat without touching the counters", async () => {
  const store = new MemoryStore();
  const m = new Meter(store, { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await store.transact((d) => ({ ...d, closed: true }));
  assert.equal((await m.state()).closed, true);
  await assert.rejects(() => m.reserve(1), (e) => e.code === "closed");
});

test("the default estimate is the design's ceiling for one call", () => {
  assert.equal(ESTIMATE, 30000);
});

test("the Firestore store runs the function inside a transaction on one document", async () => {
  const writes = [];
  const fakeRef = { id: "meter" };
  const db = {
    doc: (p) => { assert.equal(p, "chat/meter"); return fakeRef; },
    runTransaction: async (fn) => fn({
      get: async (ref) => ({ exists: true, data: () => ({ dayTokens: 5 }) }),
      set: (ref, data) => { writes.push([ref, data]); },
    }),
  };
  const store = new FirestoreStore({ db });
  const next = await store.transact((d) => ({ ...d, dayTokens: d.dayTokens + 1 }));
  assert.deepEqual(next, { dayTokens: 6 });
  assert.deepEqual(writes, [[fakeRef, { dayTokens: 6 }]]);
});
