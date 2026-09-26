// The environment, read once into one object, so nothing else in lib/ reads process.env and a
// missing value fails at start with its name rather than deep in a request.
import { DEFAULT_QUESTION_INDEX_CHARS } from "./prompt.mjs";

const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);

const need = (env, name) => {
  const v = env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set`);
  return v.trim();
};

const int = (env, name, fallback, { min = 0 } = {}) => {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} is not a whole number: ${v}`);
  if (n < min) throw new Error(`${name} must be at least ${min}: ${v}`);
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

function federationFromEnv(env) {
  const got = Object.fromEntries(Object.entries(FEDERATION).map(([k, name]) => [k, env[name]?.trim() || null]));
  const missing = Object.entries(FEDERATION).filter(([k]) => !got[k]).map(([, name]) => name);
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim() || null;
  if (missing.length === 3) {
    if (workspaceId) throw new Error("ANTHROPIC_WORKSPACE_ID is set without ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID");
    return null;
  }
  if (missing.length) throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set; federation needs all three ids`);
  return { ...got, workspaceId };
}

export function configFromEnv(env = process.env) {
  const c = {
    mcpUrl: need(env, "CHAT_MCP_URL"),
    origins: list(need(env, "CHAT_ORIGINS")),
    hosts: env.CHAT_HOSTS ? list(env.CHAT_HOSTS) : null,
    monthTokens: int(env, "CHAT_MONTH_TOKENS", undefined) ?? (() => { throw new Error("CHAT_MONTH_TOKENS is not set"); })(),
    project: need(env, "CHAT_PROJECT"),
    region: need(env, "CHAT_REGION"),
    proxyHops: int(env, "CHAT_PROXY_HOPS", 1),
    // How many characters of the prompt's question-index line a deployment allows; a title past
    // it is still reached by search, so the number is a prompt-size budget and not a ceiling on
    // what the model can answer. Zero and negative are refused rather than read as "no cap",
    // since an unbounded line is not what either would mean read as English.
    questionIndexChars: int(env, "CHAT_QUESTION_INDEX_CHARS", DEFAULT_QUESTION_INDEX_CHARS, { min: 1 }),
    port: int(env, "PORT", 8080),
    meter: env.CHAT_METER === "memory" ? "memory" : "firestore",
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicFederation: federationFromEnv(env),
  };
  // The SDK lets a key win over federation without a word, so a deployment that still carries
  // its key after the switch would go on spending on the key it meant to retire.
  if (c.anthropicKey && c.anthropicFederation) throw new Error("ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set; set one, since the key would win");
  c.provider = c.anthropicKey || c.anthropicFederation ? "anthropic" : "vertex";
  c.credential = c.anthropicKey ? "key" : c.anthropicFederation ? "federation" : "google";
  return c;
}
