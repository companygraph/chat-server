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

export class ChatError extends Error {
  constructor(code, message) {
    if (!(code in CODES)) throw new Error(`unknown code ${code}`);
    super(message);
    this.code = code;
    this.status = CODES[code];
  }
}

export const refusal = (err) => ({ error: { code: err.code, message: err.message } });
