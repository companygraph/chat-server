// The meter on Azure: one entity in Table Storage, read and written under its ETag, so two
// replicas adding at once add twice rather than once. A write whose ETag another replica moved
// first, a create another replica made first, or an update whose entity another replica (or a
// hand) deleted between the read and the write, is read again and the function run again on
// what is there, as a Firestore transaction reruns; five lost races in a row refuse. The client
// signs in as the app's user-assigned identity, named by client id; it is loaded only when
// CHAT_METER is table.
//
// A function that hands back what it read has changed nothing, and nothing is written, as with
// Firestore: those are the calls the chat makes most.
import { TableClient } from "@azure/data-tables";
import { ManagedIdentityCredential } from "@azure/identity";

/** @import { StoredDoc } from "../../meter.mjs" */

// The table's own properties ride on every entity it returns; the meter's document is the rest.
/** @param {Record<string, unknown>} e */
const own = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !["partitionKey", "rowKey", "etag", "timestamp"].includes(k) && !k.startsWith("odata.")));

/**
 * @param {StoredDoc} a
 * @param {StoredDoc} b
 */
const same = (a, b) => {
  for (const k of /** @type {Set<keyof StoredDoc>} */ (new Set([...Object.keys(a), ...Object.keys(b)]))) if (a[k] !== b[k]) return false;
  return true;
};

const LOST = new Set([409, 412, 404]);

export class TableStore {
  /** @param {{ client?: TableClient; tableUrl?: string; clientId?: string; table?: string; partition?: string; row?: string; attempts?: number }} [options] */
  constructor({ client, tableUrl, clientId, table = "chat", partition = "chat", row = "meter", attempts = 5 } = {}) {
    this.client = client ?? new TableClient(/** @type {string} */ (tableUrl).replace(/\/+$/, ""), table, new ManagedIdentityCredential(/** @type {{ clientId: string }} */ ({ clientId })));
    this.partition = partition;
    this.row = row;
    this.attempts = attempts;
  }

  /**
   * @template {StoredDoc} D
   * @param {(doc: StoredDoc) => D | Promise<D>} fn
   * @returns {Promise<D>}
   */
  async transact(fn) {
    for (let i = 0; i < this.attempts; i++) {
      let /** @type {StoredDoc} */ read = {}, /** @type {string | null | undefined} */ etag = null;
      try {
        const e = await this.client.getEntity(this.partition, this.row);
        read = /** @type {StoredDoc} */ (own(e));
        etag = e.etag;
      } catch (err) {
        if ((/** @type {{ statusCode?: number }} */ (err))?.statusCode !== 404) throw err;
      }
      const next = await fn({ ...read });
      if (same(read, next)) return next;
      const entity = { partitionKey: this.partition, rowKey: this.row, ...next };
      try {
        if (etag) await this.client.updateEntity(entity, "Replace", { etag });
        else await this.client.createEntity(entity);
        return next;
      } catch (err) {
        if (!LOST.has(/** @type {number} */ ((/** @type {{ statusCode?: number }} */ (err))?.statusCode))) throw err;
      }
    }
    throw new Error(`the meter could not be written after ${this.attempts} attempts: another replica kept writing it`);
  }
}
