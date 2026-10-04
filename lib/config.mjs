// The environment, read once into one object, so nothing else in lib/ reads process.env and a
// missing value fails at start with its name rather than deep in a request.
import { DEFAULT_QUESTION_INDEX_CHARS } from "./prompt.mjs";
import { METERS, IDENTITIES } from "./platform.mjs";
import { LOG_FORMATS } from "./log.mjs";

/**
 * The environment a process reads its values from.
 * @typedef {Record<string, string | undefined>} Env
 */
/**
 * The three ids of a workload identity federation, and the workspace where the rule spans more than one.
 * @typedef {{ ruleId: string; organizationId: string; serviceAccountId: string; workspaceId: string | null }} Federation
 */
/**
 * Everything the environment says of one chat, read once.
 * @typedef {object} Config
 * @property {string} mcpUrl
 * @property {string[]} origins
 * @property {string[] | null} hosts
 * @property {number} monthTokens
 * @property {string | null} project
 * @property {string | null} region
 * @property {number} proxyHops
 * @property {number} questionIndexChars
 * @property {number} port
 * @property {string} meter
 * @property {string} identity
 * @property {string} log
 * @property {string | null} anthropicKey
 * @property {Federation | null} anthropicFederation
 * @property {boolean} verdict
 * @property {string | null} typesafeKey
 * @property {number | null} verdictThreshold
 * @property {"global" | "us" | null} inferenceGeo
 * @property {"anthropic" | "vertex"} provider
 * @property {"key" | "federation" | "google"} credential
 * @property {Record<string, string>} meterOptions
 * @property {Record<string, string>} identityOptions
 */

/** @param {string} v */
const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * @param {Env} env
 * @param {string} name
 */
const need = (env, name) => {
  const v = env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set`);
  return v.trim();
};

/**
 * @template {number | undefined} F
 * @param {Env} env
 * @param {string} name
 * @param {F} fallback
 * @param {{ min?: number }} [options]
 * @returns {number | F}
 */
const int = (env, name, fallback, { min = 0 } = {}) => {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} is not a whole number: ${v}`);
  if (n < min) throw new Error(`${name} must be at least ${min}: ${v}`);
  return n;
};

// A choice among a port's adapters: unset is the default, which is what Google runs today, and
// any other value is refused with the ones there are, so a value in the wrong case never falls
// back to the default without a word.
// Where the Anthropic API runs a request, `global` or `us`, the two its `inference_geo` takes.
// Unset, the request names none and the workspace's default decides, so a deployment that
// re-pins changes nothing it did not ask for.
/**
 * @param {Env} env
 * @returns {"global" | "us" | null}
 */
const inferenceGeoOf = (env) => {
  const v = env.CHAT_INFERENCE_GEO?.trim();
  if (!v) return null;
  if (v !== "global" && v !== "us") throw new Error(`CHAT_INFERENCE_GEO is not one of global us: ${v}`);
  return v;
};

/**
 * @param {Env} env
 * @param {string} name
 * @param {object} kinds
 * @param {string} fallback
 */
const choice = (env, name, kinds, fallback) => {
  const v = env[name]?.trim();
  if (!v) return fallback;
  const allowed = Object.keys(kinds);
  if (!allowed.includes(v)) throw new Error(`${name} is not one of ${allowed.join(" ")}: ${v}`);
  return v;
};

// The values a chosen adapter needs beyond its name, read here with the rest so a deployment
// missing any fails at start with every name it lacks. Container Apps sets IDENTITY_ENDPOINT and
// IDENTITY_HEADER itself; the deployment's module sets the others.
/**
 * @param {Env} env
 * @param {string} choiceName
 * @param {Record<string, string>} names
 * @returns {Record<string, string>}
 */
const needAll = (env, choiceName, names) => {
  const got = Object.fromEntries(Object.entries(names).map(([k, name]) => [k, env[name]?.trim() || null]));
  const missing = Object.entries(names).filter(([k]) => !got[k]).map(([, name]) => name);
  if (missing.length) throw new Error(`${choiceName} needs ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not set`);
  return /** @type {Record<string, string>} */ (got);
};

// A switch is `true` or `false` and nothing else, so a typo never turns the check on or off
// without a word; unset is off.
/**
 * @param {Env} env
 * @param {string} name
 */
const bool = (env, name) => {
  const v = env[name]?.trim();
  if (!v) return false;
  if (v !== "true" && v !== "false") throw new Error(`${name} is true or false: ${v}`);
  return v === "true";
};
// A probability, between 0 and 1; unset is none.
/**
 * @param {Env} env
 * @param {string} name
 */
const fraction = (env, name) => {
  const v = env[name]?.trim();
  if (!v) return null;
  const n = Number(v);
  if (!(n >= 0 && n <= 1)) throw new Error(`${name} is a probability between 0 and 1: ${v}`);
  return n;
};
// Workload identity federation: the three ids name the rule, the organization and the Anthropic
// service account a token acts as, and the workspace is needed only where the rule spans more
// than one. None is a secret; the credential is the platform's own identity token. A partial set
// is a deployment half made, and is refused by name rather than read as no federation.
const FEDERATION = {
  ruleId: "ANTHROPIC_FEDERATION_RULE_ID",
  organizationId: "ANTHROPIC_ORGANIZATION_ID",
  serviceAccountId: "ANTHROPIC_SERVICE_ACCOUNT_ID",
};

/**
 * @param {Env} env
 * @returns {Federation | null}
 */
function federationFromEnv(env) {
  const got = Object.fromEntries(Object.entries(FEDERATION).map(([k, name]) => [k, env[name]?.trim() || null]));
  const missing = Object.entries(FEDERATION).filter(([k]) => !got[k]).map(([, name]) => name);
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim() || null;
  if (missing.length === 3) {
    if (workspaceId) throw new Error("ANTHROPIC_WORKSPACE_ID is set without ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID");
    return null;
  }
  if (missing.length) throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set; federation needs all three ids`);
  return /** @type {Federation} */ ({ ...got, workspaceId });
}

/**
 * @param {Env} [env]
 * @returns {Config}
 */
export function configFromEnv(env = process.env) {
  const c = /** @type {Config} */ ({
    mcpUrl: need(env, "CHAT_MCP_URL"),
    origins: list(need(env, "CHAT_ORIGINS")),
    hosts: env.CHAT_HOSTS ? list(env.CHAT_HOSTS) : null,
    monthTokens: int(env, "CHAT_MONTH_TOKENS", undefined) ?? (() => { throw new Error("CHAT_MONTH_TOKENS is not set"); })(),
    project: env.CHAT_PROJECT?.trim() || null,
    region: env.CHAT_REGION?.trim() || null,
    proxyHops: int(env, "CHAT_PROXY_HOPS", 1),
    // How many characters of the prompt's question-index line a deployment allows; a title past
    // it is still reached by search, so the number is a prompt-size budget and not a ceiling on
    // what the model can answer. Zero and negative are refused rather than read as "no cap",
    // since an unbounded line is not what either would mean read as English.
    questionIndexChars: int(env, "CHAT_QUESTION_INDEX_CHARS", DEFAULT_QUESTION_INDEX_CHARS, { min: 1 }),
    port: int(env, "PORT", 8080),
    meter: choice(env, "CHAT_METER", METERS, "firestore"),
    identity: choice(env, "CHAT_IDENTITY", IDENTITIES, "google"),
    log: choice(env, "CHAT_LOG", LOG_FORMATS, "google"),
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicFederation: federationFromEnv(env),
    // The answer check: off unless the deployment turns it on, and then it needs TypeSafe's key.
    // The threshold is what the widget marks a claim above; unset, it marks nothing.
    verdict: bool(env, "CHAT_VERDICT"),
    typesafeKey: env.TYPESAFE_API_KEY?.trim() || null,
    verdictThreshold: fraction(env, "CHAT_VERDICT_THRESHOLD"),
    inferenceGeo: inferenceGeoOf(env),
  });
  if (c.verdict && !c.typesafeKey) throw new Error("CHAT_VERDICT is true and TYPESAFE_API_KEY is not set");
  // The SDK lets a key win over federation without a word, so a deployment that still carries
  // its key after the switch would go on spending on the key it meant to retire.
  if (c.anthropicKey && c.anthropicFederation) throw new Error("ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set; set one, since the key would win");
  c.provider = c.anthropicKey || c.anthropicFederation ? "anthropic" : "vertex";
  c.credential = c.anthropicKey ? "key" : c.anthropicFederation ? "federation" : "google";
  // Vertex takes its region from the endpoint, so a region named here would be one nothing sends.
  if (c.inferenceGeo && c.provider === "vertex") throw new Error("CHAT_INFERENCE_GEO is for the Anthropic API; on Vertex the region is CHAT_REGION");
  c.meterOptions = c.meter === "table" ? needAll(env, "CHAT_METER=table", { tableUrl: "CHAT_TABLE_URL", clientId: "AZURE_CLIENT_ID" }) : {};
  // A token is asked for only under federation, so only then does the identity need its values.
  c.identityOptions = c.identity === "azure" && c.anthropicFederation
    ? needAll(env, "CHAT_IDENTITY=azure", { identityEndpoint: "IDENTITY_ENDPOINT", identityHeader: "IDENTITY_HEADER", clientId: "AZURE_CLIENT_ID", audience: "CHAT_IDENTITY_AUDIENCE" })
    : {};
  // Only Vertex is reached through the project; the Anthropic API needs neither value, and a
  // federated deployment on another cloud has no Google project to name.
  if (c.provider === "vertex") {
    if (!c.project) throw new Error("CHAT_PROJECT is not set");
    if (!c.region) throw new Error("CHAT_REGION is not set");
  }
  return c;
}
