import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { answer } from "../lib/loop.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { MAX_ROUNDS, MAX_TOOL_RESULT_CHARS } from "../lib/shape.mjs";
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
  assert.equal(model.requests[0].system[0].text.includes("Answer in English"), true);
  assert.equal(model.requests[0].tools.length, host.tools.length);
  assert.equal(model.requests[1].messages.at(-1).role, "user");
  assert.equal(model.requests[1].messages.at(-1).content[0].type, "tool_result");
  const kinds = events.map(([e]) => e);
  assert.deepEqual(kinds, ["cite", "text", "done"]);
  const cite = events[0][1];
  assert.equal(cite.id, rootId); assert.equal(cite.title, EXAMPLE_ROOT); assert.equal(typeof cite.url, "string");
  assert.deepEqual(events[1][1], { text: "It is the company." });
  const done = events[2][1];
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
  assert.equal(model.requests.at(-2).tool_choice, undefined);
  assert.equal(events.at(-1)[0], "done");
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
