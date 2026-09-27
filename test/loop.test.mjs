import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { answer, namesIn, namesPastTheCap, NAME_CAP, foundNothing, diagramOf, diagramNote } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore, ESTIMATE } from "../lib/meter.mjs";
import { MAX_ROUNDS, MAX_TOOL_RESULT_CHARS } from "../lib/shape.mjs";
import { FINAL_NOTE } from "../lib/model.mjs";
import { NAME_NOTE, DIAGRAM_RULE } from "../lib/prompt.mjs";
import { startFixtureHost, EXAMPLE_ROOT } from "./helpers.mjs";

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

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
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-2).text, NAME_NOTE, "after the naming note");
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
  assert.deepEqual(model.requests.at(-1).tool_choice, { type: "none" }, "which is the last request");
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-1).text, FINAL_NOTE, "with the note");
  assert.equal(model.requests.at(-1).messages.length, 3, "and the silent message is not in the conversation");
  assert.deepEqual(events.filter(([e]) => e === "text").map(([, d]) => d.text), ["Now it says."]);
  assert.equal(events.at(-1)[0], "done");
  const twice = fakeModel([silent, silent, textTurn("never")]);
  const again = collect();
  await answer({ host, model: twice, meter: meter() }, { messages: [{ role: "user", content: "q" }], lang: "en" }, again.emit);
  assert.equal(twice.requests.length, 2, "a second silence is not asked again");
  assert.deepEqual(twice.requests[1].messages[0].content.map((b) => b.text), ["q", FINAL_NOTE], "the note follows the question when no tool was called");
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
  assert.match(result, /truncated at 16000 characters/);
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
  assert.equal(model.requests[1].messages.at(-1).content.at(-1).text, NAME_NOTE);
  assert.equal(model.requests[1].messages.at(-1).content.at(-2).type, "tool_result");
});

test("the naming note follows every round's tool answers and never the visitor's own message", async () => {
  const model = fakeModel([toolTurn("list_types", {}), toolTurn("list_types", {}), textTurn("ok")]);
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "Welche Entscheide gibt es?" }], lang: "de" }, collect().emit);
  assert.equal(model.requests.length, 3);
  assert.ok(!JSON.stringify(model.requests[0].messages).includes(NAME_NOTE), "the first request is the visitor's message alone");
  for (const r of model.requests.slice(1)) {
    const last = r.messages.at(-1).content;
    assert.equal(last.at(-1).text, NAME_NOTE, "the note is the newest block");
    assert.ok(last.slice(0, -1).every((b) => b.type === "tool_result"), "after the tool answers it follows");
  }
  assert.equal(model.requests[2].messages.filter((m) => JSON.stringify(m).includes(NAME_NOTE)).length, 2, "each round's answers keep their note, so the prefix the cache holds does not move");
  assert.match(NAME_NOTE, /In an English answer, name every entity by its title alone/);
  assert.match(NAME_NOTE, /verweist auf die \*\*Kundenliste\*\* \(The customer list\)/, "in a sentence the article stands outside the bold");
  assert.doesNotMatch(NAME_NOTE, /\*\*(Der|Die|Das) /, "no example glues a nominative article into a name");
  assert.match(NAME_NOTE, /in the case and gender the sentence needs/);
  assert.match(NAME_NOTE, /rendered into that language wherever it has a word for it; only a name the language keeps unchanged, such as \*\*MLOps\*\*, stands once and alone/);
  assert.match(NAME_NOTE, /never ß/);
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
  assert.deepEqual(events.map(([e]) => e), ["text"]);
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
  assert.deepEqual(picture.nodes.map((n) => n.id), ["processes/delivery/phases/specify", "processes/delivery/phases/build", "processes/delivery/phases/release"]);
  const named = events[0][1].names.map((n) => n.id);
  for (const n of picture.nodes) assert.ok(named.includes(n.id), `${n.id} is linked where the answer writes it`);
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.doesNotMatch(result.content, /flowchart|-->/);
  const note = JSON.parse(result.content);
  assert.deepEqual([note.shape, note.title, note.edges, note.omitted], ["process", "Delivery", 2, 0]);
  assert.deepEqual(note.nodes, [{ title: "Specify", type: "phase" }, { title: "Build", type: "phase" }, { title: "Release", type: "phase" }]);
  assert.deepEqual(note.relations, [
    { from: "Specify", fromType: "phase", to: "Build", toType: "phase", label: "Reviewer" },
    { from: "Build", fromType: "phase", to: "Release", toType: "phase", label: "Reviewer" },
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
  assert.ok(events.some(([e, d]) => e === "cite" && d.id === "processes/delivery/phases/build"));
  assert.ok(!named.includes("processes/delivery/phases/build"));
  assert.ok(named.includes("processes/delivery/phases/specify"));
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
  assert.deepEqual(note.everyType, [{ via: "source", to: "source", multiplicity: "1" }]);
  assert.match(note.schemas, /core 0\.45\.0/);
  assert.match(note.schemas, /say it once/);
  assert.deepEqual(note.nodes, [{ title: "phase", type: "schema" }, { title: "process", type: "schema" }]);
  assert.deepEqual(note.relations, [{ from: "phase", fromType: "schema", to: "process", toType: "schema", label: "nested-in" }]);
  assert.equal("everyType" in diagramOf("diagram", { isError: false, data: { ...data, shape: "concepts" } }), false, "only the schemas carry it");
});

test("a type in a picture of the schemas is no name the answer links", () => {
  const data = { shape: "schema", nodes: [{ node: "n0", id: "core/role", title: "role", type: "schema" }, { node: "n1", id: "concepts/claim", title: "Claim", type: "concept" }] };
  assert.deepEqual(namesIn(data), [{ id: "concepts/claim", title: "Claim" }]);
});

test("the diagram rule sends the meta-model to the schema shape, never to the concepts", () => {
  assert.match(DIAGRAM_RULE, /meta-model, the schemas or the types/);
  assert.match(DIAGRAM_RULE, /shape schema/);
  assert.match(DIAGRAM_RULE, /not shape concepts/);
});
