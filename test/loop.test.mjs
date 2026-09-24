import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { answer, namesIn, namesPastTheCap, NAME_CAP } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore, ESTIMATE } from "../lib/meter.mjs";
import { MAX_ROUNDS, MAX_TOOL_RESULT_CHARS } from "../lib/shape.mjs";
import { FINAL_NOTE } from "../lib/model.mjs";
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
  assert.equal(model.requests.at(-1).messages.at(-1).content.at(-2).type, "tool_result");
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
  assert.equal(model.requests[1].messages.at(-1).content.at(-1).type, "tool_result");
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
