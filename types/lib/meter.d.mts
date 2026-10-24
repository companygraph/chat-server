import type { Choice } from "./models.mjs";
/** @import { Choice } from "./models.mjs" */
export declare const ESTIMATE = 30000;
export declare const ESTIMATE_INPUT = 18000;
/** @param {Choice} choice */
export declare function estimateFor(choice: Choice): number;
export type StoredDoc = {
    day?: string;
    month?: string;
    dayTokens?: number;
    monthTokens?: number;
    closed?: boolean;
};
export type RolledDoc = {
    day: string;
    month: string;
    dayTokens: number;
    monthTokens: number;
    closed: boolean;
};
export type Store = {
    transact: <D extends StoredDoc>(fn: (doc: StoredDoc) => D | Promise<D>) => Promise<D>;
};
/**
 * What the meter keeps in the store: the day and the month it last counted in, the tokens counted
 * in each, and whether the chat is switched off. Every field is absent from a store never written.
 * @typedef {{ day?: string; month?: string; dayTokens?: number; monthTokens?: number; closed?: boolean }} StoredDoc
 */
/**
 * The document after it is rolled to today.
 * @typedef {{ day: string; month: string; dayTokens: number; monthTokens: number; closed: boolean }} RolledDoc
 */
/**
 * One function run against one document, atomically; what it returns is what is kept and what
 * the call answers.
 * @typedef {{ transact: <D extends StoredDoc>(fn: (doc: StoredDoc) => D | Promise<D>) => Promise<D> }} Store
 */
/**
 * @param {{ input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; output_tokens?: number | null }} [usage]
 * @param {string} [model]
 */
export declare function units(usage?: {
    input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    output_tokens?: number | null;
}, model?: string): number;
export declare class MemoryStore {
    /** @type {StoredDoc} */
    doc: StoredDoc;
    /** @type {Promise<unknown>} */
    queue: Promise<unknown>;
    constructor();
    /**
     * @template {StoredDoc} D
     * @param {(doc: StoredDoc) => D | Promise<D>} fn
     * @returns {Promise<D>}
     */
    transact<D extends StoredDoc>(fn: (doc: StoredDoc) => D | Promise<D>): Promise<D>;
}
export declare class Meter {
    store: Store;
    monthCeiling: number;
    dayShare: number;
    now: () => Date;
    /**
     * @param {Store} store
     * @param {{ monthTokens: number; now?: () => Date }} options
     */
    constructor(store: Store, { monthTokens, now }: {
        monthTokens: number;
        now?: () => Date;
    });
    state(): Promise<{
        day: string;
        month: string;
        dayTokens: number;
        monthTokens: number;
        closed: boolean;
        dayShare: number;
        monthCeiling: number;
    }>;
    /**
     * @param {number} [estimate]
     * @param {{ day?: boolean }} [options]
     */
    reserve(estimate?: number, { day }?: {
        day?: boolean;
    }): Promise<void>;
    /**
     * @param {number} estimate
     * @param {number} actual
     * @param {{ day?: boolean }} [options]
     */
    settle(estimate: number, actual: number, { day }?: {
        day?: boolean;
    }): Promise<{
        day: string;
        month: string;
        closed: boolean;
        dayTokens: number;
        monthTokens: number;
    }>;
}
export declare class ReaderMeter {
    #private;
    store: Store;
    monthCeiling: number;
    now: () => Date;
    /**
     * @param {Store} store
     * @param {{ monthTokens: number; now?: () => Date }} options
     */
    constructor(store: Store, { monthTokens, now }: {
        monthTokens: number;
        now?: () => Date;
    });
    /** @param {number} estimate */
    reserve(estimate: number): Promise<void>;
    /**
     * @param {number} estimate
     * @param {number} actual
     * @returns {Promise<{ month: string; monthTokens: number }>}
     */
    settle(estimate: number, actual: number): Promise<{
        month: string;
        monthTokens: number;
    }>;
}
