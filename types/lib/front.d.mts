import { BlockList } from "node:net";
export declare const GOOGLE_RANGES = "https://www.gstatic.com/ipranges/goog.json";
export declare const CLOUD_RANGES = "https://www.gstatic.com/ipranges/cloud.json";
/**
 * @param {unknown} json
 * @returns {BlockList}
 */
export declare function rangesFrom(json: unknown): BlockList;
/**
 * Google's own front addresses, kept fresh. `isFront` is `true` for an address in Google's ranges
 * and not in its cloud customers', `false` for any other, and `null` until the first fetch.
 * @param {{ fetchFn?: typeof globalThis.fetch; warn?: (fields: { reason: string }) => void; timeoutMs?: number; refreshMs?: number; retryMs?: number }} [options]
 */
export declare function googleFront({ fetchFn, warn, timeoutMs, refreshMs, retryMs }?: {
    fetchFn?: typeof globalThis.fetch;
    warn?: (fields: {
        reason: string;
    }) => void;
    timeoutMs?: number;
    refreshMs?: number;
    retryMs?: number;
}): {
    /** @param {string} address */
    isFront(address: string): boolean | null;
    /** One fetch of both lists; a failure keeps what was had and is one warning. */
    load(): Promise<boolean>;
    /** The first load, then a refresh each day, or each hour while none has succeeded. */
    start(): Promise<boolean>;
    stop(): void;
};
