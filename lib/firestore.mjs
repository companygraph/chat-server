// The one store a deployment runs: one document, read and written inside a transaction, so two
// instances adding at once add twice rather than once. The client takes its project and its
// credentials from the environment Cloud Run gives the service account.
//
// A function that hands back what it read has changed nothing, and a state read or a refused
// reserve is exactly that, so the write is skipped: those are the calls the chat makes most and
// a free tier is 20,000 writes a day.
import { Firestore } from "@google-cloud/firestore";

// The document is five flat fields, so one pass over the union of the keys is the whole compare.
const same = (a, b) => {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) return false;
  return true;
};

export class FirestoreStore {
  constructor({ db = new Firestore(), path = "chat/meter" } = {}) {
    this.ref = db.doc(path);
    this.db = db;
  }

  async transact(fn) {
    let next;
    await this.db.runTransaction(async (t) => {
      const snap = await t.get(this.ref);
      const read = snap.exists ? snap.data() : {};
      next = await fn(read);
      if (!same(read, next)) t.set(this.ref, next);
    });
    return next;
  }
}
