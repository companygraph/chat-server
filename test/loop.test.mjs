import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { answer, namesIn, namesPastTheCap, NAME_CAP, foundNothing, diagramOf, diagramNote, restsOf, restsNote } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore, ReaderMeter, ESTIMATE, estimateFor } from "../lib/meter.mjs";
import { MAX_ROUNDS, MAX_TOOL_RESULT_CHARS, LIST_PAGE } from "../lib/shape.mjs";
import { FINAL_NOTE } from "../lib/model.mjs";
import { NAME_NOTE, nameNote, DIAGRAM_RULE, FACTS_RULE } from "../lib/prompt.mjs";
import { startFixtureHost, EXAMPLE_ROOT, exampleSnapshot } from "./helpers.mjs";

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

// The delivery process's phase ids, read off the fixture snapshot by address rather than
// hardcoded, so a server that answers with the stable id instead of the address leaves these
// tests holding.
const fixtureEntities = exampleSnapshot().entities;
const idOfAddress = (address) => fixtureEntities.find((e) => e.address === address).id;
const specifyPhaseId = idOfAddress("processes/delivery/phases/specify");
const buildPhaseId = idOfAddress("processes/delivery/phases/build");
const releasePhaseId = idOfAddress("processes/delivery/phases/release");

const usage = { input_tokens: 1000, output_tokens: 100 };
const textTurn = (text) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const toolTurn = (name, input, text = "") => ({
  content: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", id: `tu_${name}`, name, input }],
  stop_reason: "tool_use", usage,
});

function fakeModel(script) {
  const requests = [], options = [];
  return {
    requests,
    options,
    name: "fake",
    async turn(request, onText, opts) {
      requests.push(request);
      options.push(opts);
      const msg = script.shift();
      for (const c of msg.content) if (c.type === "text") onText(c.text);
      return msg;
    },
  };
}

const meter = () => new Meter(new MemoryStore(), { monthTokens: 10_000_000 });
const collect = () => { const events = []; return { events, emit: (e, d) => events.push([e, d]) }; };

test("a question that needs two rounds gets them, and the entity fetched is cited", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([
    toolTurn("search", { query: EXAMPLE_ROOT, match: "name" }),
    toolTurn("get_entity", { id: rootId }),
    textTurn("It is the company."),
  ]);
  const { events, emit } = collect();
  const m = meter();
  const r = await answer({ host, model, meter: m }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, emit);
  assert.equal(model.requests.length, 3);
  assert.equal(model.requests[0].system[0].text.includes("answer in English"), true);
  assert.match(model.requests[0].system[0].text, /types, each with how many entities it holds: .*\(\d+\)/);
  assert.equal(model.requests[0].tools.length, host.tools.length);
  assert.equal(model.requests[1].messages.at(-1).role, "user");
  assert.equal(model.requests[1].messages.at(-1).content[0].type, "tool_result");
  const kinds = events.map(([e]) => e);
  // The search round names what it found, the fetch round cites the one entity and names what
  // that entity references: a name and a cite for the same id both link the same place, so
  // neither is held back for the other.
  assert.deepEqual(kinds, ["names", "cite", "names", "text", "done"]);
  const names = events[0][1].names;
  assert.ok(names.some((n) => n.id === rootId), "the search round names what it found");
  const cite = events[1][1];
  assert.equal(cite.id, rootId); assert.equal(cite.title, EXAMPLE_ROOT); assert.equal(typeof cite.url, "string");
  assert.deepEqual(events[3][1], { text: "It is the company." });
  const done = events[4][1];
  assert.equal(done.model.repo, "companygraph/meta-model");
  assert.equal(done.spent, r.spent);
  assert.equal(done.spent, 3 * (1000 + 500));
  assert.equal((await m.state()).dayTokens, done.spent);
});

// A question of the model's says where its answer lies: its page names the entities it rests on
// and gives none of what they say. Read alone it looks like an answer, and the chat wrote one
// from it without opening a page. So the question's own tool answer ends by naming each page it
// rests on that this message has not read, and asks for them before the answer is written.
const INVOICE_QUESTION = idOfAddress("questions/how-do-i-find-out-why-a-line-is-on-my-invoice");
const CHARGE = idOfAddress("features/charge-explanation"), PRICING = idOfAddress("features/pricing-rules");
const REVENUE_QUESTION = idOfAddress("questions/does-beacon-systems-publish-its-revenue");

test("a question's answer names the pages it rests on, and nothing else has any", async () => {
  const q = await host.call("get_entity", { id: INVOICE_QUESTION });
  assert.deepEqual(restsOf("get_entity", q).map((r) => r.id).sort(), [CHARGE, PRICING].sort());
  assert.ok(restsOf("get_entity", q).every((r) => r.type === "feature" && typeof r.title === "string" && r.title.length > 0));
  assert.deepEqual(restsOf("get_entity", await host.call("get_entity", { id: REVENUE_QUESTION })), [], "a question mastered on its own page rests on none");
  assert.deepEqual(restsOf("get_entity", await host.call("get_entity", { id: CHARGE })), [], "a page that is no question");
  assert.deepEqual(restsOf("fetch", q), [], "only the structured answer carries the references");
  assert.deepEqual(restsOf("get_entity", { isError: true, data: q.data }), []);
  assert.deepEqual(restsOf("get_entity", null), []);
});

test("the note names each page by title, type and id, and says the question's page is not the answer", () => {
  const note = restsNote([{ id: "a1", title: "Charge explanation", type: "feature" }, { id: "b2", title: "Pricing rules", type: null }]);
  assert.match(note, /not the answer/);
  assert.match(note, /get_entity/);
  assert.match(note, /Charge explanation \(feature\), id a1; Pricing rules, id b2/);
  assert.equal(restsNote([]), "");
});

test("after a question is read, the model is told which of its pages it has not read yet", async () => {
  const model = fakeModel([
    toolTurn("get_entity", { id: INVOICE_QUESTION }),
    toolTurn("get_entity", { id: CHARGE }),
    toolTurn("get_entity", { id: INVOICE_QUESTION }),
    textTurn("From the charge explanation."),
  ]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "why is this line on my invoice?" }], lang: "en" }, emit);
  const given = (i) => model.requests[i].messages.at(-1).content.find((c) => c.type === "tool_result").content;
  // Read first, the question names both pages, after its own answer and in the same block.
  assert.ok(given(1).includes(`id ${CHARGE}`) && given(1).includes(`id ${PRICING}`), given(1).slice(-400));
  assert.ok(given(1).indexOf("not the answer") > given(1).indexOf(INVOICE_QUESTION), "the note follows the answer it is about");
  // A page that is no question carries no note.
  assert.ok(!given(2).includes("not the answer"));
  // Read again once one page is read, it names only the other.
  assert.ok(given(3).includes(`id ${PRICING}`) && !given(3).includes(`id ${CHARGE}`), given(3).slice(-400));
  // The note stays where the naming note and the tool's answer already stand.
  assert.equal(model.requests[1].messages.at(-1).content.at(-1).text, nameNote("why is this line on my invoice?"));
  assert.equal(model.requests[1].messages.at(-1).content.at(-2).type, "tool_result");
  assert.deepEqual(events.filter(([e]) => e === "cite").map(([, d]) => d.id), [INVOICE_QUESTION, CHARGE]);
});

test("a question read in the last round a tool may be called in carries no note, since no page can follow it", async () => {
  const script = [];
  for (let i = 0; i < MAX_ROUNDS - 1; i++) script.push(toolTurn("list_types", {}));
  script.push(toolTurn("get_entity", { id: INVOICE_QUESTION }), textTurn("ok"));
  const model = fakeModel(script);
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "q" }], lang: "en" }, collect().emit);
  const last = model.requests.at(-1).messages.at(-1).content.find((c) => c.type === "tool_result").content;
  assert.ok(last.includes(INVOICE_QUESTION) && !last.includes("not the answer"));
});

test("a fifth round is not made: the last request forbids a tool call", async () => {
  const script = [];
  for (let i = 0; i < MAX_ROUNDS; i++) script.push(toolTurn("list_types", {}));
  script.push(toolTurn("list_types", {}, "still calling"));
  const model = fakeModel(script);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "loop" }], lang: "en" }, emit);
  assert.equal(model.requests.length, MAX_ROUNDS + 1);
  assert.deepEqual(model.requests.at(-1).tool_choice, { type: "none" });
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-1).text, FINAL_NOTE, "and says so after the last tool's answer");
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-2).text, nameNote("loop"), "after the naming note");
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-3).type, "tool_result");
  assert.equal(model.requests.at(-2).tool_choice, undefined);
  assert.ok(!JSON.stringify(model.requests.at(-2).messages).includes(FINAL_NOTE));
  assert.equal(events.at(-1)[0], "done");
});

test("an answer of no text is asked for once more, as the last request, and a second silence ends the message", async () => {
  const silent = { content: [], stop_reason: "end_turn", usage };
  const model = fakeModel([toolTurn("list_types", {}), silent, textTurn("Now it says.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "q" }], lang: "en" }, emit);
  assert.equal(model.requests.length, 3, "the silence cost one more request");
  assert.deepEqual(model.requests.at(-1).tools, [], "which lists no tool, since a listed tool is what the silent model still meant to call");
  assert.equal(model.requests.at(-1).tool_choice, undefined, "and names no choice over them");
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-1).text, FINAL_NOTE, "with the note");
  assert.equal(model.requests.at(-1).messages.length, 3, "and the silent message is not in the conversation");
  assert.equal(model.requests.at(-2).tools.length, host.tools.length, "the round before it listed them");
  assert.deepEqual(events.filter(([e]) => e === "text").map(([, d]) => d.text), ["Now it says."]);
  assert.equal(events.at(-1)[0], "done");
  const twice = fakeModel([silent, silent, textTurn("never")]);
  const again = collect();
  await answer({ host, model: twice, meter: meter() }, { messages: [{ role: "user", content: "q" }], lang: "en" }, again.emit);
  assert.equal(twice.requests.length, 2, "a second silence is not asked again");
  assert.deepEqual(twice.requests[1].messages[0].content.map((b) => b.text), ["q", FINAL_NOTE], "the note follows the question when no tool was called");
  assert.deepEqual(twice.requests[1].tools, [], "and no tool is listed there either");
  assert.deepEqual(again.events.map(([e]) => e), ["done"]);
  const cut = fakeModel([{ content: [], stop_reason: "max_tokens", usage }, textTurn("never")]);
  const cutEvents = collect();
  await answer({ host, model: cut, meter: meter() }, { messages: [{ role: "user", content: "q" }], lang: "en" }, cutEvents.emit);
  assert.equal(cut.requests.length, 1, "an answer the output limit cut is not a silence");
  assert.equal(cutEvents.events.at(-1)[1].cut, true);
});

test("a tool answer over the cap reaches the model cut, with the line", async () => {
  // The fixture's entities are small, so the host is wrapped to answer one call with a text
  // over the cap; the loop must cut it and say so.
  const big = { ...host, call: async (name, args) => ({ ...(await host.call(name, args)), text: "a".repeat(MAX_TOOL_RESULT_CHARS * 2) }) };
  const model = fakeModel([toolTurn("list_types", {}), textTurn("ok")]);
  await answer({ host: big, model, meter: meter() }, { messages: [{ role: "user", content: "big" }], lang: "en" }, collect().emit);
  const result = model.requests[1].messages.at(-1).content[0].content;
  assert.ok(result.startsWith("a".repeat(MAX_TOOL_RESULT_CHARS)));
  assert.ok(result.length < MAX_TOOL_RESULT_CHARS + 200);
  assert.match(result, new RegExp(`truncated at ${MAX_TOOL_RESULT_CHARS} characters`));
});

test("a refused tool call goes back as an error result and the loop goes on", async () => {
  const model = fakeModel([toolTurn("fetch", { id: "nothing/here" }), textTurn("The model does not say.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "x" }], lang: "en" }, emit);
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.equal(events.filter(([e]) => e === "cite").length, 0);
});

test("the shape and the meter refuse before any call, and nothing is emitted", async () => {
  const model = fakeModel([textTurn("never")]);
  const { events, emit } = collect();
  await assert.rejects(() => answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "x".repeat(1001) }], lang: "en" }, emit), (e) => e.code === "too_long");
  const closed = new Meter(new MemoryStore(), { monthTokens: 100 });
  await closed.store.transact((d) => ({ ...d, closed: true }));
  await assert.rejects(() => answer({ host, model, meter: closed }, { messages: [{ role: "user", content: "x" }], lang: "en" }, emit), (e) => e.code === "closed");
  assert.equal(model.requests.length, 0);
  assert.equal(events.length, 0);
});

test("every request marks its newest block, which is what the next round resends", async () => {
  const model = fakeModel([toolTurn("list_types", {}), textTurn("ok")]);
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, collect().emit);
  assert.equal(model.requests.length, 2);
  for (const r of model.requests) {
    assert.deepEqual(r.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
    assert.equal(r.tools.at(-1).cache_control, undefined);
  }
  assert.equal(model.requests[1].messages.at(-1).content.at(-1).text, nameNote("hi"));
  assert.equal(model.requests[1].messages.at(-1).content.at(-2).type, "tool_result");
});

test("the naming note follows every round's tool answers and never the visitor's own message", async () => {
  const model = fakeModel([toolTurn("list_types", {}), toolTurn("list_types", {}), textTurn("ok")]);
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "Welche Entscheide gibt es?" }], lang: "de" }, collect().emit);
  assert.equal(model.requests.length, 3);
  const note = nameNote("Welche Entscheide gibt es?");
  assert.ok(!JSON.stringify(model.requests[0].messages).includes(NAME_NOTE), "the first request is the visitor's message alone");
  for (const r of model.requests.slice(1)) {
    const last = r.messages.at(-1).content;
    assert.equal(last.at(-1).text, note, "the note is the newest block");
    assert.ok(last.slice(0, -1).every((b) => b.type === "tool_result"), "after the tool answers it follows");
  }
  assert.equal(model.requests[2].messages.filter((m) => JSON.stringify(m).includes(NAME_NOTE)).length, 2, "each round's answers keep their note, so the prefix the cache holds does not move");
  assert.match(NAME_NOTE, /In an English answer, name every entity by its title alone/);
  assert.match(NAME_NOTE, /verweist auf die \*\*Kundenliste\*\* \(The customer list\)/, "in a sentence the article stands outside the bold");
  assert.doesNotMatch(NAME_NOTE, /\*\*(Der|Die|Das) /, "no example glues a nominative article into a name");
  assert.match(NAME_NOTE, /in the case and gender the sentence needs/);
  assert.match(NAME_NOTE, /rendered into that language wherever it has a word for it; only a name the language keeps unchanged, such as \*\*MLOps\*\*, stands once and alone/);
  assert.match(NAME_NOTE, /never ß/);
  assert.ok(note.startsWith('The visitor\'s last message is: "Welche Entscheide gibt es?". Write the answer in the language of that message'), "the note quotes the message whose language the answer takes");
});

test("a visitor who goes away stops the loop after the round it is in, and the meter is still settled", async () => {
  const model = fakeModel([toolTurn("list_types", {}), textTurn("never")]);
  const { events, emit } = collect();
  const m = meter();
  const ac = new AbortController();
  ac.abort();
  const r = await answer({ host, model, meter: m }, { messages: [{ role: "user", content: "hi" }], lang: "en", signal: ac.signal }, emit);
  assert.equal(model.requests.length, 1);
  assert.equal(model.options[0].signal, ac.signal, "the signal reaches the model");
  assert.equal(events.filter(([e]) => e === "done").length, 0, "nothing is emitted once the socket is gone");
  assert.equal((await m.state()).dayTokens, r.spent);
});

test("only the window reaches the model", async () => {
  const messages = [];
  for (let i = 0; i < 21; i++) messages.push({ role: i % 2 ? "assistant" : "user", content: `t${i}` });
  const model = fakeModel([textTurn("ok")]);
  await answer({ host, model, meter: meter() }, { messages, lang: "en" }, collect().emit);
  assert.equal(model.requests[0].messages.length, 7);
  assert.equal(model.requests[0].messages[0].content, "t14");
  assert.equal(model.requests[0].messages[0].role, "user");
});

// A meter the calls can be counted against: the real one, with every reserve and settle tallied.
const counting = (m) => ({
  calls: { reserve: 0, settle: 0 },
  get dayShare() { return m.dayShare; },
  state: () => m.state(),
  reserve(estimate) { this.calls.reserve += 1; return m.reserve(estimate); },
  settle(estimate, actual) { this.calls.settle += 1; return m.settle(estimate, actual); },
});

test("every call is reserved and settled on its own, so a three-call message is three of each", async () => {
  const m = counting(meter());
  const model = fakeModel([toolTurn("list_types", {}), toolTurn("list_types", {}), textTurn("It is the company.")]);
  const { events, emit } = collect();
  const r = await answer({ host, model, meter: m }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit);
  assert.equal(model.requests.length, 3);
  assert.equal(m.calls.reserve, 3);
  assert.equal(m.calls.settle, 3);
  assert.equal(r.spent, 3 * (1000 + 500));
  assert.equal((await m.state()).dayTokens, r.spent);
  assert.equal(events.at(-1)[0], "done");
});

test("a day's share that fits one call refuses the second, and the first call's cost is all that stands", async () => {
  // The share is one estimate exactly: the first reserve fits, and once it is settled at what
  // the call really cost the second no longer does.
  const m = new Meter(new MemoryStore(), { monthTokens: 10 * ESTIMATE });
  const model = fakeModel([toolTurn("list_types", {}, "Looking…"), textTurn("never")]);
  const { events, emit } = collect();
  await assert.rejects(
    () => answer({ host, model, meter: m }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit),
    (e) => e.code === "over_day",
  );
  assert.equal(model.requests.length, 1);
  assert.deepEqual(events.map(([e]) => e), [], "the round that called a tool sent nothing of its text");
  assert.equal((await m.state()).dayTokens, 1000 + 500, "the refused reserve added nothing");
});

test("an answer the output limit cut says so in done, and one that ended on its own says nothing", async () => {
  const model = fakeModel([{ content: [{ type: "text", text: "It began to say" }], stop_reason: "max_tokens", usage }]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit);
  assert.equal(events.at(-1)[0], "done");
  assert.equal(events.at(-1)[1].cut, true);
  const whole = collect();
  await answer({ host, model: fakeModel([textTurn("All of it.")]), meter: meter() }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, whole.emit);
  assert.equal("cut" in whole.events.at(-1)[1], false);
});

// The answer's language is the visitor's, whatever the page's, so the widget reads it off done
// to offer what follows in it: a German answer on the English page says de.
test("done names the language the answer is written in, and the request's where its words do not tell", async () => {
  const german = collect();
  await answer({ host, model: fakeModel([textTurn("Die Firma ist ein Unternehmen, das mit dem Modell arbeitet und auf der Seite steht.")]), meter: meter() }, { messages: [{ role: "user", content: "Was ist das?" }], lang: "en" }, german.emit);
  assert.equal(german.events.at(-1)[1].lang, "de", "a German answer on the English page");
  const english = collect();
  await answer({ host, model: fakeModel([textTurn("The company is a firm that works with the model and is on the page.")]), meter: meter() }, { messages: [{ role: "user", content: "What is it?" }], lang: "de" }, english.emit);
  assert.equal(english.events.at(-1)[1].lang, "en", "an English answer on the German page");
  const bare = collect();
  await answer({ host, model: fakeModel([textTurn("MLOps.")]), meter: meter() }, { messages: [{ role: "user", content: "MLOps" }], lang: "de" }, bare.emit);
  assert.equal(bare.events.at(-1)[1].lang, "de", "a name alone tells nothing, so the request's language stands");
  const none = collect();
  await answer({ host, model: fakeModel([textTurn("MLOps.")]), meter: meter() }, { messages: [{ role: "user", content: "MLOps" }], lang: "fr" }, none.emit);
  assert.equal(none.events.at(-1)[1].lang, "en", "and where the request names none the interface knows, English, as the prompt falls back");
});

test("an entity fetched in two rounds is cited once", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([toolTurn("get_entity", { id: rootId }), toolTurn("get_entity", { id: rootId }), textTurn("It is the company.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit);
  const cites = events.filter(([e]) => e === "cite");
  assert.equal(cites.length, 1);
  assert.equal(cites[0][1].id, rootId);
});

test("find_evidence answers a skill, not an entity, and it is cited", async () => {
  const skillId = (await host.call("list_entities", { type: "skill", limit: 1 })).data.entities[0].id;
  const model = fakeModel([toolTurn("find_evidence", { skill: skillId }), textTurn("It rests on that skill.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "what evidence backs it?" }], lang: "en" }, emit);
  const cites = events.filter(([e]) => e === "cite");
  assert.equal(cites.length, 1);
  assert.equal(cites[0][1].id, skillId);
});

test("a list answer gives up every entity it named, once a message and never one already cited", async () => {
  const model = fakeModel([toolTurn("list_entities", { type: "skill" }), toolTurn("list_entities", { type: "skill" }), textTurn("Skills drawn on: many.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "which skills?" }], lang: "en" }, emit);
  const names = events.filter(([e]) => e === "names");
  assert.equal(names.length, 1, "the second round names nothing new");
  const list = names[0][1].names;
  assert.ok(list.length > 1);
  for (const n of list) { assert.equal(typeof n.id, "string"); assert.equal(typeof n.title, "string"); }
  assert.equal(new Set(list.map((n) => n.id)).size, list.length, "no id twice");
});

test("namesIn reads a list, ignores a refusal and a single entity, names an id once, and stops at the cap", () => {
  assert.deepEqual(namesIn({ results: [{ id: "a/b", title: "A B" }] }), [{ id: "a/b", title: "A B" }]);
  assert.deepEqual(namesIn({ error: { code: "not_found" }, results: [{ id: "a/b", title: "A B" }] }), []);
  assert.deepEqual(namesIn({ entity: { id: "a/b", title: "A B" } }), [], "the entity itself is the cite's, not a name");
  assert.deepEqual(namesIn({ entity: { id: "a/b", references: [{ via: "Skills.Skill", to: { id: "skills/java", name: "Java" } }] } }),
    [{ id: "skills/java", title: "Java" }], "and what it references is a name");
  assert.deepEqual(namesIn({ entity: { id: "contexts/resolution", referencedBy: [{ from: { id: "aggregates/graph", name: "Graph" }, via: "nested-in", to: { id: "contexts/resolution", name: "Resolution" } }] } }),
    [{ id: "aggregates/graph", title: "Graph" }], "and so is what references it, by the edge's start");
  assert.equal(namesIn({ entities: Array.from({ length: NAME_CAP + 20 }, (_, i) => ({ id: `t/${i}`, name: `N ${i}` })) }).length, NAME_CAP);
  const repeats = { entity: { id: "p/x", references: Array.from({ length: 50 }, (_, i) => ({ via: "Evidence.Skill", to: { id: `skills/${i % 5}`, name: `Skill ${i % 5}` } })) } };
  assert.equal(namesIn(repeats).length, 5, "fifty edges to five skills are five names");
  assert.deepEqual(namesIn({ edges: [{ from: { id: "p/x", name: "X" }, via: "Skills.Skill", to: { id: "skills/java", name: "Java" } }] }),
    [{ id: "skills/java", title: "Java" }], "a list_references page names each edge's far end");
  assert.deepEqual(namesIn({ results: [{ id: "a/b", title: "Ab" }] }), [], "a name of two letters is not linked");
});

// An entity with more edges than its answer holds: the names past the fifty are read from the
// host's list_references, a few pages at most, and reach the widget with the rest.
const capped = (n) => ({
  entity: {
    id: "profiles/x", name: "X", referenceCounts: { references: n, referencedBy: 0 },
    references: Array.from({ length: 50 }, (_, i) => ({ via: "Evidence.Skill", to: { id: `skills/${i % 3}`, name: `Skill ${i % 3}` } })),
  },
});
const pagedHost = (total, calls) => ({
  async call(name, args) {
    calls.push([name, args]);
    const start = args.cursor ? Number(args.cursor) : 0;
    const end = Math.min(total, start + args.limit);
    const edges = Array.from({ length: end - start }, (_, i) => ({ from: { id: "profiles/x", name: "X" }, via: "Skills.Skill", to: { id: `skills/${start + i}`, name: `Skill ${start + i}` } }));
    return { text: "", isError: false, data: { edges, page: { hasMore: end < total, nextCursor: end < total ? String(end) : null } } };
  },
});

test("namesPastTheCap reads the outgoing edges an entity answer left out, a few pages at most", async () => {
  const calls = [];
  const names = await namesPastTheCap(pagedHost(250, calls), capped(250));
  assert.equal(names.length, 250);
  assert.deepEqual(calls.map(([n, a]) => [n, a.entity, a.direction, a.cursor ?? null]), [["list_references", "profiles/x", "out", null], ["list_references", "profiles/x", "out", "200"]]);
  const many = [];
  await namesPastTheCap(pagedHost(5000, many), capped(5000));
  assert.equal(many.length, 3, "an entity with thousands of edges is read three pages deep and no further");
});

test("namesPastTheCap asks nothing of an entity its answer holds whole, a list, or a refusal", async () => {
  const calls = [];
  const h = pagedHost(10, calls);
  assert.deepEqual(await namesPastTheCap(h, capped(50)), []);
  assert.deepEqual(await namesPastTheCap(h, { results: [] }), []);
  assert.deepEqual(await namesPastTheCap(h, { error: { code: "not_found" } }), []);
  assert.equal(calls.length, 0);
  const broken = { async call() { throw new Error("down"); } };
  assert.deepEqual(await namesPastTheCap(broken, capped(250)), [], "a host that fails a page leaves the names plain and the answer standing");
});

test("an answer about a capped entity names what lies past its fifty edges, once each, and never the cite", async () => {
  const calls = [];
  const paged = pagedHost(120, calls);
  const h = { ...host, call: async (name, args) => (name === "get_entity" ? { text: "{}", isError: false, data: capped(120) } : paged.call(name, args)) };
  const model = fakeModel([toolTurn("get_entity", { id: "profiles/x" }), textTurn("Skill 100 and Skill 7.")]);
  const { events, emit } = collect();
  await answer({ host: h, model, meter: meter() }, { messages: [{ role: "user", content: "which skills?" }], lang: "en" }, emit);
  const names = events.filter(([e]) => e === "names").flatMap(([, d]) => d.names);
  assert.equal(names.length, 120, "every skill past the fifty is named, and the three the fifty repeat are not named twice");
  assert.ok(names.some((n) => n.title === "Skill 100"));
  assert.ok(!names.some((n) => n.id === "profiles/x"), "the cited entity is not also a name");
  assert.equal(model.requests[1].messages.at(-1).content[0].content, "{}", "the model is shown the tool's own answer and nothing the extra pages read");
});

// What the route keeps of a question is what the loop saw: the ids it cited, the calls it made
// and how many of them found nothing, the rounds it ran. They come back with the answer, and
// they come back on the error, since a refusal between two rounds is also a question asked.
test("the answer carries its signals: the ids cited, the calls, the empty ones, the rounds", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([
    toolTurn("search", { query: EXAMPLE_ROOT, match: "name" }),
    toolTurn("get_entity", { id: rootId }),
    textTurn("It is the company."),
  ]);
  const { emit } = collect();
  const r = await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, emit);
  assert.deepEqual(r.cited, [rootId]);
  assert.equal(r.calls, 2);
  assert.equal(r.empty, 0);
  assert.equal(r.rounds, 3);
});

test("a search that finds nothing is counted as empty, and an answer that cites nothing has an empty list", async () => {
  const model = fakeModel([
    toolTurn("search", { query: "xqzv wvkq", match: "words" }),
    textTurn("The model does not say."),
  ]);
  const { emit } = collect();
  const r = await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "who is xqzv?" }], lang: "en" }, emit);
  assert.deepEqual(r.cited, []);
  assert.equal(r.calls, 1);
  assert.equal(r.empty, 1);
  assert.equal(r.rounds, 2);
});

test("a refusal thrown before the first call carries four zeros as its signals", async () => {
  const model = fakeModel([textTurn("never reached")]);
  const { emit } = collect();
  const m = new Meter(new MemoryStore(), { monthTokens: 100 });
  await assert.rejects(
    answer({ host, model, meter: m }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit),
    (err) => { assert.equal(err.code, "over_month"); assert.deepEqual(err.signals, { cited: [], calls: 0, empty: 0, rounds: 0 }); return true; },
  );
});

test("foundNothing: a refused call, an error answer and an empty list are nothing; an entity and a list with rows are not", () => {
  assert.equal(foundNothing({ isError: true, data: null }), true);
  assert.equal(foundNothing({ isError: false, data: { error: { code: "not_found" } } }), true);
  assert.equal(foundNothing({ isError: false, data: { results: [] } }), true);
  assert.equal(foundNothing({ isError: false, data: { entities: [], page: { hasMore: false } } }), true);
  assert.equal(foundNothing({ isError: false, data: { results: [{ id: "x", title: "X" }] } }), false);
  assert.equal(foundNothing({ isError: false, data: { entity: { id: "x", title: "X", references: [] } } }), false, "an entity with no references is the entity");
  assert.equal(foundNothing({ isError: false, data: { types: [] } }), false, "a schema answer is neither an entity nor a list of them");
});

test("a diagram answer is the widget's to draw: its event after its names, and only what it drew for the model", async () => {
  const model = fakeModel([toolTurn("diagram", { shape: "process", id: "processes/delivery" }), textTurn("Delivery runs in three phases.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me the delivery process" }], lang: "en" }, emit);
  assert.ok(model.requests[0].system[0].text.includes(DIAGRAM_RULE), "the host draws, so the model is told when to ask");
  assert.deepEqual(events.map(([e]) => e), ["names", "diagram", "text", "done"]);
  const picture = events[1][1];
  assert.deepEqual(Object.keys(picture).sort(), ["mermaid", "nodes", "omitted", "shape", "title"]);
  assert.deepEqual([picture.shape, picture.title, picture.omitted], ["process", "Delivery", 0]);
  assert.match(picture.mermaid, /^flowchart LR\n/);
  assert.deepEqual(picture.nodes.map((n) => n.id), [specifyPhaseId, buildPhaseId, releasePhaseId]);
  const named = events[0][1].names.map((n) => n.id);
  for (const n of picture.nodes) assert.ok(named.includes(n.id), `${n.id} is linked where the answer writes it`);
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.doesNotMatch(result.content, /flowchart|-->/);
  const note = JSON.parse(result.content);
  // Two forward edges and the example's two back flows, each phase's "If not met" row.
  assert.deepEqual([note.shape, note.title, note.edges, note.omitted], ["process", "Delivery", 4, 0]);
  assert.deepEqual(note.nodes, [{ title: "Specify", type: "phase" }, { title: "Build", type: "phase" }, { title: "Release", type: "phase" }]);
  assert.deepEqual(note.relations, [
    { from: "Specify", fromType: "phase", to: "Build", toType: "phase", label: "Reviewer" },
    { from: "Build", fromType: "phase", to: "Release", toType: "phase", label: "Reviewer" },
    { from: "Specify", fromType: "phase", to: "Specify", toType: "phase", label: "Reviewer: reshaped" },
    { from: "Build", fromType: "phase", to: "Build", toType: "phase", label: "Reviewer: reworked" },
  ]);
  assert.match(note.drawn, /under your answer/);
  assert.match(note.drawn, /calling each by its type/);
  assert.match(note.drawn, /state only the relations listed in relations/);
});

test("a refused diagram draws nothing, and the model reads the refusal", async () => {
  const model = fakeModel([toolTurn("diagram", { shape: "process", id: "nothing/here" }), textTurn("The model does not say.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me a process" }], lang: "en" }, emit);
  assert.ok(!events.some(([e]) => e === "diagram"));
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /nothing\/here/);
});

test("two diagrams in one message are two events, in the order they were drawn", async () => {
  const model = fakeModel([
    toolTurn("diagram", { shape: "process", id: "processes/delivery" }),
    toolTurn("diagram", { shape: "neighborhood", id: "concepts/invoice" }),
    textTurn("Here is how the invoice connects."),
  ]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me" }], lang: "en" }, emit);
  assert.deepEqual(events.filter(([e]) => e === "diagram").map(([, d]) => d.shape), ["process", "neighborhood"]);
  const notes = model.requests.at(-1).messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((c) => c.type === "tool_result").map((c) => typeof c.content === "string" ? c.content : JSON.stringify(c.content));
  assert.ok(notes.length >= 2 && notes.every((n) => !/the last one if you drew several/.test(n)), "the model is no longer told only the last picture shows");
  assert.ok(notes.some((n) => /every diagram you draw is shown/.test(n)));
});

test("a phase already cited is not named again when the process is drawn", async () => {
  const model = fakeModel([
    toolTurn("get_entity", { id: "processes/delivery/phases/build" }),
    toolTurn("diagram", { shape: "process", id: "processes/delivery" }),
    textTurn("Build is the second phase."),
  ]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "where is build?" }], lang: "en" }, emit);
  const named = events.filter(([e]) => e === "names").flatMap(([, d]) => d.names.map((n) => n.id));
  assert.ok(events.some(([e, d]) => e === "cite" && d.id === buildPhaseId));
  assert.ok(!named.includes(buildPhaseId));
  assert.ok(named.includes(specifyPhaseId));
});

test("diagramOf takes a whole diagram answer and nothing else", () => {
  const nodes = [{ node: "n0", id: "a", title: "A", type: "phase" }];
  const data = { shape: "process", title: "D", mermaid: "flowchart LR", nodes, edges: 0, omitted: 0, model: {} };
  assert.deepEqual(diagramOf("diagram", { isError: false, data }), { shape: "process", title: "D", mermaid: "flowchart LR", nodes, omitted: 0, links: [] });
  assert.equal(diagramOf("search", { isError: false, data }), null);
  assert.equal(diagramOf("diagram", { isError: true, data: { error: { code: "cannot_draw" } } }), null);
  assert.equal(diagramOf("diagram", { isError: false, data: { shape: "process", mermaid: "flowchart LR" } }), null);
  assert.equal(diagramOf("diagram", { isError: false, data: null }), null);
});

test("diagramOf drops a malformed node rather than throw, and refuses a picture with none left", () => {
  const valid = { node: "n0", id: "a", title: "A", type: "phase" };
  const data = { shape: "process", title: "D", mermaid: "flowchart LR", nodes: [null, valid, { node: "n1", id: "b", title: 5 }], edges: 0, omitted: 0 };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.deepEqual(picture.nodes, [valid]);
  const allInvalid = { ...data, nodes: [null, { node: "n1", id: "b", title: 5 }] };
  assert.equal(diagramOf("diagram", { isError: false, data: allInvalid }), null);
});

test("diagramOf drops a link whose end is a dropped node, and one whose label is not a string", () => {
  const kept = { node: "n0", id: "a", title: "A", type: "phase" };
  const dropped = { node: "n1", id: "b", title: 5 };
  const data = {
    shape: "process", title: "D", mermaid: "flowchart LR", nodes: [kept, dropped], edges: 0, omitted: 0,
    links: [{ from: "n0", to: "n1", label: "to a dropped node" }, { from: "n0", to: "n0", label: 5 }, { from: "n0", to: "n0", label: "kept" }],
  };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.deepEqual(picture.links, [{ from: "n0", to: "n0", label: "kept" }]);
});

test("diagramNote caps relations at 60 and says how many more the picture drew", () => {
  const nodes = [{ node: "n0", id: "a", title: "A", type: "concept" }, { node: "n1", id: "b", title: "B", type: "concept" }];
  const links = Array.from({ length: 65 }, () => ({ from: "n0", to: "n1", label: "x" }));
  const note = JSON.parse(diagramNote({ shape: "neighborhood", title: "A", nodes, edges: 65, omitted: 0, links }));
  assert.equal(note.relations.length, 60);
  assert.equal(note.relationsOmitted, 5);
  assert.deepEqual(note.relations[0], { from: "A", fromType: "concept", to: "B", toType: "concept", label: "x" });
});

test("diagramNote gives an empty relations list where the host answers no links", () => {
  const nodes = [{ node: "n0", id: "a", title: "A", type: "concept" }];
  const note = JSON.parse(diagramNote({ shape: "neighborhood", title: "A", nodes, edges: 0, omitted: 0 }));
  assert.deepEqual(note.relations, []);
  assert.ok(!("relationsOmitted" in note));
});

test("diagramNote says what was drawn, by title and type, and holds no source", () => {
  const note = JSON.parse(diagramNote({ shape: "concepts", title: null, mermaid: "classDiagram", nodes: [{ node: "n0", id: "a", title: "Claim", type: "concept" }], edges: 3, omitted: 1 }));
  assert.deepEqual([note.shape, note.title, note.nodes, note.edges, note.omitted], ["concepts", null, [{ title: "Claim", type: "concept" }], 3, 1]);
  assert.equal("mermaid" in note, false);
  assert.match(note.drawn, /calling each by its type/);
});

test("diagramNote says what a process picture's arrows mean, and only for a process", () => {
  const nodes = [{ node: "n0", id: "p/shape", title: "Shape", type: "phase" }, { node: "n1", id: "p/spec", title: "Spec", type: "phase" }];
  const links = [{ from: "n0", to: "n1", label: "Owner" }, { from: "n1", to: "n1", label: "Owner: reshaped, dropped" }];
  const note = JSON.parse(diagramNote({ shape: "process", title: "Delivery", nodes, edges: 2, omitted: 0, links }));
  assert.match(note.process, /approve/);
  assert.match(note.process, /owns nothing/);
  assert.match(note.process, /Stop/);
  assert.match(note.process, /Gate/);
  for (const shape of ["concepts", "neighborhood"]) {
    assert.equal("process" in JSON.parse(diagramNote({ shape, title: "A", nodes, edges: 2, omitted: 0, links })), false, shape);
  }
});

test("a picture of the schemas keeps what every other type declares and the core for the note, and sends neither to the widget", () => {
  const nodes = [
    { node: "n0", id: "core/phase", title: "phase", type: "schema", url: "https://github.com/o/r/blob/c/meta/core/phase-schema.md" },
    { node: "n1", id: "core/process", title: "process", type: "schema", url: "https://github.com/o/r/blob/c/meta/core/process-schema.md" },
  ];
  const data = {
    shape: "schema", title: null, mermaid: "classDiagram", nodes, edges: 1, omitted: 27,
    links: [{ from: "n0", to: "n1", label: "nested-in" }],
    everyType: [{ via: "source", to: "source", multiplicity: "1" }, { via: 5 }], model: { core: "0.45.0" },
  };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.deepEqual(picture.everyType, [{ via: "source", to: "source", multiplicity: "1" }]);
  assert.equal(picture.core, "0.45.0");
  assert.equal(picture.nodes[0].url, nodes[0].url, "the widget links a type by its url");
  const note = JSON.parse(diagramNote({ ...picture, edges: 1 }));
  // The sentence is given ready-made, as a relation's is: written by the model as "every type of
  // this unit also declares a field to exactly one source", it was true and the check marked it.
  assert.deepEqual(note.everyType, [{ via: "source", to: "source", multiplicity: "1", says: "every type also declares the field source, which names exactly one source" }]);
  assert.match(note.schemas, /core 0\.45\.0/);
  assert.match(note.schemas, /say it once, in a sentence of its own, as its says states it/);
  assert.deepEqual(note.nodes, [{ title: "phase", type: "schema" }, { title: "process", type: "schema" }]);
  assert.deepEqual(note.relations, [{ from: "phase", to: "process", label: "nested-in", says: "every phase is nested in one process, its owner" }]);
  assert.equal("everyType" in diagramOf("diagram", { isError: false, data: { ...data, shape: "concepts" } }), false, "only the schemas carry it");
});

// A reference is drawn from the type that declares it to the type it names, and two types can
// name each other: an aggregate's Emits column names its events and an event's emitted-by names
// its aggregate. Read off from, to and label, the two were folded into one and the field given
// to the wrong type, so each relation of the schemas comes with the sentence that states it.
test("a picture of the schemas says each reference from the type that declares it", () => {
  const nodes = ["aggregate", "domain-event", "concept-design", "bounded-context", "feature-design", "feature"].map((title, i) => ({ node: `n${i}`, id: `software/${title}`, title, type: "schema" }));
  const links = [
    { from: "n0", to: "n1", label: "Handled commands.Emits 0..*" },
    { from: "n1", to: "n0", label: "emitted-by 1" },
    { from: "n4", to: "n3", label: "contexts 1..*" },
    { from: "n4", to: "n5", label: "refines 0..1" },
    { from: "n0", to: "n2", label: "members 2..5" },
    { from: "n2", to: "n3", label: "nested-in" },
    { from: "n0", to: "n2", label: "root" },
    { from: "n3", to: "n0", label: "aggregates 2..*" },
  ];
  const picture = diagramOf("diagram", { isError: false, data: { shape: "schema", title: "software", mermaid: "classDiagram", nodes, edges: 8, omitted: 0, links, everyType: [], model: { core: "0.69.0" } } });
  const note = JSON.parse(diagramNote({ ...picture, edges: 8 }));
  assert.deepEqual(note.relations.map((r) => r.says), [
    "aggregate declares the column Emits of its section Handled commands, which names any number of domain-event",
    "domain-event declares the field emitted-by, which names exactly one aggregate",
    "feature-design declares the field contexts, which names one or more bounded-context",
    "feature-design declares the field refines, which names at most one feature",
    "aggregate declares the field members, which names 2 to 5 concept-design",
    "every concept-design is nested in one bounded-context, its owner",
    undefined,
    "bounded-context declares the field aggregates, which names 2 or more aggregate",
  ]);
  assert.deepEqual(note.relations[1], { from: "domain-event", to: "aggregate", label: "emitted-by 1", says: "domain-event declares the field emitted-by, which names exactly one aggregate" });
  // A label that names no multiplicity keeps the plain form, and says nothing it cannot back.
  assert.deepEqual(note.relations[6], { from: "aggregate", fromType: "schema", to: "concept-design", toType: "schema", label: "root" });
  assert.match(note.schemas, /as its says states it/);
  assert.match(note.schemas, /never turned around/);
  // Only the schemas are said this way: the same label in a neighborhood stays as it is labeled.
  const other = JSON.parse(diagramNote({ shape: "neighborhood", title: "A", nodes: nodes.map((n) => ({ ...n, type: "concept" })), edges: 1, omitted: 0, links: [links[1]] }));
  assert.equal("says" in other.relations[0], false);
});

// An answer about the schemas groups: these types nest in that one, those carry decisions.
// Grouped by the model, a type was put in a group it is not in: a feature-design nested in a
// bounded-context it only names, decisions on a type that declares none. A unit's picture draws
// every nesting and every reference of the unit's own types, so the note groups them itself.
// Each group is closed, which the note's line says once: a sentence carries no closing words,
// since an answer copies it as an item of its list.
test("a picture of one unit of the schemas groups its own types by owner and by a field several declare, each group closed", () => {
  const nodes = [
    ["software", "aggregate"], ["software", "bounded-context"], ["software", "concept-design"], ["software", "domain-event"], ["software", "feature-design"],
    ["core", "decision"], ["core", "feature"], ["core", "concept"],
  ].map(([unit, title], i) => ({ node: `n${i}`, id: `${unit}/${title}`, title, type: "schema" }));
  const links = [
    { from: "n0", to: "n5", label: "decisions 0..*" },
    { from: "n1", to: "n5", label: "decisions 0..*" },
    { from: "n4", to: "n5", label: "decisions 0..*" },
    { from: "n4", to: "n6", label: "refines 0..1" },
    { from: "n2", to: "n7", label: "refines 0..1" },
    { from: "n4", to: "n1", label: "contexts 1..*" },
    { from: "n0", to: "n1", label: "nested-in" },
    { from: "n2", to: "n1", label: "nested-in" },
    { from: "n3", to: "n1", label: "nested-in" },
  ];
  const data = { shape: "schema", title: "software", mermaid: "classDiagram", nodes, edges: 9, omitted: 0, links, everyType: [], model: { core: "0.69.0" }, unit: "software", units: [{ unit: "core", types: 37 }, { unit: "software", types: 5 }] };
  const note = JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data }), edges: 9 }));
  assert.deepEqual(note.owns, [
    "bounded-context owns aggregate, concept-design and domain-event",
    "bounded-context and feature-design are nested in no type",
  ]);
  // refines is declared by two types to two different types, which is no group.
  assert.deepEqual(note.shared, ["aggregate, bounded-context and feature-design each declare the field decisions, which names decision"]);
  assert.match(note.schemas, /group them as owns and shared do/);
  // One type's picture draws that type's references alone, so nothing in it is closed.
  const narrowed = JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data: { ...data, title: "aggregate", unit: undefined } }), edges: 9 }));
  assert.equal("owns" in narrowed, false);
  assert.equal("shared" in narrowed, false);
  assert.doesNotMatch(narrowed.schemas, /owns and shared/);
  // A unit with one top-level type and no shared field says the one and leaves shared empty.
  const small = JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data: { ...data, nodes: nodes.slice(0, 2), links: [links[6]] } }), edges: 1 }));
  assert.deepEqual(small.owns, ["bounded-context owns aggregate", "bounded-context is nested in no type"]);
  assert.deepEqual(small.shared, []);
});

// A row of what every type declares gets its sentence from its field and its multiplicity. One
// whose multiplicity is in no form the note reads has none, and a line asking for a sentence
// that is not there would send the model back to its own words.
test("a row of what every type declares has its sentence where its multiplicity reads, and the line asks for it only then", () => {
  const nodes = [{ node: "n0", id: "core/phase", title: "phase", type: "schema" }, { node: "n1", id: "core/process", title: "process", type: "schema" }];
  /** @param {object[]} everyType */
  const of = (everyType) => JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data: { shape: "schema", title: null, mermaid: "classDiagram", nodes, edges: 1, omitted: 0, links: [{ from: "n0", to: "n1", label: "nested-in" }], everyType, model: { core: "0.69.0" } } }), edges: 1 }));
  const column = of([{ via: "Handled commands.Emits", to: "domain-event", multiplicity: "0..*" }]);
  assert.equal(column.everyType[0].says, "every type also declares the column Emits of its section Handled commands, which names any number of domain-event");
  assert.match(column.schemas, /say it once, in a sentence of its own, as its says states it\./);
  const unread = of([{ via: "source", to: "source", multiplicity: "*" }]);
  assert.deepEqual(unread.everyType, [{ via: "source", to: "source", multiplicity: "*" }]);
  assert.match(unread.schemas, /say it once, in a sentence of its own\./);
  assert.doesNotMatch(unread.schemas, /as its says states it\. This|in a sentence of its own, as its says/);
  // One row without its sentence is enough for the line not to promise one.
  const mixed = of([{ via: "source", to: "source", multiplicity: "1" }, { via: "owner", to: "seat", multiplicity: "*" }]);
  assert.equal(mixed.everyType[0].says, "every type also declares the field source, which names exactly one source");
  assert.equal("says" in mixed.everyType[1], false);
  assert.doesNotMatch(mixed.schemas, /in a sentence of its own, as its says/);
});

// The check reads an answer claim by claim, and a sentence that joins five relations of the
// schemas reads as supported with a wrong one among them. A list item is a claim of its own, so
// the note asks for the relations of the schemas as a list, one to an item, and of no other
// picture.
test("the note for a picture of the schemas asks for a list of at most six items, one relation to an item", () => {
  const nodes = [{ node: "n0", id: "software/aggregate", title: "aggregate", type: "schema" }, { node: "n1", id: "software/bounded-context", title: "bounded-context", type: "schema" }];
  const data = { shape: "schema", title: "software", mermaid: "classDiagram", nodes, edges: 1, omitted: 0, links: [{ from: "n0", to: "n1", label: "nested-in" }], everyType: [], model: { core: "0.69.0" }, unit: "software", units: [{ unit: "core", types: 37 }, { unit: "software", types: 5 }] };
  /** @param {object} d */
  const of = (d) => JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data: d }), edges: 1 }));
  const unit = of(data), type = of({ ...data, title: "aggregate", unit: undefined }), whole = of({ ...data, title: null, unit: undefined });
  for (const note of [unit, type, whole]) {
    assert.match(note.schemas, /a list takes the place of the one or two sentences/);
    assert.match(note.schemas, /a Markdown list of at most six items, never every relation/);
    assert.match(note.schemas, /An item states one relation and no more: /);
    assert.match(note.schemas, /never two joined by and, a comma or a semicolon; a relation that has no says is not listed/);
    assert.match(note.schemas, /keeping who declares and who is named as the sentence has them/);
    assert.doesNotMatch(note.schemas, /two or three sentences/);
  }
  // Only a unit's picture has the groups, so only its line offers their sentences as items.
  assert.match(unit.schemas, /no more: one sentence of owns or shared, or one relation's says,/);
  for (const note of [type, whole]) {
    assert.match(note.schemas, /no more: one relation's says,/);
    assert.doesNotMatch(note.schemas, /owns or shared/);
  }
  // Every other picture keeps its sentences.
  for (const shape of ["concepts", "process", "neighborhood", "context", "aggregate", "organization", "system"]) {
    const other = diagramNote({ shape, title: "A", mermaid: "", nodes: nodes.map((n) => ({ ...n, type: "concept" })), edges: 1, omitted: 0, links: [{ from: "n0", to: "n1", label: "x" }] });
    assert.doesNotMatch(other, /Markdown list/, shape);
  }
});

// A meta-model of more types than one picture holds is drawn a unit at a time, core or one pack,
// and the host says which unit it drew and which there are. The note carries both, so the answer
// says what is shown and what can be shown next, and the widget needs neither.
test("a picture of one unit of the schemas says which unit it is and names the others, in the note alone", () => {
  const nodes = [{ node: "n0", id: "core/phase", title: "phase", type: "schema" }, { node: "n1", id: "core/process", title: "process", type: "schema" }];
  const data = {
    shape: "schema", title: "core", mermaid: "classDiagram", nodes, edges: 1, omitted: 3, links: [{ from: "n0", to: "n1", label: "nested-in" }], everyType: [], model: { core: "0.69.0" },
    unit: "core", units: [{ unit: "core", types: 37 }, { unit: "landscape", types: 5 }, { unit: 7 }, { unit: "software" }],
  };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.equal(picture.unit, "core");
  assert.deepEqual(picture.units, [{ unit: "core", types: 37 }, { unit: "landscape", types: 5 }]);
  const note = JSON.parse(diagramNote({ ...picture, edges: 1 }));
  assert.equal(note.unit, "core");
  assert.deepEqual(note.units, [{ unit: "core", types: 37 }, { unit: "landscape", types: 5 }]);
  assert.match(note.schemas, /draws one unit of the meta-model/);
  assert.match(note.schemas, /shown next/);
  // A picture of the whole, or of one type, names no unit and its note says nothing of one.
  const whole = diagramOf("diagram", { isError: false, data: { ...data, title: null, unit: undefined } });
  assert.equal("unit" in whole, false);
  const wholeNote = JSON.parse(diagramNote({ ...whole, edges: 1 }));
  assert.equal("unit" in wholeNote, false);
  assert.doesNotMatch(wholeNote.schemas, /one unit of the meta-model/);
  assert.equal("units" in diagramOf("diagram", { isError: false, data: { ...data, shape: "concepts" } }), false, "only the schemas carry it");
  // The event the widget gets is the picture and nothing the note alone needs.
  assert.match(fs.readFileSync(new URL("../lib/loop.mjs", import.meta.url), "utf8"), /const \{ links, everyType, core, unit, units, transitions, steps, extensions, actor, \.\.\.event \} = picture; emit\("diagram", event\);/);
});

test("the diagram rule sends core or a pack to the schema shape by unit, where the tool takes one", () => {
  assert.match(DIAGRAM_RULE, /one who names core or a pack[^;]*is shown shape schema with unit where the tool takes one/);
  assert.match(DIAGRAM_RULE, /never with type/);
});

test("a type in a picture of the schemas is no name the answer links", () => {
  const data = { shape: "schema", nodes: [{ node: "n0", id: "core/seat", title: "seat", type: "schema" }, { node: "n1", id: "concepts/claim", title: "Claim", type: "concept" }] };
  assert.deepEqual(namesIn(data), [{ id: "concepts/claim", title: "Claim" }]);
});

test("the diagram rule sends the meta-model to the schema shape, never to the concepts", () => {
  assert.match(DIAGRAM_RULE, /meta-model, the schemas or the types/);
  assert.match(DIAGRAM_RULE, /shape schema/);
  assert.match(DIAGRAM_RULE, /not shape concepts/);
});

test("the check reads the text, every returned entity and the tool answer it came in, and its event comes before done", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([toolTurn("get_entity", { id: rootId }, "Looking. "), textTurn(`${EXAMPLE_ROOT} is the company.`)]);
  const { events, emit } = collect();
  const seen = [];
  const verdict = async (message) => { seen.push(message); return { event: { claims: [], threshold: null }, claims: 2, unsupported: 1 }; };
  const r = await answer({ host, model, meter: meter(), verdict }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, emit);
  const kinds = events.map(([e]) => e);
  assert.deepEqual(kinds.slice(-2), ["verdict", "done"]);
  assert.ok(kinds.lastIndexOf("text") < kinds.indexOf("verdict"));
  assert.equal(seen[0].text, `${EXAMPLE_ROOT} is the company.`, "the round that called a tool sent nothing, so the check reads the answer alone");
  assert.equal(seen[0].returned[0].id, rootId, "the cited entity first, then what its answer named");
  assert.ok(seen[0].evidence.get(rootId).some((t) => t.includes(rootId)), "the evidence is the tool answer the model was given");
  assert.equal(seen[0].lang, "en");
  assert.deepEqual([seen[0].calls, seen[0].empty], [1, 0]);
  assert.equal(seen[0].answers.length, 1, "every tool answer of the message, for a claim naming none");
  assert.deepEqual([r.claims, r.unsupported], [2, 1]);
});

test("with no check there is no verdict event and no counts, and a check that could not run sends nothing", async () => {
  for (const verdict of [null, async () => null]) {
    const { events, emit } = collect();
    const r = await answer({ host, model: fakeModel([textTurn("Hello.")]), meter: meter(), verdict }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit);
    assert.ok(!events.some(([e]) => e === "verdict"));
    assert.equal(events.at(-1)[0], "done");
    assert.ok(!("claims" in r) && !("unsupported" in r));
  }
});

test("every tool answer that carried an entity is kept as its evidence, the search's and the fetch's", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([toolTurn("search", { query: EXAMPLE_ROOT, match: "name" }), toolTurn("get_entity", { id: rootId }), textTurn(`${EXAMPLE_ROOT} is the company.`)]);
  const seen = [];
  await answer({ host, model, meter: meter(), verdict: async (m) => { seen.push(m); return null; } }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, () => {});
  assert.equal(seen[0].evidence.get(rootId).length, 2);
});

test("a diagram's evidence is the note the model was given, not the picture's source", async () => {
  const model = fakeModel([toolTurn("diagram", { shape: "process", id: "processes/delivery" }), textTurn("Delivery runs in three phases.")]);
  const seen = [];
  await answer({ host, model, meter: meter(), verdict: async (m) => { seen.push(m); return null; } }, { messages: [{ role: "user", content: "draw it" }], lang: "en" }, () => {});
  assert.match(seen[0].answers[0], /"drawn":/);
});

test("a visitor who leaves while the check runs gets nothing more, not even done", async () => {
  const ac = new AbortController();
  const { events, emit } = collect();
  const verdict = async (m) => { ac.abort(); assert.equal(m.signal, ac.signal, "the check is handed the request's signal"); return { event: { claims: [], threshold: null }, claims: 0, unsupported: 0 }; };
  const r = await answer({ host, model: fakeModel([textTurn("Hello.")]), meter: meter(), verdict }, { messages: [{ role: "user", content: "hi" }], lang: "en", signal: ac.signal }, emit);
  assert.deepEqual(events.map(([e]) => e), ["text"]);
  assert.ok(!("claims" in r));
});

test("a context picture's relations name upstream and downstream and say it, and a process picture's keep from and to", () => {
  const nodes = ["A", "B", "C"].map((title, i) => ({ node: `n${i}`, id: title, title, type: "bounded-context" }));
  const links = [
    { from: "n0", to: "n1", label: "U → D · conformist" },
    { from: "n0", to: "n2", label: "U → D · customer/supplier" },
    { from: "n1", to: "n2", label: "U → D · open host service" },
    { from: "n1", to: "n0", label: "shared kernel" },
    { from: "n2", to: "n1", label: "partnership" },
    { from: "n0", to: "n2", label: "separate ways" },
    { from: "n0", to: "n1", label: "something else" },
    { from: "n0", to: "n1" },
  ];
  const context = JSON.parse(diagramNote({ shape: "context", nodes, links }));
  assert.deepEqual(context.relations, [
    { upstream: "A", downstream: "B", pattern: "conformist", says: "B conforms to A, its upstream" },
    { upstream: "A", downstream: "C", pattern: "customer/supplier", says: "C is downstream of A, and the two relate as customer/supplier" },
    { upstream: "B", downstream: "C", pattern: "open host service", says: "C is downstream of B, and the two relate as open host service" },
    { between: ["B", "A"], pattern: "shared kernel", says: "B and A share a kernel" },
    { between: ["C", "B"], pattern: "partnership", says: "C and B are partners" },
    { between: ["A", "C"], pattern: "separate ways", says: "A and C go separate ways" },
    { from: "A", fromType: "bounded-context", to: "B", toType: "bounded-context", label: "something else" },
    { from: "A", fromType: "bounded-context", to: "B", toType: "bounded-context" },
  ]);
  assert.match(context.map, /never turn a relation around/);
  assert.match(context.map, /in the answer's language/);
  const process = JSON.parse(diagramNote({ shape: "process", nodes, links }));
  assert.deepEqual(process.relations[0], { from: "A", fromType: "bounded-context", to: "B", toType: "bounded-context", label: "U → D · conformist" });
  assert.equal(process.map, undefined);
});

test("an aggregate picture's relations are sentences, with no cardinality symbol, and only an aggregate carries the key", () => {
  const nodes = ["Run", "Check", "Finding", "Vocabulary", "Pin", "Event", "Note"].map((title, i) => ({ node: `n${i}`, id: title, title, type: "member" }));
  const labels = [["n1", "1..*"], ["n2", "*"], ["n3", "1"], ["n4", "0..1"], ["n6", ""], ["n5", "emits"]];
  const links = [...labels.map(([to, label]) => ({ from: "n0", to, label })), { from: "n1", to: "n2", label: "one" }];
  const note = JSON.parse(diagramNote({ shape: "aggregate", nodes, links }));
  assert.deepEqual(note.relations, [
    { holder: "Run", held: "Check", says: "Run holds one or more Check" },
    { holder: "Run", held: "Finding", says: "Run holds any number of Finding" },
    { holder: "Run", held: "Vocabulary", says: "Run holds exactly one Vocabulary" },
    { holder: "Run", held: "Pin", says: "Run holds at most one Pin" },
    { holder: "Run", held: "Note", says: "Run holds Note" },
    { emitter: "Run", event: "Event", says: "Run emits Event" },
    { from: "Check", fromType: "member", to: "Finding", toType: "member", label: "one" },
  ]);
  assert.match(note.aggregate, /Each relation's says states it as the picture draws it/);
  assert.match(note.aggregate, /never write a cardinality as 1\.\.\* or \* or any other symbol/);
  assert.doesNotMatch(JSON.stringify(note.relations), /1\.\.\*|"\*"/);
  for (const shape of ["context", "process"]) {
    const other = JSON.parse(diagramNote({ shape, nodes, links }));
    assert.equal("aggregate" in other, false, shape);
    assert.equal(other.relations[0].label, "1..*", shape);
  }
});

test("a flow picture's relations say what each aggregate emits on which command, and when where the label has a When", () => {
  const nodes = [["Account", "aggregate"], ["Opened", "domain-event"], ["Approved", "domain-event"], ["Refused", "domain-event"]].map(([title, type], i) => ({ node: `n${i}`, id: title, title, type }));
  const links = [
    { from: "n0", to: "n1", label: "Open" },
    { from: "n0", to: "n2", label: "Review · the check passes" },
    { from: "n0", to: "n3", label: "Review · the check fails" },
  ];
  const note = JSON.parse(diagramNote({ shape: "flow", nodes, links }));
  assert.deepEqual(note.relations, [
    { emitter: "Account", event: "Opened", command: "Open", when: null, says: "Account emits Opened on Open" },
    { emitter: "Account", event: "Approved", command: "Review", when: "the check passes", says: "Account emits Approved on Review when the check passes" },
    { emitter: "Account", event: "Refused", command: "Review", when: "the check fails", says: "Account emits Refused on Review when the check fails" },
  ]);
  assert.match(note.flow, /^Each relation's says states it as the picture draws it\. State each relation as its says states it, in the answer's language, in words\. /);
  assert.match(note.flow, /relations lists only the events a command emits; the picture also draws, as a message from Caller, every command the aggregate handles, including those that emit nothing, so never say the flow draws no relation or shows the aggregate alone\.$/);
  const silent = JSON.parse(diagramNote({ shape: "flow", nodes: nodes.slice(0, 1), links: [] }));
  assert.deepEqual(silent.relations, [], "a flow whose commands emit nothing has no relation");
  assert.match(silent.flow, /never say the flow draws no relation/, "and is still told the picture draws its commands");
  assert.equal("lifecycle" in note, false);
  const aggregate = JSON.parse(diagramNote({ shape: "aggregate", nodes, links }));
  assert.equal("flow" in aggregate, false, "only a flow carries the key");
  assert.equal(aggregate.relations[0].label, "Open", "and only a flow words its labels so");
});

test("a lifecycle picture's relations are its transitions, each said as a start or a move, with its command where it has one", () => {
  const nodes = [{ node: "n0", id: "a1", title: "Account", type: "aggregate" }];
  const transitions = [
    { aggregate: "Account", from: null, to: "Open", command: "Open" },
    { aggregate: "Account", from: "Open", to: "Frozen", command: "Freeze" },
    { aggregate: "Account", from: "Frozen", to: "Closed", command: null },
    { aggregate: "Account", from: null, to: "Draft", command: null },
  ];
  const note = JSON.parse(diagramNote({ shape: "lifecycle", nodes, links: [], transitions, edges: 4 }));
  assert.deepEqual(note.relations, [
    { aggregate: "Account", from: null, to: "Open", command: "Open", says: "Account starts in Open on Open" },
    { aggregate: "Account", from: "Open", to: "Frozen", command: "Freeze", says: "Account moves from Open to Frozen on Freeze" },
    { aggregate: "Account", from: "Frozen", to: "Closed", command: null, says: "Account moves from Frozen to Closed" },
    { aggregate: "Account", from: null, to: "Draft", command: null, says: "Account starts in Draft" },
  ]);
  assert.equal(note.lifecycle, "Each relation's says states it as the picture draws it. State each relation as its says states it, in the answer's language, in words.");
  assert.equal("flow" in note, false);
  const many = Array.from({ length: 65 }, (_, i) => ({ aggregate: "Account", from: `s${i}`, to: `s${i + 1}`, command: null }));
  const capped = JSON.parse(diagramNote({ shape: "lifecycle", nodes, links: [], transitions: many }));
  assert.equal(capped.relations.length, 60);
  assert.equal(capped.relationsOmitted, 5);
});

test("diagramOf keeps a lifecycle's transitions for the note, drops a malformed one, and the diagram event carries none", async () => {
  const nodes = [{ node: "n0", id: "a1", title: "Account", type: "aggregate" }];
  const transitions = [{ aggregate: "Account", from: null, to: "Open", command: "Open" }, { aggregate: "Account", to: 3 }, null, { aggregate: "Account", from: "Open", to: "Closed", command: 7 }];
  const data = { shape: "lifecycle", title: "Account", mermaid: "stateDiagram-v2", nodes, links: [], transitions, edges: 1, omitted: 0 };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.deepEqual(picture?.transitions, [{ aggregate: "Account", from: null, to: "Open", command: "Open" }]);
  assert.equal("transitions" in /** @type {object} */ (diagramOf("diagram", { isError: false, data: { ...data, shape: "flow" } })), false, "only a lifecycle carries them");
  const drawing = { ...host, call: async (name, args) => (name === "diagram" ? { text: JSON.stringify(data), isError: false, data } : host.call(name, args)) };
  const model = fakeModel([toolTurn("diagram", { shape: "lifecycle", id: "a1" }), textTurn("Account starts in Open.")]);
  const { events, emit } = collect();
  await answer({ host: drawing, model, meter: meter() }, { messages: [{ role: "user", content: "show the lifecycle" }], lang: "en" }, emit);
  const drawn = events.filter(([e]) => e === "diagram").map(([, d]) => d);
  assert.equal(drawn.length, 1);
  assert.equal("transitions" in drawn[0], false, "the event strips transitions as it strips links");
  assert.equal("links" in drawn[0], false);
  const given = JSON.parse(model.requests[1].messages.at(-1).content[0].content);
  assert.equal(given.relations[0].says, "Account starts in Open on Open", "and the note reads them");
});

// A list call the model made without a page size is sent with one that arrives whole, and one
// that asked for more than that is held to it; the page in the answer says how to go on.
test("a list call gets a page that fits the cut, and other calls are sent as the model made them", async () => {
  const sent = [];
  const spy = { ...host, tools: host.tools, call: async (name, input) => { sent.push([name, input]); return host.call(name, input); } };
  const model = fakeModel([toolTurn("list_entities", { type: "skill" }), toolTurn("list_entities", { type: "skill", limit: 200 }), toolTurn("list_types", {}), textTurn("Done.")]);
  await answer({ host: spy, model, meter: meter() }, { messages: [{ role: "user", content: "skills?" }], lang: "en" }, collect().emit);
  assert.deepEqual(sent.map(([, i]) => i.limit), [LIST_PAGE, LIST_PAGE, undefined]);
  assert.ok(LIST_PAGE * 640 <= MAX_TOOL_RESULT_CHARS, "a page of entries of 640 characters, a sixth over the largest measured, fits the cut");
});

test("the prompt names today's date, and the rules for now only for a host whose list takes on", async () => {
  const run = async (tools) => {
    const model = fakeModel([textTurn("ok")]);
    await answer({ host: { ...host, tools }, model, meter: meter(), today: () => "2026-10-05" }, { messages: [{ role: "user", content: "now?" }], lang: "en" }, collect().emit);
    return model.requests[0].system[0].text;
  };
  const withOn = host.tools.map((t) => t.name === "list_entities" ? { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, on: { type: "string" }, by: { type: "string" }, where: { type: "object" } } } } : t);
  const without = host.tools.map((t) => t.name === "list_entities" ? { ...t, input_schema: { ...t.input_schema, properties: Object.fromEntries(Object.entries(t.input_schema.properties).filter(([k]) => !["on", "by", "where"].includes(k))) } } : t);
  const a = await run(withOn), b = await run(without);
  assert.match(a, /Today is 2026-10-05\./); assert.match(b, /Today is 2026-10-05\./);
  assert.ok(a.includes(FACTS_RULE)); assert.ok(!b.includes(FACTS_RULE));
});

// Text written in a round that goes on to call a tool is the model talking about what it will
// do, not the answer: "so let me get every experience" opened one answer of five at v0.29.1
// although the prompt forbids a preface. The loop sends a round's text only where the round
// calls nothing, and the answer the check reads is what was sent.
test("a round that calls a tool sends none of its text, and the answer is the text of the round that called nothing", async () => {
  const seen = [];
  const model = fakeModel([toolTurn("list_types", {}, "So let me list the types first."), textTurn("There are skills.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter(), verdict: async (m) => { seen.push(m.text); return null; } }, { messages: [{ role: "user", content: "types?" }], lang: "en" }, emit);
  assert.deepEqual(events.filter(([e]) => e === "text").map(([, d]) => d.text), ["There are skills."]);
  assert.deepEqual(seen, ["There are skills."], "the check reads what the visitor reads");
  const forced = fakeModel([...Array.from({ length: MAX_ROUNDS }, () => toolTurn("list_types", {})), toolTurn("list_types", {}, "What I have is this.")]);
  const last = collect();
  await answer({ host, model: forced, meter: meter() }, { messages: [{ role: "user", content: "loop" }], lang: "en" }, last.emit);
  assert.deepEqual(last.events.filter(([e]) => e === "text").map(([, d]) => d.text), ["What I have is this."], "the last request's text is the answer whatever it asked for");
});

test("diagramNote says each line of a system's two pictures in words, the way the line is drawn", () => {
  const nodes = [
    { node: "n0", id: "s/chat", title: "Chat server", type: "system" }, { node: "n1", id: "s/run", title: "Cloud Run", type: "system" },
    { node: "n2", id: "s/mcp", title: "MCP server", type: "system" }, { node: "n3", id: "sv/answer", title: "Chat answer", type: "service" },
    { node: "n4", id: "d/log", title: "Question log", type: "data-object" }, { node: "n5", id: "s/logging", title: "Cloud Logging", type: "system" },
    { node: "n6", id: "c/conv", title: "Conversation", type: "concept" },
  ];
  const links = [
    { from: "n0", to: "n1", label: "part-of" }, { from: "n2", to: "n0", label: "Streamable HTTP · Entity · HTTPS" }, { from: "n2", to: "n0", label: "" },
    { from: "n0", to: "n3", label: "provided-by" }, { from: "n0", to: "n4", label: "writes" }, { from: "n5", to: "n4", label: "master" }, { from: "n0", to: "n6", label: "reads" },
  ];
  const note = JSON.parse(diagramNote({ shape: "system", title: "Chat server", nodes, edges: 7, omitted: 0, links }));
  assert.deepEqual(note.relations.map((r) => r.says), [
    "Chat server runs on Cloud Run",
    "Chat server takes data from MCP server over Streamable HTTP · Entity · HTTPS",
    "Chat server takes data from MCP server",
    "Chat server provides the service Chat answer",
    "Chat server writes a copy of Question log",
    "Cloud Logging holds the master copy of Question log",
    "Chat server reads Conversation",
  ]);
  const held = JSON.parse(diagramNote({ shape: "holds", title: "Chat server", nodes, edges: 3, omitted: 0, links: links.slice(4) }));
  assert.deepEqual(held.relations.map((r) => r.says), ["Chat server writes a copy of Question log", "Cloud Logging holds the master copy of Question log", "Chat server reads Conversation"]);
  assert.match(note.system, /says states a line of the landscape/);
  assert.equal("system" in JSON.parse(diagramNote({ shape: "concepts", title: "A", nodes, edges: 1, omitted: 0, links: links.slice(0, 1) })), false);
});

test("diagramNote says each line of an organization in words, names an opening as one, and points the answer at the groups' pages", () => {
  const nodes = [
    { node: "g0", id: "g/m", title: "Management", type: "group" }, { node: "n0", id: "p/ines", title: "Ines Marchetti", type: "profile" },
    { node: "n1", id: "p/jonas", title: "Jonas Whitcombe", type: "profile" },
    { node: "g1", id: "g/legal", title: "Legal", type: "group" }, { node: "n2", id: "j/counsel", title: "Legal Counsel", type: "job" },
    { node: "g2", id: "g/eng", title: "Engineering", type: "group" }, { node: "n3", id: "p/mira", title: "Mira Halvorsen", type: "profile" },
    { node: "g3", id: "g/ops", title: "Operations", type: "group" },
  ];
  const links = [
    { from: "n0", to: "n1", label: "Staff" }, { from: "n0", to: "n2", label: "staff" },
    { from: "n0", to: "n3", label: "part-of" }, { from: "n0", to: "g3", label: "part-of" },
  ];
  const note = JSON.parse(diagramNote({ shape: "organization", title: null, nodes, edges: 4, omitted: 1, links }));
  assert.deepEqual(note.relations.map((r) => r.says), [
    "Jonas Whitcombe serves Ines Marchetti as staff",
    "the open Legal Counsel position serves Ines Marchetti from beside, as a staff unit",
    "Mira Halvorsen answers to Ines Marchetti",
    "the unit Operations answers to Ines Marchetti",
  ]);
  assert.match(note.organization, /get_entity/);
  assert.match(note.organization, /type job is an open position/);
  assert.match(note.organization, /omitted counts the groups outside the disciplinary line/);
  assert.match(note.organization, /never relations/);
  assert.equal("organization" in JSON.parse(diagramNote({ shape: "concepts", title: "A", nodes, edges: 4, omitted: 0, links })), false);
});

// A use case's lines carry the model's word for each, and a requirement's arrow is drawn into the
// use case it applies to, so each is said from the side the word names and never turned around.
test("diagramNote words a use case's lines and a requirement's from the side the word names", () => {
  const nodes = [
    { node: "n0", id: "a", title: "Download an invoice", type: "use-case" }, { node: "n1", id: "b", title: "Find an invoice", type: "use-case" },
    { node: "n2", id: "c", title: "Invoice download", type: "feature" }, { node: "n3", id: "d", title: "A copy is the invoice as issued", type: "requirement" },
    { node: "n4", id: "e", title: "Billing Clerk", type: "seat" }, { node: "n5", id: "f", title: "A copy is kept", type: "rule" },
  ];
  const links = [{ from: "n0", to: "n1", label: "includes" }, { from: "n4", to: "n0", label: "" }, { from: "n0", to: "n2", label: "features" }, { from: "n3", to: "n0", label: "Applies to" }, { from: "n3", to: "n5", label: "follows" }];
  const note = JSON.parse(diagramNote({ shape: "usecase", title: "Download an invoice", nodes, edges: 5, omitted: 0, links }));
  assert.deepEqual(note.relations.map((r) => r.says), [
    "Download an invoice includes Find an invoice",
    "Billing Clerk is the primary actor of Download an invoice",
    "Download an invoice asks something of the feature Invoice download",
    "A copy is the invoice as issued applies to Download an invoice",
    "A copy is the invoice as issued follows the rule A copy is kept",
  ]);
  assert.match(note.usecase, /never turned around/);
  const held = JSON.parse(diagramNote({ shape: "requirements", title: "Invoice download", nodes, edges: 2, omitted: 0, links: [{ from: "n3", to: "n2", label: "Applies to" }, { from: "n3", to: "n5", label: "follows" }] }));
  assert.deepEqual(held.relations.map((r) => r.says), ["A copy is the invoice as issued applies to Invoice download", "A copy is the invoice as issued follows the rule A copy is kept"]);
  assert.match(held.usecase, /never turned around/);
  for (const shape of ["neighborhood", "system"]) assert.equal("usecase" in JSON.parse(diagramNote({ shape, title: "A", nodes, edges: 1, omitted: 0, links: links.slice(0, 1) })), false, shape);
});

// A scenario's boxes are steps and extensions, no entity, so its relations are its steps in order
// and its extensions after them, each with the sentence that states it, as a lifecycle's are its transitions.
test("diagramOf keeps a scenario's steps and extensions, and diagramNote states each in order", () => {
  const data = {
    shape: "scenario", title: "Download an invoice", mermaid: "flowchart TB", nodes: [{ node: "s1", id: "e", title: "Billing Clerk", type: "seat" }], edges: 5, omitted: 1,
    links: [{ from: "t0", to: "s0", label: "1" }, { from: "s0", to: "s1", label: "2" }],
    steps: [{ step: "1", actor: "Payer", action: "Finds the invoice" }, { step: "2", actor: "Billing Clerk", action: "Asks for a copy" }, { step: 3 }],
    extensions: [{ step: "1a", condition: "The period is still open", handling: "The page says when it closes" }, { step: "9a" }],
  };
  const picture = diagramOf("diagram", { isError: false, data });
  assert.deepEqual(picture.steps, data.steps.slice(0, 2));
  assert.deepEqual(picture.extensions, data.extensions.slice(0, 1));
  assert.deepEqual(picture.links, [], "a step is no node, so no link joins two");
  const note = JSON.parse(diagramNote(picture));
  assert.deepEqual(note.relations, [
    { step: "1", actor: "Payer", action: "Finds the invoice", says: "Step 1: Payer, Finds the invoice" },
    { step: "2", actor: "Billing Clerk", action: "Asks for a copy", says: "Step 2: Billing Clerk, Asks for a copy" },
    { step: "1a", condition: "The period is still open", handling: "The page says when it closes", says: "Extension 1a departs from step 1. Condition: The period is still open. Then: The page says when it closes" },
  ]);
  assert.match(note.scenario, /in order/);
  assert.equal("steps" in diagramOf("diagram", { isError: false, data: { ...data, shape: "usecase" } }), false, "only a scenario carries them");
});

// The example's two answers as the server gives them: the Payer is no seat, so the use case's
// nodes hold no actor and the scenario's nodes hold nothing at all.
const USECASE = {"shape": "usecase", "title": "Download an invoice", "mermaid": "flowchart LR\n  a0[\"fak:fa-actor <b>Payer</b>\"]\n  subgraph scope [\"system\"]\n    n0([\"<b>Download an invoice</b><br/><small>«user goal»</small>\"]):::middle\n    n1([\"Find an invoice<br/><small>«subfunction»</small>\"])\n    n0 -.->|\"includes\"| n1\n  end\n  a0 --> n0\n  n2[\"Invoice download<br/><small>«feature»</small>\"]\n  n0 -->|\"features\"| n2\n  n3{{\"<b>A copy is the invoice as issued</b><br/><small>«functional · must»</small>\"}}:::must\n  n3 -.-> n0\n  classDef middle stroke-width:2px\n  classDef must stroke-width:2px", "nodes": [{"node": "n0", "id": "01a12b01-39b2-7ea6-994a-d246d4ab6825", "title": "Download an invoice", "type": "use-case"}, {"node": "n1", "id": "01a12b01-39eb-7a27-a513-10b8e399cbc1", "title": "Find an invoice", "type": "use-case"}, {"node": "n2", "id": "01a0c25c-19f8-77ee-8656-f16c523bdc15", "title": "Invoice download", "type": "feature"}, {"node": "n3", "id": "01a12b01-3a22-74e6-b405-dd48a35f2da8", "title": "A copy is the invoice as issued", "type": "requirement"}], "links": [{"from": "n0", "to": "n1", "label": "includes"}, {"from": "a0", "to": "n0", "label": ""}, {"from": "n0", "to": "n2", "label": "features"}, {"from": "n3", "to": "n0", "label": "Applies to"}], "edges": 4, "omitted": 0, "actor": "Payer"};
const SCENARIO = {"shape": "scenario", "title": "Download an invoice", "mermaid": "flowchart TB\n  t0([\"The payer's bookkeeping asks for the invoice of a closed billing period.\"])\n  s0[\"fak:fa-actor <b>Payer</b><br/><small>1</small> Finds the invoice on the Invoice Page, as Find an invoice says\"]\n  t0 --> s0\n  s1[\"fak:fa-actor <b>Payer</b><br/><small>2</small> Asks for a copy\"]\n  s0 --> s1\n  s2[\"fak:fa-actor <b>System</b><br/><small>3</small> Hands over the invoice as it was issued, every line and its explanation\"]\n  s1 --> s2\n  x0[\"<small>1a</small> The billing period is still open, so no invoice is issued yet<br/><i>The page says when the period closes, and the payer comes back then, so the use case ends without a copy</i>\"]:::ext\n  s0 -.-> x0\n  x1[\"<small>3a</small> A credit note has been issued against the invoice since<br/><i>The copy is still the invoice as issued, and the page names the credit note beside it</i>\"]:::ext\n  s2 -.-> x1\n  classDef ext stroke-dasharray:5 4", "nodes": [], "links": [{"from": "t0", "to": "s0", "label": "1"}, {"from": "s0", "to": "s1", "label": "2"}, {"from": "s1", "to": "s2", "label": "3"}, {"from": "s0", "to": "x0", "label": "1a"}, {"from": "s2", "to": "x1", "label": "3a"}], "edges": 5, "omitted": 0, "steps": [{"step": "1", "actor": "Payer", "action": "Finds the invoice on the Invoice Page, as Find an invoice says"}, {"step": "2", "actor": "Payer", "action": "Asks for a copy"}, {"step": "3", "actor": "System", "action": "Hands over the invoice as it was issued, every line and its explanation"}], "extensions": [{"step": "1a", "condition": "The billing period is still open, so no invoice is issued yet", "handling": "The page says when the period closes, and the payer comes back then, so the use case ends without a copy"}, {"step": "3a", "condition": "A credit note has been issued against the invoice since", "handling": "The copy is still the invoice as issued, and the page names the credit note beside it"}]};

test("a scenario whose actors are no seat reaches the widget and the note, and the event carries no steps", async () => {
  const picture = diagramOf("diagram", { isError: false, data: SCENARIO });
  assert.ok(picture, "a scenario with no node is still a picture");
  assert.deepEqual([picture.nodes, picture.steps.length, picture.extensions.length], [[], 3, 2]);
  const drawing = { ...host, call: async (name, args) => (name === "diagram" ? { text: JSON.stringify(SCENARIO), isError: false, data: SCENARIO } : host.call(name, args)) };
  const model = fakeModel([toolTurn("diagram", { shape: "scenario", id: SCENARIO.nodes[0]?.id ?? "x" }), textTurn("The payer finds the invoice.")]);
  const { events, emit } = collect();
  await answer({ host: drawing, model, meter: meter() }, { messages: [{ role: "user", content: "how does downloading an invoice run?" }], lang: "en" }, emit);
  const drawn = events.filter(([e]) => e === "diagram").map(([, d]) => d);
  assert.equal(drawn.length, 1);
  for (const k of ["steps", "extensions", "links", "actor"]) assert.equal(k in drawn[0], false, `the event strips ${k}`);
  const given = JSON.parse(model.requests[1].messages.at(-1).content[0].content);
  assert.equal(given.relations[0].says, "Step 1: Payer, Finds the invoice on the Invoice Page, as Find an invoice says");
  assert.equal(given.relations.at(-1).says, "Extension 3a departs from step 3. Condition: A credit note has been issued against the invoice since. Then: The copy is still the invoice as issued, and the page names the credit note beside it");
  assert.equal(given.relations.length, 5);
});

test("a use case's actor that is no seat is still stated, from the answer's own field", () => {
  const picture = diagramOf("diagram", { isError: false, data: USECASE });
  assert.equal(picture.actor, "Payer");
  const note = JSON.parse(diagramNote(picture));
  assert.deepEqual(note.relations.map((r) => r.says), [
    "Payer is the primary actor of Download an invoice",
    "Download an invoice includes Find an invoice",
    "Download an invoice asks something of the feature Invoice download",
    "A copy is the invoice as issued applies to Download an invoice",
  ]);
  // A seat actor is stated by its link, once.
  const seat = { ...USECASE, actor: "Billing Clerk", nodes: [...USECASE.nodes, { node: "n4", id: "s1", title: "Billing Clerk", type: "seat" }], links: USECASE.links.map((l) => (l.from === "a0" ? { ...l, from: "n4" } : l)) };
  const said = JSON.parse(diagramNote(diagramOf("diagram", { isError: false, data: seat }))).relations.map((r) => r.says);
  assert.equal(said.filter((s) => s.includes("primary actor")).length, 1);
  assert.equal("actor" in diagramOf("diagram", { isError: false, data: SCENARIO }), false, "only a use case carries it");
});

test("an extension the picture left out is not stated as departing from a step", () => {
  const data = { ...SCENARIO, extensions: [...SCENARIO.extensions, { step: "9a", condition: "Nothing", handling: "Nothing happens" }], omitted: 1 };
  const note = JSON.parse(diagramNote(diagramOf("diagram", { isError: false, data })));
  assert.equal(note.relations.length, 5);
  assert.ok(!JSON.stringify(note.relations).includes("9a"));
});

// The choice a request carries reaches the model, is named in `done`, and is paid for twice by a
// signed-in reader: on the site's month and on their own, never on the day's share, which is the
// visitors'.
const OPUS_HIGH = { model: "claude-opus-5-5", effort: "high" };
const readerMeter = (monthTokens = 5_000_000) => new ReaderMeter(new MemoryStore(), { monthTokens });
const ask = [{ role: "user", content: "what is it?" }];

test("choiceReachesRequest", async () => {
  const model = fakeModel([textTurn("ok")]);
  await answer({ host, model, meter: meter() }, { messages: ask, lang: "en", choice: OPUS_HIGH, reader: readerMeter() }, collect().emit);
  assert.equal(model.requests[0].model, "claude-opus-5-5");
  assert.equal(model.requests[0].max_tokens, 16000);
  assert.deepEqual(model.requests[0].output_config, { effort: "high" });
  assert.equal(model.options[0].timeoutMs, 840_000, "a call above low may run past the minute");
  const visitor = fakeModel([textTurn("ok")]);
  await answer({ host, model: visitor, meter: meter() }, { messages: ask, lang: "en" }, collect().emit);
  assert.equal(visitor.requests[0].model, "claude-sonnet-5");
  assert.equal(visitor.requests[0].max_tokens, 2400);
  assert.equal(visitor.options[0].timeoutMs, 60_000);
});

test("doneNamesBy", async () => {
  const { events, emit } = collect();
  await answer({ host, model: fakeModel([textTurn("ok")]), meter: meter() }, { messages: ask, lang: "en", choice: OPUS_HIGH, reader: readerMeter() }, emit);
  const done = events.find(([e]) => e === "done")[1];
  assert.deepEqual(done.by, OPUS_HIGH);
  assert.equal(done.model.repo, "companygraph/meta-model", "`model` stays the knowledge model's provenance");
  const visitor = collect();
  await answer({ host, model: fakeModel([textTurn("ok")]), meter: meter() }, { messages: ask, lang: "en" }, visitor.emit);
  assert.deepEqual(visitor.events.find(([e]) => e === "done")[1].by, { model: "claude-sonnet-5", effort: "low" });
});

test("refusalDeclines", async () => {
  const m = meter();
  const { events, emit } = collect();
  await assert.rejects(
    answer({ host, model: fakeModel([{ content: [{ type: "text", text: "I won't" }], stop_reason: "refusal", usage }]), meter: m }, { messages: ask, lang: "en", choice: OPUS_HIGH, reader: readerMeter() }, emit),
    (err) => err.code === "declined" && err.status === 422 && err.message === "the model declined to answer this question",
  );
  assert.deepEqual(events, [], "nothing of a declined round is sent");
  assert.equal((await m.state()).monthTokens, 1000 * 2 + 100 * 10, "the declined call is paid for at its price");
});

test("readerCountsTwice", async () => {
  const m = meter(), r = readerMeter();
  const { events, emit } = collect();
  await answer({ host, model: fakeModel([textTurn("ok")]), meter: m }, { messages: ask, lang: "en", choice: OPUS_HIGH, reader: r }, emit);
  const cost = 1000 * 2 + 100 * 10;
  const site = await m.state();
  assert.equal(site.monthTokens, cost);
  assert.equal(site.dayTokens, 0, "a reader never spends the day's share");
  assert.equal((await r.settle(0, 0)).monthTokens, cost);
  assert.equal(events.find(([e]) => e === "done")[1].spent, cost);
  assert.equal(events.find(([e]) => e === "done")[1].dayLeft, m.dayShare, "dayLeft stays the site's day");
});

test("readerRefusalGivesBackSite", async () => {
  const m = meter(), r = readerMeter(estimateFor(OPUS_HIGH) - 1);
  const model = fakeModel([textTurn("ok")]);
  await assert.rejects(
    answer({ host, model, meter: m }, { messages: ask, lang: "en", choice: OPUS_HIGH, reader: r }, collect().emit),
    (err) => err.code === "over_user_month",
  );
  assert.equal(model.requests.length, 0, "the model is never asked");
  const site = await m.state();
  assert.equal(site.monthTokens, 0, "the site's reservation is given back");
  assert.equal(site.dayTokens, 0);
  assert.equal((await r.settle(0, 0)).monthTokens, 0);
});
