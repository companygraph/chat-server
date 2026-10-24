import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, EFFORTS, outputLimit, callTimeoutMs, DEFAULT_MODEL, DEFAULT_EFFORT, DEFAULT_CHOICE } from "../lib/models.mjs";

test("everyModelHasWeights", () => {
  assert.equal(Object.keys(MODELS).length, 5);
  for (const [id, m] of Object.entries(MODELS)) {
    for (const k of ["input", "cacheWrite", "cacheRead", "output"]) assert.equal(typeof m.weights[k], "number", `${id} ${k}`);
  }
  assert.deepEqual(MODELS["claude-sonnet-5"].weights, { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
  assert.deepEqual(MODELS["claude-sonnet-5-5"].weights, { input: 1, cacheWrite: 1.25, cacheRead: 0.05, output: 5 });
  assert.deepEqual(MODELS["claude-fable-5-1"].weights, { input: 5, cacheWrite: 6.25, cacheRead: 0.125, output: 25 });
});

test("outputLimitPerEffort", () => {
  assert.deepEqual(EFFORTS.map(outputLimit), [2400, 8000, 16000, 32000, 64000]);
});

test("rolesAreTheSpecs", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.role])), { "claude-sonnet-5": null, "claude-sonnet-5-5": "sonnet-5-5", "claude-opus-5-5": "opus", "claude-fable-5-1": "fable", "claude-haiku-5-5": "haiku" });
});

test("the default is Sonnet 5 at low effort, and a call waits a minute at low and fourteen otherwise", () => {
  assert.deepEqual(DEFAULT_CHOICE, { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT });
  assert.equal(DEFAULT_MODEL, "claude-sonnet-5");
  assert.equal(DEFAULT_EFFORT, "low");
  assert.deepEqual(EFFORTS.map(callTimeoutMs), [60000, 840000, 840000, 840000, 840000]);
});
