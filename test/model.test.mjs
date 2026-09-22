import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, EFFORT, WEIGHTS, params, vertexModel } from "../lib/model.mjs";
import { MAX_OUTPUT_TOKENS } from "../lib/shape.mjs";

const tools = [{ name: "search", description: "d", input_schema: { type: "object" } }, { name: "fetch", description: "d", input_schema: { type: "object" } }];

test("a request names the model, the effort, the output limit, and marks the prefix for caching", () => {
  const r = params({ system: "S", tools, messages: [{ role: "user", content: "q" }] });
  assert.equal(r.model, MODEL);
  assert.equal(MODEL, "claude-sonnet-5");
  assert.equal(r.max_tokens, MAX_OUTPUT_TOKENS);
  assert.deepEqual(r.output_config, { effort: EFFORT });
  assert.deepEqual(r.system, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(r.tools[1].cache_control, { type: "ephemeral" });
  assert.equal(r.tools[0].cache_control, undefined);
  assert.equal(r.tool_choice, undefined);
  assert.equal(r.thinking, undefined);
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
