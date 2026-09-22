// The one store a deployment runs: one document, read and written inside a transaction, so two
// instances adding at once add twice rather than once. The client takes its project and its
// credentials from the environment Cloud Run gives the service account.
import { Firestore } from "@google-cloud/firestore";

export class FirestoreStore {
  constructor({ db = new Firestore(), path = "chat/meter" } = {}) {
    this.ref = db.doc(path);
    this.db = db;
  }

  async transact(fn) {
    let next;
    await this.db.runTransaction(async (t) => {
      const snap = await t.get(this.ref);
      next = await fn(snap.exists ? snap.data() : {});
      t.set(this.ref, next);
    });
    return next;
  }
}
