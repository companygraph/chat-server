import { TableClient } from "@azure/data-tables";
import type { StoredDoc } from "../../meter.mjs";
export declare class TableStore {
    client: TableClient;
    partition: string;
    row: string;
    attempts: number;
    /** @param {{ client?: TableClient; tableUrl?: string; clientId?: string; table?: string; partition?: string; row?: string; attempts?: number }} [options] */
    constructor({ client, tableUrl, clientId, table, partition, row, attempts }?: {
        client?: TableClient;
        tableUrl?: string;
        clientId?: string;
        table?: string;
        partition?: string;
        row?: string;
        attempts?: number;
    });
    /**
     * @template {StoredDoc} D
     * @param {(doc: StoredDoc) => D | Promise<D>} fn
     * @returns {Promise<D>}
     */
    transact<D extends StoredDoc>(fn: (doc: StoredDoc) => D | Promise<D>): Promise<D>;
}
