// The design pages are a map of the code, and a map that drifts is worse than none: a rule moved
// in lib/prompt.mjs and not in docs/design/prompt.md would show the order the model no longer
// reads. So the table of rules is held to the prompt systemPrompt() builds with every condition
// met, and every function a page names is held to exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { systemPrompt, RULES, QUESTION_RULE, KIND_RULE, DIAGRAM_RULE, FACTS_RULE } from "../lib/prompt.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// The rules as the model reads them with every condition met: a model with questions and their
// kinds, a host that draws and whose list takes on, by and where, and a date.
function rulesInOrder() {
  const types = [{ type: "question", count: 1, owner: null }, { type: "question-kind", count: 1, owner: null }];
  const prompt = systemPrompt("x", "en", types, ["A question?"], undefined, false, true, { today: "2026-10-06", facts: true });
  const body = prompt.split("\n\n").find((part) => part.startsWith(RULES[0]));
  assert.ok(body, "the prompt holds the rules as one part");
  const all = [...RULES, QUESTION_RULE, KIND_RULE, DIAGRAM_RULE, FACTS_RULE];
  return all.map((r) => [body.indexOf(r), r]).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

test("the table of rules in docs/design/prompt.md is the order systemPrompt() builds", () => {
  const rows = read("docs/design/prompt.md").split("\n").filter((l) => /^\| \d+ \|/.test(l));
  const openings = rows.map((l) => l.split(" | ")[2].replace(/^`|`$/g, ""));
  const actual = rulesInOrder();
  assert.equal(openings.length, actual.length, `the page lists ${openings.length} rules and the prompt holds ${actual.length}`);
  openings.forEach((o, i) => assert.ok(actual[i].startsWith(o), `rule ${i + 1} on the page opens "${o}", the prompt's opens "${actual[i].slice(0, 60)}"`));
});

test("every function the design pages name exists in lib/", () => {
  const lib = fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".mjs")).map((f) => read(`lib/${f}`)).join("\n");
  for (const page of ["docs/design/answering.md", "docs/design/prompt.md"]) {
    const named = [...read(page).matchAll(/`([A-Za-z]+)\(\)`/g)].map((m) => m[1]);
    assert.ok(named.length > 0, `${page} names functions`);
    for (const fn of named) assert.match(lib, new RegExp(`(function ${fn}\\b|const ${fn} = )`), `${page} names ${fn}(), which lib/ does not define`);
  }
});
