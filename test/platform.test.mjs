import { test } from "node:test";
import assert from "node:assert/strict";
import { meterStore, load, METERS } from "../lib/platform.mjs";
import { MemoryStore } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/platform/google/meter.mjs";

const missing = (pkg) => () => Promise.reject(Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/lib/platform/google/meter.mjs`), { code: "ERR_MODULE_NOT_FOUND" }));

test("each meter kind builds its store", async () => {
  assert.ok((await meterStore("memory")) instanceof MemoryStore);
  assert.ok((await meterStore("firestore", { firestore: async () => new FirestoreStore({ db: { doc: () => ({}) } }) })) instanceof FirestoreStore);
  assert.deepEqual(Object.keys(METERS), ["firestore", "memory"]);
});

test("a chosen adapter whose package is not installed is named in one sentence", async () => {
  await assert.rejects(meterStore("firestore", { firestore: missing("@google-cloud/firestore") }),
    (e) => e.message === "CHAT_METER=firestore needs a package that is not installed: Cannot find package '@google-cloud/firestore' imported from /app/lib/platform/google/meter.mjs");
});

test("any other failure while loading an adapter is passed on as it was", async () => {
  const boom = new Error("boom");
  await assert.rejects(load("CHAT_METER", "firestore", () => Promise.reject(boom)), (e) => e === boom);
});

// One contract, every store: a function that returns what it read writes nothing, and what it
// returns is what the next call reads.
const fakeFirestore = () => {
  let doc;
  return new FirestoreStore({ db: {
    doc: () => ({}),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: doc !== undefined, data: () => ({ ...doc }) }), set: (_, next) => { doc = { ...next }; } }),
  } });
};

for (const [name, make] of [["memory", () => new MemoryStore()], ["firestore", fakeFirestore]]) {
  test(`the ${name} store keeps what transact returns and starts empty`, async () => {
    const s = make();
    assert.deepEqual(await s.transact((d) => d), {});
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: (d.dayTokens ?? 0) + 1 })), { dayTokens: 1 });
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: d.dayTokens + 1 })), { dayTokens: 2 });
    assert.deepEqual(await s.transact((d) => d), { dayTokens: 2 });
  });
}
