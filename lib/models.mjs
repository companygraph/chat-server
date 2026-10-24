// The models a signed-in reader may pick, with what each costs and how long an answer may run.
// One table, so that the picker, the request and the meter read the same figures: the meter's
// unit is one `claude-sonnet-5` input token, and every weight below is a price ratio to it.
// A visitor who is not signed in gets the default and nothing they send changes that.

/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} Effort */
/** @typedef {{ model: string; effort: Effort }} Choice */

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_EFFORT = "low";

// `role` is the name a sign-in grants; every signed-in reader may also pick the default, which
// therefore needs no role. Haiku 5.5's weights are its prices for a prompt of up to 100,000 tokens,
// over which the price list charges five times as much; inference_geo "us" would add 1.1 times to
// every figure, and no deployment sets it.
/** @type {Record<string, { label: string; role: string | null; weights: { input: number; cacheWrite: number; cacheRead: number; output: number } }>} */
export const MODELS = {
  "claude-sonnet-5": { label: "Sonnet 5", role: null, weights: { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } },
  "claude-sonnet-5-5": { label: "Sonnet 5.5", role: "sonnet-5-5", weights: { input: 1, cacheWrite: 1.25, cacheRead: 0.05, output: 5 } },
  "claude-opus-5-5": { label: "Opus 5.5", role: "opus", weights: { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 } },
  "claude-fable-5-1": { label: "Fable 5.1", role: "fable", weights: { input: 5, cacheWrite: 6.25, cacheRead: 0.125, output: 25 } },
  "claude-haiku-5-5": { label: "Haiku 5.5", role: "haiku", weights: { input: 0.05, cacheWrite: 0.0625, cacheRead: 0.005, output: 0.25 } },
};

/** @type {Effort[]} */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** @type {Choice} */
export const DEFAULT_CHOICE = { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT };

const OUTPUT_LIMITS = { low: 2400, medium: 8000, high: 16000, xhigh: 32000, max: 64000 };

/** @param {Effort} effort */
export const outputLimit = (effort) => OUTPUT_LIMITS[effort];

// A higher effort thinks and writes for longer, so a call may not be cut off at the minute that
// is plenty at `low`; fourteen minutes stays inside a platform's quarter hour.
/** @param {Effort} effort */
export const callTimeoutMs = (effort) => (effort === "low" ? 60_000 : 840_000);
