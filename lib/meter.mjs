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

/** @param {{ input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; output_tokens?: number | null }} [usage] */
export function units(usage = {}) {
  /** @param {"input_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens" | "output_tokens"} k */
  const u = (k) => usage[k] ?? 0;
  return Math.ceil(u("input_tokens") * WEIGHTS.input + u("cache_creation_input_tokens") * WEIGHTS.cacheWrite
    + u("cache_read_input_tokens") * WEIGHTS.cacheRead + u("output_tokens") * WEIGHTS.output);
}

export class MemoryStore {
  constructor() {
    /** @type {StoredDoc} */
    this.doc = {};
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve();
  }
  // One function at a time: a call waits for the one before it, so two reserves started in one
  // turn read one another's writes rather than one snapshot.
  /**
   * @template {StoredDoc} D
   * @param {(doc: StoredDoc) => D | Promise<D>} fn
   * @returns {Promise<D>}
   */
  transact(fn) {
    const run = this.queue.then(async () => { this.doc = await fn({ ...this.doc }); return /** @type {D} */ (this.doc); });
    this.queue = run.catch(() => {});
    return run;
  }
}

/** @param {Date} d */
const dayOf = (d) => d.toISOString().slice(0, 10);
/** @param {Date} d */
const monthOf = (d) => d.toISOString().slice(0, 7);

// When a spent day and a spent month lift: the next midnight UTC, and the first of the next
// month at midnight UTC, since the counters roll on those instants and on no others.
/** @param {Date} d */
const nextDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
/** @param {Date} d */
const nextMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

// A document whose day or month is not today's is rolled forward before it is read or written.
/**
 * @param {StoredDoc} doc
 * @param {Date} now
 * @returns {RolledDoc}
 */
function rolled(doc, now) {
  const day = dayOf(now), month = monthOf(now);
  const next = { day, month, dayTokens: doc.dayTokens ?? 0, monthTokens: doc.monthTokens ?? 0, closed: doc.closed === true };
  if (doc.day !== day) next.dayTokens = 0;
  if (doc.month !== month) { next.monthTokens = 0; next.dayTokens = 0; }
  return next;
}

export class Meter {
  /**
   * @param {Store} store
   * @param {{ monthTokens: number; now?: () => Date }} options
   */
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
  /** @param {number} [estimate] */
  async reserve(estimate = ESTIMATE) {
    /** @type {ChatError | null} */
    let refusal = null;
    await this.store.transact((d) => {
      // The store reruns this on contention, and only the last run is the one that commits, so
      // a refusal decided by an earlier run is cleared here rather than thrown after a
      // reservation went through.
      refusal = null;
      const now = this.now();
      const doc = rolled(d, now);
      if (doc.closed) { refusal = new ChatError("closed", "the chat is switched off"); return doc; }
      if (doc.monthTokens + estimate > this.monthCeiling) { refusal = new ChatError("over_month", "this month's share of answers is spent", { retryAt: nextMonth(now) }); return doc; }
      if (doc.dayTokens + estimate > this.dayShare) { refusal = new ChatError("over_day", "today's share of answers is spent; tomorrow there is more", { retryAt: nextDay(now) }); return doc; }
      return { ...doc, dayTokens: doc.dayTokens + estimate, monthTokens: doc.monthTokens + estimate };
    });
    if (refusal) throw refusal;
  }

  // The rolled document it wrote is its answer, so a caller that needs the day's standing after
  // a message reads it here rather than asking the store a third time.
  /**
   * @param {number} estimate
   * @param {number} actual
   */
  async settle(estimate, actual) {
    const delta = actual - estimate;
    return await this.store.transact((d) => {
      const doc = rolled(d, this.now());
      return { ...doc, dayTokens: Math.max(0, doc.dayTokens + delta), monthTokens: Math.max(0, doc.monthTokens + delta) };
    });
  }
}
