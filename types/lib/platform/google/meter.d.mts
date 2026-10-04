import { Firestore } from "@google-cloud/firestore";
import type { StoredDoc } from "../../meter.mjs";
export declare class FirestoreStore {
    ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData, FirebaseFirestore.DocumentData>;
    db: Firestore;
    /** @param {{ db?: Firestore; path?: string }} [options] */
    constructor({ db, path }?: {
        db?: Firestore;
        path?: string;
    });
    /**
     * @template {StoredDoc} D
     * @param {(doc: StoredDoc) => D | Promise<D>} fn
     * @returns {Promise<D>}
     */
    transact<D extends StoredDoc>(fn: (doc: StoredDoc) => D | Promise<D>): Promise<D>;
}
