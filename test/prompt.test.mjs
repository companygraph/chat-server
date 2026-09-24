import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPrompt, typeMap, questionIndexLine, RULES, LANGS } from "../lib/prompt.mjs";

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
  assert.ok(RULES.some((r) => r.includes("search with match \"words\"") && r.includes("tried again with fewer words")), "the words-mode rule is missing");
  assert.ok(RULES.some((r) => r.includes("search with match \"words\"") && r.includes("put into English whatever the visitor's language") && r.includes("another English word for the same thing")), "the English-words rule is missing");
  assert.ok(RULES.some((r) => r.includes("is not one of those words") && r.includes("owner set to that entity's id")), "the name-apart rule is missing");
  assert.ok(RULES.some((r) => r.includes("a first name alone, never meets")), "the part-of-a-title rule is missing");
  assert.ok(!RULES.some((r) => r.includes("Search before you fetch")), "the search-first rule is gone");
  assert.ok(RULES.some((r) => r.startsWith("A question about this chat") && r.includes("answered through the tools like any other") && r.includes("about neither this model nor this chat")), "the chat-is-in-the-model rule is missing");
  assert.ok(RULES.some((r) => r.startsWith("When the visitor's question is one of the questions this model answers") && r.includes("get_entity that question first") && r.includes("a question that rests on no entity is itself what the answer rests on, and is named")), "the question-index rule is missing");
});

test("the question index line lists titles in the order given, within the cap, ending in a period", () => {
  const line = questionIndexLine(["What does Robert do?", "Can Robert still write code himself?"], 4000);
  assert.equal(line, 'Questions this model answers, each an entity of type question: "What does Robert do?"; "Can Robert still write code himself?".');
});

test("the question index line is empty when there are no questions", () => {
  assert.equal(questionIndexLine([], 4000), "");
});

test("titles past the cap end the line with the overflow sentence, exactly", () => {
  const line = questionIndexLine(["Alpha?", "Beta?", "Gamma?", "Delta?"], 130);
  assert.equal(line, 'Questions this model answers, each an entity of type question: "Alpha?"; "Beta?"; and more, found by search with type question');
  assert.ok(!line.includes("Gamma"));
  assert.ok(!line.includes("Delta"));
});

test("a title with a double quote is escaped so the line stays unambiguous", () => {
  const line = questionIndexLine(['What does "Robert" do?'], 4000);
  assert.ok(line.includes('\\"Robert\\"'));
  assert.equal((line.match(/(?<!\\)"/g) ?? []).length % 2, 0, "every unescaped quote still pairs up");
});

test("a title alone longer than the cap leaves no line at all", () => {
  assert.equal(questionIndexLine(["Q".repeat(5000) + "?"], 4000), "");
});

test("systemPrompt places the question index line after the type map and before the rules, and omits it with no question type or no questions", () => {
  const types = [{ type: "question", count: 2, owner: null }];
  const questions = ["What does Robert do?", "Can Robert still write code himself?"];
  const p = systemPrompt("x", "en", types, questions);
  assert.ok(p.indexOf('type question: "What does Robert do?"') > p.indexOf("types, each"));
  assert.ok(p.indexOf('type question: "What does Robert do?"') < p.indexOf(RULES[0]));
  assert.ok(!systemPrompt("x", "en", types, []).includes("Questions this model answers"), "no line with no questions");
  assert.ok(!systemPrompt("x", "en", [], questions).includes("Questions this model answers"), "no line when the type map lacks question");
});

test("the type map is one sentence naming each type with its count and owner, and nothing when the host lists none", () => {
  assert.equal(typeMap([]), "");
  assert.equal(typeMap([{ type: "product", count: 1, owner: null }, { type: "phase", count: 12, owner: "process" }]), "The model's types, each with how many entities it holds: product (1), phase (12, owned by process).");
  assert.ok(!systemPrompt("x", "en", []).includes("types, each"));
});

test("a language the widget does not send falls back to English", () => {
  assert.match(systemPrompt("x", "fr"), /answer in English\.$/);
});
