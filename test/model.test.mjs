import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, EFFORT, WEIGHTS, params, vertexModel, anthropicModel, modelFor, asChatError } from "../lib/model.mjs";
import { MAX_OUTPUT_TOKENS } from "../lib/shape.mjs";

const tools = [{ name: "search", description: "d", input_schema: { type: "object" } }, { name: "fetch", description: "d", input_schema: { type: "object" } }];

test("a request names the model, the effort, the output limit, and marks the prefix for caching", () => {
  const r = params({ system: "S", tools, messages: [{ role: "user", content: "q" }] });
  assert.equal(r.model, MODEL);
  assert.equal(MODEL, "claude-sonnet-5");
  assert.equal(r.max_tokens, MAX_OUTPUT_TOKENS);
  assert.deepEqual(r.output_config, { effort: EFFORT });
  assert.deepEqual(r.system, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.equal(r.tools[1].cache_control, undefined, "the system mark already covers the tools before it");
  assert.equal(r.tools[0].cache_control, undefined);
  assert.deepEqual(r.messages, [{ role: "user", content: [{ type: "text", text: "q", cache_control: { type: "ephemeral" } }] }]);
  assert.equal(r.tool_choice, undefined);
  assert.equal(r.thinking, undefined);
});

test("the newest block carries the mark, whatever its shape, and the caller's messages are left alone", () => {
  const results = [{ type: "tool_result", tool_use_id: "a", content: "x" }, { type: "tool_result", tool_use_id: "b", content: "y" }];
  const messages = [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: "t" }] }, { role: "user", content: results }];
  const r = params({ system: "S", tools, messages });
  assert.deepEqual(r.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(r.messages.at(-1).content[0].cache_control, undefined);
  assert.equal(r.messages[1].content[0].cache_control, undefined);
  assert.equal(typeof r.messages[0].content, "string", "only the last message is rewritten");
  assert.equal(messages.at(-1).content, results, "the caller's array is not replaced");
  assert.equal(results[1].cache_control, undefined, "nor is a block of it marked in place");
});

test("the final round keeps the tools listed and forbids another call", () => {
  const r = params({ system: "S", tools, messages: [], final: true });
  assert.equal(r.tools.length, 2);
  assert.deepEqual(r.tool_choice, { type: "none" });
});

test("the weights are the model's price ratios", () => {
  assert.deepEqual(WEIGHTS, { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
});

test("a Vertex model is built from a project and a region and exposes turn", () => {
  const m = vertexModel({ project: "p", region: "eu" });
  assert.equal(m.name, MODEL);
  assert.equal(typeof m.turn, "function");
});

test("an Anthropic model is built from a key and exposes turn, and the chooser reads the config", () => {
  const a = anthropicModel({ apiKey: "sk-ant-test" });
  assert.equal(a.name, MODEL);
  assert.equal(typeof a.turn, "function");
  const base = { project: "p", region: "eu", anthropicKey: null };
  assert.equal(modelFor(base).provider, "vertex");
  assert.equal(modelFor({ ...base, anthropicKey: "sk-ant-test" }).provider, "anthropic");
});

test("the minute's rate from the model is busy one minute from now, and any other error is what it was", () => {
  const rate = Object.assign(new Error("Too Many Requests"), { status: 429 });
  const busy = asChatError(rate, () => Date.UTC(2026, 8, 23, 14, 5, 0));
  assert.equal(busy.code, "busy");
  assert.equal(busy.status, 429);
  assert.equal(busy.retryAt, "2026-09-23T14:06:00.000Z", "the quantum the quota is counted in");
  const other = Object.assign(new Error("boom"), { status: 500 });
  assert.equal(asChatError(other), other);
  const plain = new Error("no status");
  assert.equal(asChatError(plain), plain);
});
