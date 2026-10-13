# A picture of the schemas is answered as a list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An answer under a picture of the schemas states its relations as a short list, one relation to an item, so that the answer check, unchanged, reads each relation as a claim of its own.

**Architecture:** Everything is in `diagramNote()` in `lib/loop.mjs`, the note the model reads in place of a picture's tool answer. Its line for a picture of the schemas asks for one sentence and then a Markdown list of at most six items, and the sentences of its groups `owns` and `shared` lose the closing words that were written for the model. The check in `lib/verdict.mjs` already takes a list item as a claim, so nothing there moves. What the text does to real answers is measured by hand with three throwaway scripts that are never committed.

**Tech Stack:** Node 22 ESM, `node --test`, the fixture MCP host over the meta-model's worked example; for the measurement, the live host of companygraph/mental-model, the chat's own model and TypeSafe's Jev.

**Spec:** `docs/superpowers/specs/2026-10-13-a-picture-of-the-schemas-is-answered-as-a-list-design.md`

## Global Constraints

- Only the note for shape `schema` changes. `lib/verdict.mjs`, `lib/typesafe.mjs`, the threshold, the `verdict` event, the widget and `docs/INTERFACE.md` do not change.
- The list has at most six items, and an item states one relation and no more.
- Every other shape of picture keeps its sentences: its note carries no word of a list.
- `types/` does not change: `npm run build:check` passes with no build committed.
- Nothing is merged, tagged, released or re-pinned in this plan: those are the owner's.
- The measurement is run by hand with two keys, never in CI. The keys are the owner's, are in the environment before a step runs as `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY`, and are never printed, not to check them and not in a debug line.
- The measuring scripts are throwaway: they are written outside the repository and never committed.
- Commits and the pull request body are prose in the git register, ending `Verified: …` before the trailers, and the `Verified:` line names what actually ran. Commits are authored `Implementer <implementer@companygraph.io>` with `Process: Delivery`, `Phase: Implement`, `Track: Code`.
- Before any `node`, `npm` or `gh`: `export PATH="/opt/homebrew/bin:$PATH"`. `npm test` fetches the fixtures first (`pretest`); a single test file needs `npm run fixtures` once.
- American English; no counts or versions that move in any prose.

## Rulings this plan makes on the spec

- §2 asks for an item "as that sentence states it". The line's words are the ones measured, and they ask for plain words "keeping who declares and who is named as the sentence has them"; under them the model copies the note's sentences. Two other wordings were tried in a scratch copy and are not to be tried again: "as the sentence states it" with a clause on a sentence naming more than six types had 4 of 12 answers repeat a group in a sentence after the list, and a clause forbidding a relation after the list had 18 of 20 do so.
- §2 says the note's line on the groups already says each is closed. That line, from "owns says which types" to "a nesting or a field they do not", is left exactly as it is.
- §4 found every item stating one relation. With the closing words gone from the group sentences, the text of this plan had 4 of 120 items join two relations and 3 of 20 answers repeat a group in a sentence after the list, in a scratch copy on 2026-10-13; the check still marked a wrong item planted in 20 of 20 and none of 176 claims as written. So the gate of Task 3 is on what a reader and the check find, and the two counts of form are reported, not gated.
- The spec is silent on `docs/design/prompt.md`. The page maps what rides outside the system prompt, so it gains one paragraph on the picture's note in Task 2.

## Review Focus

- A picture of one type, or of the whole, has no `owns` and no `shared`: its line must not offer their sentences as items. Pinned by the test of Task 2.
- A relation whose label names no multiplicity has no `says`: the line says it is not listed. Pinned by the test of Task 2.
- The core unit's sentence of types nested in none names dozens of types: copied as an item it would bury the list. No test can pin what a model chooses, so Task 3 reads ten core answers for it; six read in the scratch copy never copied it.
- A German answer renders each sentence itself and may say a group in a sentence after the list, where the check reads it less well; one of six did in the scratch copy. Task 3 reads ten German answers for it.
- An English answer may join two relations in an item or repeat a group after the list. Task 3 counts both on thirty answers and reports them.

---

### Task 1: The group sentences carry no closing words

**Files:**

- Modify: `lib/loop.mjs`, the comment above `const listed` and the two template strings in `groups()` inside `diagramNote()`
- Test: `test/loop.test.mjs`, the test "a picture of one unit of the schemas groups its own types by owner and by a field several declare, each group closed"

**Interfaces:**

- Consumes: nothing from another task.
- Produces: `note.owns` and `note.shared` as arrays of sentences with no closing words, which Task 2's line offers as list items and Task 3 measures.

- [ ] **Step 1: Change what the test expects**

In `test/loop.test.mjs`, replace the comment above the test:

```js
// An answer says a picture of the schemas in two or three sentences, so it groups: these types
// nest in that one, those carry decisions. Grouped by the model, a type was put in a group it is
// not in: a feature-design nested in a bounded-context it only names, decisions on a type that
// declares none. A unit's picture draws every nesting and every reference of the unit's own
// types, so the note groups them itself, each group closed, and the answer has them to repeat.
```

with:

```js
// An answer about the schemas groups: these types nest in that one, those carry decisions.
// Grouped by the model, a type was put in a group it is not in: a feature-design nested in a
// bounded-context it only names, decisions on a type that declares none. A unit's picture draws
// every nesting and every reference of the unit's own types, so the note groups them itself.
// Each group is closed, which the note's line says once: a sentence carries no closing words,
// since an answer copies it as an item of its list.
```

and, inside the test, replace these three expectations:

```js
    "bounded-context owns aggregate, concept-design and domain-event, and no other type of this unit",
```

```js
  assert.deepEqual(note.shared, ["aggregate, bounded-context and feature-design each declare the field decisions, which names decision, and no other type of this unit does"]);
```

```js
  assert.deepEqual(small.owns, ["bounded-context owns aggregate, and no other type of this unit", "bounded-context is nested in no type"]);
```

with:

```js
    "bounded-context owns aggregate, concept-design and domain-event",
```

```js
  assert.deepEqual(note.shared, ["aggregate, bounded-context and feature-design each declare the field decisions, which names decision"]);
```

```js
  assert.deepEqual(small.owns, ["bounded-context owns aggregate", "bounded-context is nested in no type"]);
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npm run fixtures && node --test --test-name-pattern "groups its own types" test/loop.test.mjs`

Expected: FAIL, the diff showing `'bounded-context owns aggregate, concept-design and domain-event, and no other type of this unit'` as actual against the sentence without the closing words as expected.

- [ ] **Step 3: Take the closing words out of the sentences**

In `lib/loop.mjs`, replace the comment:

```js
  // A unit's picture draws every nesting and every reference of the unit's own types, so what an
  // answer of two or three sentences would group, the note groups, each group closed: the types
  // an owner nests, the types nested in none, and the types that declare a field several declare.
```

with:

```js
  // A unit's picture draws every nesting and every reference of the unit's own types, so the note
  // groups them: the types an owner nests, the types nested in none, and the types that declare a
  // field several declare. Each group is closed, which the note's line says once and no sentence
  // repeats, since an answer copies a sentence as an item of its list.
```

and in `groups()` replace the two template strings:

```js
`${owner} owns ${listed(types.sort())}, and no other type of this unit`
```

```js
`${listed(f.by.sort())} each declare ${f.where}, which names ${f.to}, and no other type of this unit does`
```

with:

```js
`${owner} owns ${listed(types.sort())}`
```

```js
`${listed(f.by.sort())} each declare ${f.where}, which names ${f.to}`
```

- [ ] **Step 4: Run the test and see it pass**

Run: `node --test test/loop.test.mjs`

Expected: PASS, no test failing, the changed one among those that pass.

- [ ] **Step 5: Commit**

```bash
git add lib/loop.mjs test/loop.test.mjs
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
A group of the schemas' types is said without its closing words

The sentences of owns and shared ended in "and no other type of this unit", which closes a group for the model and reads badly where an answer copies the sentence as an item of a list. The note's own line already says each group is closed, so the sentences state the group and nothing more.

Verified: the changed test failed before the change and passes after; node --test test/loop.test.mjs passes.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

Expected: the last line prints the subject alone in brackets.

### Task 2: The schemas' line asks for the list

**Files:**

- Modify: `lib/loop.mjs`, the comment above and the template string of `schemas:` in the object `diagramNote()` returns
- Modify: `docs/design/prompt.md`, the section "Outside the system prompt"
- Test: `test/loop.test.mjs`, one new test before the comment "A meta-model of more types than one picture holds is drawn a unit at a time, core or one pack,"

**Interfaces:**

- Consumes: `note.owns` and `note.shared` without closing words, from Task 1.
- Produces: `note.schemas`, the line Task 3 measures. `diagramNote(d)` keeps its signature and its other keys.

- [ ] **Step 1: Write the failing test**

In `test/loop.test.mjs`, immediately before the comment line `// A meta-model of more types than one picture holds is drawn a unit at a time, core or one pack,`, add:

```js
// The check reads an answer claim by claim, and a sentence that joins five relations of the
// schemas reads as supported with a wrong one among them. A list item is a claim of its own, so
// the note asks for the relations of the schemas as a list, one to an item, and of no other
// picture.
test("the note for a picture of the schemas asks for a list of at most six items, one relation to an item", () => {
  const nodes = [{ node: "n0", id: "software/aggregate", title: "aggregate", type: "schema" }, { node: "n1", id: "software/bounded-context", title: "bounded-context", type: "schema" }];
  const data = { shape: "schema", title: "software", mermaid: "classDiagram", nodes, edges: 1, omitted: 0, links: [{ from: "n0", to: "n1", label: "nested-in" }], everyType: [], model: { core: "0.69.0" }, unit: "software", units: [{ unit: "core", types: 37 }, { unit: "software", types: 5 }] };
  /** @param {object} d */
  const of = (d) => JSON.parse(diagramNote({ ...diagramOf("diagram", { isError: false, data: d }), edges: 1 }));
  const unit = of(data), type = of({ ...data, title: "aggregate", unit: undefined }), whole = of({ ...data, title: null, unit: undefined });
  for (const note of [unit, type, whole]) {
    assert.match(note.schemas, /a list takes the place of the one or two sentences/);
    assert.match(note.schemas, /a Markdown list of at most six items, never every relation/);
    assert.match(note.schemas, /An item states one relation and no more: /);
    assert.match(note.schemas, /never two joined by and, a comma or a semicolon; a relation that has no says is not listed/);
    assert.match(note.schemas, /keeping who declares and who is named as the sentence has them/);
    assert.doesNotMatch(note.schemas, /two or three sentences/);
  }
  // Only a unit's picture has the groups, so only its line offers their sentences as items.
  assert.match(unit.schemas, /no more: one sentence of owns or shared, or one relation's says,/);
  for (const note of [type, whole]) {
    assert.match(note.schemas, /no more: one relation's says,/);
    assert.doesNotMatch(note.schemas, /owns or shared/);
  }
  // Every other picture keeps its sentences.
  for (const shape of ["concepts", "process", "neighborhood", "context", "aggregate", "organization", "system"]) {
    const other = diagramNote({ shape, title: "A", mermaid: "", nodes: nodes.map((n) => ({ ...n, type: "concept" })), edges: 1, omitted: 0, links: [{ from: "n0", to: "n1", label: "x" }] });
    assert.doesNotMatch(other, /Markdown list/, shape);
  }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --test --test-name-pattern "asks for a list" test/loop.test.mjs`

Expected: FAIL on the first `assert.match`, the note's line not matching `/a list takes the place of the one or two sentences/`.

- [ ] **Step 3: Ask for the list in the schemas' line**

In `lib/loop.mjs`, inside the template string of `schemas:`, replace:

```text
Name the core version once. The picture is the answer: write two or three sentences, naming a few of the types and relations that carry its structure, never a list of every relation.
```

with:

```text
Name the core version once. The picture is the answer, and for this picture a list takes the place of the one or two sentences: write one sentence saying what the picture shows, then the relations that carry its structure as a Markdown list of at most six items, never every relation. An item states one relation and no more: ${d.unit ? "one sentence of owns or shared, or " : ""}one relation's says, never two joined by and, a comma or a semicolon; a relation that has no says is not listed. Say it in plain words, as a reader would say it, keeping who declares and who is named as the sentence has them.
```

The `${d.unit ? ... : ""}` in the new text is a live expression of the template string, as the others in that string are. Leave every other sentence of the string as it is, the line on `owns` and `shared` at its end among them.

Then replace the comment above `schemas:`:

```js
    // A picture of the schemas: the types each node is, the core they are declared in, and what
    // every other type declares, said once, since the picture draws no arrow for it.
```

with:

```js
    // A picture of the schemas: the types each node is, the core they are declared in, and what
    // every other type declares, said once, since the picture draws no arrow for it. Its relations
    // are asked for as a list, one to an item: the check reads an answer claim by claim, a list
    // item is a claim, and a sentence joining several relations passes with a wrong one in it.
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test --test-name-pattern "asks for a list|picture of" test/loop.test.mjs`

Expected: PASS, six tests, among them "the note for a picture of the schemas asks for a list of at most six items, one relation to an item" and "a picture of one unit of the schemas groups its own types by owner and by a field several declare, each group closed", whose `assert.match(note.schemas, /group them as owns and shared do/)` still holds.

- [ ] **Step 5: Say it on the design page**

In `docs/design/prompt.md`, at the end of the section "Outside the system prompt", after the paragraph that ends "and it is no part of what an answer is checked against.", add a blank line and this paragraph on one line:

```markdown
A picture's tool answer is not passed on as it came. `diagramNote()` in `lib/loop.mjs` gives the model what the picture holds, by title and type, and how to say it. For a picture of the schemas it asks for the relations as a list, one to an item, because the answer check reads an answer claim by claim: a list item is a claim of its own, and a sentence that joins several relations is read as supported with a wrong one among them.
```

- [ ] **Step 6: Run every check**

Run each on its own and read its exit code:

```bash
npm test; echo "npm test: $?"
npm run typecheck; echo "typecheck: $?"
npm run build:check; echo "build:check: $?"
sh conventions/conventions-check; echo "conventions-check: $?"
sh conventions/conventions-format; echo "conventions-format: $?"
```

Expected: every line ends in `0`, `npm test` reports no failure, and `build:check` prints that `types/` is what the JSDoc declares.

- [ ] **Step 7: Commit**

```bash
git add lib/loop.mjs test/loop.test.mjs docs/design/prompt.md
git commit --author "Implementer <implementer@companygraph.io>" -F - <<'EOF'
A picture of the schemas is answered as a list

The answer check reads an answer claim by claim, and an answer about the schemas joined five to eight relations in a sentence, which the judge passes with a wrong one among them. A list item is a claim already, and the judge reads a relation that stands alone.

The note's line for a picture of the schemas now asks for one sentence and then a Markdown list of at most six items, one relation to an item, a sentence of owns or shared or one relation's says; a picture of one type or of the whole is offered the relations alone. Every other picture keeps its sentences, and the check does not change.

Verified: the new test failed before the change; npm test, typecheck, build:check, conventions-check and conventions-format pass.

Process: Delivery
Phase: Implement
Track: Code
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

Expected: the last line prints the subject alone in brackets.

### Task 3: The text as built is measured

**Files:**

- Create, outside the repository and never committed: `answers.mjs`, `count.mjs` and `check.mjs` in a new scratch directory, called `$M` below
- Modify: nothing in the repository

**Interfaces:**

- Consumes: the worktree with Tasks 1 and 2 committed, called `$W` below; `answer()` from `lib/loop.mjs`, `verdictOf()` and `isUnsupported()` from `lib/verdict.mjs`, `typesafeJudge()` from `lib/typesafe.mjs`, `connectHost()` from `lib/host.mjs`, `diagramOf()` and `diagramNote()` from `lib/loop.mjs`.
- Produces: the numbers Task 4 writes into the pull request.

- [ ] **Step 1: Write the three scripts**

`$M/answers.mjs`:

```js
// Throwaway, never committed: one question asked n times through a checkout's own answer loop
// and the real model, against a live host. One JSON line per answer.
//   node answers.mjs <checkout> <out.jsonl> <n> "<question>"
import fs from "node:fs";
const [root, out, n, question] = process.argv.slice(2);
const { configFromEnv } = await import(`${root}/lib/config.mjs`);
const { connectHost } = await import(`${root}/lib/host.mjs`);
const { modelFor } = await import(`${root}/lib/model.mjs`);
const { Meter } = await import(`${root}/lib/meter.mjs`);
const { meterStore } = await import(`${root}/lib/platform.mjs`);
const { answer } = await import(`${root}/lib/loop.mjs`);
const config = configFromEnv();
const host = await connectHost(config.mcpUrl, { questionCap: config.questionIndexChars });
const model = modelFor(config, {});
const meter = new Meter(await meterStore(config.meter, config.meterOptions), { monthTokens: config.monthTokens });
let next = 0, failed = 0;
const one = async () => {
  while (next < +n) {
    const i = next++;
    let text = "";
    const pictures = [];
    try {
      const r = await answer({ host, model, meter, questionCap: config.questionIndexChars }, { messages: [{ role: "user", content: question }], lang: "en" }, (event, data) => {
        if (event === "text") text += data.text;
        if (event === "diagram") pictures.push(`${data.shape}:${data.title}`);
      });
      fs.appendFileSync(out, JSON.stringify({ i, text, pictures, spent: r.spent, rounds: r.rounds }) + "\n");
    } catch (err) { failed++; console.error(`answer ${i}: ${err instanceof Error ? err.message.slice(0, 200) : err}`); }
  }
};
await Promise.all(Array.from({ length: 4 }, one));
console.log(`${out}: ${+n - failed} answers written, ${failed} failed, model ${model.name}, host at ${host.provenance?.commit}`);
process.exit(0);
```

`$M/count.mjs`:

```js
// Throwaway, never committed: the form of the answers, counted, and every distinct item and
// every sentence outside the list printed once for the reading by hand.
//   node count.mjs <answers.jsonl>
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const items = new Map(), outside = new Map();
let total = 0, joined = 0, withList = 0, over = 0, repeated = 0;
for (const r of rows) {
  const lines = r.text.split("\n").filter((l) => l.trim());
  const mine = lines.filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ""));
  if (mine.length) withList++;
  if (mine.length > 6) over++;
  total += mine.length;
  for (const i of mine) { if (/;|, and |, while /.test(i)) joined++; items.set(i, (items.get(i) ?? 0) + 1); }
  const rest = lines.filter((l) => !/^\s*[-*]\s/.test(l));
  if (rest.some((l) => / owns | nests? | nested | declares? the field (?!source)| each (also )?declare/.test(l))) repeated++;
  for (const l of rest) outside.set(l, (outside.get(l) ?? 0) + 1);
}
console.log(`${rows.length} answers, ${withList} with a list, ${over} with more than six items, ${total} items, ${joined} joining two relations, ${repeated} answers stating a relation or a group outside the list, mean cost ${Math.round(rows.reduce((s, r) => s + r.spent, 0) / rows.length)}`);
console.log("\nItems:");
for (const [k, n] of [...items].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${k}`);
console.log("\nOutside the list:");
for (const [k, n] of [...outside].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${k}`);
```

`$M/check.mjs`:

```js
// Throwaway, never committed: the answer check as the service runs it, over answers about the
// software unit's picture, once as written and once with a wrong item planted after the first
// item of each. Prints what was marked. The key comes from TYPESAFE_API_KEY and is never printed.
//   node check.mjs <checkout> <answers.jsonl>
import fs from "node:fs";
const [root, input] = process.argv.slice(2);
const { verdictOf, isUnsupported } = await import(`${root}/lib/verdict.mjs`);
const { typesafeJudge } = await import(`${root}/lib/typesafe.mjs`);
const { connectHost } = await import(`${root}/lib/host.mjs`);
const { diagramOf, diagramNote } = await import(`${root}/lib/loop.mjs`);
const THRESHOLD = 0.8;
const WRONG = [
  "A feature-design is nested in a bounded-context.",
  "An aggregate declares emitted-by, naming domain-event.",
  "A concept-design may carry decisions.",
  "bounded-context owns aggregate, concept-design, domain-event and feature-design.",
  "A feature-design relates to other bounded-context entities through its Relationships.",
  "A domain-event has exactly one root concept-design.",
  "An aggregate is emitted by exactly one domain-event.",
  "A concept-design is nested in an aggregate.",
  "aggregate, bounded-context, concept-design and feature-design each declare decisions.",
  "A domain-event is emitted by any number of aggregates.",
];
if (!process.env.TYPESAFE_API_KEY) { console.error("TYPESAFE_API_KEY is not set; nothing was checked."); process.exit(1); }
const judge = typesafeJudge({ key: process.env.TYPESAFE_API_KEY });
const host = await connectHost(process.env.CHAT_MCP_URL);
await host.refreshTitles();
const index = await host.titles(), promptTitles = (await host.questions()).titles;
const picture = await host.call("diagram", { shape: "schema", unit: "software" });
const note = diagramNote({ ...diagramOf("diagram", picture), edges: picture.data.edges ?? 0 });
const rows = fs.readFileSync(input, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const marked = (c) => isUnsupported(c.verdict) && typeof c.p === "number" && c.p >= THRESHOLD;
const check = (text) => verdictOf({ text, lang: "en", returned: [], index, promptTitles, evidence: new Map(), answers: [note], calls: 1, empty: 0 }, judge);
let claims = 0, markedAsWritten = 0, planted = 0, plantedMarked = 0, othersMarked = 0;
for (const [k, row] of rows.entries()) {
  const written = await check(row.text);
  claims += written.claims.length;
  for (const c of written.claims.filter(marked)) { markedAsWritten++; console.log(`as written, answer ${row.i}: ${c.verdict} ${c.p.toFixed(2)}: ${row.text.slice(c.from, c.to)}`); }
  const lines = row.text.split("\n"), at = lines.findIndex((l) => /^\s*[-*]\s/.test(l));
  if (at < 0) { console.log(`answer ${row.i} has no list`); continue; }
  const wrong = WRONG[k % WRONG.length];
  lines.splice(at + 1, 0, /^\s*[-*]\s/.exec(lines[at])[0] + wrong);
  const text = lines.join("\n"), again = await check(text);
  planted++;
  const hit = again.claims.find((c) => text.slice(c.from, c.to) === wrong);
  if (hit && marked(hit)) plantedMarked++;
  else console.log(`planted and not marked, answer ${row.i}: ${hit ? `${hit.verdict} ${hit.p?.toFixed(2)}` : "no such claim"}: ${wrong}`);
  othersMarked += again.claims.filter((c) => c !== hit && marked(c)).length;
}
console.log(`${rows.length} answers, ${claims} claims as written, ${markedAsWritten} marked; a wrong item planted in ${planted}, marked in ${plantedMarked}; other claims marked beside a planted one: ${othersMarked}`);
process.exit(0);
```

- [ ] **Step 2: Set the environment**

With `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY` already in the environment, and neither printed:

```bash
export PATH="/opt/homebrew/bin:$PATH"
export CHAT_METER=memory CHAT_MCP_URL=https://mcp.companygraph.io/mcp CHAT_MONTH_TOKENS=900000000 CHAT_PROJECT=local CHAT_REGION=local CHAT_ORIGINS=http://localhost
test -n "$ANTHROPIC_API_KEY" && test -n "$TYPESAFE_API_KEY" && echo "both keys are set"
```

Expected: `both keys are set`. If not, stop and ask the owner; do not look for a key.

- [ ] **Step 3: Thirty answers for the software pack, counted and read**

```bash
node "$M/answers.mjs" "$W" "$M/software.jsonl" 30 "Show me the meta-model for the software pack"
node "$M/count.mjs" "$M/software.jsonl"
```

Expected from the first command: `30 answers written, 0 failed`. Read every distinct item the second prints against the software unit's schemas, which are these and no others:

| Type | Declares | Nested in |
| --- | --- | --- |
| aggregate | `root`, exactly one concept-design; `members`, any number of concept-design; `decisions`, any number of decision; the column `Emits` of its section `Handled commands`, any number of domain-event | bounded-context |
| bounded-context | `realizes`, any number of domain; `decisions`, any number of decision; the column `Context` of its section `Relationships`, any number of bounded-context | no type |
| concept-design | `refines`, at most one concept; the column `Term` of its section `Attributes` and the column `Concept` of its section `Relations`, any number of concept-design | bounded-context |
| domain-event | `emitted-by`, exactly one aggregate; the column `Term` of its section `Payload`, any number of concept-design | bounded-context |
| feature-design | `contexts`, one or more bounded-context; `refines`, at most one feature; `decisions`, any number of decision | no type |

An item is wrong where it gives a type a field, a nesting or a number this table does not give it, or turns a reference around. Write down four numbers: answers with a wrong item, items joining two relations, answers stating a relation or a group outside the list, and the mean cost.

Gate: no answer holds a wrong item. If one does, stop here, change nothing, and report the item and the count to the owner.

- [ ] **Step 4: The check on those thirty, as written and with a wrong item planted**

```bash
node "$M/check.mjs" "$W" "$M/software.jsonl"
```

Expected, in the last line: no claim as written marked, a wrong item planted in 30 and marked in at least 28, and no other claim marked beside a planted one. A claim the check marks as written is read by hand against the table of Step 3: marked and wrong is the check working, marked and right is a false mark.

Gate: at least 28 of 30 planted items marked, and no false mark. If either fails, stop here, change nothing, and report the lines the script printed to the owner.

- [ ] **Step 5: Ten answers for core and ten in German, read for the form**

```bash
node "$M/answers.mjs" "$W" "$M/core.jsonl" 10 "Show me the meta-model"
node "$M/count.mjs" "$M/core.jsonl"
node "$M/answers.mjs" "$W" "$M/german.jsonl" 10 "Zeig mir das Metamodell für das Software-Pack"
node "$M/count.mjs" "$M/german.jsonl"
```

Read both. For core, write down how many answers have a list of at most six items and whether any item is the sentence that lists the types nested in no type. For German, write down how many answers have a list, how many state a relation or a group in a sentence outside it, and whether any item turns a reference around against the table of Step 3. `count.mjs` matches English words, so its count of relations outside the list does not hold for German: count those by reading.

Gate: none. These go to the owner as read.

### Task 4: The pull request says what was built and measured

**Files:**

- Modify: nothing in the repository; the description of the branch's pull request

**Interfaces:**

- Consumes: the numbers written down in Task 3.
- Produces: the hand-off to the owner.

- [ ] **Step 1: Push the branch**

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "main is in the branch"
git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push origin a-picture-of-the-schemas-is-answered-as-a-list
```

Expected: `main is in the branch`. If main moved, merge `origin/main` locally as the Implementer with the trailers and a `Verified:` line, run Step 6 of Task 2 again, then push; never use GitHub's update-branch.

- [ ] **Step 2: Rewrite the description**

Read the description first with `gh pr view --json body --jq .body`, then replace it with `gh pr edit --body-file`. The body is prose with no headings and no lists, in four paragraphs: the gap, as the spec's §1 states it; what the note now asks for and that the check does not change; what it costs and what it leaves, from the spec's §5 and the two counts of form of Task 3; and the line `Release notes to write at tagging: an answer under a picture of the schemas states its relations as a short list, one to an item.` It ends with one `Verified:` sentence that names the commands of Task 2's Step 6 and every number of Task 3 as counted: answers with a wrong item of thirty, claims marked as written, planted items marked of thirty, items joining two relations, answers stating a relation or a group outside the list, the mean cost, and what the core and the German answers showed. Then the line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Wait for the checks and hand off**

```bash
gh pr checks --watch --interval 15
gh pr view --json mergeable,mergeStateStatus --jq '"\(.mergeable) \(.mergeStateStatus)"'
```

Expected: `test`, `conventions / conventions` and `terraform` pass, and `MERGEABLE CLEAN`. Report the pull request, the checks and the numbers to the owner, and stop: merging, the release and the re-pins are the owner's.
