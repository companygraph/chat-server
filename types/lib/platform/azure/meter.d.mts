import { TableClient } from "@azure/data-tables";
import type { StoredDoc } from "../../meter.mjs";
/**
 * A client of the meter's table, signed in as the app's user-assigned identity. The site's meter
 * and every reader's month share the table, each at its own partition and row.
 * @param {{ tableUrl?: string | undefined; clientId?: string | undefined; table?: string }} options
 */
export declare const tableClient: ({ tableUrl, clientId, table }: {
    tableUrl?: string | undefined;
    clientId?: string | undefined;
    table?: string;
}) => TableClient;
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
