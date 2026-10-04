// The one store a deployment runs: one document, read and written inside a transaction, so two
// instances adding at once add twice rather than once. The client takes its project and its
// credentials from the environment Cloud Run gives the service account; it is loaded only when
// CHAT_METER is firestore.
//
// A function that hands back what it read has changed nothing, and a state read or a refused
// reserve is exactly that, so the write is skipped: those are the calls the chat makes most and
// a free tier is 20,000 writes a day.
import { Firestore } from "@google-cloud/firestore";

/** @import { StoredDoc } from "../../meter.mjs" */

// The document is five flat fields, so one pass over the union of the keys is the whole compare.
/**
 * @param {StoredDoc} a
 * @param {StoredDoc} b
 */
const same = (a, b) => {
  for (const k of /** @type {Set<keyof StoredDoc>} */ (new Set([...Object.keys(a), ...Object.keys(b)]))) if (a[k] !== b[k]) return false;
  return true;
};

export class FirestoreStore {
  /** @param {{ db?: Firestore; path?: string }} [options] */
  constructor({ db = new Firestore(), path = "chat/meter" } = {}) {
    this.ref = db.doc(path);
    this.db = db;
  }

  /**
   * @template {StoredDoc} D
   * @param {(doc: StoredDoc) => D | Promise<D>} fn
   * @returns {Promise<D>}
   */
  async transact(fn) {
    /** @type {D | undefined} */
    let next;
    await this.db.runTransaction(async (t) => {
      const snap = await t.get(this.ref);
      const read = /** @type {StoredDoc} */ (snap.exists ? snap.data() : {});
      next = await fn(read);
      if (!same(read, next)) t.set(this.ref, next);
    });
    return /** @type {D} */ (next);
  }
}
