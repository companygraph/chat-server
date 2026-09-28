import { test } from "node:test";
import assert from "node:assert/strict";
import { meterStore, load, METERS, identityTokenSource, IDENTITIES, questionSource, QUESTIONS } from "../lib/platform.mjs";
import { MemoryStore } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/platform/google/meter.mjs";
import { TableStore } from "../lib/platform/azure/meter.mjs";
import { googleIdentityToken } from "../lib/platform/google/identity.mjs";
import { azureIdentityToken } from "../lib/platform/azure/identity.mjs";
import { googleQuestions } from "../lib/platform/google/questions.mjs";

const missing = (pkg) => () => Promise.reject(Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/lib/platform/google/meter.mjs`), { code: "ERR_MODULE_NOT_FOUND" }));

test("each meter kind builds its store", async () => {
  assert.ok((await meterStore("memory")) instanceof MemoryStore);
  assert.ok((await meterStore("firestore", {}, { firestore: async () => new FirestoreStore({ db: { doc: () => ({}) } }) })) instanceof FirestoreStore);
  assert.deepEqual(Object.keys(METERS), ["firestore", "memory", "table"]);
});

test("a chosen adapter whose package is not installed is named in one sentence", async () => {
  await assert.rejects(meterStore("firestore", {}, { firestore: missing("@google-cloud/firestore") }),
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

// The table as the contract test needs it: one entity, ETags that move.
const fakeTableClient = () => {
  let entity = null, version = 0;
  const fail = (statusCode) => Object.assign(new Error(String(statusCode)), { statusCode });
  return {
    async getEntity() { if (!entity) throw fail(404); return { ...entity, etag: String(version) }; },
    async createEntity({ partitionKey, rowKey, ...rest }) { if (entity) throw fail(409); entity = rest; version++; },
    async updateEntity({ partitionKey, rowKey, ...rest }, mode, { etag }) { if (etag !== String(version)) throw fail(412); entity = rest; version++; },
  };
};

for (const [name, make] of [["memory", () => new MemoryStore()], ["firestore", fakeFirestore], ["table", () => new TableStore({ client: fakeTableClient() })]]) {
  test(`the ${name} store keeps what transact returns and starts empty`, async () => {
    const s = make();
    assert.deepEqual(await s.transact((d) => d), {});
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: (d.dayTokens ?? 0) + 1 })), { dayTokens: 1 });
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: d.dayTokens + 1 })), { dayTokens: 2 });
    assert.deepEqual(await s.transact((d) => d), { dayTokens: 2 });
  });
}

test("the table kind is made from its options", async () => {
  const store = await meterStore("table", { client: fakeTableClient() });
  assert.ok(store instanceof TableStore);
});

test("the google identity is the metadata server's token", async () => {
  assert.equal(await identityTokenSource("google"), googleIdentityToken);
  assert.deepEqual(Object.keys(IDENTITIES), ["google", "azure"]);
});

test("the azure identity is the managed-identity endpoint's token", async () => {
  assert.equal(await identityTokenSource("azure"), azureIdentityToken);
});

test("the questions of a deployment come from its platform, Google when it names none", async () => {
  assert.equal(await questionSource(undefined), googleQuestions);
  assert.equal(await questionSource("google"), googleQuestions);
  assert.deepEqual(Object.keys(QUESTIONS), ["google"]);
});

test("a platform this release has no adapter for is refused by name, before anything signs in", async () => {
  let loaded = false;
  await assert.rejects(questionSource("azure", { google: async () => { loaded = true; } }),
    (e) => e.message === "deployment.json names platform azure, which is not one of google");
  assert.equal(loaded, false);
});
