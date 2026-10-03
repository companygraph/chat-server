# An answer can show a diagram implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the model calls the host's `diagram` tool, the chat forwards the picture to the widget as its own `diagram` event, links its nodes as names, shows the model only what was drawn, and tells the model when to ask for one.

**Architecture:** `lib/loop.mjs` recognizes a `diagram` answer, emits it, and replaces the tool result the model reads with a short note of what was drawn. `lib/prompt.mjs` gains one conditional sentence, spliced after the Markdown rule only where the host lists the tool. The test host is re-pinned to the `companygraph-mcp-server` release that serves `diagram`; the interface document and the landing page name the event.

**Tech Stack:** Node 22+, `node:test`, `@modelcontextprotocol/client`, `companygraph-mcp-server` as the in-process test host (devDependency, pinned by tag). No dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-27-an-answer-can-show-a-diagram-design.md` on this branch, sections 3, 4 and 6. Read it before any task.

## Global Constraints

- **Precondition:** `companygraph/mcp-server` has a tagged release serving the `diagram` tool, built from its branch `a-diagram-tool` and its plan. Read the tag with `gh release list --repo companygraph/mcp-server --limit 3`; this plan calls it `<SERVER_TAG>`. If no such release exists, stop before Task 1 and report.
- **One repository, one branch.** The worktree exists: `~/git/companygraph/chat-server-an-answer-can-show-a-diagram`, branch `an-answer-can-show-a-diagram`, carrying the spec and this plan. The clone at `~/git/companygraph/chat-server` stays on `main` and is never edited.
- **`export PATH=/opt/homebrew/bin:$PATH`** before any `node`, `npm`, `npx`, `gh` or `sh conventions/…` command. A push names the helper: `git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push -u origin an-answer-can-show-a-diagram`.
- **Every command's exit code is read on its own**, never through a pipe into `tail` or `head`.
- **A single test file runs as** `node --test test/<name>.test.mjs`; the whole suite as `npm test`, which fetches the fixtures first. Run `npx companygraph-chat-deploy page-css` once before the suite in a fresh worktree, or the page tests are cancelled. `sh conventions/conventions-check` and `sh conventions/conventions-format check` exit 0 before every commit.
- **The event:** `diagram`, data `{ shape, title, mermaid, nodes, omitted }` with `nodes` as the host answered them (`{ node, id, title, type }`). Emitted once for every successful `diagram` answer, after that call's `names`; the widget draws the last one a message brings. Never emitted for a refused call.
- **What the model reads** of a `diagram` answer is `diagramNote(data)`: JSON with `drawn` (one sentence), `shape`, `title`, `nodes` (titles only), `edges`, `omitted`. Never the Mermaid source.
- **The prompt sentence** is `DIAGRAM_RULE`, spliced directly after the rule that starts `Write Markdown of this subset`, only when the host lists a tool named `diagram`. `RULES` itself does not change, so `test/prompt.test.mjs`'s verbatim copy stays true.
- **Commit messages** in the git register of `conventions/WRITING.md`: a sentence subject under seventy characters with no prefix and no trailing period, one to three prose paragraphs with no headers, no bullets and no plan task numbers, a `Verified:` line naming what ran, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. After every commit, `git log -1 --format='[%s]'` shows the subject alone. The pull request body in the same register, ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **A finding against a committed task is a new commit**, never an amend.
- **Nothing is merged, tagged, deployed or deleted by an agent.** `package.json`'s version is not moved; the release, and the re-pin of the three chat deployments, are the owner's.
- **No count or version of something that still moves** in any prose or comment.
- **Comments in code say why**, in the register of the surrounding file.

### Rulings the plan makes where the spec is silent

- **Two diagrams in one message** are two events; the loop does not hold one back, because the widget replaces its picture and the stream stays in order.
- **The nodes are names** through `namesIn`, by adding `nodes` to its list keys, so the cap, the once-a-message rule and the cite exclusion hold for them as for any list answer.
- **The landing page's event list** gains `names`, which it never listed, beside `diagram`, from the interface document's words.
- **The sentence names no Mermaid to write:** it says never to write the picture "in Mermaid or any other form", since the prompt's no-code-block rule alone did not stop a model from describing a diagram in a code span.

## Review Focus

1. **A refused `diagram`** (unknown id, `cannot_draw`): no event, the refusal reaches the model as an error result, the answer is words. Task 2 tests an unknown id.
2. **A host that does not serve `diagram`** (a deployment still on an older server): no sentence tells the model to call it. Task 3 tests the prompt without the tool.
3. **Two `diagram` calls in one message**: two events in call order. Task 2 tests it.
4. **A diagram whose node is also cited** in the same message: the node is not named again, as any cited entity is not. Task 2 tests a `get_entity` of a phase, then the process diagram.
5. **A `diagram` answer missing its source or nodes** (a malformed or future host answer): treated as no picture, and the model reads the host's text as for any tool. Task 2 tests `diagramOf` on a partial answer.

---

### Task 1: The test host serves the diagram tool

**Files:**

- Modify: `package.json` (devDependency `companygraph-mcp-server`)
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `<SERVER_TAG>` from the precondition.
- Produces: a fixture host (`test/helpers.mjs`'s `startFixtureHost`) that lists `diagram` among its tools.

- [ ] **Step 1: Install the server by name**

```bash
export PATH=/opt/homebrew/bin:$PATH
npm install --save-dev "companygraph-mcp-server@github:companygraph/mcp-server#<SERVER_TAG>"
git diff package.json
```

If npm reordered `package.json`, restore the order by hand so that only the tag in the one line changed.

- [ ] **Step 2: Prove the lockfile moved, the server and its parser both**

```bash
node -e 'const l=require("./package-lock.json").packages; for (const k of ["node_modules/companygraph-mcp-server","node_modules/companygraph-meta-model"]) console.log(k, l[k].version, l[k].resolved)'
gh api repos/companygraph/mcp-server/git/refs/tags/<SERVER_TAG> --jq .object.sha
grep -c "export function diagram" node_modules/companygraph-mcp-server/lib/diagram.mjs
node -e 'console.log(require("./node_modules/companygraph-mcp-server/package.json").dependencies["companygraph-meta-model"], require("./node_modules/companygraph-meta-model/package.json").version)'
```

Expected: the server's `resolved` ends in the sha the tag points at (for an annotated tag, dereference it with `gh api repos/companygraph/mcp-server/git/tags/<sha> --jq .object.sha`); the grep prints `1`; the installed parser's version is the one the server's dependency names. If the parser did not move, delete `packages["node_modules/companygraph-meta-model"]` from the lockfile and `node_modules/companygraph-meta-model`, run `npm install`, and check again.

- [ ] **Step 3: The suite still passes**

```bash
npx companygraph-chat-deploy page-css
npm test
```

Expected: PASS. The fixtures script fetches the meta-model example at the tag the new server pins.

- [ ] **Step 4: Commit**

```bash
sh conventions/conventions-check && sh conventions/conventions-format check
git add package.json package-lock.json
git commit -F - <<'EOF'
The chat's test host is the server release that draws diagrams

The chat is to forward a picture the host's diagram tool builds, and its suite runs against the server package as a real host in process, so the suite moves to the release that serves the tool before anything here reads it.

Verified: the lockfile's server entry resolves to the commit the tag names and its parser is the one the server declares; npm test passes; conventions-check and conventions-format check pass.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

---

### Task 2: The loop forwards the picture and shows the model only what it drew

**Files:**

- Modify: `lib/loop.mjs`
- Modify: `lib/page.mjs` (the `EVENTS` list)
- Modify: `docs/INTERFACE.md` (the events table)
- Test: `test/loop.test.mjs`

**Interfaces:**

- Consumes: the fixture host's `diagram` tool from Task 1; its answer `{ shape, title, mermaid, nodes: [{ node, id, title, type }], edges, omitted, model }`.
- Produces: `diagramOf(name, r) → { shape, title, mermaid, nodes, omitted } | null`; `diagramNote(data) → string`; the stream event `diagram`.

- [ ] **Step 1: Write the failing tests**

In `test/loop.test.mjs`, extend the import from `../lib/loop.mjs` with `diagramOf, diagramNote`, and append:

```js
test("a diagram answer is the widget's to draw: its event after its names, and only what it drew for the model", async () => {
  const model = fakeModel([toolTurn("diagram", { shape: "process", id: "processes/delivery" }), textTurn("Delivery runs in three phases.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me the delivery process" }], lang: "en" }, emit);
  assert.deepEqual(events.map(([e]) => e), ["names", "diagram", "text", "done"]);
  const picture = events[1][1];
  assert.deepEqual(Object.keys(picture).sort(), ["mermaid", "nodes", "omitted", "shape", "title"]);
  assert.deepEqual([picture.shape, picture.title, picture.omitted], ["process", "Delivery", 0]);
  assert.match(picture.mermaid, /^flowchart LR\n/);
  assert.deepEqual(picture.nodes.map((n) => n.id), ["processes/delivery/phases/specify", "processes/delivery/phases/build", "processes/delivery/phases/release"]);
  const named = events[0][1].names.map((n) => n.id);
  for (const n of picture.nodes) assert.ok(named.includes(n.id), `${n.id} is linked where the answer writes it`);
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.doesNotMatch(result.content, /flowchart|-->/);
  const note = JSON.parse(result.content);
  assert.deepEqual([note.shape, note.title, note.nodes, note.edges, note.omitted], ["process", "Delivery", ["Specify", "Build", "Release"], 2, 0]);
  assert.match(note.drawn, /under your answer/);
});

test("a refused diagram draws nothing, and the model reads the refusal", async () => {
  const model = fakeModel([toolTurn("diagram", { shape: "process", id: "nothing/here" }), textTurn("The model does not say.")]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me a process" }], lang: "en" }, emit);
  assert.ok(!events.some(([e]) => e === "diagram"));
  const result = model.requests[1].messages.at(-1).content[0];
  assert.equal(result.is_error, true);
  assert.match(result.content, /nothing\/here/);
});

test("two diagrams in one message are two events, in the order they were drawn", async () => {
  const model = fakeModel([
    toolTurn("diagram", { shape: "process", id: "processes/delivery" }),
    toolTurn("diagram", { shape: "neighborhood", id: "concepts/invoice" }),
    textTurn("Here is how the invoice connects."),
  ]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "show me" }], lang: "en" }, emit);
  assert.deepEqual(events.filter(([e]) => e === "diagram").map(([, d]) => d.shape), ["process", "neighborhood"]);
});

test("a phase already cited is not named again when the process is drawn", async () => {
  const model = fakeModel([
    toolTurn("get_entity", { id: "processes/delivery/phases/build" }),
    toolTurn("diagram", { shape: "process", id: "processes/delivery" }),
    textTurn("Build is the second phase."),
  ]);
  const { events, emit } = collect();
  await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "where is build?" }], lang: "en" }, emit);
  const named = events.filter(([e]) => e === "names").flatMap(([, d]) => d.names.map((n) => n.id));
  assert.ok(events.some(([e, d]) => e === "cite" && d.id === "processes/delivery/phases/build"));
  assert.ok(!named.includes("processes/delivery/phases/build"));
  assert.ok(named.includes("processes/delivery/phases/specify"));
});

test("diagramOf takes a whole diagram answer and nothing else", () => {
  const nodes = [{ node: "n0", id: "a", title: "A", type: "phase" }];
  const data = { shape: "process", title: "D", mermaid: "flowchart LR", nodes, edges: 0, omitted: 0, model: {} };
  assert.deepEqual(diagramOf("diagram", { isError: false, data }), { shape: "process", title: "D", mermaid: "flowchart LR", nodes, omitted: 0 });
  assert.equal(diagramOf("search", { isError: false, data }), null);
  assert.equal(diagramOf("diagram", { isError: true, data: { error: { code: "cannot_draw" } } }), null);
  assert.equal(diagramOf("diagram", { isError: false, data: { shape: "process", mermaid: "flowchart LR" } }), null);
  assert.equal(diagramOf("diagram", { isError: false, data: null }), null);
});

test("diagramNote says what was drawn, by title, and holds no source", () => {
  const note = JSON.parse(diagramNote({ shape: "concepts", title: null, mermaid: "classDiagram", nodes: [{ node: "n0", id: "a", title: "Claim", type: "concept" }], edges: 3, omitted: 1 }));
  assert.deepEqual([note.shape, note.title, note.nodes, note.edges, note.omitted], ["concepts", null, ["Claim"], 3, 1]);
  assert.equal("mermaid" in note, false);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/loop.test.mjs`

Expected: FAIL, `diagramOf` is not exported.

- [ ] **Step 3: Implement**

In `lib/loop.mjs`, `NAME_KEYS` gains `"nodes"` at its end:

```js
const NAME_KEYS = ["results", "entities", "references", "rows", "evidence", "items", "edges", "nodes"];
```

Add after `foundNothing`:

```js
// A picture the host drew is the widget's to draw, not the model's to write: the source goes out
// as its own event, and the model reads only what the picture holds, by title, so it can say what
// the picture shows in names the widget links and cannot restate the picture. An answer without
// both a source and its nodes is no picture, and the model reads it as any tool's answer.
export function diagramOf(name, r) {
  const d = r && !r.isError ? r.data : null;
  if (name !== "diagram" || !d || typeof d.mermaid !== "string" || !Array.isArray(d.nodes)) return null;
  return { shape: d.shape, title: d.title ?? null, mermaid: d.mermaid, nodes: d.nodes, omitted: d.omitted ?? 0 };
}

export const diagramNote = (d) => JSON.stringify({
  drawn: "The widget draws this diagram under your answer. Write a sentence or two about what it shows, naming its entities by their titles, and never the diagram itself.",
  shape: d.shape, title: d.title ?? null, nodes: d.nodes.map((n) => n.title), edges: d.edges ?? 0, omitted: d.omitted ?? 0,
});
```

In `answer`, replace the two lines

```js
        if (names.length) emit("names", { names });
        results.push({ type: "tool_result", tool_use_id: call.id, content: truncate(r.text), is_error: r.isError });
```

with

```js
        if (names.length) emit("names", { names });
        const picture = diagramOf(call.name, r);
        if (picture) emit("diagram", picture);
        results.push({ type: "tool_result", tool_use_id: call.id, content: picture ? diagramNote(r.data) : truncate(r.text), is_error: r.isError });
```

In the header comment of `lib/loop.mjs`, after the sentence ending `…where the answer writes them.`, add: `A diagram the host drew is a \`diagram\` event, and the model reads only what it holds.`

- [ ] **Step 4: Name the event where a client reads the events**

In `docs/INTERFACE.md`, the events table gains after the `names` row:

```markdown
| `diagram` | `{ shape, title, mermaid, nodes: [{ node, id, title, type }], omitted }` | the host's `diagram` tool answered: Mermaid source the host built from the model's edges, for the widget to draw under the answer, each node named in `nodes` by the entity it is so the widget links it; the model reads what was drawn and never the source, and a message with two draws the last |
```

In `lib/page.mjs`, `EVENTS` becomes:

```js
const EVENTS = [
  ["text", "a piece of the answer, as it is generated, in order"],
  ["cite", "a tool answered with one entity; the widget links it, and an entity fetched again in a later round is not cited twice"],
  ["names", "every entity a list answer named; the widget links these names where the text writes them"],
  ["diagram", "a picture the host drew from the model's edges; the widget draws it under the answer and links each node"],
  ["done", "the last event: the host's provenance, what the message cost in the meter's unit, and what is left of today's share"],
  ["error", "the last event when something arrives after the stream began: host_down, busy or internal"],
];
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test test/loop.test.mjs`, then `npm test`

Expected: PASS, both.

- [ ] **Step 6: Commit**

```bash
sh conventions/conventions-check && sh conventions/conventions-format check
git add lib/loop.mjs lib/page.mjs docs/INTERFACE.md test/loop.test.mjs
git commit -F - <<'EOF'
A picture the host draws reaches the widget as its own event

A diagram the host builds is only trustworthy if nothing rewrites it on the way, and a model asked to copy Mermaid into its answer could draw an edge no tool returned and would spend its output on it. The loop sends the host's source to the widget as a diagram event, names its nodes so the widget links them where the answer writes them, and gives the model only what the picture holds, by title, so the answer says what the picture shows and cannot restate it.

The interface document and the landing page name the event, and the page now names the names event too, which it never listed.

Verified: node --test test/loop.test.mjs and npm test pass; conventions-check and conventions-format check pass.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

---

### Task 3: The model is told when to ask for a picture

**Files:**

- Modify: `lib/prompt.mjs` (`DIAGRAM_RULE`, `systemPrompt`)
- Modify: `lib/loop.mjs` (pass whether the host lists the tool)
- Test: `test/prompt.test.mjs`, `test/loop.test.mjs`

**Interfaces:**

- Consumes: `host.tools` (`[{ name, description, input_schema }]`).
- Produces: `DIAGRAM_RULE`; `systemPrompt(instructions, lang, types, questions, questionCap, questionsMore, hasDiagram = false)`.

- [ ] **Step 1: Write the failing tests**

In `test/prompt.test.mjs`, extend the import with `DIAGRAM_RULE` and `DEFAULT_QUESTION_INDEX_CHARS`, and append:

```js
test("the picture sentence follows the Markdown rule where the host draws, and is absent where it does not", () => {
  const md = RULES.find((r) => r.startsWith("Write Markdown of this subset"));
  const without = systemPrompt("I.", "en", []);
  assert.ok(!without.includes(DIAGRAM_RULE));
  assert.ok(without.includes(md));
  const withIt = systemPrompt("I.", "en", [], [], DEFAULT_QUESTION_INDEX_CHARS, false, true);
  assert.ok(withIt.includes(`${md} ${DIAGRAM_RULE}`));
  assert.match(DIAGRAM_RULE, /\bdiagram\b/);
  assert.match(DIAGRAM_RULE, /never the picture itself/);
});
```

In `test/loop.test.mjs`, in the first test of Task 2 (`a diagram answer is the widget's to draw…`), add after the `answer` call, and extend the prompt import with `DIAGRAM_RULE`:

```js
  assert.ok(model.requests[0].system[0].text.includes(DIAGRAM_RULE), "the host draws, so the model is told when to ask");
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test test/prompt.test.mjs test/loop.test.mjs`

Expected: FAIL, `DIAGRAM_RULE` is undefined.

- [ ] **Step 3: Implement**

In `lib/prompt.mjs`, after `KIND_RULE`:

```js
// Sent only where the host serves `diagram`, right after the Markdown rule it is an exception to:
// a deployment on a server without the tool reads exactly as before, and is never told to call a
// tool it does not have. The picture is the widget's; the model writing one, in a code span or a
// list of arrows, would be an edge no tool returned, so the sentence forbids every form of it.
export const DIAGRAM_RULE = "A visitor who asks to see how the concepts relate, how a process runs, or how something connects is shown a picture: call diagram, with shape concepts, process or neighborhood, and write a sentence or two about what it shows, naming what it drew by title, with no table of it, and never the picture itself, in Mermaid or any other form, because the widget draws it under the answer. Where diagram refuses, answer in words and a table as you would without it.";
```

`systemPrompt` gains a last parameter and splices the sentence:

```js
export function systemPrompt(instructions, lang, types = [], questions = [], questionCap = DEFAULT_QUESTION_INDEX_CHARS, questionsMore = false, hasDiagram = false) {
```

and, replacing its `const rules = …` line and the `return` after it:

```js
  const withQuestions = questionsLine ? [...RULES.slice(0, searchRuleAt + 1), QUESTION_RULE, ...kinds, ...RULES.slice(searchRuleAt + 1)] : RULES;
  const markdownAt = withQuestions.findIndex((r) => r.startsWith("Write Markdown of this subset"));
  const rules = hasDiagram ? [...withQuestions.slice(0, markdownAt + 1), DIAGRAM_RULE, ...withQuestions.slice(markdownAt + 1)] : withQuestions;
  return [instructions, typeMap(types), questionsLine, rules.join(" "), language].filter(Boolean).join("\n\n");
```

In `lib/loop.mjs`, the `systemPrompt` call in `answer` becomes:

```js
  const system = systemPrompt(host.instructions, lang, await host.types(), questions.titles, questionCap, questions.more, host.tools.some((t) => t.name === "diagram"));
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test test/prompt.test.mjs test/loop.test.mjs`, then `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
sh conventions/conventions-check && sh conventions/conventions-format check
git add lib/prompt.mjs lib/loop.mjs test/prompt.test.mjs test/loop.test.mjs
git commit -F - <<'EOF'
The model asks for a picture when a visitor asks to see one

A visitor who asked to paint the concepts was told the chat cannot draw. Where the host serves the diagram tool, one sentence after the Markdown rule tells the model to call it when a visitor asks how concepts relate, how a process runs or how something connects, and to write a sentence or two about what it shows and never the picture itself. A deployment whose host does not serve the tool reads the prompt exactly as before.

Verified: node --test test/prompt.test.mjs test/loop.test.mjs and npm test pass; conventions-check and conventions-format check pass.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

---

### Task 4: Measured on the laptop against the owner's model, then the pull request

The live hosts do not serve `diagram` until they are re-pinned, so the measurement serves the owner's model locally with the new server, and runs the chat before and after this branch against it.

**Files:** none committed.

- [ ] **Step 1: A local host of the owner's model with the new server**

```bash
export PATH=/opt/homebrew/bin:$PATH
SCRATCH=$(mktemp -d)
COMMIT=$(node -p 'require(process.env.HOME + "/git/robertblust/mcp-blust-ch/source.json").commit')
cd "$SCRATCH" && npm init -y >/dev/null && npm install "companygraph-mcp-server@github:companygraph/mcp-server#<SERVER_TAG>"
npx companygraph-mcp-snapshot --github "robertblust/mental-model@$COMMIT" --out snap.json
PORT=8931 npx companygraph-mcp-http --snapshot snap.json &
echo $! > host.pid
```

Expected: the host answers `curl -s localhost:8931/health`. Read `host.pid`; every server started here is stopped by its PID and never by a pattern.

- [ ] **Step 2: The control and the change**

The control is `main` at the last tag, the change this branch. Each runs on its own port against the host of Step 1:

```bash
git -C ~/git/companygraph/chat-server worktree add --detach "$SCRATCH/control" "$(git -C ~/git/companygraph/chat-server describe --tags --abbrev=0 origin/main)"
(cd "$SCRATCH/control" && npm ci >/dev/null)
for side in control change; do
  dir=$([ $side = control ] && echo "$SCRATCH/control" || echo ~/git/companygraph/chat-server-an-answer-can-show-a-diagram)
  port=$([ $side = control ] && echo 8941 || echo 8942)
  (cd "$dir" && set -a && . ~/.config/chat-local.env && set +a && \
    CHAT_METER=memory CHAT_MCP_URL=http://127.0.0.1:8931/mcp CHAT_MONTH_TOKENS=5000000 CHAT_PROJECT=local CHAT_REGION=local \
    CHAT_ORIGINS=http://localhost PORT=$port node bin/http.mjs & echo $! > "$SCRATCH/$side.pid")
done
```

Never print the key; the environment file is read by the shell and nothing else.

- [ ] **Step 3: Ask the three questions of each**

Write `$SCRATCH/ask.mjs`:

```js
const [port, question] = process.argv.slice(2);
const r = await fetch(`http://127.0.0.1:${port}/chat`, { method: "POST", headers: { "content-type": "application/json", "X-Chat": "1", origin: "http://localhost" }, body: JSON.stringify({ messages: [{ role: "user", content: question }], lang: "en" }) });
const text = await r.text();
const events = text.split("\n\n").filter(Boolean).map((b) => ({ name: /^event: (.+)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "null") }));
const answer = events.filter((e) => e.name === "text").map((e) => e.data.text).join("");
const picture = events.find((e) => e.name === "diagram")?.data;
console.log(JSON.stringify({ question, diagram: picture ? { shape: picture.shape, title: picture.title, nodes: picture.nodes.length, omitted: picture.omitted } : null, mermaidInText: /```|-->|classDiagram|flowchart/.test(answer), answer }, null, 2));
```

Then, for each port 8941 and 8942:

```bash
for q in "paint me a diagram of the concepts" "show me the Delivery process" "how does Claim connect?"; do node "$SCRATCH/ask.mjs" <port> "$q"; done
```

Expected for the change: each answer has a `diagram` (`concepts`, `process` with title `Delivery`, `neighborhood` with title `Claim`), `mermaidInText` false, and a short answer that names what was drawn. The control, which also sees the tool but not the sentence, is the comparison. Read the six answers; they are read, not scored. Copy the six JSON blocks into the pull request body's measurement paragraph in prose, one sentence each.

- [ ] **Step 4: Stop the servers by PID and remove the control worktree**

```bash
for f in host control change; do kill "$(cat "$SCRATCH/$f.pid")"; done
git -C ~/git/companygraph/chat-server worktree remove "$SCRATCH/control"
```

- [ ] **Step 5: Push and open the pull request**

```bash
git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push -u origin an-answer-can-show-a-diagram
gh pr list --repo companygraph/chat-server --state merged --limit 2 --json number
```

Read both bodies with `gh pr view <n> --repo companygraph/chat-server --json body` and write this one in their register: prose, no headings, no bullets, no checkboxes. The body says the gap (the chat said it cannot paint), what changed (the event, the note the model reads, the conditional sentence, the test host re-pinned), the measurement of Task 4 in prose with the host commit it served, what it costs downstream (a minor release; each chat deployment re-pinned in its three places after its MCP host serves the tool; the widget ignores the event until design ships its half), a line `Release notes to write at tagging: …`, `Verified:` naming what ran, and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line.

```bash
gh pr create --repo companygraph/chat-server --base main --head an-answer-can-show-a-diagram --title "An answer can show a diagram" --body-file <file>
```

- [ ] **Step 6: Stop**

Report the pull request's URL, the test count and the six measured answers in one line each. Do not merge, tag or re-pin.
