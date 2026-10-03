// The answer, checked. The prompt asks the model to take every claim from a tool's answer and to
// name the entity it rests on, and the loop holds everything needed to hold it to that: the text
// it wrote, the entities the tools returned and what each tool answer said. This reads the answer
// back claim by claim. A claim is found by the answer's form, without a model; a claim naming a
// title the model holds but no tool returned is `unsourced` with no call made; every other claim
// is asked of a judge, which picks one of five verdicts with a probability for each, and the
// evidence it is shown is exactly what the model was shown. The judge is called through the
// function the caller hands in, so this module names none and opens no socket.
// The five options a judge picks among, each described as the judge reads it. `says-nothing` is
// the answer the prompt's third rule asks for when the tools found nothing; its wording is the
// model's, in the visitor's language, so the judge recognizes it rather than a pattern here.
export const CRITERIA = {
  supported: "The evidence says what the claim says.",
  partial: "The evidence says some of what the claim says, and not the rest.",
  contradicted: "The evidence says something the claim contradicts.",
  absent: "The evidence does not say what the claim says.",
  "says-nothing": "The claim says that the model holds nothing on the matter, or that the tools found nothing.",
};

// What counts against an answer in the kept line and the report.
const UNSUPPORTED = new Set(["partial", "contradicted", "absent", "withheld", "unnamed", "unsourced"]);
export const isUnsupported = (verdict) => UNSUPPORTED.has(verdict);

// How long the check may hold back `done` after the last `text`; past it the answer stands
// unchecked and no `verdict` event is sent.
export const VERDICT_BUDGET_MS = 1000;

// Jev reads 32k tokens of state and longest question in one request. Counted in characters, at
// three to a token, a message whose evidence is past this is left unchecked rather than refused.
export const STATE_BUDGET = 90_000;

// The claims of an answer, by its form: each sentence of a paragraph line, split in the
// visitor's language; each list item; each table row but the header. A heading, a fenced block
// and a table's separator are not claims, and neither is a line that only introduces what
// follows it, which ends in a colon. Each claim keeps its place in the answer's text, which is
// the concatenated `text` events the widget renders, so the widget can mark it where it stands.
/**
 * @param {string} text
 * @param {string} [lang]
 * @returns {{ from: number; to: number; text: string }[]}
 */
export function claimsOf(text, lang = "en") {
  const segmenter = new Intl.Segmenter(lang === "de" ? "de" : "en", { granularity: "sentence" });
  const out = [];
  let at = 0, fenced = false, inTable = false;
  for (const line of text.split("\n")) {
    const start = at;
    at += line.length + 1;
    const t = line.trim();
    if (t.startsWith("```")) { fenced = !fenced; inTable = false; continue; }
    if (fenced || !t || /^#{1,6}\s/.test(t)) { inTable = false; continue; }
    if (t.startsWith("|")) {
      const header = !inTable;
      inTable = true;
      if (header || /^\|[\s:|-]+$/.test(t)) continue;
      out.push({ from: start + line.indexOf("|"), to: start + line.trimEnd().length, text: t });
      continue;
    }
    inTable = false;
    const item = /^(\s*(?:[-*+]|\d+[.)])\s+)(\S(?:.*\S)?)\s*$/.exec(line);
    if (item) {
      out.push({ from: start + item[1].length, to: start + item[1].length + item[2].length, text: item[2] });
      continue;
    }
    for (const s of segmenter.segment(line)) {
      const body = s.segment.trim();
      if (!body) continue;
      const lead = s.segment.length - s.segment.trimStart().length;
      out.push({ from: start + s.index + lead, to: start + s.index + lead + body.length, text: body });
    }
  }
  return out.filter((c) => !/:\**\s*$/.test(c.text));
}

// The widget's own match, so a claim names exactly the entities the widget links in it: a title
// as written, longest first, never inside a word, and never inside a longer title already taken.
/**
 * @param {string} text
 * @param {number} at
 * @param {number} len
 */
const edged = (text, at, len) => {
  const before = at > 0 ? text.charAt(at - 1) : " ", after = at + len < text.length ? text.charAt(at + len) : " ";
  return !/[0-9A-Za-z]/.test(before) && !/[0-9A-Za-z]/.test(after);
};

/**
 * @param {string} text
 * @param {{ id: string; title: string }[]} titles
 * @returns {string[]}
 */
export function namedIn(text, titles) {
  const taken = /** @type {[number, number][]} */ ([]);
  const ids = [];
  for (const { id, title } of [...titles].sort((a, b) => b.title.length - a.title.length)) {
    for (let at = text.indexOf(title); at >= 0; at = text.indexOf(title, at + 1)) {
      if (!edged(text, at, title.length) || taken.some(([f, t]) => at < t && at + title.length > f)) continue;
      taken.push([at, at + title.length]);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// One message, checked. `returned` is every entity a tool returned in it, by id and title;
// `index` is every title the model holds; `evidence` maps an id to the text of the tool answer
// that carried it, as the model was given it; `answers` is every tool answer of the message,
// those that found nothing among them; `calls` and `empty` are the loop's counts. The
// judge takes `{ state, questions }` and answers each question id with `{ pick, probabilities }`.
// A message with no claims needs no judge. Its answer is null where the evidence is too large to
// send, so the caller sends no verdict rather than a partial one.
/**
 * @typedef {{ from: number; to: number; ids: string[]; verdict: string; p: number | null }} Claim
 * @typedef {{ state: { answers: Record<string, string> }; questions: Record<string, { claim: string; evidence: string[] }> }} JudgeRequest
 * @typedef {(request: JudgeRequest) => Promise<Record<string, { pick: string; probabilities: Record<string, number> }>>} Judge
 * @param {{ text: string; lang: string | null; returned: { id: string; title: string }[]; index: { id: string; title: string }[]; evidence: Map<string, string>; answers: string[]; calls: number; empty: number }} message
 * @param {Judge} judge
 * @returns {Promise<{ claims: Claim[] } | null>}
 */
export async function verdictOf(message, judge) {
  const returnedIds = new Set(message.returned.map((r) => r.id));
  const titles = [...message.returned, ...message.index.filter((t) => !returnedIds.has(t.id))];
  /** @type {Claim[]} */
  const claims = [];
  /** @type {{ claim: Claim; text: string }[]} */
  const asked = [];
  for (const c of claimsOf(message.text, message.lang ?? "en")) {
    const all = namedIn(c.text, titles);
    const claim = { from: c.from, to: c.to, ids: all.filter((id) => returnedIds.has(id)), verdict: "", p: null };
    claims.push(claim);
    if (all.some((id) => !returnedIds.has(id))) claim.verdict = "unsourced";
    else asked.push({ claim, text: c.text });
  }
  if (!asked.length) return { claims };
  // The state carries each tool answer once, however many claims rest on it; a claim naming no
  // entity is read against every answer of the message, the empty ones too, which is how the
  // judge can tell the honest nothing from a claim with nothing under it.
  /** @type {Record<string, string>} */
  const answers = {};
  const keyOf = new Map();
  /** @param {(string | undefined)[]} texts */
  const keysOf = (texts) => [...new Set(texts.filter((t) => typeof t === "string").map((t) => {
    if (!keyOf.has(t)) { keyOf.set(t, `a${keyOf.size + 1}`); answers[keyOf.get(t)] = t; }
    return keyOf.get(t);
  }))];
  /** @type {JudgeRequest["questions"]} */
  const questions = {};
  asked.forEach(({ claim, text }, i) => {
    questions[`c${i + 1}`] = { claim: text, evidence: keysOf(claim.ids.length ? claim.ids.map((id) => message.evidence.get(id)) : message.answers) };
  });
  if (JSON.stringify(answers).length > STATE_BUDGET) return null;
  const got = await judge({ state: { answers }, questions });
  asked.forEach(({ claim }, i) => {
    const a = got[`c${i + 1}`];
    if (!a) throw new Error(`the judge gave no verdict for c${i + 1}`);
    const p = a.probabilities[a.pick] ?? null;
    if (a.pick === "says-nothing") {
      // The tools found something and the answer said they did not.
      claim.verdict = message.calls > message.empty ? "withheld" : "says-nothing";
      claim.p = p;
    } else if (!claim.ids.length) {
      // A claim naming no entity breaks the second rule, whatever the judge made of it; its
      // probability is that it is not the honest nothing.
      claim.verdict = "unnamed";
      claim.p = 1 - (a.probabilities["says-nothing"] ?? 0);
    } else {
      claim.verdict = a.pick;
      claim.p = p;
    }
  });
  return { claims };
}

// The check as the loop runs it: within the budget, or not at all. A judge that fails or
// overruns leaves the answer unchecked, never in error.
/**
 * @param {Parameters<typeof verdictOf>[0]} message
 * @param {(request: JudgeRequest, options: { signal: AbortSignal }) => ReturnType<Judge>} judge
 * @param {number} [ms]
 */
export async function checked(message, judge, ms = VERDICT_BUDGET_MS) {
  const ac = new AbortController();
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    return await Promise.race([
      verdictOf(message, (request) => judge(request, { signal: ac.signal })),
      new Promise((_, refuse) => { timer = setTimeout(() => { ac.abort(); refuse(new Error("over budget")); }, ms); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// What the loop needs: a function of the message that answers the `verdict` event and the two
// counts, or null. The title index is the host's, read outside the budget, since it is the
// host's to keep and not this message's to wait on. A threshold marks claims only in English,
// the one language the measuring has read; a German answer is checked and kept, and the widget
// marks nothing in it until a German threshold is measured.
/**
 * @param {{ judge: Parameters<typeof checked>[1]; titles: () => Promise<{ id: string; title: string }[]>; threshold: number | null; budget?: number }} options
 */
export function verdictCheck({ judge, titles, threshold, budget = VERDICT_BUDGET_MS }) {
  /** @param {Omit<Parameters<typeof verdictOf>[0], "index">} message */
  return async (message) => {
    const index = await titles().catch(() => []);
    const r = await checked({ ...message, index }, judge, budget);
    if (!r) return null;
    return {
      event: { claims: r.claims, threshold: message.lang === "en" ? threshold : null },
      claims: r.claims.length,
      unsupported: r.claims.filter((c) => isUnsupported(c.verdict)).length,
    };
  };
}
