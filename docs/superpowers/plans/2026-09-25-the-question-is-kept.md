# The question is kept implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The route writes one JSON line per question to standard output, with the words, the language, the ids cited, the calls made, how many found nothing, the rounds run and the code when the model was never asked; the chat module routes those lines into a log bucket of their own with ninety days' retention behind one view, makes the account `chat-analyst` that may read that view and a private reports bucket and nothing else, and the package gains a `report` command and a reusable workflow that write the week's report into that bucket under the analyst.

**Architecture:** `answer()` in `lib/loop.mjs` counts as it goes and returns its signals, on the error it throws as well as on the value it resolves to. `lib/http.mjs` composes the line from the body and the signals and hands it to a `log` function the server is given, `console.log` by default, a captured array in the tests; the widget never receives it. `lib/report.mjs` is pure: a week's name, the boolean, the Markdown, the paging over an injected request; `deploy/build/report.mjs` is the glue that reads a deployment's values and talks to the Logging and Storage APIs with the auth library. `deploy/terraform/questions.tf` holds every new resource. Documents and the version move last.

**Tech Stack:** Node 22+, `node:test`, the MCP server package as the fixture host, `google-auth-library` for the two Google APIs over REST, Terraform 1.9+ with the google provider `~> 8.0`. No client library for Logging or Storage is added.

**Spec:** `docs/superpowers/specs/2026-09-25-the-question-is-kept-design.md` (this branch). Read it before any task.

## Global constraints

- **One repository, one branch.** The worktree exists: `~/git/companygraph/chat-server-the-question-is-kept`, branch `the-question-is-kept`, carrying the spec and this plan. The clone at `~/git/companygraph/chat-server` stays on `main` and is never edited. The three deployment repositories, the three sites and `companygraph/mcp-server` are not touched by this plan; what they will need is written into the README and the pull request body.
- **`export PATH=/opt/homebrew/bin:$PATH`** before any `node`, `npm`, `npx`, `gh`, `terraform` or `sh conventions/…` command. A push names the helper: `git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push`.
- **Every command's exit code is read on its own**, never through a pipe into `tail` or `head`.
- **A single test file runs as** `node --test test/<name>.test.mjs`; the whole suite as `npm test`, which fetches the fixture first. `sh conventions/conventions-check` and `sh conventions/conventions-format` exit 0 before every commit. Terraform is checked as CI checks it: `terraform -chdir=deploy/terraform init -backend=false -input=false`, `terraform -chdir=deploy/terraform validate`, `terraform fmt -check -recursive deploy`.
- **The spec decides, and this plan does not reopen:** the line's fields are `kind`, `question`, `lang`, `cited`, `calls`, `empty`, `rounds`, `refused` and no other; `foreign`, `bad_request` and `too_long` write nothing; the line is written after the stream ends or the refusal is sent; the boolean is derived when read, never written; the bucket is `chat-questions` at ninety days in the deployment's region, the view is `questions`, the account is `chat-analyst`, the reports bucket is `chat-reports-<project>` at ninety days; the owner's token-creator grant is a `gcloud` step and never Terraform; no MCP server in front of the reads.
- **The version moves in this branch** to `0.12.0`, the next minor after `main`'s `0.11.0`. Additive on the interface: no route, event or code moves, and the release notes say in one line that nothing breaks.
- **`lib/` and `bin/` name no instance and no entity**; `test/portability.test.mjs` holds them to the worked example.
- **No address, no header and no word of the answer** reaches the line, and no question reaches standard output of the report. A test holds each.
- **Commit messages** in the git register of `conventions/WRITING.md`: a sentence subject under seventy characters with no prefix and no trailing period, one to three prose paragraphs with no headers, no bullets and no plan task numbers, a `Verified:` line naming what ran, then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The pull request body the same, ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **A finding against a committed task is a new commit**, never an amend of a commit a reviewer has read.
- **Nothing is merged, tagged, deployed or deleted by an agent.** The last task pushes, opens the pull request and stops.
- **No count or version of something that still moves** in any prose or comment.
- **Comments in code say why**, in the register the surrounding files use: a short paragraph above the thing, present tense, no history.

### Rulings the plan makes where the spec is silent

1. **A call "found nothing"** when the host refused it (`r.isError`), or its data carries `error`, or its data is a list answer, one with no `entity`, no `skill` and no `id` at the top, whose top-level `results`, `entities`, `references` or `evidence` is an empty array. An entity with no references is that entity, not nothing, so a list inside an entity never counts. `list_types` and the `describe_*` tools answer neither an entity nor one of those lists and never count as empty.
2. **`rounds` counts calls of `model.turn`**, including the one asked again after a silence. `calls` counts tool calls the loop sent to the host. `cited` is the ids in the order the loop first cited them, which is the `cited` Set's insertion order.
3. **The signals ride on the error as `err.signals`**, an object of the four fields, set by `answer()` in a `catch` that rethrows; an error thrown before `answer()` ran, the bucket's `busy`, carries none, and the route writes four zeros for it. An aborted answer resolves, as it does today, and the four fields come back with `spent`.
4. **`question` is `body.messages.at(-1).content` as sent**, when `messages` is an array and that content is a string, and otherwise `null`; a `null` question is never written, and the codes that would follow from it are `bad_request` or `too_long`, which write nothing anyway. `lang` is `body.lang` when a string and otherwise `null`; a `null` lang is written, since a client that is not the widget may send none and its question is still a question.
5. **`log` is a property of the first argument of `createHttpServer`**, beside `config`, `host`, `model`, `meter` and `bucket`, defaulting to `console.log`, so `bin/http.mjs` changes nothing and Cloud Run reads the line from standard output as a structured entry.
6. **`google-auth-library` becomes a direct dependency at the range the tree already resolves**, `^9.15.1`. The spec says no further dependency and means no further package: the library is installed today through the Firestore client, and a package that imports what it does not declare is a bug. `npm install google-auth-library@^9.15.1` writes it into the lockfile without moving anything else; the diff of `package-lock.json` is read to confirm that.
7. **The report covers `now` minus seven days to `now`** and is named for the ISO week of the day before `now`, so a run on Monday morning names the week that ended on Sunday. The report is written even when the week held no question.
8. **The report's entries are read through the Logging API's `entries:list`** with `resourceNames` naming the view, `orderBy: "timestamp asc"`, `pageSize: 1000` and `pageToken` followed until absent; the paging is a pure function over an injected `request` in `lib/report.mjs`, so a test drives it. The file is written with the Storage JSON API's media upload, `POST https://storage.googleapis.com/upload/storage/v1/b/<bucket>/o?uploadType=media&name=reports/<week>.md`.
9. **The reusable workflow is `.github/workflows/report.yml`** with `on: workflow_call`, beside `deployment.yml`; a deployment calls it from its own `report.yml` on a schedule, and the pin test in `deploy/test/pin.mjs` already reads every workflow in `.github/workflows/` that names `companygraph/chat-server@`, so the fourth place is held to the release without a change there.
10. **The Terraform is one new file, `deploy/terraform/questions.tf`**, and two services join the module's list, `logging.googleapis.com` and `storage.googleapis.com`. The sink names the service by `google_cloud_run_v2_service.chat.name`, never the string; the exclusion carries the identical filter, so an entry goes to the bucket or to `_Default` and never to both. The view carries no filter of its own, since the bucket holds nothing but questions and the view exists so a grant can name it. The `viewAccessor` grant is on the project with a condition `resource.name == "<the view's full name>"`, which is how Google documents a grant on one view.
11. **The module outputs `analyst_email`, `questions_view` and `reports_bucket`**, so a deployment's root can print what its owner's step and its reads need.
12. **The README's owner's steps become five**, the fifth the token-creator grant, and the deployment section names the two bootstrap roles the module now needs and the `report.yml` a deployment adds. The bootstrap change itself is `companygraph/mcp-server`'s, out of this plan; the pull request body names it as the first thing that has to land.

## Review focus

The five inputs the spec implies and no section's tests name, each pinned to a task below:

1. A question holding a newline, a quote and a backslash is still one line that parses back to the same string, since Cloud Run reads one line as one entry. (Task 2)
2. A body with no `lang` is still kept, with `lang: null`, since a client that is not the widget sends none. (Task 2)
3. A question holding `|` or a newline in the report's table does not break the row. (Task 3)
4. A week with no question still writes a report that says so. (Task 3)
5. A view answering more entries than one page holds is read to the end, following `nextPageToken`. (Task 3)

---

### Task 0: A working tree that passes

**Files:** none changed but the spec, already committed, and this plan.

- [ ] **Step 1: Install and fetch the fixture**

```sh
export PATH=/opt/homebrew/bin:$PATH
cd ~/git/companygraph/chat-server-the-question-is-kept
git config user.email
npm ci
```

Expected: the address is `robert.blust@flatland.ch`; `npm ci` exits 0.

- [ ] **Step 2: Run the suite as the baseline**

Run: `npm test; echo "exit $?"`

Expected: `exit 0`, none skipped. A failure that remains is reported before any task starts; it is not worked around.

- [ ] **Step 3: Commit this plan and the spec's added sentence**

```sh
sh conventions/conventions-format; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
git add docs/superpowers/specs/2026-09-25-the-question-is-kept-design.md docs/superpowers/plans/2026-09-25-the-question-is-kept.md
git commit
```

Message subject: `The plan for the kept question`. Body: one paragraph saying the plan builds the spec task by task, test first, the server package's half only, and that the spec's order now names the bootstrap roles the module needs first; a `Verified:` line naming the two conventions scripts and the baseline suite; the trailer.

---

### Task 1: The loop returns its signals

**Files:**

- Modify: `lib/loop.mjs`
- Test: `test/loop.test.mjs`

**Interfaces:**

- Produces: `answer(...)` resolves to `{ spent, cited, calls, empty, rounds }`, where `cited` is an array of entity ids in the order first cited, and `calls`, `empty`, `rounds` are integers; an error `answer()` throws carries `err.signals`, an object of the same four fields. `foundNothing(r)` is exported: `r` a host call's result `{ isError, data, text }`, the answer `true` by ruling 1.

- [ ] **Step 1: Write the failing tests**

Append to `test/loop.test.mjs`:

```js
// What the route keeps of a question is what the loop saw: the ids it cited, the calls it made
// and how many of them found nothing, the rounds it ran. They come back with the answer, and
// they come back on the error, since a refusal between two rounds is also a question asked.
test("the answer carries its signals: the ids cited, the calls, the empty ones, the rounds", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const model = fakeModel([
    toolTurn("search", { query: EXAMPLE_ROOT, match: "name" }),
    toolTurn("get_entity", { id: rootId }),
    textTurn("It is the company."),
  ]);
  const { emit } = collect();
  const r = await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "what is it?" }], lang: "en" }, emit);
  assert.deepEqual(r.cited, [rootId]);
  assert.equal(r.calls, 2);
  assert.equal(r.empty, 0);
  assert.equal(r.rounds, 3);
});

test("a search that finds nothing is counted as empty, and an answer that cites nothing has an empty list", async () => {
  const model = fakeModel([
    toolTurn("search", { query: "xqzv wvkq", match: "words" }),
    textTurn("The model does not say."),
  ]);
  const { emit } = collect();
  const r = await answer({ host, model, meter: meter() }, { messages: [{ role: "user", content: "who is xqzv?" }], lang: "en" }, emit);
  assert.deepEqual(r.cited, []);
  assert.equal(r.calls, 1);
  assert.equal(r.empty, 1);
  assert.equal(r.rounds, 2);
});

test("a refusal thrown before the first call carries four zeros as its signals", async () => {
  const model = fakeModel([textTurn("never reached")]);
  const { emit } = collect();
  const m = new Meter(new MemoryStore(), { monthTokens: 100 });
  await assert.rejects(
    answer({ host, model, meter: m }, { messages: [{ role: "user", content: "hi" }], lang: "en" }, emit),
    (err) => { assert.equal(err.code, "over_month"); assert.deepEqual(err.signals, { cited: [], calls: 0, empty: 0, rounds: 0 }); return true; },
  );
});

test("foundNothing: a refused call, an error answer and an empty list are nothing; an entity and a list with rows are not", () => {
  assert.equal(foundNothing({ isError: true, data: null }), true);
  assert.equal(foundNothing({ isError: false, data: { error: { code: "not_found" } } }), true);
  assert.equal(foundNothing({ isError: false, data: { results: [] } }), true);
  assert.equal(foundNothing({ isError: false, data: { entities: [], page: { hasMore: false } } }), true);
  assert.equal(foundNothing({ isError: false, data: { results: [{ id: "x", title: "X" }] } }), false);
  assert.equal(foundNothing({ isError: false, data: { entity: { id: "x", title: "X", references: [] } } }), false, "an entity with no references is the entity");
  assert.equal(foundNothing({ isError: false, data: { types: [] } }), false, "a schema answer is neither an entity nor a list of them");
});
```

Add `foundNothing` to the import from `../lib/loop.mjs` at the top of the file.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/loop.test.mjs; echo "exit $?"`

Expected: exit 1; the first new test fails on `r.cited` being `undefined`, and the last on `foundNothing` not exported.

- [ ] **Step 3: Count as the loop goes**

In `lib/loop.mjs`, after `namesIn` and before `namesPastTheCap`, add:

```js
// A call that found nothing: the host refused it, its answer is an error, or it is a list with
// no rows. An entity with no references is that entity and not nothing, so only a list at the
// top counts, never one inside an entity; a schema or a type list is neither and never counts.
const LIST_KEYS = ["results", "entities", "references", "evidence"];
export function foundNothing(r) {
  if (r.isError || !r.data || typeof r.data !== "object" || r.data.error) return true;
  if (r.data.entity || r.data.skill || typeof r.data.id === "string") return false;
  return LIST_KEYS.some((k) => Array.isArray(r.data[k]) && r.data[k].length === 0);
}
```

In `answer()`, after `let askedAgain = false;` add:

```js
  // What the route keeps of this question, counted as the loop goes and handed back on the
  // answer and on the error alike; the widget's events never carry them.
  let callCount = 0, empty = 0, rounds = 0;
  const signals = () => ({ cited: [...cited], calls: callCount, empty, rounds });
```

After `last = msg;` add `rounds++;`. Inside `for (const call of calls) {`, right after `const r = await host.call(call.name, call.input);`, add `callCount++; if (foundNothing(r)) empty++;`. Between the `try {` block's closing and `finally`, add a catch that rethrows:

```js
  } catch (err) {
    err.signals = signals();
    throw err;
  } finally {
```

Change the two returns: `if (signal?.aborted) return { spent, ...signals() };` and, at the end, `return { spent, ...signals() };`.

- [ ] **Step 4: Run the file, then the suite**

Run: `node --test test/loop.test.mjs; echo "exit $?"` then `npm test; echo "exit $?"`

Expected: both `exit 0`.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format; echo "exit $?"
git add lib/loop.mjs test/loop.test.mjs
git commit
```

Subject: `The loop hands back what it saw of a question`. Body: one paragraph on the four signals, where they are counted, that they ride on the error as well, and what "found nothing" means and does not mean; `Verified:` naming the loop file and the suite; the trailer.

---

### Task 2: The route writes the line

**Files:**

- Modify: `lib/http.mjs`
- Test: `test/http.test.mjs`

**Interfaces:**

- Consumes: `answer()`'s resolved signals and `err.signals` from Task 1.
- Produces: `createHttpServer({ config, host, model, meter, bucket, log = console.log }, opts)`; `log` is called with one string, a JSON object whose keys are exactly `kind`, `question`, `lang`, `cited`, `calls`, `empty`, `rounds`, `refused`, once per kept question.

- [ ] **Step 1: Write the failing tests**

In `test/http.test.mjs`, change `listen` to take and pass a `log`:

```js
async function listen({ model = scripted("hello"), cfg = config(), meter = new Meter(new MemoryStore(), { monthTokens: cfg.monthTokens }), bucket = new Bucket(), log = () => {}, opts = {} } = {}) {
  const server = createHttpServer({ config: cfg, host, model, meter, bucket, log }, opts);
```

Add `EXAMPLE_ROOT` to the import from `./helpers.mjs`. Append:

```js
// The line the log keeps of a question: the words, the language, and what the loop saw. It is
// written once the visitor has their answer or their refusal, never for a body that carried no
// question the shape accepts, and it carries no address and no word of the answer.
const KEYS = ["kind", "question", "lang", "cited", "calls", "empty", "rounds", "refused"];
const lines = () => { const out = []; return { out, log: (s) => out.push(s) }; };
const tools = (...turns) => ({ name: "fake", async turn(req, onText) { const t = turns.shift(); for (const c of t.content) if (c.type === "text") onText(c.text); return t; } });
const toolTurn = (name, input) => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop_reason: "tool_use", usage });
const textTurn = (text) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });

test("an answered question is kept as one line with the words, the language and the loop's signals", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const { out, log } = lines();
  const base = await listen({ model: tools(toolTurn("get_entity", { id: rootId }), textTurn("It is the company.")), log });
  const r = await post(base, { messages: [{ role: "user", content: "What is it?" }], lang: "de" }, { "x-forwarded-for": "203.0.113.77, 35.0.0.1" });
  await r.text();
  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]);
  assert.deepEqual(Object.keys(line), KEYS);
  assert.deepEqual(line, { kind: "question", question: "What is it?", lang: "de", cited: [rootId], calls: 1, empty: 0, rounds: 2, refused: null });
  assert.ok(!out[0].includes("203.0.113.77"), "no address in the line");
  assert.ok(!out[0].includes("It is the company"), "no word of the answer in the line");
});

test("a question the model could not find is kept with an empty cited list and the empty count", async () => {
  const { out, log } = lines();
  const base = await listen({ model: tools(toolTurn("search", { query: "xqzv wvkq", match: "words" }), textTurn("The model does not say.")), log });
  await (await post(base, { messages: [{ role: "user", content: "who is xqzv?" }], lang: "en" })).text();
  const line = JSON.parse(out[0]);
  assert.deepEqual(line.cited, []);
  assert.equal(line.calls, 1);
  assert.equal(line.empty, 1);
  assert.equal(line.refused, null);
});

test("a refusal after the question was read is kept with its code, and one before it is not", async () => {
  const { out, log } = lines();
  const meter = new Meter(new MemoryStore(), { monthTokens: 100 });
  const base = await listen({ cfg: config({ monthTokens: 100 }), meter, log });
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" })).status, 429);
  assert.deepEqual(JSON.parse(out[0]), { kind: "question", question: "hi", lang: "en", cited: [], calls: 0, empty: 0, rounds: 0, refused: "over_month" });
  await meter.store.transact((d) => ({ ...d, closed: true }));
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" })).status, 503);
  assert.equal(JSON.parse(out[1]).refused, "closed");
  const foreign = await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, { origin: "https://other.test" });
  assert.equal(foreign.status, 403);
  const bad = await post(base, "null");
  assert.equal(bad.status, 400);
  const long = await post(base, { messages: [{ role: "user", content: "x".repeat(1001) }], lang: "en" });
  assert.equal((await long.json()).error.code, "too_long");
  assert.equal(out.length, 2, "a foreign page, a bad body and a message over the cap write nothing");
});

test("the twenty-first message is kept as busy", async () => {
  const { out, log } = lines();
  const base = await listen({ log });
  const headers = { "x-forwarded-for": "203.0.113.9, 35.0.0.1" };
  for (let i = 0; i < 20; i++) await (await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, headers)).text();
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, headers)).status, 429);
  assert.equal(out.length, 21);
  assert.equal(JSON.parse(out[20]).refused, "busy");
  assert.ok(out.every((l) => !l.includes("203.0.113.9")), "no address in any line");
});

test("a question with a newline, a quote and a backslash is one line that parses back, and no lang is null", async () => {
  const { out, log } = lines();
  const base = await listen({ log });
  const question = "Was ist \"das\"?\nUnd \\ dann?";
  await (await post(base, { messages: [{ role: "user", content: question }] })).text();
  assert.equal(out.length, 1);
  assert.ok(!out[0].includes("\n"), "one line");
  const line = JSON.parse(out[0]);
  assert.equal(line.question, question);
  assert.equal(line.lang, null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/http.test.mjs; echo "exit $?"`

Expected: exit 1; every new test fails on `out.length` being 0.

- [ ] **Step 3: Compose the line in the route**

In `lib/http.mjs`, replace the header comment's last paragraph, the one beginning `An error that is not a refusal is logged as its name`, with:

```js
// Once the visitor has their answer or their refusal, one line of JSON goes to standard output:
// the question as sent, the language, and what the loop saw, which the deployment routes into a
// bucket of its own under the retention the privacy pages state. Nothing else of the request is
// written: no address, no header, no word of the answer. An error that is not a refusal is
// logged as its name, its status and its code and never as the object, since a provider's error
// carries its own message about the request, which can hold more than the question.
```

Change the signature to `export function createHttpServer({ config, host, model, meter, bucket, log = console.log }, { pageCss = null, pageBrand = null, pageIcon = null } = {}) {`. After `const json = ...` at module level add:

```js
// The codes that follow from no question the shape accepts, or from a page that is not the
// site's, write no line; every other refusal is a question asked and not answered.
const UNKEPT = new Set(["bad_request", "too_long", "foreign"]);
const NO_SIGNALS = { cited: [], calls: 0, empty: 0, rounds: 0 };
```

Inside the request handler, before `try {`, add:

```js
    let question = null, lang = null;
    // The line the log keeps of this question, written once, after the answer or the refusal.
    const keep = (signals, refused) => {
      if (question === null) return;
      const s = signals ?? NO_SIGNALS;
      log(JSON.stringify({ kind: "question", question, lang, cited: s.cited, calls: s.calls, empty: s.empty, rounds: s.rounds, refused }));
    };
```

After the line `if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChatError(...)` add:

```js
      question = Array.isArray(body.messages) && typeof body.messages.at(-1)?.content === "string" ? body.messages.at(-1).content : null;
      lang = typeof body.lang === "string" ? body.lang : null;
```

Change the stream block to:

```js
      try {
        const r = await answer({ host, model, meter, questionCap: config.questionIndexChars }, { messages: body.messages, lang: body.lang, signal: ac.signal }, (event, data) => stream.send(event, data));
        keep(r, null);
      } catch (err) {
        if (!stream.opened) throw err;
        if (err instanceof ChatError) { keep(err.signals, err.code); stream.send("error", refusal(err)); }
        else { logInternal(err); keep(err.signals, "internal"); stream.send("error", { error: { code: "internal", message: "internal error" } }); }
      }
      stream.end();
```

In the outer `catch (err) {`, as its first line, add:

```js
      const code = err instanceof ChatError ? err.code : "internal";
      if (!UNKEPT.has(code)) keep(err.signals, code);
```

- [ ] **Step 4: Run the file, then the suite**

Run: `node --test test/http.test.mjs; echo "exit $?"` then `npm test; echo "exit $?"`

Expected: both `exit 0`. `test/bin-http.test.mjs` still passes: its process logs to standard output by default and its one request is a `GET`, which writes no line.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format; echo "exit $?"
git add lib/http.mjs test/http.test.mjs
git commit
```

Subject: `The route keeps one line of every question`. Body: a paragraph on the line and when it is written, which codes write nothing and why, and the header comment's changed promise; `Verified:` naming the http file and the suite; the trailer.

---

### Task 3: The report, pure

**Files:**

- Create: `lib/report.mjs`
- Test: `test/report.test.mjs`

**Interfaces:**

- Produces: `weekOf(date)` → `"YYYY-Www"` by the ISO week in UTC; `answered(entry)` → boolean, true when `entry.cited` is a non-empty array and `entry.refused` is null or absent; `renderReport(entries, { week, from, to })` → Markdown string; `listEntries(request, view, { from, to })` → array of `{ timestamp, ...jsonPayload }` for entries whose `jsonPayload.kind` is `"question"`, following `nextPageToken`, where `request(body)` is an async function answering the Logging API's response object `{ entries, nextPageToken }`; `runReport({ list, put, now = new Date(), out = console.log })` → `{ week, total, answered }`, calling `list({ from, to })` and `put(name, text)` and printing counts only.

- [ ] **Step 1: Write the failing tests**

Create `test/report.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf, answered, renderReport, listEntries, runReport } from "../lib/report.mjs";

const entry = (over = {}) => ({ timestamp: "2026-09-23T10:00:00Z", kind: "question", question: "What is it?", lang: "en", cited: ["e1"], calls: 1, empty: 0, rounds: 2, refused: null, ...over });

test("weekOf names the ISO week in UTC, across a year's edge", () => {
  assert.equal(weekOf(new Date("2026-09-27T23:59:59Z")), "2026-W39");
  assert.equal(weekOf(new Date("2026-09-28T00:00:00Z")), "2026-W40");
  assert.equal(weekOf(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(weekOf(new Date("2027-01-04T12:00:00Z")), "2027-W01");
});

test("answered is a non-empty cited list and no refusal", () => {
  assert.equal(answered(entry()), true);
  assert.equal(answered(entry({ cited: [] })), false);
  assert.equal(answered(entry({ refused: "over_day" })), false);
  assert.equal(answered(entry({ cited: ["e1"], refused: "host_down" })), false);
});

test("the report counts, splits by language, ranks the cited and lists the unanswered in full", () => {
  const entries = [
    entry(),
    entry({ question: "Was hat er gemacht?", lang: "de", cited: ["e1", "e2"] }),
    entry({ question: "Who is xqzv?", cited: [], empty: 1 }),
    entry({ question: "Ist das Modell offen?", lang: "de", cited: [], calls: 0, rounds: 0, refused: "closed" }),
  ];
  const md = renderReport(entries, { week: "2026-W39", from: new Date("2026-09-21T06:00:00Z"), to: new Date("2026-09-28T06:00:00Z") });
  assert.match(md, /^# Chat questions, week 2026-W39\n/);
  assert.match(md, /4 questions, 2 answered, 2 not\./);
  assert.match(md, /\| en \| 2 \| 1 \|/);
  assert.match(md, /\| de \| 2 \| 1 \|/);
  assert.match(md, /\| e1 \| 2 \|\n\| e2 \| 1 \|/);
  assert.match(md, /\| Who is xqzv\? \| en \| 1 \| 1 \| — \|/);
  assert.match(md, /\| Ist das Modell offen\? \| de \| 0 \| 0 \| closed \|/);
  assert.ok(!md.includes("Was hat er gemacht?"), "an answered question is not listed");
});

test("a question with a pipe or a newline keeps its row whole", () => {
  const md = renderReport([entry({ question: "a | b\nc", cited: [] })], { week: "2026-W39", from: new Date(0), to: new Date(0) });
  assert.match(md, /\| a \\\| b c \| en \| 1 \| 0 \| — \|/);
});

test("a week with no question still writes a report that says so", () => {
  const md = renderReport([], { week: "2026-W39", from: new Date("2026-09-21T06:00:00Z"), to: new Date("2026-09-28T06:00:00Z") });
  assert.match(md, /0 questions, 0 answered, 0 not\./);
  assert.ok(!md.includes("## Not answered"), "no empty table");
});

test("listEntries follows nextPageToken to the end and keeps only question entries", async () => {
  const bodies = [];
  const request = async (body) => {
    bodies.push(body);
    if (!body.pageToken) return { entries: [{ timestamp: "t1", jsonPayload: entry() }, { timestamp: "t2", textPayload: "noise" }], nextPageToken: "p2" };
    return { entries: [{ timestamp: "t3", jsonPayload: entry({ question: "second page" }) }] };
  };
  const from = new Date("2026-09-21T06:00:00Z"), to = new Date("2026-09-28T06:00:00Z");
  const got = await listEntries(request, "projects/p/locations/r/buckets/chat-questions/views/questions", { from, to });
  assert.deepEqual(got.map((e) => e.question), ["What is it?", "second page"]);
  assert.equal(got[0].timestamp, "t1");
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].resourceNames, ["projects/p/locations/r/buckets/chat-questions/views/questions"]);
  assert.equal(bodies[0].filter, `timestamp >= "2026-09-21T06:00:00.000Z" AND timestamp < "2026-09-28T06:00:00.000Z"`);
  assert.equal(bodies[0].orderBy, "timestamp asc");
  assert.equal(bodies[0].pageSize, 1000);
  assert.equal(bodies[1].pageToken, "p2");
});

test("runReport reads seven days back, names the week that ended, writes the file and prints counts only", async () => {
  const calls = { list: [], put: [], out: [] };
  const now = new Date("2026-09-28T06:00:00Z");
  const r = await runReport({
    list: async (range) => { calls.list.push(range); return [entry(), entry({ question: "secret words", cited: [] })]; },
    put: async (name, text) => { calls.put.push({ name, text }); },
    now,
    out: (s) => calls.out.push(s),
  });
  assert.deepEqual(r, { week: "2026-W39", total: 2, answered: 1 });
  assert.deepEqual(calls.list[0], { from: new Date("2026-09-21T06:00:00Z"), to: now });
  assert.equal(calls.put[0].name, "reports/2026-W39.md");
  assert.match(calls.put[0].text, /secret words/);
  assert.equal(calls.out.length, 1);
  assert.match(calls.out[0], /2026-W39: 2 questions, 1 answered/);
  assert.ok(!calls.out.join("").includes("secret words"), "no question on standard output");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/report.test.mjs; echo "exit $?"`

Expected: exit 1; the module does not exist.

- [ ] **Step 3: Write the module**

Create `lib/report.mjs`:

```js
// The week's report of what the chat was asked, pure: the entries in, Markdown out, with the
// Logging API's paging over an injected request so a test drives it. The boolean the owner
// reads, answered or not, is decided here and never by the server that wrote the entry, so
// the rule can change with the entries intact.
const DAY = 86_400_000;

export function weekOf(date) {
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t - jan1) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const answered = (e) => Array.isArray(e.cited) && e.cited.length > 0 && e.refused == null;

// A cell holds one line and no bare pipe, whatever the visitor typed.
const cell = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

export function renderReport(entries, { week, from, to }) {
  const yes = entries.filter(answered);
  const no = entries.filter((e) => !answered(e));
  const byLang = new Map();
  for (const e of entries) {
    const l = e.lang ?? "—";
    const row = byLang.get(l) ?? { total: 0, answered: 0 };
    row.total++;
    if (answered(e)) row.answered++;
    byLang.set(l, row);
  }
  const cited = new Map();
  for (const e of entries) for (const id of e.cited ?? []) cited.set(id, (cited.get(id) ?? 0) + 1);
  const ranked = [...cited].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const lines = [
    `# Chat questions, week ${week}`,
    "",
    `From ${from.toISOString()} to ${to.toISOString()}. ${entries.length} questions, ${yes.length} answered, ${no.length} not.`,
  ];
  if (byLang.size) {
    lines.push("", "## By language", "", "| Language | Questions | Answered |", "| --- | --- | --- |");
    for (const [l, r] of [...byLang].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) lines.push(`| ${cell(l)} | ${r.total} | ${r.answered} |`);
  }
  if (ranked.length) {
    lines.push("", "## Most cited", "", "| Entity | Times |", "| --- | --- |");
    for (const [id, n] of ranked) lines.push(`| ${cell(id)} | ${n} |`);
  }
  if (no.length) {
    lines.push("", "## Not answered", "", "| Question | Language | Calls | Empty | Refused |", "| --- | --- | --- | --- | --- |");
    for (const e of no) lines.push(`| ${cell(e.question)} | ${cell(e.lang ?? "—")} | ${e.calls ?? 0} | ${e.empty ?? 0} | ${cell(e.refused ?? "—")} |`);
  }
  return lines.join("\n") + "\n";
}

export async function listEntries(request, view, { from, to }) {
  const out = [];
  let pageToken;
  do {
    const body = {
      resourceNames: [view],
      filter: `timestamp >= "${from.toISOString()}" AND timestamp < "${to.toISOString()}"`,
      orderBy: "timestamp asc",
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    };
    const data = await request(body);
    for (const e of data.entries ?? []) if (e.jsonPayload?.kind === "question") out.push({ timestamp: e.timestamp, ...e.jsonPayload });
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// Seven days back to now, named for the week of the day before now: a run on Monday morning
// names the week that ended on Sunday. Standard output carries counts and never a question,
// since a run's log in a public repository is public.
export async function runReport({ list, put, now = new Date(), out = console.log }) {
  const to = now;
  const from = new Date(now.getTime() - 7 * DAY);
  const week = weekOf(new Date(now.getTime() - DAY));
  const entries = await list({ from, to });
  const text = renderReport(entries, { week, from, to });
  const name = `reports/${week}.md`;
  await put(name, text);
  const yes = entries.filter(answered).length;
  out(`report ${week}: ${entries.length} questions, ${yes} answered, written to ${name}`);
  return { week, total: entries.length, answered: yes };
}
```

- [ ] **Step 4: Run the file, then the suite**

Run: `node --test test/report.test.mjs; echo "exit $?"` then `npm test; echo "exit $?"`

Expected: both `exit 0`. `test/portability.test.mjs` passes: the module names no instance and no entity.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format; echo "exit $?"
git add lib/report.mjs test/report.test.mjs
git commit
```

Subject: `The week's report, from the entries alone`. Body: a paragraph on what the report holds, that the boolean is decided here, how the week is named, and that the paging is pure over an injected request; `Verified:` naming the report file and the suite; the trailer.

---

### Task 4: The report command and the reusable workflow

**Files:**

- Modify: `bin/deploy.mjs`, `deploy/build/config.mjs`, `package.json`, `package-lock.json`
- Create: `deploy/build/report.mjs`, `.github/workflows/report.yml`
- Test: `test/bin-deploy.test.mjs`

**Interfaces:**

- Consumes: `listEntries` and `runReport` from Task 3.
- Produces: `companygraph-chat-deploy report`, run in a deployment's `chat/`, reading `../deployment.json` for `project` and `region`, reading the view `projects/<project>/locations/<region>/buckets/chat-questions/views/questions` and writing to `gs://chat-reports-<project>/reports/<week>.md`; `deployment()` in `deploy/build/config.mjs`; the workflow `report.yml` on `workflow_call`.

- [ ] **Step 1: Declare the auth library**

```sh
npm install google-auth-library@^9.15.1; echo "exit $?"
git diff --stat package.json package-lock.json
git diff package-lock.json
```

Expected: exit 0; `package.json` gains one line under `dependencies`; the lockfile's diff adds `google-auth-library` under the root package's dependencies and moves no version. A lockfile diff that moves any other package is reverted with `git checkout package-lock.json package.json` and reported before going on.

- [ ] **Step 2: Write the failing test**

Create `test/bin-deploy.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "deploy.mjs");
const run = (args, cwd) => new Promise((resolve) => {
  const child = spawn(process.execPath, [bin, ...args], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  child.on("exit", (code) => resolve({ code, err }));
});

// The command's operator errors are one line and exit 2, as the other commands' are; a report
// asked for outside a deployment's chat/ has no deployment.json to read and says so.
test("report outside a deployment is one line on stderr and exit 2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-report-"));
  const { code, err } = await run(["report"], dir);
  assert.equal(code, 2);
  assert.match(err, /deployment\.json/);
  assert.ok(!err.includes("    at "), "no stack");
});

test("an unknown command names report among the commands", async () => {
  const { code, err } = await run(["nothing"], os.tmpdir());
  assert.equal(code, 2);
  assert.match(err, /usage: companygraph-chat-deploy <page-css\|tag\|serve\|report>/);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test test/bin-deploy.test.mjs; echo "exit $?"`

Expected: exit 1; the usage line has no `report`, and `report` is an unknown command.

- [ ] **Step 4: Write the command**

In `deploy/build/config.mjs`, append:

```js
// The project's values, one directory up: a deployment's chat/ sits beside its deployment.json.
export const deployment = () => JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));
```

Create `deploy/build/report.mjs`:

```js
// The week's report, run in a deployment's chat/ under the analyst's credentials: the view's
// entries of the past seven days, read through the Logging API, one Markdown file into the
// project's reports bucket through the Storage API. The library is the auth alone; each call
// is one request, and the paging and the rendering are the package's own and tested.
import { GoogleAuth } from "google-auth-library";
import { deployment } from "./config.mjs";
import { listEntries, runReport } from "../../lib/report.mjs";

const d = deployment();
const view = `projects/${d.project}/locations/${d.region}/buckets/chat-questions/views/questions`;
const bucket = `chat-reports-${d.project}`;
const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();

const list = (range) => listEntries(async (body) => (await client.request({ url: "https://logging.googleapis.com/v2/entries:list", method: "POST", data: body })).data, view, range);
const put = async (name, text) => {
  await client.request({
    url: `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    method: "POST",
    headers: { "content-type": "text/markdown; charset=utf-8" },
    body: text,
  });
};

await runReport({ list, put, out: (s) => console.log(`${s} in gs://${bucket}`) });
```

In `bin/deploy.mjs`, change the comment's first sentence to end `…\`serve\` starts the server with the page, \`report\` writes the week's questions to the project's reports bucket.`, the usage to `"usage: companygraph-chat-deploy <page-css|tag|serve|report>"`, and add `case "report": await import("../deploy/build/report.mjs"); break;` before `default`.

- [ ] **Step 5: Run the file, then the suite**

Run: `node --test test/bin-deploy.test.mjs; echo "exit $?"` then `npm test; echo "exit $?"`

Expected: both `exit 0`. The first test reaches `deployment()` before any credential is read, since the module reads `deployment.json` at its top, so the message names the file.

- [ ] **Step 6: Write the reusable workflow**

Create `.github/workflows/report.yml`:

```yaml
# The week's report of a deployment's chat questions, called by the release chat/package.json
# pins on the deployment's own schedule. The run acts as the project's chat-analyst through the
# pool the MCP host's bootstrap made, which admits a run on main, and a schedule runs on main.
# The log here carries counts and never a question: a public repository's log is public.
name: report
on:
  workflow_call:
jobs:
  report:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    defaults:
      run:
        working-directory: chat
    steps:
      - uses: actions/checkout@v7
      - run: |
          jq -r '"PROJECT=\(.project)\nPROJECT_NUMBER=\(.project_number)"' ../deployment.json >> "$GITHUB_ENV"
      - run: |
          echo "WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github" >> "$GITHUB_ENV"
      - uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ env.WIF_PROVIDER }}
          service_account: chat-analyst@${{ env.PROJECT }}.iam.gserviceaccount.com
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx companygraph-chat-deploy report
```

Run: `test -f .github/workflows/report.yml; echo "exit $?"`, expected `exit 0`. Then `node -e 'const y=require("node:fs").readFileSync(".github/workflows/report.yml","utf8"); if(!/^on:\n  workflow_call:$/m.test(y)) process.exit(1)'; echo "exit $?"`, expected `exit 0`: the file calls as `deployment.yml` does. The workflow is proven by a deployment's first Monday run and nothing here can run it.

- [ ] **Step 7: Commit**

```sh
sh conventions/conventions-format; echo "exit $?"
git add bin/deploy.mjs deploy/build/config.mjs deploy/build/report.mjs .github/workflows/report.yml package.json package-lock.json test/bin-deploy.test.mjs
git commit
```

Subject: `A report command, and the workflow a deployment schedules`. Body: a paragraph on the command, where it runs, the two APIs it calls with the auth library now declared, and the reusable workflow and the identity it runs as; `Verified:` naming the bin test, the suite and the lockfile diff read; the trailer.

---

### Task 5: The bucket, the view, the analyst and the reports bucket

**Files:**

- Create: `deploy/terraform/questions.tf`
- Modify: `deploy/terraform/main.tf`, `deploy/terraform/outputs.tf`

**Interfaces:**

- Produces: outputs `analyst_email`, `questions_view`, `reports_bucket`.

- [ ] **Step 1: See the module validate as it is**

```sh
terraform -chdir=deploy/terraform init -backend=false -input=false; echo "exit $?"
terraform -chdir=deploy/terraform validate; echo "exit $?"
```

Expected: both `exit 0`, the providers downloaded once.

- [ ] **Step 2: Add the two services**

In `deploy/terraform/main.tf`, add `"logging.googleapis.com",` and `"storage.googleapis.com",` to the `toset([...])` of `google_project_service.chat`, after `"secretmanager.googleapis.com",`.

- [ ] **Step 3: Write the resources**

Create `deploy/terraform/questions.tf`:

```hcl
# What the chat keeps of a question, and who may read it. The route writes one line per question
# to standard output; the sink routes those lines, and only those, into a bucket of their own
# with the retention the privacy pages state, and the exclusion, on the same filter, keeps the
# default bucket from holding a second copy under another retention. The view over the bucket
# exists so that a grant can name it: the bucket holds nothing but questions.
locals {
  questions_filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_v2_service.chat.name}\" AND jsonPayload.kind=\"question\""
  questions_view   = "${google_logging_project_bucket_config.questions.id}/views/${google_logging_log_view.questions.name}"
  main_runs        = "principalSet://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/github/attribute.ref/refs/heads/main"
}

resource "google_logging_project_bucket_config" "questions" {
  project        = var.project
  location       = var.region
  bucket_id      = "chat-questions"
  retention_days = 90
  description    = "One line per question the chat was asked, kept ninety days"
  depends_on     = [google_project_service.chat]
}

resource "google_logging_log_view" "questions" {
  name        = "questions"
  bucket      = google_logging_project_bucket_config.questions.id
  description = "The questions, and nothing else in the project"
}

resource "google_logging_project_sink" "questions" {
  name                   = "chat-questions"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.questions.id}"
  filter                 = local.questions_filter
  unique_writer_identity = true
}

resource "google_logging_project_exclusion" "questions" {
  name        = "chat-questions"
  description = "The questions live in their own bucket, under their own retention"
  filter      = local.questions_filter
}

# The reader: one account holding the view and the reports bucket and nothing else, not the
# request log with its addresses, not the meter, not the service. The repository's runs on main
# act as it for the weekly report, through the pool the bootstrap made; the owner's login is
# granted impersonation by hand, since the login's address belongs in no repository.
resource "google_service_account" "analyst" {
  account_id   = "chat-analyst"
  display_name = "Reader of the chat's questions and reports"
  depends_on   = [google_project_service.chat]
}

resource "google_project_iam_member" "analyst_view" {
  project = var.project
  role    = "roles/logging.viewAccessor"
  member  = "serviceAccount:${google_service_account.analyst.email}"
  condition {
    title      = "the questions view"
    expression = "resource.name == \"${local.questions_view}\""
  }
}

resource "google_service_account_iam_member" "analyst_wif" {
  service_account_id = google_service_account.analyst.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.main_runs
}

# The reports: private, in the region, and gone at ninety days, so a question quoted in a report
# outlives the entry it came from by nothing.
resource "google_storage_bucket" "reports" {
  name                        = "chat-reports-${var.project}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 90
    }
  }
  depends_on = [google_project_service.chat]
}

resource "google_storage_bucket_iam_member" "analyst_reports" {
  bucket = google_storage_bucket.reports.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.analyst.email}"
}
```

Append to `deploy/terraform/outputs.tf`:

```hcl
output "analyst_email" { value = google_service_account.analyst.email }
output "questions_view" { value = local.questions_view }
output "reports_bucket" { value = google_storage_bucket.reports.name }
```

- [ ] **Step 4: Validate and format**

```sh
terraform fmt -recursive deploy; echo "exit $?"
terraform -chdir=deploy/terraform validate; echo "exit $?"
terraform fmt -check -recursive deploy; echo "exit $?"
git status --short deploy
```

Expected: every `exit 0`; `fmt` may rewrite `questions.tf`'s alignment and nothing else. A validation error names an argument the provider does not know; that argument is looked up in the provider's documentation for the resource and corrected, never removed.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format; echo "exit $?"
git add deploy/terraform/main.tf deploy/terraform/questions.tf deploy/terraform/outputs.tf
git commit
```

Subject: `The questions' bucket, its view, and the one account that reads it`. Body: a paragraph on the bucket, sink, exclusion and view and why the exclusion carries the same filter; a paragraph on the analyst, its two grants, the pool binding, and the reports bucket's lifecycle; `Verified:` naming init, validate and fmt; the trailer.

---

### Task 6: The documents and the version

**Files:**

- Modify: `docs/INTERFACE.md`, `README.md`, `package.json`, `package-lock.json`

- [ ] **Step 1: The interface**

In `docs/INTERFACE.md`, after the paragraph ending `and never later.` and before `## The meter's unit`, insert:

```markdown
## What is kept

Once a message has its answer or its refusal, the service writes one line for it, which the deployment keeps for ninety days in a log bucket of the project's own, behind one view that one account may read. The line carries no address, no header and no word of the answer. A message refused as `bad_request`, `too_long` or `foreign` writes no line.

| Field | Holds |
| --- | --- |
| `kind` | `question` |
| `question` | the last `user` turn as it was sent |
| `lang` | the request's `lang`, or null where it sent none |
| `cited` | the ids of the entities the answer cited, in order, empty where it cited none |
| `calls` | how many tool calls the answer made |
| `empty` | how many of those found nothing: refused by the host, an error, or a list with no rows |
| `rounds` | how many requests to the model were made |
| `refused` | null where the model answered, else the code: `busy`, `over_day`, `over_month`, `closed`, `host_down` or `internal` |

Whether a question was answered is not a field: it is read as `cited` being non-empty and `refused` null, so the rule can change with the lines intact.
```

Add to the last section, `## What counts as a break`, after `A field or an event added is not.`: ` A field of the kept line removed, or the line written for a code that wrote none, is a break; a field added is not.`

- [ ] **Step 2: The README**

In `README.md`, line 15's paragraph, after `Every refusal is made before the model is asked and costs nothing.` insert: `Once a message has its answer or its refusal, one line is kept of it, the question as sent and what the loop saw of it, no address and no word of the answer, in a log bucket of the project's own for ninety days, and the interface document names its fields.`

In the deployment paragraph (line 31), after `and a workflow calling \`.github/workflows/deployment.yml\` at the same tag.` insert: ` A deployment also adds \`.github/workflows/report.yml\`, a schedule on Monday morning and a \`workflow_dispatch\`, calling this package's \`report.yml\` at the same tag, which writes the week's questions to the project's private reports bucket as \`chat-analyst\`; the pin test holds that fourth place to the release too.` Change `The module needs the deploy identity to hold \`roles/datastore.owner\` and \`roles/resourcemanager.projectIamAdmin\`, which the MCP host's bootstrap grants from its next release.` to `The module needs the deploy identity to hold \`roles/datastore.owner\`, \`roles/resourcemanager.projectIamAdmin\`, \`roles/logging.configWriter\` and \`roles/storage.admin\`, which the MCP host's bootstrap grants.`

In the owner's paragraph (line 35), change `Four steps are the owner's` to `Five steps are the owner's`, and before the sentence beginning `And the chat is stopped by hand` insert: `The owner's own reading of the questions is granted once per project, with the login's address that belongs in no repository: \`gcloud iam service-accounts add-iam-policy-binding chat-analyst@<project>.iam.gserviceaccount.com --member user:<login> --role roles/iam.serviceAccountTokenCreator --project <project>\`; after \`gcloud auth application-default login\` once on the machine, a read runs as the analyst and as nothing more with \`gcloud logging read '' --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com --bucket chat-questions --location <region> --view questions --project <project> --format json\`, and a report with \`gcloud storage cat gs://chat-reports-<project>/reports/<week>.md --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com\`.`

- [ ] **Step 3: The version**

```sh
npm version 0.12.0 --no-git-tag-version; echo "exit $?"
git diff --stat package.json package-lock.json
```

Expected: exit 0; two files, the version line in each.

- [ ] **Step 4: Check the form and the suite**

```sh
sh conventions/conventions-format; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
npm test; echo "exit $?"
```

Expected: every `exit 0`.

- [ ] **Step 5: Commit**

```sh
git add docs/INTERFACE.md README.md package.json package-lock.json
git commit
```

Subject: `The interface says what is kept, and the release is 0.12.0`. Body: a paragraph on the new section and the two README changes, the fifth owner's step and the bootstrap roles; `Verified:` naming the two conventions scripts and the suite; the trailer.

---

### Task 7: Push and open the pull request

**Files:** none changed.

- [ ] **Step 1: Read the register**

```sh
gh pr list --repo companygraph/chat-server --state merged --limit 2 --json number,title,body
```

The body of the pull request is written in that register: prose paragraphs, no headings, no bullets, ending `Verified: …`, then the generated-with line.

- [ ] **Step 2: Push and open**

```sh
git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push -u origin the-question-is-kept; echo "exit $?"
gh pr create --repo companygraph/chat-server --base main --head the-question-is-kept --title "The question is kept" --body-file -
```

The body, as prose: what the line holds and when it is written; the bucket, the view, the analyst and the reports bucket; the report command and the workflow; the interface's new section; then what has to land before a deployment's plan can pass, in this order — `companygraph/mcp-server`'s bootstrap granting `terraform` the roles `roles/logging.configWriter` and `roles/storage.admin`, released and applied by the owner in the three projects; the three deployments' re-pins each adding `report.yml`; the owner's token-creator grant per project; the three sites' privacy pages, English and German, before the first Monday run — and that nothing here merges, tags or deploys. `Verified:` names the suite, the two conventions scripts, and init, validate and fmt on the module. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Stop**

Report the pull request's URL and the four things outside this repository, in order, and stop. Merging, tagging and re-pinning are the owner's.
