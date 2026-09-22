import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, RULES, LANGS } from "../lib/prompt.mjs";

test("the prompt is the host's instructions, then the rules, then the language", () => {
  const p = systemPrompt("Tagline one.\n\nTerms the tools use.", "de");
  assert.ok(p.startsWith("Tagline one."));
  for (const r of RULES) assert.ok(p.includes(r), `rule missing: ${r}`);
  assert.ok(p.indexOf("Terms the tools use.") < p.indexOf(RULES[0]));
  assert.match(p, /Answer in German/);
  assert.match(systemPrompt("x", "en"), /Answer in English/);
  assert.deepEqual(LANGS, ["en", "de"]);
});

test("a language the widget does not send falls back to English", () => {
  assert.match(systemPrompt("x", "fr"), /Answer in English/);
});
