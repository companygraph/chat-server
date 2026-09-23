// Every refusal this service makes, as a code beside a sentence: the code for the widget, which
// turns it into a sentence in the visitor's language, the sentence for a reader of the raw
// answer. A refusal costs no tokens by construction — it is made before the model is asked.
export const CODES = {
  bad_request: 400,
  too_long: 400,
  foreign: 403,
  busy: 429,
  over_day: 429,
  over_month: 429,
  host_down: 502,
  closed: 503,
};

// A refusal for a limit that lifts by itself names the moment it lifts, because the widget
// would otherwise guess it, and guessed wrong for the bucket's hour. The moment is kept as the
// ISO time the body will carry, so the error says what the client reads.
export class ChatError extends Error {
  constructor(code, message, { retryAt } = {}) {
    if (!Object.hasOwn(CODES, code)) throw new Error(`unknown code ${code}`);
    super(message);
    this.code = code;
    this.status = CODES[code];
    if (retryAt !== undefined) this.retryAt = new Date(retryAt).toISOString();
  }
}

export const refusal = (err) => ({ error: { code: err.code, message: err.message, ...(err.retryAt ? { retryAt: err.retryAt } : {}) } });
