// The meter on Azure: one entity in Table Storage, read and written under its ETag, so two
// replicas adding at once add twice rather than once. A write whose ETag another replica moved
// first, or a create another replica made first, is read again and the function run again on
// what is there, as a Firestore transaction reruns; five lost races in a row refuse. The client
// signs in as the app's user-assigned identity, named by client id; it is loaded only when
// CHAT_METER is table.
//
// A function that hands back what it read has changed nothing, and nothing is written, as with
// Firestore: those are the calls the chat makes most.
import { TableClient } from "@azure/data-tables";
import { ManagedIdentityCredential } from "@azure/identity";

// The table's own properties ride on every entity it returns; the meter's document is the rest.
const own = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !["partitionKey", "rowKey", "etag", "timestamp"].includes(k) && !k.startsWith("odata.")));

const same = (a, b) => {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) return false;
  return true;
};

const LOST = new Set([409, 412]);

export class TableStore {
  constructor({ client, tableUrl, clientId, table = "chat", partition = "chat", row = "meter", attempts = 5 } = {}) {
    this.client = client ?? new TableClient(tableUrl.replace(/\/+$/, ""), table, new ManagedIdentityCredential({ clientId }));
    this.partition = partition;
    this.row = row;
    this.attempts = attempts;
  }

  async transact(fn) {
    for (let i = 0; i < this.attempts; i++) {
      let read = {}, etag = null;
      try {
        const e = await this.client.getEntity(this.partition, this.row);
        read = own(e);
        etag = e.etag;
      } catch (err) {
        if (err?.statusCode !== 404) throw err;
      }
      const next = await fn({ ...read });
      if (same(read, next)) return next;
      const entity = { partitionKey: this.partition, rowKey: this.row, ...next };
      try {
        if (etag) await this.client.updateEntity(entity, "Replace", { etag });
        else await this.client.createEntity(entity);
        return next;
      } catch (err) {
        if (!LOST.has(err?.statusCode)) throw err;
      }
    }
    throw new Error(`the meter could not be written after ${this.attempts} attempts: another replica kept writing it`);
  }
}
