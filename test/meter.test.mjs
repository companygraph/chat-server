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

// The day and the month are counted in UTC, so the day's refusal lifts at the next midnight
// UTC and the month's on the first of the next month, computed from the meter's own clock and
// never from the instance's.
test("a spent day names the next midnight UTC and a spent month the first of the next month", async () => {
  const day = new Meter(new MemoryStore(), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await day.reserve(100);
  await assert.rejects(() => day.reserve(1), (e) => e.code === "over_day" && e.retryAt === "2026-09-23T00:00:00.000Z");
  const month = new Meter(new MemoryStore(), { monthTokens: 100, now: at("2026-12-31T23:59:59Z") });
  await assert.rejects(() => month.reserve(101), (e) => e.code === "over_month" && e.retryAt === "2027-01-01T00:00:00.000Z");
  const closed = new Meter(new MemoryStore(), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await closed.store.transact((d) => ({ ...d, closed: true }));
  await assert.rejects(() => closed.reserve(1), (e) => e.code === "closed" && !("retryAt" in e));
});

test("two reserves started together against a share that fits one: exactly one passes", async () => {
  const store = new MemoryStore();
  const m = new Meter(store, { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  const results = await Promise.allSettled([m.reserve(60), m.reserve(60)]);
  const passed = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(passed, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "over_day");
  assert.equal((await m.state()).dayTokens, 60);
});

test("the default estimate is the design's ceiling for one call", () => {
  assert.equal(ESTIMATE, 30000);
});

// A store whose transaction is retried: Firestore reruns the function on contention, and only
// the last run is the one that commits.
const retrying = (...snapshots) => {
  const commits = [];
  return {
    commits,
    async transact(fn) {
      let next;
      for (const snap of snapshots) next = await fn({ ...snap });
      commits.push(next);
      return next;
    },
  };
};

test("a retried transaction is judged by the run that commits, not by the one before it", async () => {
  const full = { day: "2026-09-22", month: "2026-09", dayTokens: 100, monthTokens: 100, closed: false };
  const room = { ...full, dayTokens: 10, monthTokens: 10 };
  const store = retrying(full, room);
  const m = new Meter(store, { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await m.reserve(60);
  assert.equal(store.commits.length, 1);
  assert.equal(store.commits[0].dayTokens, 70);
  assert.equal(store.commits[0].monthTokens, 70);
});

test("settle floors at zero, so an answer under the estimate cannot drive a counter below nothing", async () => {
  const m = new Meter(new MemoryStore(), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  const doc = await m.settle(60, 0);
  assert.equal(doc.dayTokens, 0);
  assert.equal(doc.monthTokens, 0);
  assert.equal((await m.state()).dayTokens, 0);
});

// A Firestore whose document survives the transaction, so a second call reads what the first
// wrote and a write can be counted.
const fakeDb = (doc) => {
  const held = { doc, sets: 0 };
  held.db = {
    doc: () => ({ id: "meter" }),
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: true, data: () => ({ ...held.doc }) }),
      set: (ref, d) => { held.doc = d; held.sets += 1; },
    }),
  };
  return held;
};

test("a state that changes nothing and a refused reserve cost no write", async () => {
  const full = fakeDb({ day: "2026-09-22", month: "2026-09", dayTokens: 100, monthTokens: 100, closed: false });
  const m = new Meter(new FirestoreStore({ db: full.db }), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  assert.equal((await m.state()).dayTokens, 100);
  assert.equal(full.sets, 0, "a document read back unchanged is not written");
  await assert.rejects(() => m.reserve(1), (e) => e.code === "over_day");
  assert.equal(full.sets, 0, "a refused reserve puts nothing back, so it writes nothing");
  assert.equal((await m.settle(10, 10)).dayTokens, 100);
  assert.equal(full.sets, 0, "a settlement that moves nothing writes nothing");
  const room = fakeDb({ day: "2026-09-22", month: "2026-09", dayTokens: 10, monthTokens: 10, closed: false });
  const n = new Meter(new FirestoreStore({ db: room.db }), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await n.reserve(1);
  assert.equal(room.sets, 1, "a reservation is one write");
  assert.equal(room.doc.dayTokens, 11);
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
