export declare class Bucket {
    perHour: number;
    now: () => number;
    /** @type {Map<string, number[]>} */
    hits: Map<string, number[]>;
    /** @param {{ perHour?: number; now?: () => number }} [options] */
    constructor({ perHour, now }?: {
        perHour?: number;
        now?: () => number;
    });
    /**
     * @param {string} address
     * @returns {true | Date}
     */
    take(address: string): true | Date;
}
/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [hops]
 */
export declare function clientAddress(req: import("node:http").IncomingMessage, hops?: number): string;
