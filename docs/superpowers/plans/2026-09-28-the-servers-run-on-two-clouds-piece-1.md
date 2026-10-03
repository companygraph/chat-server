# The servers run on two clouds, piece 1 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat server's code platform-agnostic behind ports whose Google adapters are the defaults, move both servers' Google Terraform and workflows under Google-named paths, release both, and re-pin the three deployments with proof that nothing on Google changed.

**Architecture:** A new `lib/platform.mjs` names each port's adapters and imports the chosen one dynamically, so no module outside `lib/platform/` imports a cloud SDK statically. The Google code that lives today in `lib/firestore.mjs`, `lib/model.mjs` and `deploy/build/report.mjs` moves to `lib/platform/google/`. `lib/config.mjs` reads the choices `CHAT_METER`, `CHAT_IDENTITY` and `CHAT_LOG`, and each defaults to what Google runs today. Folders and workflows are renamed with `git mv`, and nothing inside them changes.

**Tech Stack:** Node >= 22 ESM, `node:test`, `@anthropic-ai/sdk` ^0.127.0, Terraform 1.9.8 with google `~> 8.0`, GitHub reusable workflows.

**Spec:** `docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md` in this repository. This plan is piece 1 of its §7. Piece 2 (the Azure adapters, modules and workflows) and piece 3 (the live Azure proof) get plans of their own.

## Global Constraints

- Google stays as it is: every new choice defaults to today's behaviour, and the three deployments set no new variable.
- `CHAT_METER` is `firestore` or `memory`, default `firestore`. `CHAT_IDENTITY` is `google`, default `google`. `CHAT_LOG` is `google` or `plain`, default `google`. An unknown value refuses the start, naming the variable, the allowed values and the value given.
- The `google` log line is byte-for-byte today's: `{ severity, "logging.googleapis.com/labels": { logger }, ...fields }`.
- `CHAT_PROJECT` and `CHAT_REGION` are required only when the provider is Vertex.
- No file in `lib/` or `bin/` outside `lib/platform/` imports `@google-cloud/*`, `google-auth-library`, `@anthropic-ai/vertex-sdk` or `@azure/*` with a static `import`.
- `@anthropic-ai/vertex-sdk`, `@google-cloud/firestore` and `google-auth-library` move from `dependencies` to `optionalDependencies`. `npm ci --omit=dev` still installs them, so the deployments' Dockerfiles do not change.
- Every branch lives in a sibling worktree `<repo>-<branch>`; the clone stays on its default branch.
- Commit messages and PR bodies follow the family's git register: a plain-sentence subject under seventy characters with no type prefix and no trailing period; a prose body with no headings and no bullets; a `Verified:` line naming the commands actually run, written from what ran, not from this plan; then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. After each commit, `git log -1 --format='[%s]'` must show the subject alone.
- Open each PR and stop. Merging, tagging and releasing each need Rob's word.
- Before running anything: `export PATH=/opt/homebrew/bin:$PATH`.

## Review Focus

1. **A choice written in another case**, such as `CHAT_METER=Firestore`. Today any value other than `memory` means Firestore. Now it must refuse the start with `CHAT_METER is not one of firestore memory: Firestore`, and never fall back silently. Pinned in Task 2.
2. **An optional SDK missing from the image** when its adapter is chosen. The start must fail with one line naming the variable, its value and the package, and exit 2, not with a stack trace. Pinned in Task 4.
3. **A federated deployment with `CHAT_PROJECT` unset.** It must start, because Vertex is not used. A Vertex deployment without it must be refused by name. Pinned in Task 2.
4. **A Vertex client whose SDK fails to load on the first turn.** The next turn must try again rather than rethrow a cached rejection forever. Pinned in Task 5.
5. **A `deployment.json` naming a platform this release has no adapter for**, such as `"platform": "azure"` before piece 2. The report must refuse it by name before signing in anywhere. Pinned in Task 6.

---

## Part A: chat-server

Work in the worktree that already holds the spec: `/Users/rob/git/companygraph/chat-server-the-servers-run-on-two-clouds`, branch `the-servers-run-on-two-clouds`. Run `npm ci` there once before Task 1 if `node_modules` is absent.

### Task 1: The portability test reads every file under lib/, however deep

**Files:**

- Modify: `test/portability.test.mjs:10-11`

**Interfaces:**

- Produces: a `sources` list covering every file under `lib/` and `bin/` at any depth. Task 7 extends the same file.

- [ ] **Step 1: Show the failure a subfolder causes**

Run: `mkdir -p lib/platform/google && touch lib/platform/google/.probe && node --test test/portability.test.mjs; rm -r lib/platform`

Expected: FAIL with `EISDIR: illegal operation on a directory, read`.

- [ ] **Step 2: Walk the folders**

Replace lines 10-11 of `test/portability.test.mjs`:

```js
const sources = ["lib", "bin"].filter((d) => fs.existsSync(path.join(root, d)))
  .flatMap((d) => fs.readdirSync(path.join(root, d)).map((f) => path.join(d, f)));
```

with:

```js
// Every file at any depth: the platform adapters sit a folder below lib/, and a folder read as a
// file fails the test for the wrong reason.
const sources = ["lib", "bin"].filter((d) => fs.existsSync(path.join(root, d)))
  .flatMap((d) => fs.readdirSync(path.join(root, d), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name))));
```

- [ ] **Step 3: Run it with the subfolder present, then without it**

Run: `mkdir -p lib/platform/google && touch lib/platform/google/.probe && node --test test/portability.test.mjs; rm -r lib/platform; node --test test/portability.test.mjs`

Expected: PASS both times.

- [ ] **Step 4: Commit**

```bash
git add test/portability.test.mjs
git commit -F - <<'EOF'
The portability test reads every file under lib/, however deep

The platform adapters of the two-clouds design sit in a folder below lib/, and the test read lib/ one level deep, so the first folder there would have failed it on EISDIR rather than on a name. It now walks every folder and reads files only.

Verified: node --test test/portability.test.mjs with a probe folder under lib/ and without it, both passing; before the change the probe failed it on EISDIR.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 2: The config reads three choices and asks for a project only for Vertex

**Files:**

- Create: `lib/platform.mjs`, with the adapter tables only; Tasks 4, 5 and 6 fill them.
- Modify: `lib/config.mjs`, `lib/log.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**

- Produces:
  - `configFromEnv(env)` returns, besides today's fields: `meter: "firestore" | "memory"`, `identity: "google"`, `log: "google" | "plain"`. `project` and `region` are `string | null`: required when `provider === "vertex"`, and `null` when unset otherwise.
  - `lib/platform.mjs` exports `METERS`, `IDENTITIES` and `QUESTIONS`, objects whose keys are the allowed values.
  - `lib/log.mjs` exports `LOG_FORMATS`, whose keys are the allowed `CHAT_LOG` values. Task 3 writes its bodies; this task adds the object with both keys.

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.mjs`:

```js
test("the three choices default to what Google runs today", () => {
  const c = configFromEnv(full);
  assert.equal(c.meter, "firestore");
  assert.equal(c.identity, "google");
  assert.equal(c.log, "google");
});

test("each choice takes its values and refuses any other by name, whatever the case", () => {
  const c = configFromEnv({ ...full, CHAT_METER: "memory", CHAT_IDENTITY: "google", CHAT_LOG: "plain" });
  assert.equal(c.meter, "memory");
  assert.equal(c.log, "plain");
  assert.throws(() => configFromEnv({ ...full, CHAT_METER: "Firestore" }), /^Error: CHAT_METER is not one of firestore memory: Firestore$/);
  assert.throws(() => configFromEnv({ ...full, CHAT_IDENTITY: "azure" }), /^Error: CHAT_IDENTITY is not one of google: azure$/);
  assert.throws(() => configFromEnv({ ...full, CHAT_LOG: "json" }), /^Error: CHAT_LOG is not one of google plain: json$/);
});

const fed = { ANTHROPIC_FEDERATION_RULE_ID: "fdrl_01x", ANTHROPIC_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000000", ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_01x" };

test("a project and a region are asked for only when the provider is Vertex", () => {
  const f = configFromEnv({ ...full, ...fed, CHAT_PROJECT: undefined, CHAT_REGION: undefined });
  assert.equal(f.provider, "anthropic");
  assert.equal(f.project, null);
  assert.equal(f.region, null);
  const k = configFromEnv({ ...full, ANTHROPIC_API_KEY: "sk-ant-x", CHAT_PROJECT: "", CHAT_REGION: "" });
  assert.equal(k.project, null);
  assert.throws(() => configFromEnv({ ...full, CHAT_PROJECT: undefined }), /^Error: CHAT_PROJECT is not set$/);
  assert.throws(() => configFromEnv({ ...full, CHAT_REGION: " " }), /^Error: CHAT_REGION is not set$/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/config.test.mjs`

Expected: FAIL. The first two tests fail because `c.identity` is `undefined` and no refusal is thrown; the third fails on `CHAT_PROJECT is not set` for the federated config.

- [ ] **Step 3: Create `lib/platform.mjs` with the tables**

```js
// Each port's adapters, named by the value that chooses them. An adapter is imported only when it
// is chosen, so a deployment loads the cloud SDK of the platform it runs on and no other, and the
// config reads the allowed values from the keys here rather than from a list of its own.
export const METERS = {
  firestore: null,
  memory: null,
};

export const IDENTITIES = {
  google: null,
};

export const QUESTIONS = {
  google: null,
};
```

The `null`s are filled with importers in Tasks 4, 5 and 6. This task reads only the keys.

- [ ] **Step 4: Add `LOG_FORMATS` to `lib/log.mjs`**

Replace the `export const line = …` line at the end of `lib/log.mjs` with the following. Task 3 replaces this again with the `plain` body and the format switch.

```js
export const LOG_FORMATS = {
  google: (logger, severity, fields) => ({ severity, "logging.googleapis.com/labels": { logger }, ...fields }),
  plain: null,
};

export const line = (logger, severity, fields) => JSON.stringify(LOG_FORMATS.google(logger, severity, fields));
```

- [ ] **Step 5: Read the choices in `lib/config.mjs`**

Add the imports below the existing `import { DEFAULT_QUESTION_INDEX_CHARS } …` line:

```js
import { METERS, IDENTITIES } from "./platform.mjs";
import { LOG_FORMATS } from "./log.mjs";
```

Add this helper below `int`:

```js
// A choice among a port's adapters: unset is the default, which is what Google runs today, and
// any other value is refused with the ones there are, so a value in the wrong case never falls
// back to the default without a word.
const choice = (env, name, kinds, fallback) => {
  const v = env[name]?.trim();
  if (!v) return fallback;
  const allowed = Object.keys(kinds);
  if (!allowed.includes(v)) throw new Error(`${name} is not one of ${allowed.join(" ")}: ${v}`);
  return v;
};
```

In `configFromEnv`, replace these three properties:

```js
    project: need(env, "CHAT_PROJECT"),
    region: need(env, "CHAT_REGION"),
```

```js
    meter: env.CHAT_METER === "memory" ? "memory" : "firestore",
```

with, in the same positions:

```js
    project: env.CHAT_PROJECT?.trim() || null,
    region: env.CHAT_REGION?.trim() || null,
```

```js
    meter: choice(env, "CHAT_METER", METERS, "firestore"),
    identity: choice(env, "CHAT_IDENTITY", IDENTITIES, "google"),
    log: choice(env, "CHAT_LOG", LOG_FORMATS, "google"),
```

After the line `c.credential = …`, and before `return c;`, add:

```js
  // Only Vertex is reached through the project; the Anthropic API needs neither value, and a
  // federated deployment on another cloud has no Google project to name.
  if (c.provider === "vertex") {
    if (!c.project) throw new Error("CHAT_PROJECT is not set");
    if (!c.region) throw new Error("CHAT_REGION is not set");
  }
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: all pass, including the three new tests. The suite's total is the previous count plus three; write down the number for the PR.

- [ ] **Step 7: Commit**

```bash
git add lib/platform.mjs lib/config.mjs lib/log.mjs test/config.test.mjs
git commit -F - <<'EOF'
The config reads three choices and asks for a project only for Vertex

A second platform is reached by choosing adapters, so the config now reads CHAT_METER, CHAT_IDENTITY and CHAT_LOG, each defaulting to what Google runs today and refusing any value it has no adapter for, the allowed values named. CHAT_METER used to read anything but memory as Firestore, so a value in the wrong case ran the default without a word. CHAT_PROJECT and CHAT_REGION are now asked for only when the provider is Vertex, since the Anthropic API needs neither.

Verified: npm test <count from Step 6>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

Write the count, not the angle-bracket text, into the message.

### Task 3: The log line has a plain form beside Google's

**Files:**

- Modify: `lib/log.mjs`, `bin/http.mjs`
- Test: `test/log.test.mjs`

**Interfaces:**

- Consumes: `LOG_FORMATS` from Task 2.
- Produces:
  - `formatLine(kind, logger, severity, fields) → string`, pure.
  - `useLogFormat(kind)`, which sets the format every later `line()` uses.
  - `line(logger, severity, fields) → string`, whose signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/log.test.mjs`, and extend its import to `import { line, formatLine, useLogFormat, LOG_FORMATS } from "../lib/log.mjs";`:

```js
test("Google's line is today's, to the byte", () => {
  assert.equal(formatLine("google", "chat.question", "INFO", { kind: "question", question: "hi" }),
    '{"severity":"INFO","logging.googleapis.com/labels":{"logger":"chat.question"},"kind":"question","question":"hi"}');
});

test("the plain line carries the severity and the logger at the top, then the fields", () => {
  const s = formatLine("plain", "chat.question", "INFO", { kind: "question", question: "hi" });
  assert.deepEqual(Object.keys(JSON.parse(s)), ["severity", "logger", "kind", "question"]);
  assert.deepEqual(JSON.parse(s), { severity: "INFO", logger: "chat.question", kind: "question", question: "hi" });
});

test("the chosen format holds for every later line, and Google's is the default", () => {
  assert.equal(line("chat.start", "INFO", { kind: "start" }), formatLine("google", "chat.start", "INFO", { kind: "start" }));
  useLogFormat("plain");
  try {
    assert.equal(JSON.parse(line("chat.start", "INFO", { kind: "start" })).logger, "chat.start");
  } finally {
    useLogFormat("google");
  }
  assert.throws(() => useLogFormat("json"), /^Error: CHAT_LOG is not one of google plain: json$/);
  assert.deepEqual(Object.keys(LOG_FORMATS), ["google", "plain"]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/log.test.mjs`

Expected: FAIL with `formatLine is not a function` (or a SyntaxError, because the named import does not exist).

- [ ] **Step 3: Write the formats**

Replace everything in `lib/log.mjs` after the opening comment with:

```js
export const LOG_FORMATS = {
  google: (logger, severity, fields) => ({ severity, "logging.googleapis.com/labels": { logger }, ...fields }),
  plain: (logger, severity, fields) => ({ severity, logger, ...fields }),
};

export const formatLine = (kind, logger, severity, fields) => JSON.stringify(LOG_FORMATS[kind](logger, severity, fields));

let current = "google";

export const useLogFormat = (kind) => {
  if (!Object.hasOwn(LOG_FORMATS, kind)) throw new Error(`CHAT_LOG is not one of ${Object.keys(LOG_FORMATS).join(" ")}: ${kind}`);
  current = kind;
};

export const line = (logger, severity, fields) => formatLine(current, logger, severity, fields);
```

Then append to the opening comment, before `export`, these lines:

```js
//
// That is Google's form and the default. The plain form writes the logger as a top-level key
// beside the severity, which is what a platform without Cloud Logging's conventions, Azure's Log
// Analytics among them, reads as a column. The process chooses once, at start, from CHAT_LOG.
```

- [ ] **Step 4: Set the format at start**

In `bin/http.mjs`, change `import { line } from "../lib/log.mjs";` to `import { line, useLogFormat } from "../lib/log.mjs";`, and directly after `const config = configFromEnv();` add `useLogFormat(config.log);`.

- [ ] **Step 5: Run the suite**

Run: `npm test`

Expected: all pass. `test/http.test.mjs` and `test/host.test.mjs` still assert the Google keys, and they pass because Google's form is the default.

- [ ] **Step 6: Commit**

```bash
git add lib/log.mjs bin/http.mjs test/log.test.mjs
git commit -F - <<'EOF'
The log line has a plain form beside Google's

Azure's Log Analytics reads a line's top-level keys as columns and knows nothing of Cloud Logging's labels key, so a line meant for it names its logger at the top. The line now has two forms, Google's, unchanged to the byte and the default, and plain, chosen once at start from CHAT_LOG; every caller keeps calling line().

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 4: The meter store is chosen by name, and Firestore lives with Google

**Files:**

- Create: `lib/platform/google/meter.mjs`, whose content is today's `lib/firestore.mjs`
- Delete: `lib/firestore.mjs`
- Modify: `lib/platform.mjs`, `bin/http.mjs`
- Test: `test/meter.test.mjs`, and a new `test/platform.test.mjs`

**Interfaces:**

- Consumes: `METERS` from Task 2; `MemoryStore` from `lib/meter.mjs`.
- Produces:
  - `load(variable, value, importer) → Promise<any>`, which turns a missing package into one sentence.
  - `meterStore(kind, adapters = METERS) → Promise<{ transact(fn) }>`.
  - `FirestoreStore`, now at `lib/platform/google/meter.mjs`.

- [ ] **Step 1: Move the file with its history**

Run: `mkdir -p lib/platform/google && git mv lib/firestore.mjs lib/platform/google/meter.mjs`

In `test/meter.test.mjs`, change line 4 to `import { FirestoreStore } from "../lib/platform/google/meter.mjs";`.

- [ ] **Step 2: Write the failing tests**

Create `test/platform.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { meterStore, load, METERS } from "../lib/platform.mjs";
import { MemoryStore } from "../lib/meter.mjs";
import { FirestoreStore } from "../lib/platform/google/meter.mjs";

const missing = (pkg) => () => Promise.reject(Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/lib/platform/google/meter.mjs`), { code: "ERR_MODULE_NOT_FOUND" }));

test("each meter kind builds its store", async () => {
  assert.ok((await meterStore("memory")) instanceof MemoryStore);
  assert.ok((await meterStore("firestore", { firestore: async () => new FirestoreStore({ db: { doc: () => ({}) } }) })) instanceof FirestoreStore);
  assert.deepEqual(Object.keys(METERS), ["firestore", "memory"]);
});

test("a chosen adapter whose package is not installed is named in one sentence", async () => {
  await assert.rejects(meterStore("firestore", { firestore: missing("@google-cloud/firestore") }),
    (e) => e.message === "CHAT_METER=firestore needs a package that is not installed: Cannot find package '@google-cloud/firestore' imported from /app/lib/platform/google/meter.mjs");
});

test("any other failure while loading an adapter is passed on as it was", async () => {
  const boom = new Error("boom");
  await assert.rejects(load("CHAT_METER", "firestore", () => Promise.reject(boom)), (e) => e === boom);
});

// One contract, every store: a function that returns what it read writes nothing, and what it
// returns is what the next call reads.
const fakeFirestore = () => {
  let doc;
  return new FirestoreStore({ db: {
    doc: () => ({}),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: doc !== undefined, data: () => ({ ...doc }) }), set: (_, next) => { doc = { ...next }; } }),
  } });
};

for (const [name, make] of [["memory", () => new MemoryStore()], ["firestore", fakeFirestore]]) {
  test(`the ${name} store keeps what transact returns and starts empty`, async () => {
    const s = make();
    assert.deepEqual(await s.transact((d) => d), {});
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: (d.dayTokens ?? 0) + 1 })), { dayTokens: 1 });
    assert.deepEqual(await s.transact((d) => ({ ...d, dayTokens: d.dayTokens + 1 })), { dayTokens: 2 });
    assert.deepEqual(await s.transact((d) => d), { dayTokens: 2 });
  });
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/platform.test.mjs`

Expected: FAIL with `does not provide an export named 'meterStore'`.

- [ ] **Step 4: Write the loader and the meter table**

Replace the `METERS` block in `lib/platform.mjs` and add `load` and `meterStore`:

```js
// A package an adapter needs and the image does not hold is an operator's error, said in one
// sentence naming the choice that asked for it; any other failure is the adapter's own.
export async function load(variable, value, importer) {
  try {
    return await importer();
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") throw new Error(`${variable}=${value} needs a package that is not installed: ${String(err.message).split("\n")[0]}`);
    throw err;
  }
}

export const METERS = {
  firestore: async () => new (await import("./platform/google/meter.mjs")).FirestoreStore(),
  memory: async () => new (await import("./meter.mjs")).MemoryStore(),
};

export const meterStore = (kind, adapters = METERS) => load("CHAT_METER", kind, adapters[kind]);
```

Change the opening comment of `lib/platform/google/meter.mjs` so its last sentence reads: `The client takes its project and its credentials from the environment Cloud Run gives the service account; it is loaded only when CHAT_METER is firestore.`

- [ ] **Step 5: Take the store from the table in `bin/http.mjs`**

Remove `import { FirestoreStore } from "../lib/firestore.mjs";`, change `import { Meter, MemoryStore } from "../lib/meter.mjs";` to `import { Meter } from "../lib/meter.mjs";`, add `import { meterStore } from "../lib/platform.mjs";`, and replace

```js
  const store = config.meter === "memory" ? new MemoryStore() : new FirestoreStore();
```

with

```js
  const store = await meterStore(config.meter);
```

- [ ] **Step 6: Run the suite**

Run: `npm test`

Expected: all pass, including `test/meter.test.mjs` at its new import path and `test/bin-http.test.mjs`, which starts the process with `CHAT_METER=memory`.

- [ ] **Step 7: Commit**

```bash
git add -A lib bin test
git commit -F - <<'EOF'
The meter store is chosen by name, and Firestore lives with Google

The meter already reached its store through transact alone, so a second platform's store needs only a second adapter. Firestore's store moves to lib/platform/google/meter.mjs and is imported only when CHAT_METER names it. An adapter whose package the image lacks now stops the start with one sentence naming the choice and the package. One contract test runs over every store.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 5: The identity token is chosen by name, and Vertex is loaded on first use

**Files:**

- Create: `lib/credential.mjs`, `lib/platform/google/identity.mjs`
- Modify: `lib/model.mjs`, `lib/platform.mjs`, `bin/http.mjs`
- Test: `test/model.test.mjs`, `test/platform.test.mjs`

**Interfaces:**

- Consumes: `load` from Task 4.
- Produces:
  - `lib/credential.mjs`: `ANTHROPIC_API`, `TOKEN_TIMEOUT_MS`, `credentialError(message)`, and `asToken(text, source) → string`.
  - `lib/platform/google/identity.mjs`: `METADATA_IDENTITY_URL`, and `googleIdentityToken(fetchFn, { timeoutMs }) → () => Promise<string>`.
  - `identityTokenSource(kind, adapters = IDENTITIES) → Promise<(fetchFn, { timeoutMs }) => () => Promise<string>>`.
  - `anthropicModel({ apiKey, federation, identityToken, fetch, tokenTimeoutMs })`, where `identityToken` is required when `federation` is set.
  - `modelFor(config, { identityToken } = {})`.

- [ ] **Step 1: Write the failing tests**

In `test/model.test.mjs`:

- Change the import on line 3 to drop `googleIdentityToken` and `METADATA_IDENTITY_URL`.
- Add `import { googleIdentityToken, METADATA_IDENTITY_URL } from "../lib/platform/google/identity.mjs";`.
- Pass `identityToken: googleIdentityToken` in every `anthropicModel({ federation, … })` call (lines 131, 155 and 186).
- Change line 163 to `const f = modelFor({ ...base, anthropicFederation: federation }, { identityToken: googleIdentityToken });`.

Then append:

```js
test("a federated model without an identity token source is refused where it is built", () => {
  assert.throws(() => anthropicModel({ federation }), /^Error: a federated model needs an identity token source$/);
  assert.throws(() => modelFor({ provider: "anthropic", anthropicFederation: federation }), /identity token source/);
});

test("a Vertex client that failed to load is built again on the next turn", async () => {
  let builds = 0;
  const m = overForTest(async () => {
    builds++;
    if (builds === 1) throw new Error("Cannot find package '@anthropic-ai/vertex-sdk'");
    return { messages: { stream: () => ({ on() {}, finalMessage: async () => ({ content: [], stop_reason: "end_turn", usage: {} }) }) } };
  });
  await assert.rejects(m.turn({}, () => {}), /vertex-sdk/);
  await m.turn({}, () => {});
  assert.equal(builds, 2);
});
```

Extend the import on line 3 with `overForTest`.

Append to `test/platform.test.mjs`:

```js
import { identityTokenSource, IDENTITIES } from "../lib/platform.mjs";
import { googleIdentityToken } from "../lib/platform/google/identity.mjs";

test("the google identity is the metadata server's token", async () => {
  assert.equal(await identityTokenSource("google"), googleIdentityToken);
  assert.deepEqual(Object.keys(IDENTITIES), ["google"]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/model.test.mjs test/platform.test.mjs`

Expected: FAIL with `Cannot find module '…/lib/platform/google/identity.mjs'`.

- [ ] **Step 3: Create `lib/credential.mjs`**

```js
// What every identity-token source shares: the audience Anthropic's rule names on Google, a
// deadline of its own for the fetch, the error a credential's fault is named by, and the check
// that an answer is a token at all. A credential's fault says so in a sentence of this module's
// own, which holds nothing the visitor sent, so the route may log it where it logs no other
// error's message.
export const ANTHROPIC_API = "https://api.anthropic.com";
export const TOKEN_TIMEOUT_MS = 10_000;

export const credentialError = (message) => Object.assign(new Error(message), { name: "CredentialError" });

// Three parts, each base64url and none empty: counting the dots alone would pass a page of HTML
// that happens to hold two, and send it on to the exchange.
export function asToken(text, source) {
  const token = text.trim();
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw credentialError(`${source} answered something that is not a token`);
  return token;
}
```

- [ ] **Step 4: Create `lib/platform/google/identity.mjs`**

Move the code out of `lib/model.mjs` with its comment, and keep its sentences so the logs read the same:

```js
// The Google Cloud the service runs on signs a token for its own account on request, for the
// audience the federation rule pins; `full` puts the account's email in it, which the rule
// matches beside the numeric id. The status and the token's shape are checked here because an
// error page sent on as an assertion comes back from the exchange as a bare 401, and the fetch
// has a deadline of its own, since it runs before the client's timeout starts counting.
import { ANTHROPIC_API, TOKEN_TIMEOUT_MS, credentialError, asToken } from "../../credential.mjs";

export const METADATA_IDENTITY_URL = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${ANTHROPIC_API}&format=full`;

export const googleIdentityToken = (fetchFn = fetch, { timeoutMs = TOKEN_TIMEOUT_MS } = {}) => async () => {
  let res;
  try {
    res = await fetchFn(METADATA_IDENTITY_URL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw credentialError(`the metadata server could not be reached: ${err?.message ?? err}`);
  }
  if (!res.ok) throw Object.assign(credentialError(`the metadata server answered ${res.status} when asked for an identity token`), { statusCode: res.status });
  return asToken(await res.text(), "the metadata server");
};
```

- [ ] **Step 5: Change `lib/model.mjs`**

1. Remove `import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";`.
2. Add `import { ANTHROPIC_API, TOKEN_TIMEOUT_MS } from "./credential.mjs";`.
3. Delete everything from the comment `// The Google Cloud the service runs on signs a token …` through the end of `googleIdentityToken`. That covers `ANTHROPIC_API`, `METADATA_IDENTITY_URL`, `TOKEN_TIMEOUT_MS`, `credentialError` with its comment, and `googleIdentityToken`.
4. Replace `over` with a version that builds asynchronously, forgets a failed build, and is exported for the test:

```js
// The client is built on the first turn and kept, not at start: the Vertex SDK is loaded only
// then, and its constructor begins resolving Google's credentials, which a process that never
// answers a message — a test run, a build — has none of. A build that failed is forgotten, so
// the next turn tries again rather than repeat one failure for the life of the process.
function over(provider, credential, build) {
  let client;
  return {
    name: MODEL,
    provider,
    credential,
    async turn(request, onText, { signal } = {}) {
      try {
        client ??= Promise.resolve().then(build).catch((err) => { client = undefined; throw err; });
        const c = await client;
        const stream = c.messages.stream(request, { signal });
        stream.on("text", (delta) => onText(delta));
        return await stream.finalMessage();
      } catch (err) {
        throw asChatError(err);
      }
    },
  };
}

export const overForTest = (build) => over("test", "none", build);
```

Delete the paragraph above `over` that begins `// The client is built on the first turn and kept, not at start:`, since the new comment replaces it. Keep the `turn` paragraph above it.

5. Replace `vertexModel`:

```js
export const vertexModel = ({ project, region }) =>
  over("vertex", "google", async () => {
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    return new AnthropicVertex({ projectId: project, region, maxRetries: 1, timeout: 60_000 });
  });
```

6. In `anthropicModel`, add `identityToken` to the parameters, refuse federation without it, and use it:

```js
export const anthropicModel = ({ apiKey, federation, identityToken, fetch: fetchFn = globalThis.fetch, tokenTimeoutMs = TOKEN_TIMEOUT_MS }) => {
  if (!apiKey && !identityToken) throw new Error("a federated model needs an identity token source");
  return apiKey
    ? over("anthropic", "key", () => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }))
    : over("anthropic", "federation", () => new Anthropic({
      apiKey: null,
      authToken: null,
      credentials: oidcFederationProvider({
        identityTokenProvider: identityToken(fetchFn, { timeoutMs: tokenTimeoutMs }),
        federationRuleId: federation.ruleId,
        organizationId: federation.organizationId,
        serviceAccountId: federation.serviceAccountId,
        workspaceId: federation.workspaceId ?? undefined,
        baseURL: ANTHROPIC_API,
        fetch: (url, init = {}) => fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(tokenTimeoutMs) }),
      }),
      fetch: fetchFn,
      maxRetries: 1,
      timeout: 60_000,
    }));
};
```

Add a sentence to its comment: `The identity token comes from the platform the service runs on, chosen by CHAT_IDENTITY and handed in, so this module names no cloud.`

7. Replace `modelFor`:

```js
export const modelFor = (config, { identityToken } = {}) =>
  config.anthropicKey ? anthropicModel({ apiKey: config.anthropicKey })
    : config.anthropicFederation ? anthropicModel({ federation: config.anthropicFederation, identityToken })
      : vertexModel({ project: config.project, region: config.region });
```

8. Run `grep -rn "credentialError\|ANTHROPIC_API\|TOKEN_TIMEOUT_MS" lib test bin`. Every hit must import from `lib/credential.mjs` or from `lib/platform/google/identity.mjs`, and none from `lib/model.mjs` except its own import. `credentialFault` stays in `lib/model.mjs` unchanged.

- [ ] **Step 6: Fill the identity table**

In `lib/platform.mjs`, replace the `IDENTITIES` block:

```js
export const IDENTITIES = {
  google: async () => (await import("./platform/google/identity.mjs")).googleIdentityToken,
};

export const identityTokenSource = (kind, adapters = IDENTITIES) => load("CHAT_IDENTITY", kind, adapters[kind]);
```

- [ ] **Step 7: Hand the model its identity in `bin/http.mjs`**

Change the platform import to `import { meterStore, identityTokenSource } from "../lib/platform.mjs";` and replace

```js
  const model = values.model === "fake" ? fakeModel : modelFor(config);
```

with

```js
  const identityToken = values.model !== "fake" && config.anthropicFederation ? await identityTokenSource(config.identity) : undefined;
  const model = values.model === "fake" ? fakeModel : modelFor(config, { identityToken });
```

- [ ] **Step 8: Run the suite**

Run: `npm test`

Expected: all pass. The metadata tests on `test/model.test.mjs` lines 112-123 and 177-181 pass unchanged against the moved function.

- [ ] **Step 9: Commit**

```bash
git add -A lib bin test
git commit -F - <<'EOF'
The identity token is chosen by name, and Vertex is loaded on first use

The federated model asked Google's metadata server for its token from inside lib/model.mjs, so the model module knew its cloud. The metadata code moves to lib/platform/google/identity.mjs, CHAT_IDENTITY chooses it, and the model is handed the source it uses; a federated model built without one is refused where it is built. The Vertex SDK is imported on the first turn rather than at load, and a client whose build failed is built again on the next turn instead of failing for the life of the process.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 6: The weekly report reads its questions through the platform

**Files:**

- Create: `lib/platform/google/questions.mjs`
- Modify: `lib/report.mjs` (remove `listEntries`), `deploy/build/report.mjs`, `lib/platform.mjs`
- Test: `test/report.test.mjs`, `test/platform.test.mjs`

**Interfaces:**

- Consumes: `load` from Task 4.
- Produces:
  - `lib/platform/google/questions.mjs`: `listEntries(request, view, range)`, moved unchanged, and `googleQuestions({ project, region }) → Promise<{ where, list(range), put(name, text) }>`.
  - `questionSource(platform, adapters = QUESTIONS) → Promise<(deployment) => Promise<{ where, list, put }>>`.

- [ ] **Step 1: Write the failing tests**

In `test/report.test.mjs`, change line 3 to import `weekOf, weekRange, answered, renderReport, runReport` from `../lib/report.mjs`, and add `import { listEntries } from "../lib/platform/google/questions.mjs";`.

Append to `test/platform.test.mjs`:

```js
import { questionSource, QUESTIONS } from "../lib/platform.mjs";
import { googleQuestions } from "../lib/platform/google/questions.mjs";

test("the questions of a deployment come from its platform, Google when it names none", async () => {
  assert.equal(await questionSource(undefined), googleQuestions);
  assert.equal(await questionSource("google"), googleQuestions);
  assert.deepEqual(Object.keys(QUESTIONS), ["google"]);
});

test("a platform this release has no adapter for is refused by name, before anything signs in", async () => {
  let loaded = false;
  await assert.rejects(questionSource("azure", { google: async () => { loaded = true; } }),
    (e) => e.message === "deployment.json names platform azure, which is not one of google");
  assert.equal(loaded, false);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/report.test.mjs test/platform.test.mjs`

Expected: FAIL with `Cannot find module '…/lib/platform/google/questions.mjs'`.

- [ ] **Step 3: Create `lib/platform/google/questions.mjs`**

Cut `listEntries` out of `lib/report.mjs` and paste it here unchanged, then add the source:

```js
// Kept questions on Google: the log view the sink fills, read through the Logging API a page at
// a time, and the week's file written to the project's reports bucket through the Storage API.
// The library is the auth alone; each call is one request.
import { GoogleAuth } from "google-auth-library";

// (listEntries, moved unchanged from lib/report.mjs)

export async function googleQuestions({ project, region }) {
  const view = `projects/${project}/locations/${region}/buckets/chat-questions/views/questions`;
  const bucket = `chat-reports-${project}`;
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
  return {
    where: `gs://${bucket}`,
    list: (range) => listEntries(async (body) => (await client.request({ url: "https://logging.googleapis.com/v2/entries:list", method: "POST", data: body })).data, view, range),
    put: async (name, text) => {
      await client.request({
        url: `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
        method: "POST",
        headers: { "content-type": "text/markdown; charset=utf-8" },
        body: text,
      });
    },
  };
}
```

Replace the comment placeholder line with the pasted function. In `lib/report.mjs`, change the opening comment's `with the Logging API's paging over an injected request so a test drives it` to `with the entries read by the platform's own source`.

- [ ] **Step 4: Fill the questions table**

In `lib/platform.mjs`, replace the `QUESTIONS` block:

```js
export const QUESTIONS = {
  google: async () => (await import("./platform/google/questions.mjs")).googleQuestions,
};

// A deployment that names no platform is on Google, as every deployment before the field was.
export async function questionSource(platform = "google", adapters = QUESTIONS) {
  if (!Object.hasOwn(adapters, platform)) throw new Error(`deployment.json names platform ${platform}, which is not one of ${Object.keys(adapters).join(" ")}`);
  return load("platform", platform, adapters[platform]);
}
```

- [ ] **Step 5: Rewrite `deploy/build/report.mjs`**

```js
// The week's report, run in a deployment's chat/ under the analyst's credentials: the entries of
// one ISO week, the one that ended or the one named, read from where the deployment's platform
// keeps them, one Markdown file written beside them. The week is checked before anything is
// read, and the platform before anything signs in, so a wrong name is refused on its own.
import { deployment } from "./config.mjs";
import { runReport, weekRange } from "../../lib/report.mjs";
import { questionSource } from "../../lib/platform.mjs";

const week = process.argv[3];
if (week !== undefined) weekRange(week);
const d = deployment();
const open = await questionSource(d.platform);
const source = await open(d);

await runReport({ list: source.list, put: source.put, out: (s) => console.log(`${s} in ${source.where}`), ...(week !== undefined ? { week } : {}) });
```

- [ ] **Step 6: Run the suite**

Run: `npm test`

Expected: all pass, including the moved `listEntries` test and `test/bin-deploy.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add -A lib deploy test
git commit -F - <<'EOF'
The weekly report reads its questions through the platform

The report reached Cloud Logging and Cloud Storage directly from deploy/build/report.mjs. Both calls move to lib/platform/google/questions.mjs, and the report takes its source from the platform deployment.json names, Google when it names none, as every deployment does today. A platform this release has no adapter for is refused by name before anything signs in. The written file and the line the run prints are unchanged.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 7: No module outside lib/platform/ imports a cloud SDK, and the SDKs are optional

**Files:**

- Modify: `bin/http.mjs` (header comment only), `package.json`, `package-lock.json`, `test/portability.test.mjs`

**Interfaces:**

- Consumes: the wiring of Tasks 3 to 6, which already removed every static cloud import outside `lib/platform/`.

- [ ] **Step 1: Write the failing guard**

Append to `test/portability.test.mjs`:

```js
// A cloud's SDK is the platform's business: outside lib/platform/ a module reaches one only by
// a dynamic import, at the moment the choice is made, so a deployment on one cloud never loads
// another's.
const CLOUD = /^\s*import\s[^;]*?from\s+["'](@google-cloud\/[^"']+|google-auth-library|@anthropic-ai\/vertex-sdk|@azure\/[^"']+)["']/m;

// deploy/build/ runs in a deployment's image too, so it is held to the same rule.
const buildSources = fs.readdirSync(path.join(root, "deploy", "build")).map((f) => path.join("deploy", "build", f));

test("no module outside lib/platform/ imports a cloud SDK statically", () => {
  for (const file of [...sources, ...buildSources].filter((f) => !f.startsWith(path.join("lib", "platform") + path.sep))) {
    const m = CLOUD.exec(fs.readFileSync(path.join(root, file), "utf8"));
    assert.equal(m, null, `${file} imports ${m?.[1]}`);
  }
});

test("the guard can hit: a static import of a cloud SDK is found", () => {
  assert.ok(CLOUD.test('import { Firestore } from "@google-cloud/firestore";'));
  assert.ok(!CLOUD.test('const { X } = await import("@google-cloud/firestore");'));
});
```

- [ ] **Step 2: Run it, and show that it can fail**

Run: `node --test test/portability.test.mjs`

Expected: PASS, because Tasks 4 to 6 already moved every static cloud import into `lib/platform/`. A passing guard counts only once it has been seen to fail. So add `import { GoogleAuth } from "google-auth-library";` as the first line of `lib/report.mjs`, run the test again, and see it FAIL naming `lib/report.mjs imports google-auth-library`. Then remove the line and run the test a third time to see it PASS.

- [ ] **Step 3: Say in `bin/http.mjs` that the platform is chosen**

In the header comment, change `PORT is what Cloud Run sets.` to `PORT is what the platform sets.`. Change `for a local run without Vertex; \`--meter\` is CHAT_METER's, and \`memory\` is the local case.` to `for a local run without a model; the meter, the identity and the log line are CHAT_METER's, CHAT_IDENTITY's and CHAT_LOG's, and CHAT_METER=memory is the local case.`

- [ ] **Step 4: Make the cloud SDKs optional**

In `package.json`, move the three entries `"@anthropic-ai/vertex-sdk"`, `"@google-cloud/firestore"` and `"google-auth-library"` out of `dependencies` into a new `"optionalDependencies"` block placed after `dependencies`, with their version ranges unchanged. Then run `npm install --package-lock-only` and `npm ci`.

Check: `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).join(' '),'|',Object.keys(p.optionalDependencies).join(' '))"`

Expected: `@anthropic-ai/sdk @modelcontextprotocol/client | @anthropic-ai/vertex-sdk @google-cloud/firestore google-auth-library`

- [ ] **Step 5: Run the suite**

Run: `npm test`

Expected: all pass.

- [ ] **Step 6: Start it the way a Google deployment does, against the fixture, and read the start line**

Run: `npm run fixtures` if the suite has not already done so. Then start the process as `test/bin-http.test.mjs` does, with `CHAT_MCP_URL` set to the fixture host that test uses, `CHAT_ORIGINS=https://site.test CHAT_MONTH_TOKENS=1000 CHAT_PROJECT=p CHAT_REGION=eu PORT=0` and no `CHAT_METER`, and pass `--model fake`. Stop it by PID after the first line.

Expected: the first line on stdout is JSON whose keys start `severity`, `logging.googleapis.com/labels`, with `meter` equal to `firestore`. Firestore is loaded without being reached, because a meter makes no call until a message arrives.

- [ ] **Step 7: Commit**

```bash
git add bin/http.mjs package.json package-lock.json test/portability.test.mjs
git commit -F - <<'EOF'
No module outside lib/platform/ imports a cloud SDK

With the meter, the identity and the report behind the ports, no module outside lib/platform/ imports a cloud SDK, and a test now holds lib/, bin/ and deploy/build/ to that; it failed on a planted import before it passed. The three Google packages become optional dependencies, which npm ci still installs, so the deployments' images do not change; a test now fails on any static import of a cloud SDK outside lib/platform/, and a second test shows that the guard can hit.

Verified: npm test <count>; the guard failing on a planted import in lib/report.mjs and passing without it; the process started with no CHAT_METER against the fixture printed a Google-form start line naming meter firestore.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 8: Google's Terraform and workflows carry Google's name

**Files:**

- Move: `deploy/terraform` → `deploy/google/terraform`; `.github/workflows/deployment.yml` → `.github/workflows/deploy-google.yml`; `.github/workflows/report.yml` → `.github/workflows/report-google.yml`
- Modify: `.github/workflows/test.yml:24-25`, `README.md`, `docs/INTERFACE.md`

- [ ] **Step 1: Show that the old names are found before renaming (the positive control)**

Run: `git grep -n "deploy/terraform\|workflows/deployment\.yml\|workflows/report\.yml\|calling \`report\.yml\`\|package's \`report\.yml\`" -- . ':!docs/superpowers'`

Expected: hits in `.github/workflows/test.yml` and `README.md`. Write down every hit; each must be gone after Step 3.

- [ ] **Step 2: Move with history**

```bash
mkdir -p deploy/google
git mv deploy/terraform deploy/google/terraform
git mv .github/workflows/deployment.yml .github/workflows/deploy-google.yml
git mv .github/workflows/report.yml .github/workflows/report-google.yml
```

- [ ] **Step 3: Update the references**

- `.github/workflows/test.yml` lines 24-25: `deploy/terraform` → `deploy/google/terraform`.
- `README.md`, in the "Deploying it" paragraph:
  - `calling \`deploy/terraform\` at the same tag` → `calling \`deploy/google/terraform\` at the same tag`
  - `a workflow calling \`.github/workflows/deployment.yml\` at the same tag` → `a workflow calling \`.github/workflows/deploy-google.yml\` at the same tag`
  - `calling this package's \`report.yml\` at the same tag` → `calling this package's \`report-google.yml\` at the same tag`
  - Leave the deployment's own `.github/workflows/report.yml` as it is: that file is in the deployment's repository.
- `README.md`, in the paragraph that describes `CHAT_METER` (the one beginning `` `--model fake` answers one sentence ``):
  - Replace `` `CHAT_METER=memory` keeps the meter in the process; unset, the meter is Firestore. `` with `` `CHAT_METER` chooses the meter's store, `firestore`, the default, or `memory`, which keeps it in the process; `CHAT_IDENTITY` chooses where a federated service gets its identity token, `google`, the default, the only one this release has; `CHAT_LOG` chooses the log line's form, `google`, the default, or `plain`, which names the logger at the top of the line. Any other value stops the service at start with the values there are. The cloud packages each choice needs are optional dependencies, which `npm ci` installs. ``
  - After `CHAT_PROXY_HOPS` … `one by default.`, add: `` `CHAT_PROJECT` and `CHAT_REGION` are needed only for Vertex AI. ``
- `docs/INTERFACE.md` line 66: after the first sentence, add `A service started with \`CHAT_LOG=plain\` writes the logger as a top-level key, \`logger\`, in place of the label, for a platform that reads a line's top-level keys and not Cloud Logging's.`

- [ ] **Step 4: Check that the old names are gone and Terraform still validates**

Run the grep from Step 1 again.

Expected: no hits.

Run: `terraform -chdir=deploy/google/terraform init -backend=false -input=false && terraform -chdir=deploy/google/terraform validate && npx -y markdownlint-cli2 README.md docs/INTERFACE.md && npm test`

Expected: `Success! The configuration is valid.`, no markdownlint errors, and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A deploy .github README.md docs/INTERFACE.md
git commit -F - <<'EOF'
Google's Terraform and workflows carry Google's name

Azure's module and workflows will sit beside Google's, so the folder and the reusable workflows say which cloud they are for: deploy/terraform is now deploy/google/terraform, deployment.yml is deploy-google.yml and report.yml is report-google.yml, nothing inside them changed. A deployment keeps its old paths at its old tag and moves them with its next re-pin; Terraform addresses a module by its name, so its state is untouched. The README names the three choices, and INTERFACE.md the plain line.

Verified: git grep for the old paths, with hits before and none after; terraform validate on deploy/google/terraform; markdownlint-cli2 on README.md and docs/INTERFACE.md; npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 9: Open chat-server's pull request and stop

- [ ] **Step 1: Read the last two merged PR bodies for form**

Run: `gh pr list -R companygraph/chat-server --state merged --limit 2 --json number -q '.[].number' | xargs -I{} gh pr view {} -R companygraph/chat-server --json body -q .body`

- [ ] **Step 2: Push and open the PR**

Push with the gh credential helper, per the family's local toolchain notes: `git -c credential.helper='!gh auth git-credential' push -u https://github.com/companygraph/chat-server.git the-servers-run-on-two-clouds`. Then run `gh pr create -R companygraph/chat-server --head the-servers-run-on-two-clouds --title "The chat server reaches its platform through ports" --body-file <file>`.

The body is prose, with no headings and no bullets. Its first paragraph says why: the servers deploy only to Google, and the spec and plan in this PR design Azure beside it. Its second paragraph says what changed: the four ports, with Google's adapters as the defaults, the SDKs made optional, and the renamed folder and workflows. Its third paragraph gives the cost downstream: at the next re-pin, each deployment moves its module paths and workflow names along with the tag, and changes nothing else. Then comes the line `Release notes to write at tagging: …` with one sentence, then `Verified: …` with the commands that actually ran and the test count, and last the 🤖 line.

- [ ] **Step 3: Check the body and the checks, then stop**

Run: `gh pr view -R companygraph/chat-server --json body -q .body` and read it against the register. Then run `gh pr checks -R companygraph/chat-server --watch`.

Report the PR link and the checks' result to Rob, and wait. Do not merge.

---

## Part B: mcp-server

### Task 10: mcp-server's Google Terraform and workflow carry Google's name

**Files:**

- Move: `deploy/terraform` → `deploy/google/terraform`; `deploy/bootstrap` → `deploy/google/bootstrap`; `.github/workflows/deployment.yml` → `.github/workflows/deploy-google.yml`
- Modify: `.github/workflows/test.yml:28-31`, `README.md`, `deploy/google/bootstrap/README.md`, `test/deploy-tools.test.mjs:26,28`

- [ ] **Step 1: Make the worktree**

```bash
cd /Users/rob/git/companygraph
git -C mcp-server fetch -q
git -C mcp-server worktree add ../mcp-server-the-servers-run-on-two-clouds -b the-servers-run-on-two-clouds origin/main
cd mcp-server-the-servers-run-on-two-clouds && npm ci
```

- [ ] **Step 2: Positive control**

Run: `git grep -n "deploy/terraform\|deploy/bootstrap\|workflows/deployment\.yml" -- . ':!docs/superpowers'`

Expected: hits in `.github/workflows/test.yml`, `README.md`, `deploy/bootstrap/README.md` and `test/deploy-tools.test.mjs`. Write them all down.

- [ ] **Step 3: Move with history**

```bash
mkdir -p deploy/google
git mv deploy/terraform deploy/google/terraform
git mv deploy/bootstrap deploy/google/bootstrap
git mv .github/workflows/deployment.yml .github/workflows/deploy-google.yml
```

- [ ] **Step 4: Update every hit from Step 2**

- `test.yml`: `deploy/terraform` → `deploy/google/terraform`, and `deploy/bootstrap` → `deploy/google/bootstrap`.
- `deploy/google/bootstrap/README.md` line 24: `//deploy/bootstrap?ref=<tag>` → `//deploy/google/bootstrap?ref=<tag>`.
- `test/deploy-tools.test.mjs` line 26: `workflows/deployment.yml@${tag}` → `workflows/deploy-google.yml@${tag}`, and the fixture file name `"deployment.yml"` → `"deploy.yml"`, the name a deployment gives its caller. Line 28: `//deploy/terraform?ref=` → `//deploy/google/terraform?ref=`.
- `README.md` lines 58 and 62: every path named in the Step 2 hits, moved the same way.
- Also in `README.md`, add one sentence at the end of the paragraph on line 58: `Azure beside Google is designed in chat-server's [The servers run on two clouds](https://github.com/companygraph/chat-server/blob/main/docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md); this package's part so far is the Google folder's name.` The link resolves only once chat-server's PR is merged. That is why this PR opens after Task 9's PR merges; if Rob wants both open at once, leave the sentence out and add it in piece 2.

- [ ] **Step 5: Verify**

Run the grep from Step 2 again.

Expected: no hits.

Run: `for d in deploy/google/terraform deploy/google/bootstrap; do terraform -chdir=$d init -backend=false -input=false && terraform -chdir=$d validate; done && npx -y markdownlint-cli2 README.md deploy/google/bootstrap/README.md && npm test`

Expected: both configurations are valid, no markdownlint errors, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A deploy .github README.md test
git commit -F - <<'EOF'
Google's Terraform and workflow carry Google's name

Azure's module, bootstrap and workflow will sit beside Google's, as chat-server's two-clouds design has them, so this package's say which cloud they are for: deploy/terraform and deploy/bootstrap move under deploy/google/ and deployment.yml becomes deploy-google.yml, nothing inside them changed. A deployment keeps its old paths at its old tag and moves them with its next re-pin; Terraform addresses a module by its name, so neither state moves.

Verified: git grep for the old paths, with hits before and none after; terraform validate on both folders; markdownlint-cli2 on both READMEs; npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

- [ ] **Step 7: Open the PR and stop**

Follow Task 9's steps 1 to 3 against `companygraph/mcp-server`, with the title `Google's Terraform and workflow carry Google's name`. The body gives the same three things in prose: why, what moved, and what a deployment moves at its re-pin. Report the link to Rob and wait.

---

## Part C: releases and the re-pin proof

### Task 11: Release both servers

Only on Rob's word, after both PRs are merged.

- [ ] **Step 1: One release PR per repository**

In a new worktree per repository, named `<repo>-this-release-is-<version-with-dashes>` and based on `origin/main`, run `npm version minor --no-git-tag-version`. The version is the next minor above the one `package.json` holds at that moment; read it there and never from this plan. Commit `This release is <version>`, whose body says in one prose paragraph what the release carries, followed by `Verified: npm test <count>.`. Open the PR the way the repository's last release PR was opened (`gh pr list --state merged --search "This release is" --limit 1`), and stop.

- [ ] **Step 2: Tag after Rob merges**

Run: `gh release create v<version> -R companygraph/<repo> --target main --title v<version> --notes "<the release-notes sentence from the feature PR>"`. Then check it with `gh release view v<version> -R companygraph/<repo>`.

### Task 12: Re-pin the three deployments, and prove Google did not move

The repositories are `robertblust/mcp-blust-ch`, `companygraph/mcp-companygraph-io` and `guestgraph/mcp-guestgraph-io`. Before starting, ask Rob whether this wave should also carry any re-pin owed from other work, so the deployments move once.

- [ ] **Step 1: A worktree per deployment**

The worktree is `<repo>-the-servers-run-on-two-clouds`, based on `origin/main`.

- [ ] **Step 2: Move every pin and path**

`<M>` is mcp-server's new tag and `<C>` is chat-server's.

- Root: `npm install companygraph-mcp-server@github:companygraph/mcp-server#<M>`. Install it by name, because a stale lockfile otherwise keeps the old commit.
- `chat/`: `npm install companygraph-chat-server@github:companygraph/chat-server#<C>`.
- `infra/main.tf`: `//deploy/terraform?ref=<old>` → `//deploy/google/terraform?ref=<M>`.
- `infra/bootstrap/main.tf`: `//deploy/bootstrap?ref=<old>` → `//deploy/google/bootstrap?ref=<M>`.
- `infra/chat/main.tf`: `//deploy/terraform?ref=<old>` → `//deploy/google/terraform?ref=<C>`.
- `.github/workflows/deploy.yml`: `mcp-server/.github/workflows/deployment.yml@<old>` → `deploy-google.yml@<M>`.
- `.github/workflows/chat.yml`: `chat-server/.github/workflows/deployment.yml@<old>` → `deploy-google.yml@<C>`.
- `.github/workflows/report.yml`: `chat-server/.github/workflows/report.yml@<old>` → `report-google.yml@<C>`.
- `.github/workflows/publish.yml`, where it calls mcp-server's `registry.yml`: the tag only, to `<M>`.

Then run `grep -rn "deploy/terraform\|deploy/bootstrap\|deployment\.yml@\|report\.yml@" infra .github`.

Expected: no hits. As the positive control, the same grep on `origin/main` (`git grep … origin/main -- infra .github`) shows the old ones.

- [ ] **Step 3: Test locally**

Run: `npm test && (cd chat && npm test)`

Expected: all pass, including both pin tests, which hold every place to `<M>` and `<C>`.

- [ ] **Step 4: Commit, open the PR, and read its plans**

The commit subject is `The deployment re-pins to the servers' Google-named paths`, with a prose body and a `Verified:` line. Open the PR and stop.

When the plan comments arrive, read both, `infra` and `infra/chat`. Each must show `No changes.`, or show only the image, where the image digest moved because the server release moved. Any other resource in either plan is a finding: report it to Rob before anything merges.

- [ ] **Step 5: After Rob merges, prove each deployment live**

1. The deploy workflows' live checks pass. Read them with `gh run list -R <repo> --limit 3`.
2. One message sent by hand to each chat streams and cites. Use the `curl` in chat-server's README, section "Deploying it".
3. That question appears in the project's questions view within five minutes. Run `gcloud logging read '' --freshness=1h --impersonate-service-account chat-analyst@<project>.iam.gserviceaccount.com --bucket chat-questions --location <region> --view questions --project <project> --format 'value(jsonPayload.question)'`. It must print the question just sent. If the impersonation is refused, hand Rob the command.

Report the three results per deployment to Rob. Piece 1 is done when all nine hold.
