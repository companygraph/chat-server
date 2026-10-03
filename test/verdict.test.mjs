// The answer, checked: claims found by the answer's form, the entities each names, the findings
// that need no judge, and what a scripted judge's answers become. No live service is reached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsOf, namedIn, verdictOf, checked, verdictCheck, isUnsupported, languageOf, CRITERIA, STATE_BUDGET, REQUEST_BUDGET } from "../lib/verdict.mjs";

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

test("German is split in German", () => {
  assert.deepEqual(claimsOf("Sie begann im Februar 2022. Danach folgte die Aufteilung.", "de").map((c) => c.text), ["Sie begann im Februar 2022.", "Danach folgte die Aufteilung."]);
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
  evidence: new Map([["x", ["start: 2022-02"]]]),
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
  const r = await verdictOf(message({ text: "The Release Engineering phase follows.", index: [...message().index, { id: "re", title: "Release Engineering" }] }), judge);
  assert.equal(r.claims[0].verdict, "unsourced");
  assert.equal(seen.length, 0);
});

test("a one-word title and a title the prompt gave the model are no ground for unsourced", async () => {
  const { judge } = judging("absent");
  assert.equal((await verdictOf(message({ text: "The Release phase follows." }), judge)).claims[0].verdict, "unnamed");
  const asked = "How does a change ship?";
  const r = await verdictOf(message({ text: `Splitting the billing domain answers How does a change ship? in part.`, index: [...message().index, { id: "q", title: asked }], promptTitles: [asked] }), judging("supported").judge);
  assert.equal(r.claims[0].verdict, "supported");
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
  assert.deepEqual(await verdictOf(message({ evidence: new Map([["x", ["y".repeat(STATE_BUDGET)]]]) }), judge), { failed: "too_large" });
  assert.equal(seen.length, 0);
});

test("a judge that fails or overruns its budget leaves the answer unchecked, never in error", async () => {
  assert.deepEqual(await checked(message(), async () => { throw new Error("TypeSafe answered 401"); }), { failed: "TypeSafe answered 401" });
  let aborted = false;
  const slow = (request, { signal }) => new Promise((done) => { signal.addEventListener("abort", () => { aborted = true; }); setTimeout(() => done({}), 200); });
  assert.deepEqual(await checked(message(), slow, 20), { failed: "budget" });
  assert.ok(aborted, "the overrunning call is aborted");
});

test("the check answers the event and the two counts, and marks nothing in German", async () => {
  const { judge } = judging("contradicted");
  const check = verdictCheck({ judge, titles: () => message().index, threshold: 0.8 });
  const { index, ...rest } = message();
  const en = await check(rest);
  assert.deepEqual(en, { event: { claims: [{ from: 0, to: 52, ids: ["x"], verdict: "contradicted", p: 0.9 }], threshold: 0.8 }, claims: 1, unsupported: 1 });
  assert.equal((await check({ ...rest, lang: "de" })).event.threshold, null);
  // The answer's own language decides, not the page's: a German answer on an English page.
  assert.equal((await check({ ...rest, lang: "en", text: "Splitting the billing domain begann im Februar 2022 und ist noch nicht fertig." })).event.threshold, null);
});

test("the five options are the judge's, and what counts against an answer is fixed", () => {
  assert.deepEqual(Object.keys(CRITERIA), ["supported", "partial", "contradicted", "absent", "says-nothing", "connective"]);
  assert.deepEqual(["supported", "says-nothing", "partial", "contradicted", "absent", "withheld", "unnamed", "unsourced"].map(isUnsupported), [false, false, true, true, true, true, true, true]);
});

test("every tool answer that carried an entity is its evidence, the fetch beside the search", async () => {
  const { seen, judge } = judging("supported");
  await verdictOf(message({ evidence: new Map([["x", ['{"results":[{"id":"x"}]}', "start: 2022-02"]]]) }), judge);
  assert.deepEqual(seen[0].state.answers, { a1: '{"results":[{"id":"x"}]}', a2: "start: 2022-02" });
  assert.deepEqual(seen[0].questions.c1.evidence, ["a1", "a2"]);
});

test("the answer's language is read from its words, and is none where they do not say", () => {
  assert.equal(languageOf("Das Projekt begann im Februar und ist noch nicht abgeschlossen."), "de");
  assert.equal(languageOf("The project began in February and is not finished."), "en");
  assert.equal(languageOf("Java Programming."), null);
});

test("German dates and common abbreviations do not end a sentence, and a question is no claim", () => {
  assert.deepEqual(claimsOf("Das Projekt begann am 15. März 2022 und endete im Mai.", "de").map((c) => c.text), ["Das Projekt begann am 15. März 2022 und endete im Mai."]);
  assert.deepEqual(claimsOf("Sie nutzte z. B. Java. Dann ging sie.", "de").map((c) => c.text), ["Sie nutzte z. B. Java.", "Dann ging sie."]);
  assert.deepEqual(claimsOf("Dr. Smith led it. Would you like to know more?", "en").map((c) => c.text), ["Dr. Smith led it."]);
});

test("a tilde fence, a bold-only line and a quote's marker are not claims, and two rounds' sentences part", () => {
  const text = "~~~\nnot = a claim\n~~~\n\n**Robert Blust**\n\n> Quoted fact.\n\nLooking.Robert Blust is it.";
  const claims = claimsOf(text, "en");
  assert.deepEqual(claims.map((c) => c.text), ["Quoted fact.", "Looking.", "Robert Blust is it."]);
  for (const c of claims) assert.equal(text.slice(c.from, c.to), c.text);
});

test("a title inside inline code is not a name", () => {
  assert.deepEqual(namedIn("Run `Java Programming` here.", [{ id: "j", title: "Java Programming" }]), []);
});

test("a sentence the judge reads as connective is dropped from the claims", async () => {
  const { judge } = judging("connective");
  assert.deepEqual((await verdictOf(message({ text: "Let me look that up." }), judge)).claims, []);
});

test("a request larger than the judge reads, counting its questions, is not sent", async () => {
  const { seen, judge } = judging("supported");
  const many = Array.from({ length: 400 }, (_, i) => `Splitting the billing domain fact ${i} holds.`).join(" ");
  assert.ok(many.length < REQUEST_BUDGET);
  assert.deepEqual(await verdictOf(message({ text: many }), judge), { failed: "too_large" });
  assert.equal(seen.length, 0);
});

test("a check that could not run says why in one warning, with no key and no word of the answer", async () => {
  const warned = [];
  const check = verdictCheck({ judge: async () => { throw new Error("TypeSafe answered 429"); }, titles: () => [], threshold: null, warn: (fields) => warned.push(fields) });
  const { index, ...rest } = message();
  assert.equal(await check(rest), null);
  assert.deepEqual(warned, [{ reason: "TypeSafe answered 429" }]);
  assert.ok(!JSON.stringify(warned).includes("February"));
});

test("a claim naming no entity keeps the judge's verdict where the tool answers carry it, and is unnamed where they do not", async () => {
  const of = async (pick) => (await verdictOf(message({ text: "An experience is one dated period." }), judging(pick).judge)).claims[0];
  assert.deepEqual(await of("supported"), { from: 0, to: 34, ids: [], verdict: "supported", p: 0.9 });
  assert.equal((await of("partial")).verdict, "partial");
  assert.equal((await of("absent")).verdict, "unnamed");
  assert.equal((await of("contradicted")).verdict, "unnamed");
});
