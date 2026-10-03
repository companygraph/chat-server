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
