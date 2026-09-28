import { test } from "node:test";
import assert from "node:assert/strict";
import { TableStore } from "../lib/platform/azure/meter.mjs";

// Table Storage as the store sees it: one entity, an ETag that moves with every write, 404 for
// a missing entity, 409 for a create that lost, 412 for an update whose ETag is stale. `races`
// is how many writes another replica wins first, each moving the entity under the store.
const fakeTable = ({ races = 0 } = {}) => {
  const t = { entity: null, version: 0, races, writes: 0 };
  const fail = (statusCode) => Object.assign(new Error(`status ${statusCode}`), { statusCode });
  const other = () => { t.races--; t.version++; t.entity = { ...(t.entity ?? {}), dayTokens: (t.entity?.dayTokens ?? 0) + 100 }; };
  t.client = {
    async getEntity(partitionKey, rowKey) {
      if (!t.entity) throw fail(404);
      return { ...t.entity, partitionKey, rowKey, etag: `W/"${t.version}"`, timestamp: "2026-09-28T00:00:00Z", "odata.metadata": "m" };
    },
    async createEntity(e) {
      if (t.races > 0) { other(); throw fail(409); }
      if (t.entity) throw fail(409);
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
    async updateEntity(e, mode, { etag }) {
      assert.equal(mode, "Replace");
      if (t.races > 0) { other(); throw fail(412); }
      if (etag !== `W/"${t.version}"`) throw fail(412);
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
  };
  return t;
};

test("the function sees the entity's own fields and nothing of the table's", async () => {
  const t = fakeTable();
  const store = new TableStore({ client: t.client });
  await store.transact(() => ({ day: "2026-09-28", dayTokens: 5, closed: false }));
  let seen;
  await store.transact((d) => { seen = d; return d; });
  assert.deepEqual(seen, { day: "2026-09-28", dayTokens: 5, closed: false });
});

test("what the function hands back unchanged is not written", async () => {
  const t = fakeTable();
  const store = new TableStore({ client: t.client });
  await store.transact(() => ({ dayTokens: 1 }));
  await store.transact((d) => d);
  await store.transact((d) => ({ ...d }));
  assert.equal(t.writes, 1);
});

test("a write another replica got to first is read again and retried, the function run on what is there", async () => {
  const t = fakeTable({ races: 2 });
  const store = new TableStore({ client: t.client });
  let calls = 0;
  const next = await store.transact((d) => { calls++; return { ...d, dayTokens: (d.dayTokens ?? 0) + 1 }; });
  assert.equal(calls, 3);
  assert.deepEqual(next, { dayTokens: 201 }, "two lost races of 100 each, then this write of 1");
  assert.deepEqual(t.entity, { dayTokens: 201 });
});

test("five lost races refuse with a sentence rather than loop", async () => {
  const t = fakeTable({ races: 10 });
  const store = new TableStore({ client: t.client });
  await assert.rejects(store.transact((d) => ({ ...d, dayTokens: 1 })), /^Error: the meter could not be written after 5 attempts: another replica kept writing it$/);
});

test("an update that finds the entity gone, deleted by hand between the read and the write, is read again and the function creates it", async () => {
  const t = { entity: { dayTokens: 1 }, version: 1, deleted: false, writes: 0 };
  const fail = (statusCode) => Object.assign(new Error(`status ${statusCode}`), { statusCode });
  const client = {
    async getEntity(partitionKey, rowKey) {
      if (!t.entity) throw fail(404);
      return { ...t.entity, partitionKey, rowKey, etag: `W/"${t.version}"`, timestamp: "2026-09-28T00:00:00Z", "odata.metadata": "m" };
    },
    async createEntity(e) {
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
    async updateEntity(e, mode, { etag }) {
      assert.equal(mode, "Replace");
      if (!t.deleted) { t.deleted = true; t.entity = null; throw fail(404); }
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
  };
  const store = new TableStore({ client });
  let calls = 0;
  const next = await store.transact((d) => { calls++; return { ...d, dayTokens: (d.dayTokens ?? 0) + 1 }; });
  assert.equal(calls, 2, "the first attempt's update lost to the deletion; the second ran the function again");
  assert.deepEqual(next, { dayTokens: 1 }, "the second attempt read nothing, so the function started fresh");
  assert.equal(t.writes, 1, "one write, a create, since the entity was gone when it was made");
});

test("any other failure of the table is passed on as it was", async () => {
  const boom = Object.assign(new Error("forbidden"), { statusCode: 403 });
  const store = new TableStore({ client: { getEntity: async () => { throw boom; } } });
  await assert.rejects(store.transact((d) => d), (e) => e === boom);
});
