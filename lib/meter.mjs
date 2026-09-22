// The cap. Google's quotas bound a minute and its budgets send mail; this counts what the model
// reports and refuses the next message once the day's share or the month's ceiling is spent.
// The unit is the input-equivalent token, the model's own price ratios, so the ceiling a
// deployment writes down is the money it means.
//
// The counters live in a store outside the instance, because an instance dies after fifteen
// idle minutes and three instances would each hold a third of the truth. The store runs one
// function against one document, atomically; MemoryStore is the suite's, FirestoreStore the
// deployment's.
import { ChatError } from "./errors.mjs";
import { WEIGHTS } from "./model.mjs";

export const ESTIMATE = 30000;

export function units(usage = {}) {
  const u = (k) => usage[k] ?? 0;
  return Math.ceil(u("input_tokens") * WEIGHTS.input + u("cache_creation_input_tokens") * WEIGHTS.cacheWrite
    + u("cache_read_input_tokens") * WEIGHTS.cacheRead + u("output_tokens") * WEIGHTS.output);
}

export class MemoryStore {
  constructor() { this.doc = {}; }
  async transact(fn) { this.doc = await fn({ ...this.doc }); return this.doc; }
}

const dayOf = (d) => d.toISOString().slice(0, 10);
const monthOf = (d) => d.toISOString().slice(0, 7);

// A document whose day or month is not today's is rolled forward before it is read or written.
function rolled(doc, now) {
  const day = dayOf(now), month = monthOf(now);
  const next = { day, month, dayTokens: doc.dayTokens ?? 0, monthTokens: doc.monthTokens ?? 0, closed: doc.closed === true };
  if (doc.day !== day) next.dayTokens = 0;
  if (doc.month !== month) { next.monthTokens = 0; next.dayTokens = 0; }
  return next;
}

export class Meter {
  constructor(store, { monthTokens, now = () => new Date() }) {
    this.store = store;
    this.monthCeiling = monthTokens;
    this.dayShare = Math.floor(monthTokens / 10);
    this.now = now;
  }

  async state() {
    const doc = await this.store.transact((d) => rolled(d, this.now()));
    return { ...doc, dayShare: this.dayShare, monthCeiling: this.monthCeiling };
  }

  // Add before the call, so that concurrent messages cannot each pass the same reading; refuse
  // and take the addition back when the addition itself crosses a line.
  async reserve(estimate = ESTIMATE) {
    let refusal = null;
    await this.store.transact((d) => {
      const doc = rolled(d, this.now());
      if (doc.closed) { refusal = new ChatError("closed", "the chat is switched off"); return doc; }
      if (doc.monthTokens + estimate > this.monthCeiling) { refusal = new ChatError("over_month", "this month's share of answers is spent"); return doc; }
      if (doc.dayTokens + estimate > this.dayShare) { refusal = new ChatError("over_day", "today's share of answers is spent; tomorrow there is more"); return doc; }
      return { ...doc, dayTokens: doc.dayTokens + estimate, monthTokens: doc.monthTokens + estimate };
    });
    if (refusal) throw refusal;
  }

  async settle(estimate, actual) {
    const delta = actual - estimate;
    await this.store.transact((d) => {
      const doc = rolled(d, this.now());
      return { ...doc, dayTokens: Math.max(0, doc.dayTokens + delta), monthTokens: Math.max(0, doc.monthTokens + delta) };
    });
  }
}
