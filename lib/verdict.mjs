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
  connective: "The sentence states nothing about the matter: it introduces what follows, says what the answer is about to do, or offers more.",
};

// What counts against an answer in the kept line and the report.
const UNSUPPORTED = new Set(["partial", "contradicted", "absent", "withheld", "unnamed", "unsourced"]);
/** @param {string} verdict */
export const isUnsupported = (verdict) => UNSUPPORTED.has(verdict);

// How long the check may hold back `done` after the last `text`; past it the answer stands
// unchecked and no `verdict` event is sent.
export const VERDICT_BUDGET_MS = 1000;

// Jev reads 32k tokens of state and longest question, and 64k for the whole request. Counted in
// characters at two and a half to a token, since tool answers are JSON full of ids, a message
// past either is left unchecked rather than refused.
export const STATE_BUDGET = 78_000;
export const REQUEST_BUDGET = 160_000;
// What every question repeats beside its claim: the options and the instruction.
const QUESTION_OVERHEAD = 700;

// The answer's own language, read from its words: the prompt answers in the visitor's language,
// whatever the page's, so a German answer can come from an English page. None where too few of
// the common words of either language stand in it to say.
const DE = new Set("der die das und ist nicht mit im sich auf ein eine den dem zu von für wird sind auch noch wie bei aus".split(" "));
const EN = new Set("the and is not with in of to a an it that on for was are also still as at from by".split(" "));
/** @param {string} text */
export function languageOf(text) {
  let de = 0, en = 0;
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (DE.has(w)) de++;
    if (EN.has(w)) en++;
  }
  if (de + en < 3 || de === en) return null;
  return de > en ? "de" : "en";
}

// A stop that does not end a sentence: an ordinal or a day before its month, and the common
// abbreviations of both languages. ICU's rules split there, so the pieces are joined again.
const NOT_AN_END = /(?:\b\d{1,3}\.|\b(?:z|B|d|h|u|a|s|o|Dr|Mr|Mrs|Ms|Prof|St|Nr|bzw|ca|vs|etc|e\.g|i\.e)\.)\s*$/;

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
  for (const whole of text.split("\n")) {
    let start = at;
    at += whole.length + 1;
    // A quote's marker is not part of what it claims.
    const quote = /^\s*(?:>\s?)+/.exec(whole);
    const line = quote ? whole.slice(quote[0].length) : whole;
    if (quote) start += quote[0].length;
    const t = line.trim();
    if (/^(?:```|~~~)/.test(t)) { fenced = !fenced; inTable = false; continue; }
    if (fenced || !t || /^#{1,6}\s/.test(t) || /^(\*\*|__)[^*_]+\1$/.test(t)) { inTable = false; continue; }
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
    // ICU's sentences, joined again where a stop ends no sentence, and parted again where two
    // rounds' text met with no space between a stop and the next capital.
    const pieces = [];
    for (const s of segmenter.segment(line)) {
      const last = pieces[pieces.length - 1];
      if (last && (NOT_AN_END.test(last.segment) || /^\s*\p{Ll}/u.test(s.segment))) last.segment += s.segment;
      else pieces.push({ index: s.index, segment: s.segment });
    }
    for (const piece of pieces) {
      let offset = 0;
      for (const part of piece.segment.split(/(?<=\p{Ll}[.!?])(?=\p{Lu})/u)) {
        const body = part.trim();
        if (body) {
          const lead = part.length - part.trimStart().length;
          out.push({ from: start + piece.index + offset + lead, to: start + piece.index + offset + lead + body.length, text: body });
        }
        offset += part.length;
      }
    }
  }
  // A line that only introduces what follows, and a question, claim nothing.
  return out.filter((c) => !/:\**\s*$/.test(c.text) && !/\?\**\s*$/.test(c.text));
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
  // Inline code is not prose: a title inside it is masked, its length kept so places hold.
  text = text.replace(/`[^`]*`/g, (code) => " ".repeat(code.length));
  const taken = /** @type {[number, number][]} */ ([]);
  const ids = /** @type {string[]} */ ([]);
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
// `index` is every title the model holds, and `promptTitles` those the prompt itself gave the
// model; `evidence` maps an id to the text of every tool answer that carried it, as the model was
// given each; `answers` is every tool answer of the message, those that found nothing among them;
// `calls` and `empty` are the loop's counts. The judge takes `{ state, questions }` and answers
// each question id with `{ pick, probabilities }`. A message with no claims needs no judge. Where
// the request would be larger than the judge reads, the answer is `{ failed: "too_large" }`, so
// the caller sends no verdict rather than a partial one.
/**
 * @typedef {{ from: number; to: number; ids: string[]; verdict: string; p: number | null }} Claim
 * @typedef {{ state: { answers: Record<string, string> }; questions: Record<string, { claim: string; evidence: string[] }> }} JudgeRequest
 * @typedef {(request: JudgeRequest) => Promise<Record<string, { pick: string; probabilities: Record<string, number> }>>} Judge
 * @param {{ text: string; lang: string | null; returned: { id: string; title: string }[]; index: { id: string; title: string }[]; promptTitles?: string[]; evidence: Map<string, string[]>; answers: string[]; calls: number; empty: number }} message
 * @param {Judge} judge
 * @returns {Promise<{ claims: Claim[] } | { failed: string }>}
 */
export async function verdictOf(message, judge) {
  const returnedIds = new Set(message.returned.map((r) => r.id));
  const titles = [...message.returned, ...message.index.filter((t) => !returnedIds.has(t.id))];
  // A title is ground for unsourced only where it could not be a common word, and only where the
  // model did not have it from the prompt itself: a one-word title reads as prose as often as
  // a name.
  const prompted = new Set(message.promptTitles ?? []);
  const titleOf = new Map(titles.map((t) => [t.id, t.title]));
  /** @param {string} id */
  const sourcing = (id) => !returnedIds.has(id) && /\s/.test(titleOf.get(id) ?? "") && !prompted.has(/** @type {string} */ (titleOf.get(id)));
  /** @type {Claim[]} */
  const claims = [];
  /** @type {{ claim: Claim; text: string }[]} */
  const asked = [];
  for (const c of claimsOf(message.text, languageOf(message.text) ?? message.lang ?? "en")) {
    const all = namedIn(c.text, titles);
    const claim = { from: c.from, to: c.to, ids: all.filter((id) => returnedIds.has(id)), verdict: "", p: null };
    claims.push(claim);
    if (all.some(sourcing)) claim.verdict = "unsourced";
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
  const keysOf = (texts) => [...new Set(texts.flat().filter((t) => typeof t === "string").map((t) => {
    if (!keyOf.has(t)) { keyOf.set(t, `a${keyOf.size + 1}`); answers[keyOf.get(t)] = t; }
    return keyOf.get(t);
  }))];
  /** @type {JudgeRequest["questions"]} */
  const questions = {};
  asked.forEach(({ claim, text }, i) => {
    questions[`c${i + 1}`] = { claim: text, evidence: keysOf(claim.ids.length ? claim.ids.flatMap((id) => message.evidence.get(id) ?? []) : message.answers) };
  });
  const state = JSON.stringify(answers).length;
  const total = state + Object.values(questions).reduce((n, q) => n + JSON.stringify(q).length + QUESTION_OVERHEAD, 0);
  if (state > STATE_BUDGET || total > REQUEST_BUDGET) return { failed: "too_large" };
  const got = await judge({ state: { answers }, questions });
  asked.forEach(({ claim }, i) => {
    const a = got[`c${i + 1}`];
    if (!a) throw new Error(`the judge gave no verdict for c${i + 1}`);
    const p = a.probabilities[a.pick] ?? null;
    if (a.pick === "connective") {
      claim.verdict = "connective";
    } else if (a.pick === "says-nothing") {
      // The tools found something and the answer said they did not.
      claim.verdict = message.calls > message.empty ? "withheld" : "says-nothing";
      claim.p = p;
    } else if (!claim.ids.length && (a.pick === "absent" || a.pick === "contradicted")) {
      // A claim naming no entity that the tool answers do not carry has nothing under it: it is
      // unnamed, and its probability is that it is not the honest nothing. One they carry keeps
      // the judge's verdict, since a claim about a type, read from the schema, has no entity it
      // could name.
      claim.verdict = "unnamed";
      claim.p = 1 - (a.probabilities["says-nothing"] ?? 0);
    } else {
      claim.verdict = a.pick;
      claim.p = p;
    }
  });
  return { claims: claims.filter((c) => c.verdict !== "connective") };
}

// The check as the loop runs it: within the budget, or not at all. A judge that fails or
// overruns leaves the answer unchecked, never in error, and says why as `failed`. The request's
// own signal reaches the judge, so a visitor who leaves stops the call too.
/**
 * @param {Parameters<typeof verdictOf>[0] & { signal?: AbortSignal | undefined }} message
 * @param {(request: JudgeRequest, options: { signal: AbortSignal }) => ReturnType<Judge>} judge
 * @param {number} [ms]
 * @returns {Promise<{ claims: Claim[] } | { failed: string }>}
 */
export async function checked(message, judge, ms = VERDICT_BUDGET_MS) {
  const ac = new AbortController();
  const stop = () => ac.abort();
  message.signal?.addEventListener("abort", stop);
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    return await Promise.race([
      verdictOf(message, (request) => judge(request, { signal: ac.signal })),
      new Promise((_, refuse) => { timer = setTimeout(() => { ac.abort(); refuse(new Error("budget")); }, ms); }),
    ]);
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    message.signal?.removeEventListener("abort", stop);
  }
}

// What the loop needs: a function of the message that answers the `verdict` event and the two
// counts, or null. The title index is the host's, answered at once from what it holds, so no
// message waits on it. A threshold marks claims only in an answer written in English, the one
// language the measuring has read, whatever the page's language; a German answer is checked and
// kept, and the widget marks nothing in it until a German threshold is measured. A check that
// could not run says why in `warn`, with no word of the answer and no key.
/**
 * @param {{ judge: Parameters<typeof checked>[1]; titles: () => { id: string; title: string }[] | Promise<{ id: string; title: string }[]>; promptTitles?: () => string[] | Promise<string[]>; threshold: number | null; budget?: number; warn?: (fields: { reason: string }) => void }} options
 */
export function verdictCheck({ judge, titles, promptTitles = () => [], threshold, budget = VERDICT_BUDGET_MS, warn = () => {} }) {
  const settled = async (/** @type {() => any} */ read) => { try { return (await read()) ?? []; } catch { return []; } };
  /** @param {Omit<Parameters<typeof checked>[0], "index" | "promptTitles">} message */
  return async (message) => {
    const r = await checked({ ...message, index: await settled(titles), promptTitles: await settled(promptTitles) }, judge, budget);
    if ("failed" in r) {
      warn({ reason: r.failed });
      return null;
    }
    const written = languageOf(message.text) ?? message.lang;
    return {
      event: { claims: r.claims, threshold: written === "en" ? threshold : null },
      claims: r.claims.length,
      unsupported: r.claims.filter((c) => isUnsupported(c.verdict)).length,
    };
  };
}
