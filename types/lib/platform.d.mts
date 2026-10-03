/** @import { Store } from "./meter.mjs" */
/** @import { QuestionSource } from "./report.mjs" */
import type { Store } from "./meter.mjs";
import type { QuestionSource } from "./report.mjs";
export type IdentityTokenSource = (fetchFn?: typeof globalThis.fetch, options?: {
    timeoutMs?: number;
}) => () => Promise<string>;
export type QuestionOpener = (deployment: any, chat: any) => Promise<QuestionSource>;
/**
 * What a platform's identity source is called with, and what it hands back: a function that
 * fetches the token. The platform's own values ride in `options` beside the deadline.
 * @typedef {(fetchFn?: typeof globalThis.fetch, options?: { timeoutMs?: number }) => () => Promise<string>} IdentityTokenSource
 */
/**
 * Opens the place a platform keeps the questions in. Each platform reads of `deployment` and
 * `chat`, the deployment's two files, the keys it needs, which deploy/build/config.mjs checks.
 * @typedef {(deployment: any, chat: any) => Promise<QuestionSource>} QuestionOpener
 */
/**
 * @template T
 * @param {string} variable
 * @param {string} value
 * @param {() => Promise<T>} importer
 * @returns {Promise<T>}
 */
export declare function load<T>(variable: string, value: string, importer: () => Promise<T>): Promise<T>;
export declare const METERS: {
    firestore: () => Promise<import("./platform/google/meter.mjs").FirestoreStore>;
    memory: () => Promise<import("./meter.mjs").MemoryStore>;
    table: (/** @type {ConstructorParameters<typeof import("./platform/azure/meter.mjs").TableStore>[0]} */ options: ConstructorParameters<typeof import("./platform/azure/meter.mjs").TableStore>[0]) => Promise<import("./platform/azure/meter.mjs").TableStore>;
};
/**
 * @param {string} kind
 * @param {Record<string, string>} [options]
 * @param {Record<string, (options?: any) => Promise<Store>>} [adapters]
 */
export declare const meterStore: (kind: string, options?: Record<string, string>, adapters?: Record<string, (options?: any) => Promise<Store>>) => Promise<Store>;
export declare const IDENTITIES: {
    google: () => Promise<typeof import("./platform/google/identity.mjs").googleIdentityToken>;
    azure: () => Promise<typeof import("./platform/azure/identity.mjs").azureIdentityToken>;
};
/**
 * @param {string} kind
 * @param {Record<string, () => Promise<IdentityTokenSource>>} [adapters]
 */
export declare const identityTokenSource: (kind: string, adapters?: Record<string, () => Promise<IdentityTokenSource>>) => Promise<IdentityTokenSource>;
export declare const QUESTIONS: {
    google: () => Promise<typeof import("./platform/google/questions.mjs").googleQuestions>;
    azure: () => Promise<typeof import("./platform/azure/questions.mjs").azureQuestions>;
};
/**
 * @param {string} [platform]
 * @param {Record<string, () => Promise<QuestionOpener>>} [adapters]
 */
export declare function questionSource(platform?: string, adapters?: Record<string, () => Promise<QuestionOpener>>): Promise<QuestionOpener>;
