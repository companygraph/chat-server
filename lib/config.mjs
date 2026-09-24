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
  };
  c.provider = c.anthropicKey ? "anthropic" : "vertex";
  return c;
}
