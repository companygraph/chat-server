# The answer is checked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Where a deployment turns it on, the chat reads its own answer back claim by claim against the tool answers the model was given, asks TypeSafe's Jev whether those answers carry each claim, sends the widget a `verdict` event before `done`, and keeps two counts in the line and the weekly report; then the three sites' privacy pages name TypeSafe before any deployment turns it on.

**Architecture:** `lib/verdict.mjs` is pure: it finds claims by the answer's Markdown form, names the entities each writes the way the widget links them, settles `unsourced` with no call, builds one judge request per message, and maps the judge's picks to verdicts. `lib/typesafe.mjs` is the only file naming the judge. `lib/host.mjs` gains a title index, read once per host commit, so a title the model holds and no tool returned can be told from none. `lib/loop.mjs` keeps the text, the returned entities and their tool answers as it goes, and runs the check after the last `text` within a one-second budget. Config, the kept line, the report, the Google Terraform module and the docs follow. A measuring script runs the real loop over the fixture host by hand with a key.

**Tech Stack:** Node 22 ESM, `node --test`, the fixture MCP host over the meta-model's worked example, Terraform for Google Cloud Run.

**Spec:** `docs/superpowers/specs/2026-09-26-the-answer-is-checked-design.md` (merged at `580f754`, with the owner's decisions of October 3, 2026).

## Global Constraints

- The check is off by default: `CHAT_VERDICT` unset or `false` changes nothing a deployment sends or keeps, and with it `true` the service refuses to start without `TYPESAFE_API_KEY`.
- The judge is `jev-1.13.0` at `https://api.typesafe.ai/v1/systemone`, pinned, called once per message with no retry, its key in a header and never in an error.
- The `verdict` event comes after the last `text` and before `done`, and a check that fails or overruns `VERDICT_BUDGET_MS` (1000) sends no `verdict` and never an `error`.
- The evidence of a claim is the tool answer that carried each entity it names, cut by `truncate` exactly as the model was given it, never more.
- `threshold` in the event is the deployment's `CHAT_VERDICT_THRESHOLD` for an English answer and null otherwise; with none set, the widget marks nothing.
- The kept line carries `claims` and `unsupported` only where the check ran, and still no word of the answer.
- `verdict` and `verdict_threshold` are Google fields of `chat.json`; Azure refuses them in this release.
- Nothing is turned on, released or measured with a key in this plan: those are the owner's.
- Commits and PR bodies are prose in the git register, ending `Verified: …` before the trailers. Code commits are authored `Implementer <implementer@companygraph.io>` with `Process: Delivery`, `Phase: Implement`, `Track: Code`; the privacy pages' English is the Writer's and its German the Translator's, at each site's governing domain.
- Before any `node`, `npm`, `terraform` or `gh`: `export PATH="/opt/homebrew/bin:$PATH"`. `npm test` fetches the fixtures first (`pretest`).
- American English (R14); no counts or versions that move in any prose.

## Rulings this plan makes on the spec

- §4 sends all claims "in one request, each a question with its own state". In Jev's API a request has one state for all its questions. The state is the message's tool answers, each once, keyed `a1`…`an`, and each question names the keys its claim rests on.
- §8 says a claim naming no title is `unnamed` "with no call made". That would count the honest "the model holds nothing on that" against every answer whose search found nothing. A claim naming no entity is asked against every tool answer of the message, the empty ones too: the judge's `says-nothing` makes it `says-nothing` or `withheld`, and anything else makes it `unnamed`. A dry run against the live judge got all 16 of its English and German cases right this way, and 14 of 16 the other way.
- §3 leaves connective prose to the judge, but no option of the five describes it. A line ending in a colon, a table's header row, a heading and a fenced block are not claims at all.
- `list_entities` answers one type at a time, so the title index walks the type map, two hundred to a page, at most 100 pages, and is started as the service comes up when the check is on.

## Review Focus

- A message whose tool answers are larger than Jev reads in one request: a person expects the answer to stand unchecked, with no `verdict` event and no counts, never an error. Task 1 tests `STATE_BUDGET`.
- A German answer: sentences split by German rules, verdicts kept and counted, and `threshold` null so nothing is marked until German is measured. Tasks 1 and 8 test it.
- A visitor who closes the tab while the check runs: nothing more is emitted and nothing is kept as checked. Task 4 keeps the loop's abort return ahead of the check, and the check's own result is dropped if the abort lands while it runs.
- A host whose type map or entity pages fail: the title index keeps what it had, and an empty index only means no claim is `unsourced`. Task 3 tests a failed read.
- A deployment that re-pins without touching `chat.json`: nothing changes. Tasks 5 and 7 test the default.

---

### Task 1: Claims, names and the verdict of a message

**Files:**

- Create: `lib/verdict.mjs`
- Test: `test/verdict.test.mjs`

**Interfaces:**

- Produces, from `lib/verdict.mjs`: `CRITERIA` (the five options, in order `supported`, `partial`, `contradicted`, `absent`, `says-nothing`); `isUnsupported(verdict): boolean`; `VERDICT_BUDGET_MS` (1000); `STATE_BUDGET` (90000); `claimsOf(text, lang): { from, to, text }[]`; `namedIn(text, titles): string[]`; `verdictOf(message, judge): Promise<{ claims } | null>` where `message` is `{ text, lang, returned, index, evidence: Map<id, text>, answers: string[], calls, empty }` and `judge({ state: { answers }, questions })` answers `{ [id]: { pick, probabilities } }`; `checked(message, judge, ms?)`; `verdictCheck({ judge, titles, threshold, budget? })` returning `async (message without index) => { event: { claims, threshold }, claims, unsupported } | null`.

- [ ] **Step 1: Write the failing tests**

Create `test/verdict.test.mjs`:

````js
// The answer, checked: claims found by the answer's form, the entities each names, the findings
// that need no judge, and what a scripted judge's answers become. No live service is reached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsOf, namedIn, verdictOf, checked, verdictCheck, isUnsupported, CRITERIA, STATE_BUDGET } from "../lib/verdict.mjs";

const at = (text, c) => text.slice(c.from, c.to);

test("a claim is a sentence, a list item or a table row, each kept with its place in the text", () => {
  const text = "Mira led it. She split the service.\n\nWhat it drew on:\n\n- Java Programming\n- Domain-Driven Design\n\n| Skill | Level |\n| --- | --- |\n| Java Programming | Expert |\n";
  const claims = claimsOf(text, "en");
  assert.deepEqual(claims.map((c) => c.text), ["Mira led it.", "She split the service.", "Java Programming", "Domain-Driven Design", "| Java Programming | Expert |"]);
  for (const c of claims) assert.equal(at(text, c), c.text);
});

test("a heading, a fenced block, a table's header and a line that only introduces are not claims", () => {
  const text = "## The skills\n\n```\nnot = a claim\n```\n\n**These are the ones:**\n\n| Skill |\n| --- |\n| Java Programming |";
  assert.deepEqual(claimsOf(text, "en").map((c) => c.text), ["| Java Programming |"]);
});

test("German is split in German, and an abbreviation's stop still ends a sentence there", () => {
  assert.deepEqual(claimsOf("Sie begann im Februar 2022. Danach folgte die Aufteilung.", "de").map((c) => c.text), ["Sie begann im Februar 2022.", "Danach folgte die Aufteilung."]);
  // ICU's sentence rules do not know "z. B.", so it splits there; a claim cut in two is judged
  // as two, which the measuring of German answers counts.
  assert.ok(claimsOf("Sie begann z. B. im Februar 2022.", "de").length > 1);
});

test("a claim names what the widget would link: whole titles, the longest first, never inside a word", () => {
  const titles = [{ id: "a", title: "Design" }, { id: "b", title: "Domain-Driven Design" }, { id: "c", title: "Java" }];
  assert.deepEqual(namedIn("It drew on Domain-Driven Design and Javascript.", titles), ["b"]);
  assert.deepEqual(namedIn("**Java** and Design.", titles).sort(), ["a", "c"]);
});

const message = (over = {}) => ({
  text: "Splitting the billing domain began in February 2022.",
  lang: "en",
  returned: [{ id: "x", title: "Splitting the billing domain" }],
  index: [{ id: "x", title: "Splitting the billing domain" }, { id: "r", title: "Release" }],
  evidence: new Map([["x", "start: 2022-02"]]),
  answers: ["start: 2022-02"],
  calls: 1, empty: 0,
  ...over,
});
const judging = (pick, probabilities = { [pick]: 0.9 }) => {
  const seen = [];
  const judge = async (request) => { seen.push(request); return Object.fromEntries(Object.keys(request.questions).map((id) => [id, { pick, probabilities }])); };
  return { seen, judge };
};

test("a claim the evidence carries is supported, and the judge was shown that evidence and no more", async () => {
  const { seen, judge } = judging("supported");
  const r = await verdictOf(message(), judge);
  assert.deepEqual(r.claims, [{ from: 0, to: 52, ids: ["x"], verdict: "supported", p: 0.9 }]);
  assert.deepEqual(seen[0], { state: { answers: { a1: "start: 2022-02" } }, questions: { c1: { claim: "Splitting the billing domain began in February 2022.", evidence: ["a1"] } } });
});

test("a claim naming a title no tool returned is unsourced, with no call made", async () => {
  const { seen, judge } = judging("supported");
  const r = await verdictOf(message({ text: "The Release phase follows." }), judge);
  assert.equal(r.claims[0].verdict, "unsourced");
  assert.equal(seen.length, 0);
});

test("a claim naming no entity is unnamed, read against every answer of the message, the empty ones too", async () => {
  const { seen, judge } = judging("absent", { absent: 0.8, "says-nothing": 0.1 });
  const r = await verdictOf(message({ text: "It went well.", answers: ["start: 2022-02", '{"results":[]}'] }), judge);
  assert.equal(r.claims[0].verdict, "unnamed");
  assert.equal(r.claims[0].p, 0.9);
  assert.deepEqual(seen[0].questions.c1.evidence, ["a1", "a2"]);
  assert.equal(seen[0].state.answers.a2, '{"results":[]}');
});

test("the honest nothing is says-nothing where the tools found nothing, and withheld where they found something", async () => {
  const { judge } = judging("says-nothing");
  assert.equal((await verdictOf(message({ text: "The model holds nothing on that.", calls: 1, empty: 1 }), judge)).claims[0].verdict, "says-nothing");
  assert.equal((await verdictOf(message({ text: "The model holds nothing on that.", calls: 2, empty: 1 }), judge)).claims[0].verdict, "withheld");
});

test("evidence too large to send leaves the message unchecked", async () => {
  const { seen, judge } = judging("supported");
  assert.equal(await verdictOf(message({ evidence: new Map([["x", "y".repeat(STATE_BUDGET)]]) }), judge), null);
  assert.equal(seen.length, 0);
});

test("a judge that fails or overruns its budget leaves the answer unchecked, never in error", async () => {
  assert.equal(await checked(message(), async () => { throw new Error("down"); }), null);
  let aborted = false;
  const slow = (request, { signal }) => new Promise((done) => { signal.addEventListener("abort", () => { aborted = true; }); setTimeout(() => done({}), 200); });
  assert.equal(await checked(message(), slow, 20), null);
  assert.ok(aborted, "the overrunning call is aborted");
});

test("the check answers the event and the two counts, and marks nothing in German", async () => {
  const { judge } = judging("contradicted");
  const check = verdictCheck({ judge, titles: async () => message().index, threshold: 0.8 });
  const { index, ...rest } = message();
  const en = await check(rest);
  assert.deepEqual(en, { event: { claims: [{ from: 0, to: 52, ids: ["x"], verdict: "contradicted", p: 0.9 }], threshold: 0.8 }, claims: 1, unsupported: 1 });
  assert.equal((await check({ ...rest, lang: "de" })).event.threshold, null);
});

test("the five options are the judge's, and what counts against an answer is fixed", () => {
  assert.deepEqual(Object.keys(CRITERIA), ["supported", "partial", "contradicted", "absent", "says-nothing"]);
  assert.deepEqual(["supported", "says-nothing", "partial", "contradicted", "absent", "withheld", "unnamed", "unsourced"].map(isUnsupported), [false, false, true, true, true, true, true, true]);
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/verdict.test.mjs`

Expected: FAIL, `Cannot find module '…/lib/verdict.mjs'`.

- [ ] **Step 3: Write the code**

Create `lib/verdict.mjs`:

````js
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
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/verdict.test.mjs`

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/verdict.mjs test/verdict.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
An answer's claims are found and judged against its evidence

lib/verdict.mjs finds an answer's claims by its form, names the entities each writes the way the widget links them, settles a title no tool returned as unsourced with no call, and asks a judge, which it is handed, about the rest within a one-second budget. The evidence a claim is read against is the tool answer the model was given, and a claim naming no entity is read against every answer of the message, so the honest nothing is told from a claim with nothing under it.

Verified: node --test test/verdict.test.mjs passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 2: The judge, in one file

**Files:**

- Create: `lib/typesafe.mjs`
- Test: `test/typesafe.test.mjs`

**Interfaces:**

- Consumes `CRITERIA` and the request shape of Task 1. Produces, from `lib/typesafe.mjs`: `MODEL` (`jev-1.13.0`); `wireOf(request)`; `typesafeJudge({ key, url?, fetch? })` returning `async (request, { signal }?) => { [id]: { pick, probabilities } }`.

- [ ] **Step 1: Write the failing tests**

Create `test/typesafe.test.mjs`:

````js
// The judge's wire: a request of lib/verdict.mjs as TypeSafe reads it, and its answers back. A
// fake fetch stands in for the service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wireOf, typesafeJudge, MODEL } from "../lib/typesafe.mjs";
import { CRITERIA } from "../lib/verdict.mjs";

const request = { state: { answers: { a1: "start: 2022-02" } }, questions: { c1: { claim: "It began in 2022.", evidence: ["a1"] } } };
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("each claim is a choice among the five verdicts, on the pinned model, with the state as given", () => {
  const wire = wireOf(request);
  assert.equal(wire.model, MODEL);
  assert.deepEqual(wire.state, request.state);
  assert.equal(wire.questions.c1.type, "choice");
  assert.equal(wire.questions.c1.instructions.claim, "It began in 2022.");
  assert.deepEqual(wire.questions.c1.instructions.evidence, ["a1"]);
  assert.deepEqual(wire.questions.c1.criteria, CRITERIA);
});

test("the answers come back as picks with their probabilities, the key in a header and never in an error", async () => {
  const sent = [];
  const judge = typesafeJudge({ key: "sk-secret", fetch: async (url, init) => { sent.push(init); return reply(200, { answers: { c1: { type: "choice", choice: "supported", probabilities: { supported: 0.9 }, confidence: 0.8 } } }); } });
  assert.deepEqual(await judge(request), { c1: { pick: "supported", probabilities: { supported: 0.9 } } });
  assert.equal(sent[0].headers.authorization, "Bearer sk-secret");
  const failing = typesafeJudge({ key: "sk-secret", fetch: async () => reply(500, {}) });
  await assert.rejects(failing(request), (e) => /TypeSafe answered 500/.test(e.message) && !e.message.includes("sk-secret"));
  const empty = typesafeJudge({ key: "k", fetch: async () => reply(200, { answers: {} }) });
  await assert.rejects(empty(request), /gave no choice for c1/);
});

test("the caller's signal reaches the request, so an overrun is cancelled", async () => {
  const ac = new AbortController();
  let got;
  await typesafeJudge({ key: "k", fetch: async (url, init) => { got = init.signal; return reply(200, { answers: { c1: { type: "choice", choice: "absent" } } }); } })(request, { signal: ac.signal });
  assert.equal(got, ac.signal);
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/typesafe.test.mjs`

Expected: FAIL, `Cannot find module '…/lib/typesafe.mjs'`.

- [ ] **Step 3: Write the code**

Create `lib/typesafe.mjs`:

````js
// The one place this package names a judge: TypeSafe's Jev, over its HTTP API
// (https://docs.typesafe.ai/api). A request of lib/verdict.mjs becomes Jev's wire shape here and
// its answers come back in the module's own, so a second judge is a second file beside this one.
// The model is pinned, since a threshold is measured against one model. One attempt and no
// retry: the check has a second to run in, and a retry would only spend it.
import { CRITERIA } from "./verdict.mjs";

export const MODEL = "jev-1.13.0";
const URL_DEFAULT = "https://api.typesafe.ai/v1/systemone";

const QUESTION = "`claim` is a sentence of an answer written from the tool answers in `answers`. Do the answers that `evidence` names carry it?";

/** @param {import("./verdict.mjs").JudgeRequest} request */
export function wireOf({ state, questions }) {
  /** @type {Record<string, object>} */
  const wire = {};
  for (const [id, q] of Object.entries(questions))
    wire[id] = { type: "choice", instructions: { claim: q.claim, evidence: q.evidence, question: QUESTION }, criteria: CRITERIA };
  return { model: MODEL, state, questions: wire };
}

// The key is sent in a header and never appears in an error.
/**
 * @param {{ key: string; url?: string; fetch?: typeof globalThis.fetch }} options
 */
export function typesafeJudge({ key, url = URL_DEFAULT, fetch = globalThis.fetch }) {
  /**
   * @param {import("./verdict.mjs").JudgeRequest} request
   * @param {{ signal?: AbortSignal }} [options]
   */
  return async (request, { signal } = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(wireOf(request)),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`TypeSafe answered ${res.status}`);
    const body = await res.json();
    /** @type {Record<string, { pick: string; probabilities: Record<string, number> }>} */
    const out = {};
    for (const id of Object.keys(request.questions)) {
      const a = body?.answers?.[id];
      if (a?.type !== "choice" || typeof a.choice !== "string") throw new Error(`TypeSafe gave no choice for ${id}`);
      out[id] = { pick: a.choice, probabilities: a.probabilities ?? {} };
    }
    return out;
  };
}
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/typesafe.test.mjs`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/typesafe.mjs test/typesafe.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
TypeSafe's Jev is the judge, named in one file

lib/typesafe.mjs is the only place the package names a judge: each claim becomes a choice among the five verdicts on the pinned jev-1.13.0, with the message's tool answers as the one state, and its picks come back with their probabilities. One attempt and no retry, since the check has a second to run in, and the key stays out of every error.

Verified: node --test test/typesafe.test.mjs passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 3: Every title the model holds

**Files:**

- Modify: `lib/host.mjs`
- Test: `test/titles.test.mjs`

**Interfaces:**

- Produces `host.titles(): Promise<{ id, title }[]>`, read for the commit the host answers from and again when it moves; a failed read keeps what was read, and none was read is `[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/titles.test.mjs`:

````js
// The title index the answer check reads names against: every entity of every type, read from a
// real host once for its commit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connectHost } from "../lib/host.mjs";
import { startFixtureHost, exampleSnapshot, EXAMPLE_ROOT } from "./helpers.mjs";

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

test("the index holds every entity the model holds, by id and title", async () => {
  const titles = await host.titles();
  const entities = exampleSnapshot().entities;
  assert.equal(titles.length, entities.length);
  assert.ok(titles.some((t) => t.title === EXAMPLE_ROOT));
  assert.ok(titles.every((t) => typeof t.id === "string" && typeof t.title === "string"));
});

test("the index is read once for a commit, and a failed read keeps what was read", async () => {
  const first = await host.titles();
  const call = host.call;
  let calls = 0;
  host.call = async (...args) => { calls++; return call(...args); };
  try {
    assert.equal(await host.titles(), first);
    assert.equal(calls, 0, "no page is read again for the same commit");
    host.provenance = { ...host.provenance, commit: "moved" };
    host.call = async () => ({ isError: true, data: null, text: "" });
    assert.equal(await host.titles(), first, "a failed read keeps the titles it had");
  } finally {
    host.call = call;
  }
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/titles.test.mjs`

Expected: FAIL, `host.titles is not a function`.

- [ ] **Step 3: Write the code**

Apply to `lib/host.mjs` (`git apply` takes it as written):

````diff
diff --git a/lib/host.mjs b/lib/host.mjs
index 20c480a..22918ba 100644
--- a/lib/host.mjs
+++ b/lib/host.mjs
@@ -103,6 +103,34 @@ async function fetchQuestionTitles(callFn, cap) {
   }
 }
 
+// Every title the model holds, by id: what the answer check reads a claim's names against, so a
+// title the model holds and no tool returned can be told from no title at all. list_entities
+// answers one type at a time, so this walks the type map, a page of two hundred at a time, and
+// stops at a fixed number of pages in all, the same floor the question titles have. A failure is
+// not this function's to raise: it answers null, and the caller keeps the titles it had.
+const TITLE_PAGE_LIMIT = 100;
+async function fetchTitles(callFn, types) {
+  const titles = [];
+  let pages = 0;
+  try {
+    for (const { type, count } of types) {
+      if (!count) continue;
+      let cursor;
+      do {
+        if (pages++ >= TITLE_PAGE_LIMIT) return titles;
+        const r = await callFn("list_entities", { type, limit: 200, ...(cursor ? { cursor } : {}) });
+        if (r.isError) return null;
+        for (const e of r.data?.entities ?? []) if (typeof e.id === "string" && typeof e.name === "string") titles.push({ id: e.id, title: e.name });
+        const next = r.data?.page?.hasMore === true ? r.data.page.nextCursor ?? null : null;
+        cursor = next && next !== cursor ? next : undefined;
+      } while (cursor);
+    }
+    return titles;
+  } catch {
+    return null;
+  }
+}
+
 async function open(url, questionCap) {
   const client = new Client({ name: "companygraph-chat-server", version: "0" });
   await client.connect(new StreamableHTTPClientTransport(new URL(url)));
@@ -231,6 +259,9 @@ export async function connectHost(url, { questionCap = DEFAULT_QUESTION_INDEX_CH
     return refreshing;
   };
 
+  /** @type {{ id: string; title: string }[] | null} */
+  let titleList = null;
+  let titlesAt;
   const host = {
     url,
     instructions: conn.instructions,
@@ -252,6 +283,15 @@ export async function connectHost(url, { questionCap = DEFAULT_QUESTION_INDEX_CH
       await ensureFresh();
       return { titles: questionTitles, more: questionsMore };
     },
+    // Every title the model holds, read once for the commit the host answers from and again when
+    // it moves; until a read has worked, none. Only the answer check asks for it.
+    async titles() {
+      const at = host.provenance?.commit ?? null;
+      if (titleList && titlesAt === at) return titleList;
+      const read = await fetchTitles(host.call, await host.types());
+      if (read) { titleList = read; titlesAt = at; }
+      return titleList ?? [];
+    },
     async call(name, args) {
       const once = async () => {
         const r = await conn.client.callTool({ name, arguments: args ?? {} });
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/titles.test.mjs`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/host.mjs test/titles.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
The host keeps an index of every title the model holds

The answer check tells a title the model holds and no tool returned from no title at all, so the host now reads every entity's title, type by type since list_entities answers one at a time, once for the commit it answers from, and keeps what it had when a read fails.

Verified: node --test test/titles.test.mjs and test/host.test.mjs pass.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 4: The loop keeps the evidence and runs the check

**Files:**

- Modify: `lib/loop.mjs`
- Test: `test/loop.test.mjs`

**Interfaces:**

- Consumes the `verdictCheck` function shape of Task 1. Produces `answer({ host, model, meter, questionCap, verdict = null }, …)`: with `verdict` a function, it is called once after the last `text` with `{ text, lang, returned, evidence, answers, calls, empty }`; a non-null result is emitted as `verdict` before `done`, and the returned signals gain `claims` and `unsupported`.

- [ ] **Step 1: Write the failing tests**

Apply to `test/loop.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/loop.test.mjs b/test/loop.test.mjs
index e3cedac..ea9643c 100644
--- a/test/loop.test.mjs
+++ b/test/loop.test.mjs
@@ -572,3 +572,32 @@ test("the diagram rule sends the meta-model to the schema shape, never to the co
   assert.match(DIAGRAM_RULE, /shape schema/);
   assert.match(DIAGRAM_RULE, /not shape concepts/);
 });
+
+test("the check reads the text, every returned entity and the tool answer it came in, and its event comes before done", async () => {
+  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
+  const model = fakeModel([toolTurn("get_entity", { id: rootId }, "Looking. "), textTurn(`${EXAMPLE_ROOT} is the company.`)]);
+  const { events, emit } = collect();
+  const seen = [];
+  const verdict = async (message) => { seen.push(message); return { event: { claims: [], threshold: null }, claims: 2, unsupported: 1 }; };
+  const r = await answer({ host, model, meter: meter(), verdict }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, emit);
+  const kinds = events.map(([e]) => e);
+  assert.deepEqual(kinds.slice(-2), ["verdict", "done"]);
+  assert.ok(kinds.lastIndexOf("text") < kinds.indexOf("verdict"));
+  assert.equal(seen[0].text, `Looking. ${EXAMPLE_ROOT} is the company.`);
+  assert.equal(seen[0].returned[0].id, rootId, "the cited entity first, then what its answer named");
+  assert.ok(seen[0].evidence.get(rootId).includes(rootId), "the evidence is the tool answer the model was given");
+  assert.equal(seen[0].lang, "en");
+  assert.deepEqual([seen[0].calls, seen[0].empty], [1, 0]);
+  assert.equal(seen[0].answers.length, 1, "every tool answer of the message, for a claim naming none");
+  assert.deepEqual([r.claims, r.unsupported], [2, 1]);
+});
+
+test("with no check there is no verdict event and no counts, and a check that could not run sends nothing", async () => {
+  for (const verdict of [null, async () => null]) {
+    const { events, emit } = collect();
+    const r = await answer({ host, model: fakeModel([textTurn("Hello.")]), meter: meter(), verdict }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit);
+    assert.ok(!events.some(([e]) => e === "verdict"));
+    assert.equal(events.at(-1)[0], "done");
+    assert.ok(!("claims" in r) && !("unsupported" in r));
+  }
+});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/loop.test.mjs`

Expected: FAIL: the two new tests; no `verdict` event is emitted.

- [ ] **Step 3: Write the code**

Apply to `lib/loop.mjs` (`git apply` takes it as written):

````diff
diff --git a/lib/loop.mjs b/lib/loop.mjs
index 5c913ef..6b0f5b0 100644
--- a/lib/loop.mjs
+++ b/lib/loop.mjs
@@ -20,6 +20,12 @@
 // the last request, before the loop takes it for the answer; an answer the output limit cut is
 // not a silence, and a second silence is what it is.
 //
+// Where the deployment checks its answers, the loop keeps what the check reads as it goes: the
+// text it forwarded, every entity a tool returned, and for each the tool answer that carried it,
+// cut where the model's was, so the evidence is exactly what the model saw. The check runs after
+// the last `text` and before `done`, within its own budget, and a check that could not run sends
+// nothing and takes nothing from the answer.
+//
 // A visitor who closes the tab is a socket that is gone, and every remaining round would be
 // spent writing into it, so the signal the request carries reaches the model and is read between
 // rounds: the loop stops where it stands, the meter is settled, and nothing more is emitted.
@@ -168,7 +174,7 @@ export async function namesPastTheCap(host, data) {
   return out;
 }
 
-export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTION_INDEX_CHARS }, { messages, lang, signal }, emit) {
+export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTION_INDEX_CHARS, verdict = null }, { messages, lang, signal }, emit) {
   const turns = window(validateMessages(messages));
   let spent = 0;
   const conv = turns.map((t) => ({ role: t.role, content: t.content }));
@@ -186,14 +192,27 @@ export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTIO
   // What the route keeps of this question, counted as the loop goes and handed back on the
   // answer and on the error alike; the widget's events never carry them.
   let callCount = 0, empty = 0, rounds = 0;
-  const signals = () => ({ cited: [...cited], calls: callCount, empty, rounds });
+  /** @type {{ claims: number; unsupported: number } | null} */
+  let counted = null;
+  const signals = () => ({ cited: [...cited], calls: callCount, empty, rounds, ...(counted ?? {}) });
+  // What the check reads: the text forwarded, and each returned entity with its tool answer.
+  let said = "";
+  const returned = new Map();
+  const evidence = new Map();
+  const toolAnswers = [];
+  const heard = (entities, text) => {
+    for (const { id, title } of entities) {
+      if (!returned.has(id)) returned.set(id, { id, title });
+      if (!evidence.has(id)) evidence.set(id, text);
+    }
+  };
 
   try {
     for (let round = 0; round <= MAX_ROUNDS; round++) {
       const final = round === MAX_ROUNDS;
       await meter.reserve(ESTIMATE);
       outstanding = true;
-      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final }), (text) => emit("text", { text }), { signal });
+      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final }), (text) => { said += text; emit("text", { text }); }, { signal });
       last = msg;
       rounds++;
       const cost = units(msg.usage);
@@ -214,6 +233,8 @@ export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTIO
         callCount++;
         if (foundNothing(r)) empty++;
         const cite = r.isError ? null : citeOf(r.data);
+        if (verdict) toolAnswers.push(truncate(r.text));
+        if (verdict && cite) heard([cite], truncate(r.text));
         if (cite && !cited.has(cite.id)) { cited.add(cite.id); emit("cite", cite); }
         // A name is emitted once a message, and never for an entity the answer already cites:
         // the cite carries the same id, and the widget links it from either.
@@ -226,6 +247,7 @@ export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTIO
           named.add(n.id); names.push(n);
         }
         if (names.length) emit("names", { names });
+        if (verdict) heard(found, truncate(r.text));
         const picture = diagramOf(call.name, r);
         if (picture) { const { links, everyType, core, ...event } = picture; emit("diagram", event); }
         results.push({ type: "tool_result", tool_use_id: call.id, content: picture ? diagramNote({ ...picture, edges: r.data.edges ?? 0 }) : truncate(r.text), is_error: r.isError });
@@ -244,6 +266,13 @@ export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTIO
   // The output limit stopped the last call mid-sentence, which the visitor would otherwise read
   // as the answer ending there; the widget says so instead.
   if (last?.stop_reason === "max_tokens") done.cut = true;
+  if (verdict && said.trim()) {
+    const v = await verdict({ text: said, lang: lang ?? null, returned: [...returned.values()], evidence, answers: toolAnswers, calls: callCount, empty });
+    if (v && !signal?.aborted) {
+      emit("verdict", v.event);
+      counted = { claims: v.claims, unsupported: v.unsupported };
+    }
+  }
   emit("done", done);
   return { spent, ...signals() };
 }
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/loop.test.mjs`

Expected: PASS, every loop test.

- [ ] **Step 5: Commit**

```bash
git add lib/loop.mjs test/loop.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
The loop keeps what the check reads and runs it before done

Where a deployment checks its answers, the loop now keeps the text it forwarded, every entity a tool returned with the tool answer that carried it, cut as the model's was, and every tool answer of the message, and runs the check after the last text. Its event comes before done, and a check that could not run sends nothing.

Verified: node --test test/loop.test.mjs passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 5: The switch, the kept line and the start line

**Files:**

- Modify: `lib/config.mjs`, `lib/http.mjs`, `bin/http.mjs`
- Test: `test/config.test.mjs`, `test/http.test.mjs`, `test/bin-http.test.mjs`

**Interfaces:**

- Consumes `verdictCheck` (Task 1), `typesafeJudge` (Task 2), `host.titles` (Task 3), `answer`'s `verdict` (Task 4). Produces config `verdict`, `typesafeKey`, `verdictThreshold`; `createHttpServer({ …, verdict = null })`; the kept line's `claims` and `unsupported` where the check ran; the start line's `verdict`.

- [ ] **Step 1: Write the failing tests**

Apply to `test/config.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/config.test.mjs b/test/config.test.mjs
index 94485e8..2e32f6d 100644
--- a/test/config.test.mjs
+++ b/test/config.test.mjs
@@ -139,3 +139,13 @@ test("a table meter reads its address and identity, and refuses the start naming
   assert.throws(() => configFromEnv({ ...full, CHAT_METER: "table" }), /^Error: CHAT_METER=table needs CHAT_TABLE_URL, AZURE_CLIENT_ID, which are not set$/);
   assert.deepEqual(configFromEnv(full).meterOptions, {});
 });
+
+test("the answer check is off unless turned on, needs TypeSafe's key when on, and reads a threshold as a probability", () => {
+  const off = configFromEnv(full);
+  assert.deepEqual([off.verdict, off.typesafeKey, off.verdictThreshold], [false, null, null]);
+  const on = configFromEnv({ ...full, CHAT_VERDICT: "true", TYPESAFE_API_KEY: " ts-key ", CHAT_VERDICT_THRESHOLD: "0.8" });
+  assert.deepEqual([on.verdict, on.typesafeKey, on.verdictThreshold], [true, "ts-key", 0.8]);
+  assert.throws(() => configFromEnv({ ...full, CHAT_VERDICT: "true" }), /CHAT_VERDICT is true and TYPESAFE_API_KEY is not set/);
+  assert.throws(() => configFromEnv({ ...full, CHAT_VERDICT: "yes" }), /CHAT_VERDICT is true or false: yes/);
+  assert.throws(() => configFromEnv({ ...full, CHAT_VERDICT_THRESHOLD: "80" }), /CHAT_VERDICT_THRESHOLD is a probability between 0 and 1: 80/);
+});
````

Apply to `test/http.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/http.test.mjs b/test/http.test.mjs
index 14c9533..d5310bf 100644
--- a/test/http.test.mjs
+++ b/test/http.test.mjs
@@ -421,3 +421,17 @@ test("an ordinary fault still logs no message of its own", async () => {
   assert.equal(faults[0].detail, undefined);
   assert.ok(!errors.join("").includes("secret words"));
 });
+
+test("where the answer check ran, the kept line carries its two counts and still no word of the answer", async () => {
+  const { out, log } = lines();
+  const verdict = async () => ({ event: { claims: [{ from: 0, to: 19, ids: [], verdict: "unnamed", p: 0.9 }], threshold: null }, claims: 1, unsupported: 1 });
+  const server = createHttpServer({ config: config(), host, model: tools(textTurn("It is a fine answer.")), meter: new Meter(new MemoryStore(), { monthTokens: 1_000_000 }), bucket: new Bucket(), log, verdict });
+  await new Promise((r) => server.listen(0, "127.0.0.1", r));
+  after(() => server.close());
+  const r = await post(`http://127.0.0.1:${server.address().port}`, { messages: [{ role: "user", content: "Is it?" }], lang: "en" });
+  const evs = await events(r);
+  assert.deepEqual(evs.map(([e]) => e).slice(-2), ["verdict", "done"]);
+  const line = JSON.parse(out[0]);
+  assert.deepEqual([line.claims, line.unsupported], [1, 1]);
+  assert.ok(!out[0].includes("fine answer"), "no word of the answer in the line");
+});
````

Apply to `test/bin-http.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/bin-http.test.mjs b/test/bin-http.test.mjs
index df8cf72..ab24354 100644
--- a/test/bin-http.test.mjs
+++ b/test/bin-http.test.mjs
@@ -13,7 +13,7 @@ test("the process starts from the environment with a memory meter and a fake mod
   const env = { ...process.env, CHAT_MCP_URL: fixture.url, CHAT_ORIGINS: "https://site.test", CHAT_MONTH_TOKENS: "1000000", CHAT_PROJECT: "p", CHAT_REGION: "eu", CHAT_METER: "memory", PORT: "0" };
   const child = spawn(process.execPath, [bin, "--model", "fake"], { env });
   after(() => child.kill());
-  const line = await new Promise((resolve) => child.stdout.on("data", (d) => { for (const l of String(d).split("\n")) if (l.includes("chat.start")) { const j = JSON.parse(l); assert.equal(j.severity, "INFO"); assert.match(j.message, /companygraph-chat-http on :/); assert.match(j.message, / via fake \(none\), /, "the start line names the credential"); assert.equal(j.credential, "none"); resolve(String(j.port)); } }));
+  const line = await new Promise((resolve) => child.stdout.on("data", (d) => { for (const l of String(d).split("\n")) if (l.includes("chat.start")) { const j = JSON.parse(l); assert.equal(j.severity, "INFO"); assert.match(j.message, /companygraph-chat-http on :/); assert.match(j.message, / via fake \(none\), /, "the start line names the credential"); assert.equal(j.credential, "none"); assert.equal(j.verdict, false, "the start line says the answer check is off"); resolve(String(j.port)); } }));
   const r = await fetch(`http://127.0.0.1:${line}/chat`);
   assert.equal(r.status, 200);
   assert.equal((await r.json()).mcp_url, fixture.url);
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/config.test.mjs test/http.test.mjs test/bin-http.test.mjs`

Expected: FAIL: the three new assertions.

- [ ] **Step 3: Write the code**

Apply to `lib/config.mjs` (`git apply` takes it as written):

````diff
diff --git a/lib/config.mjs b/lib/config.mjs
index cc77934..62c4f55 100644
--- a/lib/config.mjs
+++ b/lib/config.mjs
@@ -42,6 +42,22 @@ const needAll = (env, choiceName, names) => {
   return got;
 };
 
+// A switch is `true` or `false` and nothing else, so a typo never turns the check on or off
+// without a word; unset is off.
+const bool = (env, name) => {
+  const v = env[name]?.trim();
+  if (!v) return false;
+  if (v !== "true" && v !== "false") throw new Error(`${name} is true or false: ${v}`);
+  return v === "true";
+};
+// A probability, between 0 and 1; unset is none.
+const fraction = (env, name) => {
+  const v = env[name]?.trim();
+  if (!v) return null;
+  const n = Number(v);
+  if (!(n >= 0 && n <= 1)) throw new Error(`${name} is a probability between 0 and 1: ${v}`);
+  return n;
+};
 // Workload identity federation: the three ids name the rule, the organization and the Anthropic
 // service account a token acts as, and the workspace is needed only where the rule spans more
 // than one. None is a secret; the credential is the platform's own identity token. A partial set
@@ -84,7 +100,13 @@ export function configFromEnv(env = process.env) {
     log: choice(env, "CHAT_LOG", LOG_FORMATS, "google"),
     anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
     anthropicFederation: federationFromEnv(env),
+    // The answer check: off unless the deployment turns it on, and then it needs TypeSafe's key.
+    // The threshold is what the widget marks a claim above; unset, it marks nothing.
+    verdict: bool(env, "CHAT_VERDICT"),
+    typesafeKey: env.TYPESAFE_API_KEY?.trim() || null,
+    verdictThreshold: fraction(env, "CHAT_VERDICT_THRESHOLD"),
   };
+  if (c.verdict && !c.typesafeKey) throw new Error("CHAT_VERDICT is true and TYPESAFE_API_KEY is not set");
   // The SDK lets a key win over federation without a word, so a deployment that still carries
   // its key after the switch would go on spending on the key it meant to retire.
   if (c.anthropicKey && c.anthropicFederation) throw new Error("ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set; set one, since the key would win");
````

Apply to `lib/http.mjs` (`git apply` takes it as written):

````diff
diff --git a/lib/http.mjs b/lib/http.mjs
index d0a9cf3..a2f000e 100644
--- a/lib/http.mjs
+++ b/lib/http.mjs
@@ -83,7 +83,7 @@ const UNKEPT = new Set(["bad_request", "too_long", "foreign"]);
 
 const NO_SIGNALS = { cited: [], calls: 0, empty: 0, rounds: 0 };
 
-export function createHttpServer({ config, host, model, meter, bucket, log = console.log }, { pageCss = null, pageBrand = null, pageIcon = null } = {}) {
+export function createHttpServer({ config, host, model, meter, bucket, log = console.log, verdict = null }, { pageCss = null, pageBrand = null, pageIcon = null } = {}) {
   const hostOk = (req) => !config.hosts || config.hosts.includes((req.headers.host ?? "").replace(/:\d+$/, ""));
   const originOf = (req) => (req.headers.origin ?? "").trim();
   const takeOrBusy = (req) => {
@@ -105,7 +105,9 @@ export function createHttpServer({ config, host, model, meter, bucket, log = con
       if (question === null || kept) return;
       kept = true;
       const s = signals ?? NO_SIGNALS;
-      log(line("chat.question", "INFO", { kind: "question", question, lang, cited: s.cited, calls: s.calls, empty: s.empty, rounds: s.rounds, refused }));
+      // The answer check's two counts ride along where it ran, and are absent where it did not.
+      const counts = Number.isFinite(s.claims) ? { claims: s.claims, unsupported: s.unsupported } : {};
+      log(line("chat.question", "INFO", { kind: "question", question, lang, cited: s.cited, calls: s.calls, empty: s.empty, rounds: s.rounds, refused, ...counts }));
     };
     try {
       if (!hostOk(req)) { res.writeHead(421, { "Content-Type": "text/plain" }).end("unknown host\n"); return; }
@@ -167,7 +169,7 @@ export function createHttpServer({ config, host, model, meter, bucket, log = con
       res.on("close", () => { if (!res.writableFinished) ac.abort(); });
       const stream = sse(res);
       try {
-        const r = await answer({ host, model, meter, questionCap: config.questionIndexChars }, { messages: body.messages, lang: body.lang, signal: ac.signal }, (event, data) => stream.send(event, data));
+        const r = await answer({ host, model, meter, questionCap: config.questionIndexChars, verdict }, { messages: body.messages, lang: body.lang, signal: ac.signal }, (event, data) => stream.send(event, data));
         keep(r, null);
       } catch (err) {
         // The visitor left: the socket is gone and nothing can be sent, and what the loop had
````

Apply to `bin/http.mjs` (`git apply` takes it as written):

````diff
diff --git a/bin/http.mjs b/bin/http.mjs
index 05e1a4d..375868e 100755
--- a/bin/http.mjs
+++ b/bin/http.mjs
@@ -15,6 +15,8 @@ import { Meter } from "../lib/meter.mjs";
 import { Bucket } from "../lib/bucket.mjs";
 import { meterStore, identityTokenSource } from "../lib/platform.mjs";
 import { createHttpServer } from "../lib/http.mjs";
+import { verdictCheck } from "../lib/verdict.mjs";
+import { typesafeJudge } from "../lib/typesafe.mjs";
 
 const ICON_TYPES = { ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
 
@@ -50,9 +52,13 @@ try {
   const store = await meterStore(config.meter, config.meterOptions);
   const meter = new Meter(store, { monthTokens: config.monthTokens });
   const bucket = new Bucket();
-  createHttpServer({ config, host, model, meter, bucket }, { pageCss, pageBrand, pageIcon }).listen(config.port, "0.0.0.0", function () {
+  // The answer check, where the deployment turned it on; the title index is read as the service
+  // comes up, so the first answer does not wait on it.
+  const verdict = config.verdict ? verdictCheck({ judge: typesafeJudge({ key: config.typesafeKey }), titles: () => host.titles(), threshold: config.verdictThreshold }) : null;
+  if (verdict) host.titles().catch(() => {});
+  createHttpServer({ config, host, model, meter, bucket, verdict }, { pageCss, pageBrand, pageIcon }).listen(config.port, "0.0.0.0", function () {
     const port = this.address().port, commit = host.provenance?.commit ?? null;
-    console.log(line("chat.start", "INFO", { kind: "start", message: `companygraph-chat-http on :${port}, host ${config.mcpUrl} at ${commit ?? "(none)"}, model ${model.name} via ${model.provider} (${model.credential}), meter ${config.meter}, origins ${config.origins.join(" ")}, hosts ${config.hosts ? config.hosts.join(" ") : "any"}`, port, host: config.mcpUrl, commit, model: model.name, provider: model.provider, credential: model.credential, meter: config.meter, origins: config.origins, hosts: config.hosts ?? null }));
+    console.log(line("chat.start", "INFO", { kind: "start", message: `companygraph-chat-http on :${port}, host ${config.mcpUrl} at ${commit ?? "(none)"}, model ${model.name} via ${model.provider} (${model.credential}), meter ${config.meter}, origins ${config.origins.join(" ")}, hosts ${config.hosts ? config.hosts.join(" ") : "any"}, answer check ${config.verdict ? "on" : "off"}`, port, host: config.mcpUrl, commit, model: model.name, provider: model.provider, credential: model.credential, meter: config.meter, origins: config.origins, hosts: config.hosts ?? null, verdict: config.verdict }));
   });
 } catch (err) {
   console.error(err.message);
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/config.test.mjs test/http.test.mjs test/bin-http.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.mjs lib/http.mjs bin/http.mjs test/config.test.mjs test/http.test.mjs test/bin-http.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
A deployment turns the answer check on, and the line keeps its counts

CHAT_VERDICT turns the check on and then needs TYPESAFE_API_KEY, and CHAT_VERDICT_THRESHOLD is read as a probability. The kept line carries claims and unsupported where the check ran and still no word of the answer, and the start line says whether the check is on; the title index is read as the service comes up, so the first answer does not wait on it.

Verified: node --test test/config.test.mjs, test/http.test.mjs and test/bin-http.test.mjs pass.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 6: The weekly report counts the claims

**Files:**

- Modify: `lib/report.mjs`
- Test: `test/report.test.mjs`

**Interfaces:**

- Consumes the kept line's `claims` and `unsupported`. Produces a `## Claims` section where any entry carries them.

- [ ] **Step 1: Write the failing tests**

Apply to `test/report.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/report.test.mjs b/test/report.test.mjs
index 57088b5..ca4bd1c 100644
--- a/test/report.test.mjs
+++ b/test/report.test.mjs
@@ -123,3 +123,11 @@ test("runReport takes a week by name and rebuilds it, and refuses a name that is
   assert.deepEqual(calls.put, ["reports/2026-W37.md"]);
   await assert.rejects(runReport({ list: async () => [], put: async () => {}, week: "yesterday" }), /a week is YYYY-Www/);
 });
+
+test("where answers were checked, the report counts their claims and lists each question with one its evidence did not carry", () => {
+  const md = renderReport([entry(), entry({ question: "When did it start?", claims: 3, unsupported: 1 }), entry({ question: "Who?", claims: 2, unsupported: 0 })], { week: "2026-W40", ...weekRange("2026-W40") });
+  assert.match(md, /^## Claims\n\n2 answers checked, 5 claims, 1 not carried by their evidence\.$/m);
+  assert.match(md, /^\| When did it start\? \| en \| 3 \| 1 \|$/m);
+  assert.doesNotMatch(md, /^\| Who\? \|/m);
+  assert.doesNotMatch(renderReport([entry()], { week: "2026-W40", ...weekRange("2026-W40") }), /## Claims/, "no section where nothing was checked");
+});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/report.test.mjs`

Expected: FAIL: no `## Claims` section.

- [ ] **Step 3: Write the code**

Apply to `lib/report.mjs` (`git apply` takes it as written):

````diff
diff --git a/lib/report.mjs b/lib/report.mjs
index e392598..c74a113 100644
--- a/lib/report.mjs
+++ b/lib/report.mjs
@@ -65,6 +65,18 @@ export function renderReport(entries, { week, from, to }) {
     lines.push("", "## Most cited", "", "| Entity | Times |", "| --- | --- |");
     for (const [id, n] of ranked) lines.push(`| ${cell(id)} | ${n} |`);
   }
+  // The answer check's counts, where it ran: how many claims the checked answers made and how
+  // many their evidence did not carry, and every question whose answer had one of those.
+  const checked = entries.filter((e) => Number.isFinite(e.claims) && Number.isFinite(e.unsupported));
+  if (checked.length) {
+    const claims = checked.reduce((n, e) => n + e.claims, 0), unsupported = checked.reduce((n, e) => n + e.unsupported, 0);
+    lines.push("", "## Claims", "", `${checked.length} answers checked, ${claims} claims, ${unsupported} not carried by their evidence.`);
+    const flagged = checked.filter((e) => e.unsupported > 0);
+    if (flagged.length) {
+      lines.push("", "| Question | Language | Claims | Not carried |", "| --- | --- | --- | --- |");
+      for (const e of flagged) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.claims} | ${e.unsupported} |`);
+    }
+  }
   if (no.length) {
     lines.push("", "## Not answered", "", "| Question | Language | Calls | Empty | Refused |", "| --- | --- | --- | --- | --- |");
     for (const e of no) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.calls ?? 0} | ${e.empty ?? 0} | ${cell(e.refused ?? "—")} |`);
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/report.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report.mjs test/report.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
The weekly report counts the checked answers' claims

Where answers were checked, the report says how many, how many claims they made and how many their evidence did not carry, and lists each question whose answer had one of those; a week with nothing checked has no section.

Verified: node --test test/report.test.mjs passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 7: The Google module, chat.json and the docs

**Files:**

- Modify: `deploy/build/config.mjs`, `deploy/google/terraform/variables.tf`, `deploy/google/terraform/run.tf`, `docs/INTERFACE.md`, `README.md`
- Test: `test/deploy-config.test.mjs`

**Interfaces:**

- Consumes the environment names of Task 5. Produces the module variables `verdict` (bool, false) and `verdict_threshold` (number or null), the secret `typesafe-key` mounted as `TYPESAFE_API_KEY`, and `chat.json` fields `verdict` and `verdict_threshold`, Google only.

- [ ] **Step 1: Write the failing tests**

Apply to `test/deploy-config.test.mjs` (`git apply` takes it as written):

````diff
diff --git a/test/deploy-config.test.mjs b/test/deploy-config.test.mjs
index 50d4c51..b6bb26a 100644
--- a/test/deploy-config.test.mjs
+++ b/test/deploy-config.test.mjs
@@ -68,3 +68,12 @@ test("federation names its audience on Azure and never on Google", () => {
   assert.deepEqual(federationProblems({ ...azureChat, anthropic_federation: noAudience }, "azure"), ["audience is the client id of the app registration standing for the Claude API"]);
   assert.deepEqual(federationProblems({ ...googleChat, anthropic_federation: { ...googleChat.anthropic_federation, audience: f.audience } }, "google"), ["audience is not a field of anthropic_federation"]);
 });
+
+test("the answer check is a Google chat's switch, true or false, with a threshold between 0 and 1", () => {
+  const google = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, site_id: "chat-example" };
+  assert.deepEqual(chatProblems({ ...google, verdict: true, verdict_threshold: 0.8 }, "google"), []);
+  assert.deepEqual(chatProblems({ ...google, verdict: "yes" }, "google"), ["verdict is true or false"]);
+  assert.deepEqual(chatProblems({ ...google, verdict_threshold: 2 }, "google"), ["verdict_threshold is a probability between 0 and 1"]);
+  const azure = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, storage_account: "chatexample", provider: "anthropic", anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC", audience: "00000000-0000-4000-8000-000000000001" } };
+  assert.deepEqual(chatProblems({ ...azure, verdict: true }, "azure"), ["verdict is for a chat on Google"]);
+});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/deploy-config.test.mjs`

Expected: FAIL: `verdict` is not refused on Azure.

- [ ] **Step 3: Write the code**

Apply to `deploy/build/config.mjs` (`git apply` takes it as written):

````diff
diff --git a/deploy/build/config.mjs b/deploy/build/config.mjs
index 9836dbf..9626b44 100644
--- a/deploy/build/config.mjs
+++ b/deploy/build/config.mjs
@@ -41,7 +41,9 @@ export function federationProblems(c, platform = "google") {
   return problems;
 }
 
-const GOOGLE_ONLY = ["site_id", "run_host"];
+// The answer check runs on Google alone in this release: the Azure module holds no secret by
+// design, so TypeSafe's key has nowhere to come from there.
+const GOOGLE_ONLY = ["site_id", "run_host", "verdict", "verdict_threshold"];
 const AZURE_ONLY = ["storage_account", "app_host", "dns_ready", "questions_workspace_id", "analyst_client_id"];
 
 // chat.json as its platform needs it: the fields every chat names, the platform's own, and none of
@@ -53,6 +55,8 @@ export function chatProblems(c, platform) {
     if (!("site_id" in c)) problems.push("chat.json has no site_id, the Hosting site Google serves the chat from");
     for (const k of AZURE_ONLY) if (k in c) problems.push(`${k} is for a chat on Azure`);
     if ("provider" in c && !["vertex", "anthropic"].includes(c.provider)) problems.push("provider is vertex or anthropic");
+    if ("verdict" in c && typeof c.verdict !== "boolean") problems.push("verdict is true or false");
+    if ("verdict_threshold" in c && !(typeof c.verdict_threshold === "number" && c.verdict_threshold >= 0 && c.verdict_threshold <= 1)) problems.push("verdict_threshold is a probability between 0 and 1");
   } else {
     for (const k of GOOGLE_ONLY) if (k in c) problems.push(`${k} is for a chat on Google`);
     if (!/^[a-z0-9]{3,24}$/.test(c.storage_account ?? "")) problems.push("storage_account is 3 to 24 lowercase letters and digits");
````

Apply to `deploy/google/terraform/variables.tf` (`git apply` takes it as written):

````diff
diff --git a/deploy/google/terraform/variables.tf b/deploy/google/terraform/variables.tf
index f302cbd..6a9fee8 100644
--- a/deploy/google/terraform/variables.tf
+++ b/deploy/google/terraform/variables.tf
@@ -52,3 +52,20 @@ variable "anthropic_federation" {
     error_message = "anthropic_federation is for model_provider anthropic."
   }
 }
+
+# The answer check (docs/INTERFACE.md, the verdict event). Off by default, so a deployment that
+# re-pins gains nothing it did not ask for. On, the module mounts the project's Secret Manager
+# secret `typesafe-key`, which the owner makes as the README says, and passes the threshold the
+# widget marks a claim above; with no threshold the widget marks nothing.
+variable "verdict" {
+  type    = bool
+  default = false
+}
+variable "verdict_threshold" {
+  type    = number
+  default = null
+  validation {
+    condition     = var.verdict_threshold == null || (var.verdict_threshold >= 0 && var.verdict_threshold <= 1)
+    error_message = "verdict_threshold is a probability between 0 and 1."
+  }
+}
````

Apply to `deploy/google/terraform/run.tf` (`git apply` takes it as written):

````diff
diff --git a/deploy/google/terraform/run.tf b/deploy/google/terraform/run.tf
index 60264fa..7b57730 100644
--- a/deploy/google/terraform/run.tf
+++ b/deploy/google/terraform/run.tf
@@ -97,6 +97,34 @@ resource "google_cloud_run_v2_service" "chat" {
           }
         }
       }
+      # The answer check: its switch, TypeSafe's key from the project's secret, and the threshold
+      # where one is set. The secret is the owner's, as the Anthropic key's is.
+      dynamic "env" {
+        for_each = var.verdict ? [1] : []
+        content {
+          name  = "CHAT_VERDICT"
+          value = "true"
+        }
+      }
+      dynamic "env" {
+        for_each = var.verdict ? [1] : []
+        content {
+          name = "TYPESAFE_API_KEY"
+          value_source {
+            secret_key_ref {
+              secret  = "typesafe-key"
+              version = "latest"
+            }
+          }
+        }
+      }
+      dynamic "env" {
+        for_each = var.verdict && var.verdict_threshold != null ? [1] : []
+        content {
+          name  = "CHAT_VERDICT_THRESHOLD"
+          value = tostring(var.verdict_threshold)
+        }
+      }
       dynamic "env" {
         for_each = local.federation_env
         content {
````

Apply to `docs/INTERFACE.md` (`git apply` takes it as written):

````diff
diff --git a/docs/INTERFACE.md b/docs/INTERFACE.md
index 004c537..9360742 100644
--- a/docs/INTERFACE.md
+++ b/docs/INTERFACE.md
@@ -34,6 +34,7 @@ The answer is `text/event-stream`, each event an `event:` line and one `data:` l
 | `cite` | `{ id, title, type, url }`, `url` null where the host names no file | a tool answered with one entity, or evidence for one skill; the widget links it, and an entity cited already in this message is not cited twice |
 | `names` | `{ names: [{ id, title }] }` | every entity a list answer named, and every entity an entity answer references past the fifty edges it holds, read from the host; at most three hundred a message, each once and never one the answer also cites; the widget links these names where the text writes them |
 | `diagram` | `{ shape, title, mermaid, nodes: [{ node, id, title, type }], omitted }` | the host's `diagram` tool answered: Mermaid source the host built from the model's edges, for the widget to draw under the answer, each node named in `nodes` by the entity it is so the widget links it; the model reads what was drawn and never the source, and a message with two draws the last |
+| `verdict` | `{ claims: [{ from, to, ids, verdict, p }], threshold }` | where the deployment checks its answers, after the last `text` and before `done`: each claim of the answer, by its place in the concatenated text, the entities it names, its verdict — `supported`, `partial`, `contradicted`, `absent`, `says-nothing`, `withheld`, `unnamed` or `unsourced` — and the probability the judge gave it, null where no judge was asked; `threshold` is the probability above which the widget marks a claim whose verdict is not `supported` or `says-nothing`, null where it marks none, as it is in German until a German threshold is measured. A check that could not run sends no `verdict`, never an `error` |
 | `done` | `{ model, spent, dayLeft, cut }` | the last event: the host's provenance, what the message cost in the meter's unit, and what is left of today's share; `cut` is `true` where the output limit stopped the answer mid-sentence and is absent where it did not |
 | `error` | `{ error: { code, message } }`, with `retryAt` where the code is `busy` | the last event when something arrives after the stream began: `host_down`, `busy` or `internal` |
 
@@ -75,6 +76,8 @@ Every line the service writes is one JSON object that opens with a severity and
 | `empty` | how many of those found nothing: refused by the host, an error, or a list with no rows |
 | `rounds` | how many requests the model answered; a request it did not, a rate refusal or a visitor gone, is not one |
 | `refused` | null where the model answered, else the code: `busy`, `over_day`, `over_month`, `closed`, `host_down` or `internal` |
+| `claims` | where the answer was checked, how many claims it made; absent where it was not |
+| `unsupported` | where the answer was checked, how many of its claims are `partial`, `contradicted`, `absent`, `withheld`, `unnamed` or `unsourced`; absent where it was not |
 
 Whether a question was answered is not a field: it is read as `refused` null and either `cited` non-empty or `calls` above `empty`, since a list answer cites nothing though the model had every row, and the rule can change with the lines intact.
 
````

Apply to `README.md` (`git apply` takes it as written):

````diff
diff --git a/README.md b/README.md
index 0b2be5c..ff735b8 100644
--- a/README.md
+++ b/README.md
@@ -32,6 +32,8 @@ A deployment of an MCP host adds a `chat/` directory holding `package.json` pinn
 
 A deployment's `chat/Dockerfile` copies `package.json` and the lockfile and runs `npm ci --omit=dev`, then copies `dist/page.css`, which the build wrote from the design package with each font family's license text ahead of its faces, and so from `@robertblust/design` v0.83.0 or later, the first release that ships those texts, `brand.html` and, where the deployment has one, `favicon.svg`; its command is `CMD ["node", "node_modules/.bin/companygraph-chat-deploy", "serve"]`, which starts this package's server in the container's one process with that page.
 
+A deployment on Google can check its answers: `chat.json` names `verdict: true`, which `infra/chat/main.tf` passes as `verdict = lookup(local.c, "verdict", false)`, and where a threshold has been measured `verdict_threshold`, passed as `verdict_threshold = lookup(local.c, "verdict_threshold", null)`. The service then reads each answer back claim by claim against the tool answers the model was given, asks TypeSafe's Jev whether those answers carry each claim, and sends the widget a `verdict` event and the kept line two counts, as `docs/INTERFACE.md` says. TypeSafe receives the answer's sentences and the model's public text they rest on, never the visitor's question or address, and before any deployment turns this on its site's privacy page names TypeSafe as a processor of the answer, in English and in German. The key is the owner's, in the project's secret, made once with the key on stdin: `gcloud secrets create typesafe-key --replication-policy automatic --project <project>`, `printf '%s' "$KEY" | gcloud secrets versions add typesafe-key --data-file=- --project <project>`, and `gcloud secrets add-iam-policy-binding typesafe-key --member serviceAccount:chat-run@<project>.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor --project <project>`. Its spend limit is set at TypeSafe, which is the hard stop: the meter counts the chat's own model and has no unit for a second provider. A chat on Azure does not offer the check in this release, since its module holds no secret. `node scripts/measure-verdict.mjs`, run by hand with `TYPESAFE_API_KEY` set and never in CI, prints how often each tenth of probability was right over answers with a known fault planted in each, in English and in German; a threshold is read off that curve and never guessed.
+
 Five steps are the owner's, because Terraform cannot do them. Claude's terms are accepted and Sonnet 5 enabled in Vertex AI's Model Garden, once per project: no Terraform resource does it, and until it is done the first message fails as `internal` rather than as a refusal with a code, since the fence has nothing to refuse. A deployment on the Anthropic API instead makes a workspace in the Anthropic Console with a monthly spend limit, which is the hard stop Google does not give, and connects the service to it once under Settings, Workload identity, Connect workload, Google Cloud: the issuer `https://accounts.google.com`, made once for the organization; an Anthropic service account for this deployment, a member of that workspace; and a rule with audience `https://api.anthropic.com` matching the claims `sub`, the number `gcloud iam service-accounts describe chat-run@<project>.iam.gserviceaccount.com --format='value(uniqueId)' --project <project>` prints, and `email`, `chat-run@<project>.iam.gserviceaccount.com`, scope `workspace:developer`, lifetime six hundred seconds; the rule's, the organization's and the service account's ids then go into `chat.json`. Never match Google's `sub` by prefix: it is a bare number, and a prefix admits service accounts of any project. A deployment that cannot federate keeps a key instead, in the project's secret, made once with the key on stdin and never in a file: `gcloud services enable secretmanager.googleapis.com --project <project>`, `gcloud secrets create chat-anthropic-key --replication-policy automatic --project <project>`, `printf '%s' "$KEY" | gcloud secrets versions add chat-anthropic-key --data-file=- --project <project>`, and `gcloud secrets add-iam-policy-binding chat-anthropic-key --member serviceAccount:chat-run@<project>.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor --project <project>`. Model Garden and the quota then do not apply. The model's quota is lowered on the project's Quotas page to a rate a chat needs and an attack does not, on the order of sixty requests and 300,000 input tokens a minute, which is the one layer that holds before this package runs a line. The module enables the Cloud Quotas API, so the same request can be filed from a terminal, `gcloud beta quotas preferences create --service aiplatform.googleapis.com --quota-id EuOnlinePredictionRequestsPerMinPerProjectPerBaseModel --dimensions base_model=anthropic-claude-sonnet --preferred-value 60 --email <login> --justification <why> --project <project> --billing-project <project>`, where the billing project keeps the request off whichever project `gcloud` happens to be set to, and a new project's first request may be refused until its billing account has history. The domain's records are set at the DNS provider from the `dns_records` output of `infra/chat/`, which the apply prints. The owner's own reading of the questions is granted once per project, with the login's address that belongs in no repository: `gcloud iam service-accounts add-iam-policy-binding chat-analyst@<project>.iam.gserviceaccount.com --member user:<login> --role roles/iam.serviceAccountTokenCreator --project <project>`; a read then runs as the analyst and as nothing more, under the owner's own `gcloud auth login`, with `gcloud logging read '' --freshness=90d --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com --bucket chat-questions --location <region> --view questions --project <project> --format json`, since the flag names the account every command acts as and the freshness reaches back over the whole bucket where the default is a day, and a report with `gcloud storage cat gs://chat-reports-<project>/reports/<week>.md --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com`. Running `report` on the machine instead of in the workflow needs application-default credentials that impersonate the analyst, `gcloud auth application-default login --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com`, which the auth library reads and `gcloud` does not. And the chat is stopped by hand where the meter keeps it: the project's `(default)` Firestore database, document `chat/meter`, field `closed` set to `true`, which refuses the next message with `closed` and spends nothing, and back to `false` to open it again — the day and the month that document counts are UTC, so a share turns over at midnight UTC and not at midnight in Zürich.
 
 One message is sent by hand after the second merge, because the deploy's live check is a `GET /chat` and a GET proves the route, the origins, the ceiling and the MCP host and never the model, the region or the runtime's role binding:
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/deploy-config.test.mjs`

Expected: PASS; then `terraform -chdir=deploy/google/terraform fmt -check`, and `terraform init -backend=false` with `terraform validate` in that folder, print no error, and `sh conventions/conventions-format` and `sh conventions/conventions-check` pass. Remove the `.terraform` folder and lock file `init` wrote.

- [ ] **Step 5: Commit**

```bash
git add deploy/build/config.mjs deploy/google/terraform/variables.tf deploy/google/terraform/run.tf docs/INTERFACE.md README.md test/deploy-config.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
The Google module mounts TypeSafe's key where the check is on

chat.json names verdict and verdict_threshold on Google, and the module passes the switch, mounts the project's secret typesafe-key and sets the threshold where one is given; Azure refuses both fields, since its module holds no secret. INTERFACE.md gains the verdict event and the two line fields, and the README the owner's steps and the fence.

Verified: node --test test/deploy-config.test.mjs, terraform fmt -check and validate, conventions-format and conventions-check pass.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 8: The measuring

**Files:**

- Create: `scripts/measure-verdict.mjs`
- Test: `test/measure-verdict.test.mjs`

**Interfaces:**

- Consumes `answer` (Task 4), `verdictCheck` and `isUnsupported` (Task 1), `typesafeJudge` and `MODEL` (Task 2), `host.titles` (Task 3). Reads `CHAT_TYPESAFE_URL` only as the test's seam.

- [ ] **Step 1: Write the failing tests**

Create `test/measure-verdict.test.mjs`:

````js
// The measuring script, run against a fake TypeSafe so the suite reaches no live service: every
// case is run through the real loop and checked, and the curves are printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/measure-verdict.mjs", import.meta.url));
const run = (env) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [script], { env });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.on("error", fail);
  child.on("close", (code) => done({ code, out, err }));
});
const withoutKey = () => { const env = { ...process.env }; delete env.TYPESAFE_API_KEY; delete env.CHAT_TYPESAFE_URL; return env; };

test("without a key nothing is measured", async () => {
  const { code, err } = await run(withoutKey());
  assert.equal(code, 1);
  assert.match(err, /TYPESAFE_API_KEY is not set; nothing was measured\./);
});

test("every case is run through the loop and checked, in both languages, and both curves are printed", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "choice", choice: "supported", probabilities: { supported: 0.9 } }]));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ answers }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { code, out } = await run({ ...withoutKey(), TYPESAFE_API_KEY: "k", CHAT_TYPESAFE_URL: `http://127.0.0.1:${server.address().port}/v1/systemone` });
    assert.equal(code, 0, out);
    assert.equal(out.split("\n").filter((l) => /^ {2}(en|de) {2}/.test(l)).length, 16);
    assert.match(out, /^ {2}en {2}a title no tool returned, faulted: unsourced$/m);
    assert.match(out, /^en: the probability/m);
    assert.match(out, /^de: the probability/m);
    assert.match(out, /^not checked: 0 answers$/m);
    assert.ok(seen.length > 0 && seen.every((b) => b.model === "jev-1.13.0"));
  } finally {
    server.close();
  }
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/measure-verdict.test.mjs`

Expected: FAIL, `Cannot find module '…/scripts/measure-verdict.mjs'`.

- [ ] **Step 3: Write the code**

Create `scripts/measure-verdict.mjs`:

````js
// Whether the answer check's probabilities mean what they say, measured before any threshold is
// written. Run by hand, with a key, never in CI, since the suite reaches no live service:
//
//   TYPESAFE_API_KEY=… node scripts/measure-verdict.mjs
//
// It runs the loop itself over the fixture host, the meta-model's worked example, with a
// scripted model: each case makes the tool calls a real answer would and writes one sentence,
// once as the evidence carries it and once with a fault planted in it — a wrong date, a skill the
// entity does not claim, a title no tool returned, an empty search said to be full — in English
// and in German. The check runs as the service runs it, budget and all. It prints each case's
// verdict, and, per tenth of probability, how often the verdict was right, which here means it
// counted a faulted sentence against the answer and a clean one not. Where that curve is near the
// diagonal, the threshold is read off it and written into the spec's §8; where it is not, the
// widget marks nothing and the kept counts are the whole use.
import { answer } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { verdictCheck, isUnsupported } from "../lib/verdict.mjs";
import { typesafeJudge, MODEL } from "../lib/typesafe.mjs";
import { startFixtureHost } from "../test/helpers.mjs";

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.error("TYPESAFE_API_KEY is not set; nothing was measured.");
  process.exit(1);
}
// The measuring's own seam, so its test can stand a fake service in; the service has none.
const url = process.env.CHAT_TYPESAFE_URL;
const judge = typesafeJudge({ key, ...(url ? { url } : {}) });

const fixture = await startFixtureHost();
const host = await connectHost(fixture.url);
const idOf = async (name) => (await host.call("search", { query: name, match: "name" })).data.results[0].id;
const EXPERIENCE = "Splitting the billing domain";
const calls = {
  experience: async () => [["get_entity", { id: await idOf(EXPERIENCE) }]],
  experienceAndSkill: async () => [["get_entity", { id: await idOf(EXPERIENCE) }], ["search", { query: "Product Discovery", match: "name" }]],
  release: async () => [["get_entity", { id: await idOf("Release") }]],
  nothing: async () => [["search", { query: "quantum roadmap", match: "words" }]],
};

// Each case: the calls, and per language the clean sentence and the faulted one.
const CASES = [
  { name: "a wrong date", calls: "experience",
    en: [`${EXPERIENCE} began in February 2022.`, `${EXPERIENCE} began in March 2019.`],
    de: [`${EXPERIENCE} begann im Februar 2022.`, `${EXPERIENCE} begann im März 2019.`] },
  { name: "a skill the entity does not claim", calls: "experienceAndSkill",
    en: [`${EXPERIENCE} drew on Java Programming.`, `${EXPERIENCE} drew on Product Discovery.`],
    de: [`${EXPERIENCE} stützte sich auf Java Programming.`, `${EXPERIENCE} stützte sich auf Product Discovery.`] },
  { name: "a title no tool returned", calls: "release", faultCalls: "experience",
    en: ["Release watches the platform until the change has been exercised by real traffic.", "Release watches the platform until the change has been exercised by real traffic."],
    de: ["Release beobachtet die Plattform, bis echter Verkehr die Änderung durchlaufen hat.", "Release beobachtet die Plattform, bis echter Verkehr die Änderung durchlaufen hat."] },
  { name: "an empty search said to be full", calls: "nothing",
    en: ["The model holds nothing on a quantum roadmap.", "The quantum roadmap ships in 2027."],
    de: ["Das Modell enthält nichts zu einer Quanten-Roadmap.", "Die Quanten-Roadmap erscheint 2027."] },
];

const usage = { input_tokens: 0, output_tokens: 0 };
const run = async (toolCalls, sentence, lang) => {
  const script = [
    ...toolCalls.map(([name, input], i) => ({ content: [{ type: "tool_use", id: `tu_${i}`, name, input }], stop_reason: "tool_use", usage })),
    { content: [{ type: "text", text: sentence }], stop_reason: "end_turn", usage },
  ];
  const model = { name: "scripted", async turn(request, onText) { const msg = script.shift(); for (const c of msg.content) if (c.type === "text") onText(c.text); return msg; } };
  let event = null;
  const check = verdictCheck({ judge, titles: () => host.titles(), threshold: null, budget: 30_000 });
  await answer({ host, model, meter: new Meter(new MemoryStore(), { monthTokens: 1e9 }), verdict: async (m) => { const v = await check(m); event = v?.event ?? null; return v; } },
    { messages: [{ role: "user", content: "?" }], lang }, () => {});
  return event;
};

const points = [];
let failed = 0;
console.log(`TypeSafe ${MODEL}, over the fixture host's worked example\n`);
for (const lang of ["en", "de"]) {
  for (const c of CASES) {
    for (const [i, faulted] of [[0, false], [1, true]]) {
      const toolCalls = await calls[faulted && c.faultCalls ? c.faultCalls : c.calls]();
      const event = await run(toolCalls, c[lang][i], lang);
      const claim = event?.claims?.[0];
      if (!claim) { failed++; console.log(`  ${lang}  ${c.name}, ${faulted ? "faulted" : "clean"}: not checked`); continue; }
      const right = isUnsupported(claim.verdict) === faulted;
      console.log(`  ${lang}  ${c.name}, ${faulted ? "faulted" : "clean"}: ${claim.verdict}${claim.p === null ? "" : ` ${claim.p.toFixed(2)}`}${right ? "" : "  (wrong)"}`);
      if (claim.p !== null) points.push({ lang, p: claim.p, right });
    }
  }
}
for (const lang of ["en", "de"]) {
  console.log(`\n${lang}: the probability of the verdict, by tenth; right is how often the verdict counted the sentence as it should`);
  for (let t = 0; t < 10; t++) {
    const inside = points.filter((x) => x.lang === lang && Math.min(9, Math.floor(x.p * 10)) === t);
    console.log(`  ${(t / 10).toFixed(1)}–${((t + 1) / 10).toFixed(1)}  n=${String(inside.length).padStart(3)}  right ${inside.length ? (inside.filter((x) => x.right).length / inside.length).toFixed(2) : "—"}`);
  }
}
console.log(`\nnot checked: ${failed} answers`);
await host.close();
await fixture.close();
````

- [ ] **Step 4: Run them to see them pass**

Run: `node --test test/measure-verdict.test.mjs`

Expected: PASS, 2 tests; then `npm test`, the whole suite, passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-verdict.mjs test/measure-verdict.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
The answer check's calibration can be measured, by hand

scripts/measure-verdict.mjs runs the loop itself over the fixture host with a scripted model, once with a clean sentence and once with a fault planted in it, in English and in German, checks each as the service does and prints the verdicts and the curve per language. It runs with a key, by hand, and never in CI; its test stands a fake service in.

Verified: npm test passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: <the model that wrote this commit>
EOF
git log -1 --format='[%s]'
```

---

### Task 9: The privacy pages name TypeSafe

**Files**, one pull request in each site repository, each its own worktree and its own owner's merge:

- Modify: `privacy/index.html` in `robertblust/robertblust.github.io` (chat.blust.ch, seats at `blust.ch`)
- Modify: `privacy/index.html` in `companygraph/companygraph.github.io` (chat.companygraph.io, seats at `companygraph.io`)
- Modify: `privacy/index.html` in `guestgraph/guestgraph.github.io` (chat.guestgraph.io, seats at `guestgraph.io`)

Each page holds its English in the element and its German in a `data-de` attribute beside it. Two places name Anthropic today and gain TypeSafe: the third-party requests item, which says the chat's message goes to the chat host and from there to Anthropic, and the chat paragraph, which says what Anthropic receives and keeps.

- [ ] **Step 1: Read what TypeSafe says before writing what it does**

Read `https://typesafe.ai/legal/privacy-policy`, `https://typesafe.ai/legal/data-processing` and `https://trust.typesafe.ai/subprocessors`, and note where TypeSafe processes data, how long it keeps it, and whether it trains on it. Its data processing agreement states no fixed retention, only for as long as the processing needs; write only what the documents say, and where they say no period, say that.

- [ ] **Step 2: The English, as the Writer**

In each page's chat paragraph, after the sentence about what Anthropic keeps, add one sentence in that page's own register, of this substance: where the chat checks its answers, the service also sends the answer's sentences, and the parts of the model's public pages they rest on, to TypeSafe, whose model judges whether the pages carry each sentence; your question and your address do not go there; and what TypeSafe keeps and for how long, from Step 1. In the third-party item, name TypeSafe beside Anthropic as receiving the answer, not the message. Each page names its own chat host.

- [ ] **Step 3: The German, as the Translator**

Hand each English change to the translator subagent of `conventions/TRANSLATOR.md` for the `data-de` attribute beside it, in Swiss Standard German as `conventions/GERMAN.md` says, and apply what it returns.

- [ ] **Step 4: Check and commit**

Run each site's own checks (`npm test` where it has one, `sh conventions/conventions-format`, `sh conventions/conventions-check`) and open the page locally in both languages. Commit the English as `Writer <writer@<domain>>` and the German as `Translator <translator@<domain>>`, `Process: Delivery`, `Phase: Implement`, `Track: Prose`, and open the pull request. Stop: the merge is the owner's, and no deployment sets `verdict` until all three pages are live.

---

## After the last task

Run `npm test` once more, `terraform fmt -check` and `validate` in `deploy/google/terraform`, and the conventions checks; open the pull request and stop. Then, in order, and each on the owner's word: the three privacy pages go live; the owner makes `typesafe-key` with a spend limit at TypeSafe and runs `node scripts/measure-verdict.mjs` with a key; one deployment sets `verdict: true` with no threshold and runs a week, its report read for the counts; then a threshold read off the measurement is set, and the widget's marking of claims is designed in `robertblust/design` once there is one to mark by.
