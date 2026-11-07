import { test } from "node:test";
import assert from "node:assert/strict";
import { meterStore, readerStore, firestoreReaders, tableReaders, load, METERS, identityTokenSource, IDENTITIES, questionSource, QUESTIONS } from "../lib/platform.mjs";
import { MemoryStore } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/platform/google/meter.mjs";
import { TableStore } from "../lib/platform/azure/meter.mjs";
import { googleIdentityToken } from "../lib/platform/google/identity.mjs";
import { azureIdentityToken } from "../lib/platform/azure/identity.mjs";
import { googleQuestions } from "../lib/platform/google/questions.mjs";
import { azureQuestions } from "../lib/platform/azure/questions.mjs";

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
  assert.deepEqual(Object.keys(QUESTIONS), ["google", "azure"]);
});

test("a platform this release has no adapter for is refused by name, before anything signs in", async () => {
  let loaded = false;
  await assert.rejects(questionSource("aws", { google: async () => { loaded = true; } }),
    (e) => e.message === "deployment.json names platform aws, which is not one of google");
  assert.equal(loaded, false);
});

test("the questions of a deployment on Azure come from Log Analytics", async () => {
  assert.equal(await questionSource("azure"), azureQuestions);
});

test("readerStoreMemoryPerKey keeps one store for each key", async () => {
  const a = await readerStore("memory", "key-a"), b = await readerStore("memory", "key-b");
  assert.ok(a instanceof MemoryStore && b instanceof MemoryStore);
  assert.notEqual(a, b);
  assert.equal(await readerStore("memory", "key-a"), a);
});

test("readerStore on firestore keeps the reader at their own path", async () => {
  const store = await readerStore("firestore", "abc", { firestore: async (key) => new FirestoreStore({ db: { doc: (p) => ({ p }) }, path: "chat-readers/" + key }) });
  assert.equal(store.ref.p, "chat-readers/abc");
});

test("readerStore refuses a meter that keeps no readers' months, saying what sign-in needs", async () => {
  await assert.rejects(readerStore("file", "k"), (e) => e.message === "CHAT_METER=file keeps no readers' months; sign-in needs firestore, table or memory");
});

// On Azure a reader's month is a row of its own in the meter's table, at the partition
// `readers`, and every reader's store shares one table client, opened with the meter's options.
test("readerStore on table keeps each reader at their own row of one shared client", async () => {
  const opened = [];
  const client = { name: "client" };
  const adapters = { table: tableReaders(async (options) => { opened.push(options); return client; }) };
  const options = { tableUrl: "https://example.table.core.windows.net/", clientId: "00000000-0000-0000-0000-000000000001" };
  const [a, b] = await Promise.all([readerStore("table", "abc", adapters, options), readerStore("table", "def", adapters, options)]);
  const c = await readerStore("table", "abc", adapters, options);
  assert.deepEqual(opened, [options], "the client is made once, on the first reader, from the meter's options");
  assert.ok(a.client === client && b.client === client && c.client === client);
  assert.deepEqual([a.partition, a.row, b.partition, b.row], ["readers", "abc", "readers", "def"]);
});

test("a table client that could not be made is made again on the next reader", async () => {
  let calls = 0;
  const adapters = { table: tableReaders(async () => { if (calls++ === 0) throw new Error("no endpoint"); return {}; }) };
  await assert.rejects(readerStore("table", "k", adapters), /no endpoint/);
  assert.ok(await readerStore("table", "k", adapters));
  assert.equal(calls, 2);
});

test("readerStore called twice at once for one key gives one store", async () => {
  const [a, b] = await Promise.all([readerStore("memory", "key-race"), readerStore("memory", "key-race")]);
  assert.equal(a, b);
});

// One Firestore client for every reader's month: a client a message opened and never closed
// would hold its channel for the life of the process.
test("readerStoreFirestoreSharesOneClient", async () => {
  let opened = 0;
  const db = { doc: (p) => ({ p }) };
  const adapters = { firestore: firestoreReaders(async () => { opened++; return db; }) };
  const [a, b] = await Promise.all([readerStore("firestore", "abc", adapters), readerStore("firestore", "def", adapters)]);
  const c = await readerStore("firestore", "abc", adapters);
  assert.equal(opened, 1, "the client is made once, on the first reader");
  assert.ok(a.db === db && b.db === db && c.db === db);
  assert.equal(a.ref.p, "chat-readers/abc");
  assert.equal(b.ref.p, "chat-readers/def");
});
