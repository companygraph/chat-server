import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, typeMap, RULES, LANGS } from "../lib/prompt.mjs";

test("the prompt is the host's instructions, then the types, then the rules, then the language", () => {
  const p = systemPrompt("Tagline one.\n\nTerms the tools use.", "de", [{ type: "feature", count: 5, owner: null }]);
  assert.ok(p.indexOf("Terms the tools use.") < p.indexOf("feature (5)"));
  assert.ok(p.indexOf("feature (5)") < p.indexOf(RULES[0]));
  assert.ok(p.startsWith("Tagline one."));
  for (const r of RULES) assert.ok(p.includes(r), `rule missing: ${r}`);
  assert.ok(p.indexOf("Terms the tools use.") < p.indexOf(RULES[0]));
  assert.match(p, /answer in German\.$/);
  assert.match(p, /language of the visitor's last message/);
  assert.match(systemPrompt("x", "en"), /answer in English\.$/);
  assert.equal(RULES.at(-1), "Call a tool without a preface; write only the answer.");
  assert.deepEqual(LANGS, ["en", "de"]);
  assert.ok(RULES.some((r) => r.startsWith("Write Markdown of this subset")), "the Markdown rule is missing");
  assert.ok(RULES.some((r) => r.includes("write an address bare")), "the bare-address rule is missing");
  assert.ok(!RULES.some((r) => r.includes("no links,")), "the blanket no-links rule is gone");
  assert.ok(RULES.some((r) => r.startsWith("Every question about this model is answered through a tool")), "the tool rule is missing");
  assert.ok(RULES.some((r) => r.includes("list_entities with that type")), "the list-a-type rule is missing");
  assert.ok(!RULES.some((r) => r.includes("Search before you fetch")), "the search-first rule is gone");
});

test("the type map is one sentence naming each type with its count and owner, and nothing when the host lists none", () => {
  assert.equal(typeMap([]), "");
  assert.equal(typeMap([{ type: "product", count: 1, owner: null }, { type: "phase", count: 12, owner: "process" }]), "The model's types, each with how many entities it holds: product (1), phase (12, owned by process).");
  assert.ok(!systemPrompt("x", "en", []).includes("types, each"));
});

test("a language the widget does not send falls back to English", () => {
  assert.match(systemPrompt("x", "fr"), /answer in English\.$/);
});
