// Each port's adapters, named by the value that chooses them. An adapter is imported only when it
// is chosen, so a deployment loads the cloud SDK of the platform it runs on and no other, and the
// config reads the allowed values from the keys here rather than from a list of its own.
// A package an adapter needs and the image does not hold is an operator's error, said in one
// sentence naming the choice that asked for it; any other failure is the adapter's own.
/** @import { Store } from "./meter.mjs" */
/** @import { QuestionSource } from "./report.mjs" */

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
export async function load(variable, value, importer) {
  try {
    return await importer();
  } catch (err) {
    if ((/** @type {Error & { code?: string }} */ (err))?.code === "ERR_MODULE_NOT_FOUND") throw new Error(`${variable}=${value} needs a package that is not installed: ${String((/** @type {Error} */ (err)).message).split("\n")[0]}`);
    throw err;
  }
}

export const METERS = {
  firestore: async () => new (await import("./platform/google/meter.mjs")).FirestoreStore(),
  memory: async () => new (await import("./meter.mjs")).MemoryStore(),
  table: async (/** @type {ConstructorParameters<typeof import("./platform/azure/meter.mjs").TableStore>[0]} */ options) => new (await import("./platform/azure/meter.mjs")).TableStore(options),
};

/**
 * @param {string} kind
 * @param {Record<string, string>} [options]
 * @param {Record<string, (options?: any) => Promise<Store>>} [adapters]
 */
export const meterStore = (kind, options = {}, adapters = METERS) => load("CHAT_METER", kind, () => adapters[kind](options));

export const IDENTITIES = {
  google: async () => (await import("./platform/google/identity.mjs")).googleIdentityToken,
  azure: async () => (await import("./platform/azure/identity.mjs")).azureIdentityToken,
};

/**
 * @param {string} kind
 * @param {Record<string, () => Promise<IdentityTokenSource>>} [adapters]
 */
export const identityTokenSource = (kind, adapters = IDENTITIES) => load("CHAT_IDENTITY", kind, adapters[kind]);

export const QUESTIONS = {
  google: async () => (await import("./platform/google/questions.mjs")).googleQuestions,
  azure: async () => (await import("./platform/azure/questions.mjs")).azureQuestions,
};

// A deployment that names no platform is on Google, as every deployment before the field was.
/**
 * @param {string} [platform]
 * @param {Record<string, () => Promise<QuestionOpener>>} [adapters]
 */
export async function questionSource(platform = "google", adapters = QUESTIONS) {
  if (!Object.hasOwn(adapters, platform)) throw new Error(`deployment.json names platform ${platform}, which is not one of ${Object.keys(adapters).join(" ")}`);
  return load("platform", platform, adapters[platform]);
}
