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
 * The client's address: the entry before the trusted hops at the end of X-Forwarded-For, or the
 * socket's where there is no header. A hop is skipped only where `isFront` does not deny that its
 * entry is a front end's own address; `null`, a check that cannot tell yet, skips it as before.
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [hops]
 * @param {(address: string) => boolean | null} [isFront]
 */
export declare function clientAddress(req: import("node:http").IncomingMessage, hops?: number, isFront?: (address: string) => boolean | null): string;
