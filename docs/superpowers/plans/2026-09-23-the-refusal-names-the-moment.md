# The refusal names the moment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A refusal whose code is `busy`, `over_day` or `over_month` carries `error.retryAt`, the moment the limit lifts as an ISO 8601 time in UTC, and the response carries `Retry-After` in whole seconds, rounded up and never below one; every other code carries neither.

**Architecture:** `ChatError` gains an optional third argument, `{ retryAt }`, kept as an ISO string, and `refusal()` writes the field when the error has it. Each place that knows a moment hands it in: the bucket's `take` answers a refusal with the moment the oldest hit leaves the window and the route puts it on the error; the meter computes the next midnight UTC or the first of the next month from its own injected clock; the model's rate for the minute names one minute from an injected clock. `lib/http.mjs` writes the header from the field on every JSON refusal. The server's half only: the widget in `robertblust/design` is a spec of its own and is not touched.

**Tech Stack:** Node 22+, `node:test`, the MCP server package as the fixture host. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-09-23-the-refusal-names-the-moment-design.md` (this branch). Read it before any task.

## Global constraints

- **One repository, one branch.** The worktree exists: `~/git/companygraph/chat-server-the-refusal-names-the-moment`, branch `the-refusal-names-the-moment`, carrying the spec and this plan; pull request #15 is open on it. The clone at `~/git/companygraph/chat-server` stays on `main` and is never edited. `robertblust/design` and both deployment repositories are not touched.
- **`export PATH=/opt/homebrew/bin:$PATH`** before any `node`, `npm`, `npx`, `gh` or `sh conventions/…` command. A push names the helper: `git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push`.
- **Every command's exit code is read on its own**, never through a pipe into `tail` or `head`.
- **A single test file runs as** `node --test test/<name>.test.mjs`; the whole suite as `npm test`, which fetches the fixture first. `sh conventions/conventions-check` and `sh conventions/conventions-format` exit 0 before every commit.
- **The spec decides, and this plan does not reopen:** the three codes and no other carry the field and the header; the field is `retryAt`, an ISO 8601 time in UTC; the header is `Retry-After` in whole seconds, rounded up, never below one; the bucket's moment is when the oldest hit in the window leaves it; the meter's are the next midnight UTC and the first of the next month at midnight UTC; the model's is one minute from now; the moment is the refusing instance's truth and the interface document says so; the bucket's twenty, a moment for `closed` and a retry the widget makes on its own are out of scope.
- **The version moves in this branch** to `0.8.0`, the next minor after `main`'s `0.7.0`, by the owner's instruction. Additive on the interface: no route, event or code moves, a client reading `code` and `message` reads what it read, so the release notes carry no `Interface` heading and say in one line that nothing breaks.
- **`lib/` and `bin/` name no instance and no entity**; `test/portability.test.mjs` holds them to the worked example.
- **Commit messages** in the git register of `conventions/WRITING.md`: a sentence subject under seventy characters with no prefix and no trailing period, one to three prose paragraphs with no headers, no bullets and no plan task numbers, a `Verified:` line naming what ran, then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The pull request body the same, ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **A finding against a committed task is a new commit**, never an amend of a commit a reviewer has read.
- **Nothing is merged, tagged, deployed or deleted by an agent.** The last task pushes, updates #15's body and stops.
- **No count or version of something that still moves** in any prose or comment.
- **Comments in code say why**, in the register the surrounding files use: a short paragraph above the thing, present tense, no history.

### Rulings the plan makes where the spec is silent

1. **`take` answers `true` when the message is taken and the moment, a `Date`, when it is refused.** The spec says `take` returns the moment on refusal and says nothing of the allowed case, whose callers and tests read `true` today; a `Date` is truthy, so the route compares against `true` rather than negating the answer. The moment is the oldest hit in the window plus the hour, which is the first instant at which the window's filter drops it, so a take at exactly that moment is allowed.
2. **`ChatError` keeps `retryAt` as an ISO string** whatever it was handed, a `Date` or a millisecond count, so `refusal()` writes it without conversion and a reader of the error sees what the body will say. Handed nothing, the property is absent, not `null`.
3. **The header is computed in `lib/http.mjs` from the field and the server's own clock**, `Date.now()`, as `Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000))`, on every JSON refusal that carries the field. A refusal that arrives mid-stream, the model's rate between two rounds, is the stream's last event; it carries the field in its data, since `refusal()` writes it, and no header, since the headers are gone.
4. **`asChatError` takes an injected clock**, `asChatError(err, now = Date.now)`, so the minute is testable; the model's `turn` calls it as before with the default.
5. **The `error` event's row in the interface document** says the field rides in its data where the code is `busy`, because that is what `refusal()` writes and a client reading the stream would otherwise find a field the document does not name. The row's shape stays `{ error: { code, message } }` with the field optional.

---

### Task 0: A working tree that passes

**Files:** none changed.

- [ ] **Step 1: Install and fetch the fixture**

```sh
export PATH=/opt/homebrew/bin:$PATH
cd ~/git/companygraph/chat-server-the-refusal-names-the-moment
git config user.email
npm ci
```

Expected: the address is `robert.blust@flatland.ch`; `npm ci` exits 0.

- [ ] **Step 2: Run the suite as the baseline**

Run: `npm test; echo "exit $?"`

Expected: `exit 0`, none skipped. A failure that remains is reported before any task starts; it is not worked around.

- [ ] **Step 3: Commit this plan**

```sh
sh conventions/conventions-format; echo "exit $?"
git add docs/superpowers/plans/2026-09-23-the-refusal-names-the-moment.md
git commit
```

Message subject: `The plan for the refusal's moment`. Body: one paragraph saying the plan builds the spec task by task, test first, the server's half only, and where it stops; a `Verified:` line naming conventions-format; the trailer.

---

### Task 1: The error carries the moment

**Files:**

- Modify: `lib/errors.mjs`
- Test: `test/errors.test.mjs`

**Interfaces:**

- Produces: `new ChatError(code, message, { retryAt } = {})`, where `retryAt` is a `Date`, a millisecond count or an ISO string, kept on the error as `err.retryAt`, an ISO string, and absent when not handed in; `refusal(err)` → `{ error: { code, message } }` or `{ error: { code, message, retryAt } }` when the error has it.

- [ ] **Step 1: Write the failing test**

Append to `test/errors.test.mjs`:

```js
// A refusal for a limit says when the limit lifts, from the one place that knows; a refusal for
// anything else has no moment and writes no field, so a client reading code and message reads
// what it read.
test("a refusal with a moment writes retryAt as an ISO time in UTC, and one without writes no field", () => {
  const at = new Date("2026-09-23T14:05:00.500Z");
  const e = new ChatError("busy", "too many messages from this address", { retryAt: at });
  assert.equal(e.retryAt, "2026-09-23T14:05:00.500Z");
  assert.deepEqual(refusal(e), { error: { code: "busy", message: "too many messages from this address", retryAt: "2026-09-23T14:05:00.500Z" } });
  const ms = new ChatError("over_day", "today's share is spent", { retryAt: Date.UTC(2026, 8, 24) });
  assert.equal(ms.retryAt, "2026-09-24T00:00:00.000Z", "a millisecond count is the same moment");
  const none = new ChatError("foreign", "not a page this chat answers");
  assert.ok(!("retryAt" in none), "no moment, no property");
  assert.deepEqual(Object.keys(refusal(none).error), ["code", "message"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/errors.test.mjs; echo "exit $?"`

Expected: exit 1; the new test fails on `e.retryAt`, `undefined` against the ISO string.

- [ ] **Step 3: Write the field**

In `lib/errors.mjs`, the class and `refusal` become:

```js
// A refusal for a limit that lifts by itself names the moment it lifts, because the widget
// would otherwise guess it, and guessed wrong for the bucket's hour. The moment is kept as the
// ISO time the body will carry, so the error says what the client reads.
export class ChatError extends Error {
  constructor(code, message, { retryAt } = {}) {
    if (!Object.hasOwn(CODES, code)) throw new Error(`unknown code ${code}`);
    super(message);
    this.code = code;
    this.status = CODES[code];
    if (retryAt !== undefined) this.retryAt = new Date(retryAt).toISOString();
  }
}

export const refusal = (err) => ({ error: { code: err.code, message: err.message, ...(err.retryAt ? { retryAt: err.retryAt } : {}) } });
```

- [ ] **Step 4: Run the file**

Run: `node --test test/errors.test.mjs; echo "exit $?"`

Expected: exit 0, three tests.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-check; echo "exit $?"
sh conventions/conventions-format; echo "exit $?"
git add lib/errors.mjs test/errors.test.mjs
git commit
```

Subject: `A refusal can carry the moment its limit lifts`. Body: why the field exists, that it is kept as the ISO string the body carries and absent otherwise; `Verified:`; the trailer.

---

### Task 2: The bucket says when the window opens

**Files:**

- Modify: `lib/bucket.mjs`
- Test: `test/bucket.test.mjs`

**Interfaces:**

- Produces: `Bucket#take(address)` → `true` when the message is taken; when refused, a `Date`, the moment the oldest hit in the window leaves it, at which a take is allowed again.

- [ ] **Step 1: Change the first test and add the moment**

In `test/bucket.test.mjs`, replace the first test with:

```js
// The window slides: the twenty-first message waits until the oldest of the last twenty is an
// hour old, seconds or the whole hour, and the bucket is the one thing that knows which. Its
// refusal is that moment, so the route can say it rather than guess.
test("twenty an hour per address, then the moment the oldest leaves the window, then one more", () => {
  let t = 1000;
  const b = new Bucket({ perHour: 20, now: () => t });
  for (let i = 0; i < 20; i++) { assert.equal(b.take("a"), true); t += 1000; }
  const refused = b.take("a");
  assert.ok(refused instanceof Date, "a refusal is the moment, not false");
  assert.equal(refused.toISOString(), new Date(1000 + 3600 * 1000).toISOString(), "the first hit leaves the window an hour after it");
  assert.equal(b.take("b"), true, "another address has its own bucket");
  t = refused.getTime() - 1;
  assert.ok(b.take("a") instanceof Date, "a moment before, still refused");
  t = refused.getTime();
  assert.equal(b.take("a"), true, "at the moment, allowed");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/bucket.test.mjs; echo "exit $?"`

Expected: exit 1; "a refusal is the moment, not false".

- [ ] **Step 3: Answer with the moment**

In `lib/bucket.mjs`, `take` becomes:

```js
  // A refusal is the moment the oldest hit leaves the window, the first instant at which the
  // filter above drops it, so a take at exactly that moment is allowed; `true` is a message
  // taken. The two are told apart by comparing against `true`, since a Date is truthy.
  take(address) {
    const t = this.now(), since = t - 3600 * 1000;
    const list = (this.hits.get(address) ?? []).filter((x) => x > since);
    if (list.length >= this.perHour) { this.hits.set(address, list); return new Date(list[0] + 3600 * 1000); }
    list.push(t);
    this.hits.set(address, list);
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (!v.some((x) => x > since)) this.hits.delete(k);
    return true;
  }
```

And the file's opening comment gains one sentence after "what the meter is for.": "A refusal names the moment the window opens again, because the widget's sentence is only as true as what the server tells it."

- [ ] **Step 4: Run the file**

Run: `node --test test/bucket.test.mjs; echo "exit $?"`

Expected: exit 0. `test/http.test.mjs` fails now on the route reading `false`; Task 4 fixes the route.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-check; echo "exit $?"
sh conventions/conventions-format; echo "exit $?"
git add lib/bucket.mjs test/bucket.test.mjs
git commit
```

Subject: `The bucket's refusal is the moment the window opens`. Body: why the bucket is the one that knows, that `true` is a take and a Date a refusal, and that the route follows in a later commit; `Verified:` naming bucket and errors; the trailer.

---

### Task 3: The meter names midnight and the first of the month

**Files:**

- Modify: `lib/meter.mjs`
- Test: `test/meter.test.mjs`

**Interfaces:**

- Consumes: `ChatError(code, message, { retryAt })` (Task 1).
- Produces: `reserve` rejects `over_day` with `retryAt` the next midnight UTC after the meter's clock, and `over_month` with the first of the next month at midnight UTC.

- [ ] **Step 1: Write the failing test**

Append to `test/meter.test.mjs`, after "the switch closes the chat" test:

```js
// The day and the month are counted in UTC, so the day's refusal lifts at the next midnight
// UTC and the month's on the first of the next month, computed from the meter's own clock and
// never from the instance's.
test("a spent day names the next midnight UTC and a spent month the first of the next month", async () => {
  const day = new Meter(new MemoryStore(), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await day.reserve(100);
  await assert.rejects(() => day.reserve(1), (e) => e.code === "over_day" && e.retryAt === "2026-09-23T00:00:00.000Z");
  const month = new Meter(new MemoryStore(), { monthTokens: 100, now: at("2026-12-31T23:59:59Z") });
  await assert.rejects(() => month.reserve(101), (e) => e.code === "over_month" && e.retryAt === "2027-01-01T00:00:00.000Z");
  const closed = new Meter(new MemoryStore(), { monthTokens: 1000, now: at("2026-09-22T10:00:00Z") });
  await closed.store.transact((d) => ({ ...d, closed: true }));
  await assert.rejects(() => closed.reserve(1), (e) => e.code === "closed" && !("retryAt" in e));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/meter.test.mjs; echo "exit $?"`

Expected: exit 1; the new test's first `rejects` validation returns false because `e.retryAt` is undefined.

- [ ] **Step 3: Compute the moments**

In `lib/meter.mjs`, beside `dayOf` and `monthOf`:

```js
// When a spent day and a spent month lift: the next midnight UTC, and the first of the next
// month at midnight UTC, since the counters roll on those instants and on no others.
const nextDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
const nextMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
```

In `reserve`, read the clock once and hand the moments in:

```js
      const now = this.now();
      const doc = rolled(d, now);
      if (doc.closed) { refusal = new ChatError("closed", "the chat is switched off"); return doc; }
      if (doc.monthTokens + estimate > this.monthCeiling) { refusal = new ChatError("over_month", "this month's share of answers is spent", { retryAt: nextMonth(now) }); return doc; }
      if (doc.dayTokens + estimate > this.dayShare) { refusal = new ChatError("over_day", "today's share of answers is spent; tomorrow there is more", { retryAt: nextDay(now) }); return doc; }
```

- [ ] **Step 4: Run the file**

Run: `node --test test/meter.test.mjs; echo "exit $?"`

Expected: exit 0.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-check; echo "exit $?"
sh conventions/conventions-format; echo "exit $?"
git add lib/meter.mjs test/meter.test.mjs
git commit
```

Subject: `The meter's refusals name midnight and the first of the month`. Body: why UTC and why the meter's clock; `Verified:`; the trailer.

---

### Task 4: The route writes the field and the header, and the minute names its moment

**Files:**

- Modify: `lib/http.mjs` (`takeOrBusy`, `json`, the catch), `lib/model.mjs` (`asChatError`)
- Test: `test/http.test.mjs`, `test/model.test.mjs`

**Interfaces:**

- Consumes: `Bucket#take` → `true` or a `Date` (Task 2); `ChatError` with `retryAt` and `refusal()` (Task 1).
- Produces: a JSON refusal whose error carries `retryAt` also carries the header `Retry-After: <seconds>`, `Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000))`; `asChatError(err, now = Date.now)` maps a 429 to `busy` with `retryAt` one minute after `now()`.

- [ ] **Step 1: Write the failing tests**

In `test/http.test.mjs`, replace the test "the twenty-first message from one address in an hour is busy" with:

```js
// The bucket knows the moment to the second; the response says it twice, in the body for the
// widget and in the header for any other client, and the two agree. A refusal with no moment
// carries neither, so a client is never told to wait for something that will not change.
test("the twenty-first message from one address in an hour is busy, and says until when", async () => {
  const base = await listen({ model: scripted(...Array(25).fill("ok")) });
  const from = { "x-forwarded-for": "203.0.113.7, 35.0.0.1" };
  for (let i = 0; i < 20; i++) assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }] }, from)).status, 200);
  const r = await post(base, { messages: [{ role: "user", content: "hi" }] }, from);
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.equal(body.error.code, "busy");
  assert.match(body.error.retryAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "an ISO time in UTC");
  const wait = Number(r.headers.get("retry-after"));
  assert.ok(Number.isInteger(wait) && wait >= 1, `Retry-After is whole seconds, never below one: ${r.headers.get("retry-after")}`);
  const fromBody = Math.ceil((Date.parse(body.error.retryAt) - Date.now()) / 1000);
  assert.ok(Math.abs(wait - fromBody) <= 1, `the header says ${wait}, the body ${fromBody}`);
  assert.ok(wait <= 3600 && wait > 3590, `the bucket's hour: ${wait}`);
  const gate = await fetch(`${base}/chat`, { headers: from });
  assert.equal(gate.status, 429, "GET /chat is held by the same bucket");
  assert.ok((await gate.json()).error.retryAt, "and says until when");
  const foreign = await post(base, { messages: [{ role: "user", content: "hi" }] }, { origin: "https://other.test" });
  assert.equal(foreign.status, 403);
  assert.ok(!("retryAt" in (await foreign.json()).error), "a foreign page has no moment");
  assert.equal(foreign.headers.get("retry-after"), null, "and no header");
});
```

And in "a spent ceiling and a closed switch are refused before the stream", after `assert.equal((await r.json()).error.code, "over_month");` change the two lines to read the body once and hold the field:

```js
  const spent = await r.json();
  assert.equal(spent.error.code, "over_month");
  assert.match(spent.error.retryAt, /T00:00:00\.000Z$/, "the first of the next month at midnight UTC");
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
```

and after the `closed` assertions:

```js
  assert.equal(c.headers.get("retry-after"), null, "closed lifts when the owner says, so no header");
```

In `test/model.test.mjs`, replace the test "the minute's rate from the model is busy, and any other error is what it was" with:

```js
test("the minute's rate from the model is busy one minute from now, and any other error is what it was", () => {
  const rate = Object.assign(new Error("Too Many Requests"), { status: 429 });
  const busy = asChatError(rate, () => Date.UTC(2026, 8, 23, 14, 5, 0));
  assert.equal(busy.code, "busy");
  assert.equal(busy.status, 429);
  assert.equal(busy.retryAt, "2026-09-23T14:06:00.000Z", "the quantum the quota is counted in");
  const other = Object.assign(new Error("Bad Request"), { status: 400 });
  assert.equal(asChatError(other), other);
  const plain = new Error("x");
  assert.equal(asChatError(plain), plain);
});
```

Keep the rest of that test as the file has it if its lines differ from the two `other` and `plain` lines above; only the `busy` lines change.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/http.test.mjs test/model.test.mjs; echo "exit $?"`

Expected: exit 1. In `http`, the route still reads `take`'s answer as a boolean, so the twenty-first message is not refused at all, or is refused without the field; in `model`, `busy.retryAt` is undefined.

- [ ] **Step 3: Write the route and the minute**

In `lib/http.mjs`, `takeOrBusy` and `json` become:

```js
  const takeOrBusy = (req) => {
    const taken = bucket.take(clientAddress(req, config.proxyHops));
    if (taken !== true) throw new ChatError("busy", "too many messages from this address; wait a while", { retryAt: taken });
  };
```

```js
// A 429 says when in the standard header as well as in the body, whole seconds rounded up and
// never below one, since a second that has begun is a second to wait; the body's moment is the
// one the header is computed from, so the two agree.
const retryAfter = (err) => (err.retryAt ? { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(err.retryAt) - Date.now()) / 1000))) } : {});

const json = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body) + "\n"); };
```

And the catch at the end:

```js
      if (err instanceof ChatError) { if (!res.headersSent) json(res, err.status, refusal(err), retryAfter(err)); else res.end(); return; }
```

In the header comment of `lib/http.mjs`, after "A refusal decided before the stream is JSON with a code; one that arrives mid-stream, a host gone between two rounds, is the stream's last event." add: "A refusal for a limit that lifts by itself says when, in the body and, before the stream, in the standard header."

In `lib/model.mjs`, `asChatError` becomes:

```js
// A 429 is the project's quota for the minute, which is the fence working rather than a defect,
// so the visitor gets the sentence that says to come back, and the moment one minute on, the
// quantum the quota is counted in; the SDK's error carries nothing more exact that this reads.
// Anything else is what it was.
export const asChatError = (err, now = Date.now) =>
  err?.status === 429 ? new ChatError("busy", "the model is busy; try again in a minute", { retryAt: now() + 60_000 }) : err;
```

- [ ] **Step 4: Run the files and the suite**

Run: `node --test test/http.test.mjs test/model.test.mjs test/loop.test.mjs; echo "exit $?"`, then `npm test; echo "exit $?"`.

Expected: exit 0 each, none skipped.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-check; echo "exit $?"
sh conventions/conventions-format; echo "exit $?"
git add lib/http.mjs lib/model.mjs test/http.test.mjs test/model.test.mjs
git commit
```

Subject: `A refusal for a limit says until when, in the body and the header`. Body: the route, the header's arithmetic and why never below one, the minute and its injected clock, that the mid-stream event carries the field and no header; `Verified:` with the suite; the trailer.

---

### Task 5: The interface document and the README say it

**Files:**

- Modify: `docs/INTERFACE.md` (the events table's `error` row; the codes section's opening paragraph, the three rows, one closing paragraph), `README.md` (line 15, the bucket's sentence)

- [ ] **Step 1: Write the codes section**

In `docs/INTERFACE.md`, the paragraph opening "The codes" becomes:

"A refusal decided before the stream is JSON, `{ error: { code, message } }`, with the status the table gives. The widget turns a code into a sentence in the visitor's language; the message is for a reader of the raw answer. A refusal for a limit that lifts by itself, `busy`, `over_day` or `over_month`, also carries `retryAt`, the moment it lifts as an ISO 8601 time in UTC, and the response carries `Retry-After`, the same moment in whole seconds from now, rounded up and never below one; every other code carries neither, since a bad request, a foreign origin, a closed chat and a host that did not answer have no moment."

The three rows become:

```
| `busy` | 429 | this address has sent twenty messages this hour, and `retryAt` is when the oldest of them is an hour old; or the model is at the project's rate for the minute, and `retryAt` is one minute on |
| `over_day` | 429 | today's share of the ceiling is spent; `retryAt` is the next midnight UTC |
| `over_month` | 429 | this month's ceiling is spent; `retryAt` is the first of the next month at midnight UTC |
```

After the paragraph on the 64 KiB body, add:

"The moment is the truth of the instance that refused. The bucket is in memory per instance and a second instance counts an address on its own, so a visitor may find the chat open earlier than the moment says, and never later."

In the events table, the `error` row's data becomes `{ error: { code, message } }`, with `retryAt` where the code is `busy`, and its "When" stays.

- [ ] **Step 2: Write the README clause**

In `README.md` line 15, "An address gets twenty messages an hour, on a message and on `GET /chat` alike." becomes "An address gets twenty messages an hour, on a message and on `GET /chat` alike, and a refusal for that or for a spent share names the moment it lifts, so the widget's sentence is the server's truth and not a guess."

- [ ] **Step 3: Check the form**

Run: `sh conventions/conventions-check; echo "exit $?"` and `sh conventions/conventions-format; echo "exit $?"`.

Expected: exit 0 each. If `format` reports the table, run `sh conventions/conventions-format fix` and read the diff.

- [ ] **Step 4: Commit**

```sh
git add docs/INTERFACE.md README.md
git commit
```

Subject: `The interface names the moment a refusal lifts`. Body: the field, the header and the sentence on the instance's truth, and that a client reading code and message reads what it read; `Verified:`; the trailer.

---

### Task 6: The release is 0.8.0

**Files:**

- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Move the version**

Run: `npm version 0.8.0 --no-git-tag-version; echo "exit $?"`

Expected: exit 0; `git diff --stat` shows the two files only.

- [ ] **Step 2: Run the whole suite**

Run: `npm test; echo "exit $?"`

Expected: exit 0, none skipped. Read the counts for the pull request body.

- [ ] **Step 3: Commit**

```sh
sh conventions/conventions-check; echo "exit $?"
sh conventions/conventions-format; echo "exit $?"
git add package.json package-lock.json
git commit
```

Subject: `The release is 0.8.0`. Body: the next minor after 0.7.0, additive, what the notes say at tagging; `Verified:`; the trailer.

---

### Task 7: Push and describe the build

- [ ] **Step 1: Push**

```sh
git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push
```

- [ ] **Step 2: Update #15's body**

`gh pr edit 15 --body-file <file>`, the body written to the scratchpad first. It keeps the opening paragraph the spec commit wrote and replaces the paragraph that said the pull request opens with the spec alone with the build: the error's field, the bucket's answer, the meter's two moments, the minute, the route's header, the interface document and the README, the version, and the rulings above that the spec did not foresee. One paragraph names the release notes to write at tagging with no `Interface` heading, and that the widget's half is design's #125. A `Verified:` line with the suite's counts and the conventions scripts, then the Claude Code line.

- [ ] **Step 3: Stop**

Merging, the tag and the deployments' re-pins are the owner's.
