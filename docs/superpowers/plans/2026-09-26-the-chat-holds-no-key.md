# The chat holds no key implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployment on the Anthropic API authenticates with the service's own Google identity, traded through Workload Identity Federation for an Anthropic token that expires in minutes, instead of a key kept in Secret Manager. The change ships as a chat-server minor release, then the three deployments take it and the key is retired.

**Architecture:** `lib/config.mjs` reads the three federation ids, and the optional workspace, from the environment. It refuses a partial set, and it refuses a key and federation set together, so a leftover key can never quietly shadow federation. `lib/model.mjs` builds the `Anthropic` client with `credentials: oidcFederationProvider(...)` and an identity-token function that asks the Cloud Run metadata server for a Google-signed token with audience `https://api.anthropic.com`. The SDK's own token cache refreshes it. The Terraform module takes an `anthropic_federation` object; when it is set, the module writes the ids as plain environment variables and stops mounting `chat-anthropic-key`. A deployment names the object in `chat/chat.json`. The key path stays for local runs and for deployers without a Google project, and Vertex stays the default.

**Tech Stack:** `@anthropic-ai/sdk` ^0.127.0 (installed 0.127.0 ships `lib/credentials/oidc-federation`, so no upgrade is needed), Node 22 global `fetch`, `node:test`, Terraform >= 1.9 with google `~> 8.0`.

**Spec:** No separate spec. The design was settled in conversation with Rob on 2026-09-26 and is written down here under *Rulings*. Anthropic's pages are the reference and the executor reads both: `https://platform.claude.com/docs/en/manage-claude/workload-identity-federation.md` (concepts, credential precedence, token refresh) and `https://platform.claude.com/docs/en/manage-claude/wif-providers/gcp.md` (issuer, rule shape, metadata-server URL, TypeScript sample).

## Global Constraints

- **Worktree:** `~/git/companygraph/chat-server-the-chat-holds-no-key`, branch `the-chat-holds-no-key`, cut from `origin/main` at ffafbaf. The clone at `~/git/companygraph/chat-server` stays on `main` and is never edited. The worktree `chat-server-the-note-names-in-the-answers-language` belongs to another session and is not touched.
- **PATH:** `export PATH=/opt/homebrew/bin:$PATH` before any `node`, `npm`, `npx`, `gh`, `terraform` or `sh conventions/…` command. A push names the helper: `git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push`.
- **Exit codes:** every command's exit code is read on its own, never through a pipe into `tail` or `head`.
- **Test commands:** a single file runs as `node --test test/<name>.test.mjs`, the suite as `npm test`. `sh conventions/conventions-check` and `sh conventions/conventions-format check` exit 0 before every commit. Terraform is checked as CI checks it: `terraform -chdir=deploy/terraform init -backend=false -input=false`, `terraform -chdir=deploy/terraform validate`, `terraform fmt -check -recursive deploy`.
- **Unchanged surface:** the Vertex path stays, and stays the default. The key path stays and behaves exactly as today. `params`, the model id, effort, cache marks, weights and every route and event are untouched. `GET /chat` still says `provider: "anthropic"` on either Anthropic credential; the credential shows only in the start log line.
- **The environment variable names are the SDK's own:** `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID`. `ANTHROPIC_IDENTITY_TOKEN_FILE` is never set, because the token comes from the metadata server through code.
- **Identity-token request:** the audience is exactly `https://api.anthropic.com`, requested with `format=full` so the token carries `email`.
- **No network in the suite:** nothing in it reaches Anthropic, Google, Firestore or a live host. The federation test drives the real SDK through an injected `fetch`.
- **Instance facts:** `lib/` and `bin/` name no instance fact; `test/portability.test.mjs` holds them to that.
- **Markdown:** every paragraph is one line. Code comments say why, in the register of the surrounding file.
- **Commits** are in the git register of `conventions/WRITING.md`: a sentence subject under seventy characters with no prefix and no trailing period, one to three prose paragraphs with no headings, bullets or task numbers, a `Verified:` line naming what ran, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. The pull request body follows the same register and ends `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Review fixes:** a finding against a committed task is a new commit, never an amend.
- **Owner-only actions:** nothing is merged, tagged, released, deployed or deleted by an agent without Rob's explicit word for that step. The chat-server part ends at an open pull request.
- **No counts or versions that move:** no prose or comment states a count or version of something still changing.

## Rulings

1. **Both credentials set is refused at start.** When `ANTHROPIC_API_KEY` and the federation ids are both set, the service refuses to start, naming both, because the SDK would let the key win without a word. A partial federation set (one or two of the three ids) is refused, naming each id missing. `ANTHROPIC_WORKSPACE_ID` set without the three ids is refused too, because it would mean nothing.
2. **Config shape:** `config.anthropicFederation` is `{ ruleId, organizationId, serviceAccountId, workspaceId }` (the last one string or `null`) or `null`. `config.provider` is `"anthropic"` when a key or federation is set, else `"vertex"`. `config.credential` is `"key"`, `"federation"` or `"google"`, the last meaning Vertex under the runtime's Google credentials.
3. **Model shape:** the model object gains `credential` beside `provider`, and the start log line names it: `model claude-sonnet-5 via anthropic (federation)`. That line is how the owner confirms the switch.
4. **Explicit `null`s on the client:** the federated client is built with `apiKey: null` and `authToken: null` stated explicitly, because the SDK fills an `undefined` `apiKey` from `process.env.ANTHROPIC_API_KEY`, and a key outranks `credentials`. With both stated, even a stray environment key cannot shadow federation in-process. Ruling 1 guards the configuration, and this guards the client.
5. **The identity-token function** checks the metadata server's status and that the body has the three parts of a JWT, and throws a sentence naming the status otherwise. Anthropic's sample passes `response.text()` blindly, which would send an HTML error page as an assertion and surface as an opaque 401 at the exchange.
6. **Exchange endpoint:** `baseURL` for the exchange is the constant `https://api.anthropic.com`. `fetch` is injected into both the provider and the client, the global one by default, so a test can drive the whole path.
7. **Errors:** a failed exchange or metadata fetch is not `busy`. It reaches the loop as any other error and the visitor gets `internal`, as a Vertex credential failure does today. The metadata server is on the host and the SDK keeps the cached token through the advisory window, so this is a rare case, not a daily one.
8. **Terraform:** the module takes `anthropic_federation`, an object of `rule_id`, `organization_id`, `service_account_id` and optional `workspace_id`, default `null`, and valid only with `model_provider == "anthropic"`. When it is set, the secret mount is dropped and the ids become plain `env` entries. `chat-run` needs no new role, since a Cloud Run service may ask the metadata server for its own identity token.
9. **The ids live in `chat.json`, in the public deployment repository.** None of them is a credential: the rule accepts only a token Google signs for that project's `chat-run`, pinned by its numeric `sub` and its `email`. The deployment test checks their form through a pure function the package tests, `federationProblems(c)` in `deploy/build/config.mjs`.
10. **One Anthropic service account and one federation rule per deployment**, each pinned to that project's `chat-run` `sub` and `email`, so one site can be revoked without touching the others. The Google issuer, `https://accounts.google.com`, is registered once per Anthropic organization. Each rule targets the workspace that site's key uses today, so its spend limit keeps holding. `token_lifetime_seconds` is 600 and the scope is `workspace:developer`.
11. **The release is the next minor after `main`'s version when Task 4 runs**: `0.13.0` if `main` is still at `0.12.6`. Read `git show origin/main:package.json` first, because another session's branch may release before this one.
12. **Cutover and rollback:** each deployment switches in one pull request, since the same apply that sets the ids stops mounting the key. Rollback is reverting that pull request, which works as long as the key and its secret still exist. So the key is deleted only after every deployment has run on federation through at least one token refresh (more than ten minutes) and one full day.

## Review Focus

These are the five inputs the design implies and no happy-path test would cover. Each is pinned to the task that owns it.

1. **A leftover `ANTHROPIC_API_KEY` in `process.env` while the model is federated.** The request must still carry `Authorization: Bearer <federated token>` and no `x-api-key`. (Task 2, the federation test sets one.)
2. **Key and federation ids both in the environment.** Start is refused, naming both, rather than one winning silently. (Task 1)
3. **Only some of the three ids set, or a workspace id alone.** Start is refused, naming each missing id. (Task 1)
4. **The metadata server answers 404 or an HTML page.** The turn fails with a sentence naming the metadata server and the status, not an opaque 401 from the exchange, and it is not reported as `busy`. (Task 2)
5. **A `chat.json` whose `anthropic_federation` has a typo'd id, an extra key, or `provider` other than `anthropic`.** The deployment test fails with the field named, before any plan runs. (Task 3)

---

### Task 0: A working tree that passes

**Files:** this plan only.

- [ ] **Step 1: Install**

```sh
export PATH=/opt/homebrew/bin:$PATH
cd ~/git/companygraph/chat-server-the-chat-holds-no-key
git config user.email
npm ci; echo "exit $?"
ls node_modules/@anthropic-ai/sdk/lib/credentials/oidc-federation.mjs
```

Expected: the address is `robert.blust@flatland.ch`, `exit 0`, and the file exists.

- [ ] **Step 2: Baseline**

Run: `npm test; echo "exit $?"`

Expected: `exit 0`. A failure is reported before any task starts, never worked around.

- [ ] **Step 3: Commit the plan**

```sh
sh conventions/conventions-format check; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
git add docs/superpowers/plans/2026-09-26-the-chat-holds-no-key.md
git commit
```

Subject: `The plan for a chat that holds no key`. Body: one paragraph saying the chat on the Anthropic API trades the service's Google identity for a short-lived Anthropic token instead of reading a key from Secret Manager, the package's half first and then the three deployments. Then `Verified:` naming the conventions scripts and the baseline suite, and the trailer.

---

### Task 1: The config reads federation, and refuses what would shadow it

**Files:**

- Modify: `lib/config.mjs`
- Test: `test/config.test.mjs`

**Interfaces:**

- Produces: `configFromEnv(env)` returns, besides today's fields, `anthropicFederation` (`{ ruleId: string, organizationId: string, serviceAccountId: string, workspaceId: string | null } | null`) and `credential` (`"key" | "federation" | "google"`). `provider` is `"anthropic"` when `anthropicKey` or `anthropicFederation` is set.

- [ ] **Step 1: Failing tests**

Append to `test/config.test.mjs`:

```js
const ids = {
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_01test",
  ANTHROPIC_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000000",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_01test",
};

test("three federation ids name the Anthropic provider without a key, and the workspace is optional", () => {
  const c = configFromEnv({ ...full, ...ids });
  assert.equal(c.provider, "anthropic");
  assert.equal(c.credential, "federation");
  assert.equal(c.anthropicKey, null);
  assert.deepEqual(c.anthropicFederation, { ruleId: "fdrl_01test", organizationId: "00000000-0000-4000-8000-000000000000", serviceAccountId: "svac_01test", workspaceId: null });
  assert.equal(configFromEnv({ ...full, ...ids, ANTHROPIC_WORKSPACE_ID: " wrkspc_01test " }).anthropicFederation.workspaceId, "wrkspc_01test");
});

test("the credential is named on every path", () => {
  assert.equal(configFromEnv(full).credential, "google");
  assert.equal(configFromEnv(full).anthropicFederation, null);
  assert.equal(configFromEnv({ ...full, ANTHROPIC_API_KEY: "sk-ant-test" }).credential, "key");
});

test("a key beside the federation ids is refused, since the key would win without a word", () => {
  assert.throws(() => configFromEnv({ ...full, ...ids, ANTHROPIC_API_KEY: "sk-ant-test" }), /ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set/);
});

test("a partial set of federation ids names each one missing, and a workspace alone is refused", () => {
  assert.throws(() => configFromEnv({ ...full, ANTHROPIC_FEDERATION_RULE_ID: "fdrl_01test" }), /ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID are not set/);
  assert.throws(() => configFromEnv({ ...full, ...ids, ANTHROPIC_SERVICE_ACCOUNT_ID: "  " }), /ANTHROPIC_SERVICE_ACCOUNT_ID is not set/);
  assert.throws(() => configFromEnv({ ...full, ANTHROPIC_WORKSPACE_ID: "wrkspc_01test" }), /ANTHROPIC_WORKSPACE_ID is set without/);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/config.test.mjs; echo "exit $?"`

Expected: the four new tests fail (`credential` is undefined, nothing throws), and `exit 1`.

- [ ] **Step 3: Implement**

In `lib/config.mjs`, above `export function configFromEnv`, add:

```js
// Workload identity federation: the three ids name the rule, the organization and the Anthropic
// service account a token acts as, and the workspace is needed only where the rule spans more
// than one. None is a secret; the credential is the platform's own identity token. A partial set
// is a deployment half made, and is refused by name rather than read as no federation.
const FEDERATION = {
  ruleId: "ANTHROPIC_FEDERATION_RULE_ID",
  organizationId: "ANTHROPIC_ORGANIZATION_ID",
  serviceAccountId: "ANTHROPIC_SERVICE_ACCOUNT_ID",
};

function federationFromEnv(env) {
  const got = Object.fromEntries(Object.entries(FEDERATION).map(([k, name]) => [k, env[name]?.trim() || null]));
  const missing = Object.entries(FEDERATION).filter(([k]) => !got[k]).map(([, name]) => name);
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim() || null;
  if (missing.length === 3) {
    if (workspaceId) throw new Error("ANTHROPIC_WORKSPACE_ID is set without ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID");
    return null;
  }
  if (missing.length) throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set; federation needs all three ids`);
  return { ...got, workspaceId };
}
```

In `configFromEnv`, add `anthropicFederation: federationFromEnv(env),` after `anthropicKey`, and replace the line `c.provider = c.anthropicKey ? "anthropic" : "vertex";` with:

```js
  // The SDK lets a key win over federation without a word, so a deployment that still carries
  // its key after the switch would go on spending on the key it meant to retire.
  if (c.anthropicKey && c.anthropicFederation) throw new Error("ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set; set one, since the key would win");
  c.provider = c.anthropicKey || c.anthropicFederation ? "anthropic" : "vertex";
  c.credential = c.anthropicKey ? "key" : c.anthropicFederation ? "federation" : "google";
```

- [ ] **Step 4: Run and see them pass**

Run: `node --test test/config.test.mjs; echo "exit $?"`

Expected: all pass, `exit 0`.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format check; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
git add lib/config.mjs test/config.test.mjs
git commit
```

Subject: `The config reads federation and refuses a key beside it`. Body: the three ids and the optional workspace, why a partial set and a key beside them are refused at start, and the new `credential` field. Then `Verified:` and the trailer.

---

### Task 2: The model trades the service's identity for a token

**Files:**

- Modify: `lib/model.mjs`, `bin/http.mjs:49` (the start line)
- Test: `test/model.test.mjs`

**Interfaces:**

- Consumes: `config.anthropicKey`, `config.anthropicFederation`, `config.project`, `config.region` from Task 1.
- Produces:
  - `METADATA_IDENTITY_URL`, a string.
  - `googleIdentityToken(fetchFn = fetch)` returns `() => Promise<string>`.
  - `anthropicModel({ apiKey })` and `anthropicModel({ federation, fetch })` each return `{ name, provider: "anthropic", credential: "key" | "federation", turn }`.
  - `vertexModel(...)` gains `credential: "google"`.
  - `modelFor(config)` picks federation when `config.anthropicFederation` is set.

- [ ] **Step 1: Failing tests**

In `test/model.test.mjs`, change the import line to also take `googleIdentityToken, METADATA_IDENTITY_URL`, then append:

```js
const federation = { ruleId: "fdrl_01test", organizationId: "00000000-0000-4000-8000-000000000000", serviceAccountId: "svac_01test", workspaceId: null };

// The exchange's body is read as JSON, or as a form where the SDK sends one, so the test holds
// the fields and not the encoding.
const fields = (body) => { try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); } };

// A fetch that plays the metadata server, the token endpoint and the Messages API, and records
// what each was sent. The Messages API answers 429 with x-should-retry false, so the turn ends
// at once as busy, which proves the request was made with the traded token.
function fakeFetch({ metadata = () => new Response("h.p.s") } = {}) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    seen.push({ url: u, headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null });
    if (u.startsWith("http://metadata.google.internal/")) return metadata();
    if (u.endsWith("/v1/oauth/token")) return Response.json({ access_token: "sk-ant-oat01-test", token_type: "Bearer", expires_in: 600 });
    return Response.json({ type: "error", error: { type: "rate_limit_error", message: "slow" } }, { status: 429, headers: { "x-should-retry": "false" } });
  };
  return { fetch, seen };
}

const ask = (m) => m.turn(params({ system: "S", tools, messages: [{ role: "user", content: "q" }] }), () => {});

test("the identity token is asked of the metadata server for the Anthropic audience, in full", async () => {
  assert.equal(METADATA_IDENTITY_URL, "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://api.anthropic.com&format=full");
  const { fetch, seen } = fakeFetch({ metadata: () => new Response("h.p.s\n") });
  assert.equal(await googleIdentityToken(fetch)(), "h.p.s");
  assert.equal(seen[0].headers.get("metadata-flavor"), "Google");
});

test("a metadata answer that is not a token says so by status, before any exchange", async () => {
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("<html>", { status: 404 }) }).fetch)(), /metadata server answered 404/);
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("<html>") }).fetch)(), /not a token/);
});

test("a federated model trades the platform's token for a bearer, and a stray key in the environment does not shadow it", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-leftover";
  const { fetch, seen } = fakeFetch();
  try {
    const m = anthropicModel({ federation, fetch });
    assert.equal(m.provider, "anthropic");
    assert.equal(m.credential, "federation");
    await assert.rejects(ask(m), (e) => e.code === "busy");
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
  const exchange = seen.find((s) => s.url.endsWith("/v1/oauth/token"));
  assert.ok(exchange, "the token endpoint was asked");
  assert.equal(new URL(exchange.url).origin, "https://api.anthropic.com");
  const f = fields(exchange.body);
  assert.equal(f.grant_type, "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(f.assertion, "h.p.s");
  assert.equal(f.federation_rule_id, "fdrl_01test");
  assert.equal(f.organization_id, "00000000-0000-4000-8000-000000000000");
  assert.equal(f.service_account_id, "svac_01test");
  const message = seen.find((s) => s.url.endsWith("/v1/messages"));
  assert.ok(message, "the Messages API was asked");
  assert.equal(message.headers.get("authorization"), "Bearer sk-ant-oat01-test");
  assert.equal(message.headers.get("x-api-key"), null, "no key rides along");
});

test("a metadata server that fails ends the turn as an error that names it, and never as busy", async () => {
  const { fetch, seen } = fakeFetch({ metadata: () => new Response("<html>", { status: 404 }) });
  await assert.rejects(ask(anthropicModel({ federation, fetch })), (e) => e.code !== "busy" && /metadata server answered 404/.test(`${e?.message} ${e?.cause?.message}`));
  assert.ok(!seen.some((s) => s.url.endsWith("/v1/messages")), "no message was sent without a token");
});

test("the chooser picks federation from the config, and each model names its credential", () => {
  const base = { project: "p", region: "eu", anthropicKey: null, anthropicFederation: null };
  assert.equal(modelFor(base).credential, "google");
  assert.equal(modelFor({ ...base, anthropicKey: "sk-ant-test" }).credential, "key");
  const f = modelFor({ ...base, anthropicFederation: federation });
  assert.equal(f.provider, "anthropic");
  assert.equal(f.credential, "federation");
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/model.test.mjs; echo "exit $?"`

Expected: the new tests fail (the imports are undefined, `credential` is undefined), and `exit 1`.

- [ ] **Step 3: Implement**

In `lib/model.mjs`:

Change the second paragraph of the header comment to: `Two providers answer the same request: Vertex AI in the deployment's own project, or the Anthropic API direct, with a key or with the service's own identity traded for a short-lived token. Both speak the same Messages surface, so one \`turn\` covers every client; only how the client is built differs.`

Add the import below the `Anthropic` import:

```js
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";
```

Change `over` to carry the credential:

```js
function over(provider, credential, build) {
  let client;
  return {
    name: MODEL,
    provider,
    credential,
```

(the rest of `over` unchanged), and `vertexModel` to `over("vertex", "google", () => …)`.

Replace `anthropicModel` with:

```js
// The Google Cloud the service runs on signs a token for its own account on request, for the
// audience the federation rule pins; `full` puts the account's email in it, which the rule
// matches beside the numeric id. The status and the token's shape are checked here because an
// error page sent on as an assertion comes back from the exchange as a bare 401.
export const ANTHROPIC_API = "https://api.anthropic.com";
export const METADATA_IDENTITY_URL = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${ANTHROPIC_API}&format=full`;

export const googleIdentityToken = (fetchFn = fetch) => async () => {
  const res = await fetchFn(METADATA_IDENTITY_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new Error(`the metadata server answered ${res.status} when asked for an identity token`);
  const token = (await res.text()).trim();
  if (token.split(".").length !== 3) throw new Error("the metadata server answered something that is not a token");
  return token;
};

// The Anthropic API direct: the same Messages surface and the same model id, with a key, or with
// the service's identity traded through workload identity federation for a token that lives
// minutes, which the SDK's own cache refreshes before it lapses. The key and the auth token are
// stated as null on the federated client, since the SDK otherwise reads a key from the
// environment and a key outranks every other credential.
export const anthropicModel = ({ apiKey, federation, fetch: fetchFn = globalThis.fetch }) =>
  apiKey
    ? over("anthropic", "key", () => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }))
    : over("anthropic", "federation", () => new Anthropic({
      apiKey: null,
      authToken: null,
      credentials: oidcFederationProvider({
        identityTokenProvider: googleIdentityToken(fetchFn),
        federationRuleId: federation.ruleId,
        organizationId: federation.organizationId,
        serviceAccountId: federation.serviceAccountId,
        workspaceId: federation.workspaceId ?? undefined,
        baseURL: ANTHROPIC_API,
        fetch: fetchFn,
      }),
      fetch: fetchFn,
      maxRetries: 1,
      timeout: 60_000,
    }));

export const modelFor = (config) =>
  config.anthropicKey ? anthropicModel({ apiKey: config.anthropicKey })
    : config.anthropicFederation ? anthropicModel({ federation: config.anthropicFederation })
      : vertexModel({ project: config.project, region: config.region });
```

In `bin/http.mjs` line 49, change `model ${model.name} via ${model.provider}` to `model ${model.name} via ${model.provider} (${model.credential})`, and add `credential: model.credential` to the structured fields after `provider: model.provider`. The `fakeModel` near line 22 gains `credential: "none"`.

- [ ] **Step 4: Run and see them pass**

```sh
node --test test/model.test.mjs; echo "exit $?"
npm test; echo "exit $?"
```

Expected: `exit 0` twice. If the federation test fails because the SDK sends the exchange to a path other than `/v1/oauth/token`, or reads `fetch` from somewhere other than the option, read `node_modules/@anthropic-ai/sdk/lib/credentials/oidc-federation.mjs` and fix the fake to match what the SDK actually does. Do not weaken an assertion about the bearer, the missing key, or the exchange's fields.

- [ ] **Step 5: Commit**

```sh
sh conventions/conventions-format check; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
git add lib/model.mjs bin/http.mjs test/model.test.mjs
git commit
```

Subject: `The model trades the service's identity for a short-lived token`. Body: the metadata-server token with the pinned audience, the SDK's federation provider and its cache, why the key and auth token are stated as null, and the credential in the start line. Then `Verified:` and the trailer.

---

### Task 3: The module and the deployment test take federation

**Files:**

- Modify: `deploy/terraform/variables.tf`, `deploy/terraform/run.tf`, `deploy/build/config.mjs`, `deploy/test/config.mjs`
- Test: `test/deploy-config.test.mjs` (create)

**Interfaces:**

- Produces:
  - Module input `anthropic_federation` (`object({ rule_id = string, organization_id = string, service_account_id = string, workspace_id = optional(string) })`, default `null`).
  - `federationProblems(c)` in `deploy/build/config.mjs` returns `string[]`, empty when `chat.json` is sound.
  - `chat.json` key `anthropic_federation`: `{ "rule_id", "organization_id", "service_account_id", "workspace_id"? }`.

- [ ] **Step 1: Failing test**

Create `test/deploy-config.test.mjs`:

```js
// A deployment's chat.json is checked by the deployment's own suite; the check itself is a pure
// function, held here so a typo in an id fails with the field named before any plan runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { federationProblems } from "../deploy/build/config.mjs";

const sound = { provider: "anthropic", anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC" } };

test("a chat.json without federation, or with sound federation, has no problem", () => {
  assert.deepEqual(federationProblems({ provider: "anthropic" }), []);
  assert.deepEqual(federationProblems({}), []);
  assert.deepEqual(federationProblems(sound), []);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...sound.anthropic_federation, workspace_id: "wrkspc_01AbC" } }), []);
});

test("each wrong field is named", () => {
  const f = sound.anthropic_federation;
  assert.deepEqual(federationProblems({ ...sound, provider: "vertex" }), ["anthropic_federation needs provider anthropic"]);
  assert.deepEqual(federationProblems({ provider: "anthropic", anthropic_federation: "fdrl_01AbC" }), ["anthropic_federation is an object"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, rule_id: "fdis_01AbC" } }), ["rule_id is an fdrl_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, organization_id: "org-1" } }), ["organization_id is the organization's UUID"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, service_account_id: undefined } }), ["service_account_id is an svac_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, workspace_id: "default" } }), ["workspace_id is a wrkspc_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, ruleId: "fdrl_01AbC" } }), ["ruleId is not a field of anthropic_federation"]);
});
```

- [ ] **Step 2: Run and see it fail**

Run: `node --test test/deploy-config.test.mjs; echo "exit $?"`

Expected: fails because `federationProblems` is not exported, `exit 1`.

- [ ] **Step 3: Implement the check**

Append to `deploy/build/config.mjs`:

```js
// chat.json's federation, checked by form: Terraform drops a key its object type does not name
// and says nothing, so a misspelt field would deploy as a missing one.
const FEDERATION_FIELDS = {
  rule_id: [/^fdrl_\w+$/, "rule_id is an fdrl_ id"],
  organization_id: [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "organization_id is the organization's UUID"],
  service_account_id: [/^svac_\w+$/, "service_account_id is an svac_ id"],
};

export function federationProblems(c) {
  if (!("anthropic_federation" in c)) return [];
  const f = c.anthropic_federation;
  const problems = c.provider === "anthropic" ? [] : ["anthropic_federation needs provider anthropic"];
  if (!f || typeof f !== "object" || Array.isArray(f)) return [...problems, "anthropic_federation is an object"];
  for (const [k, [form, sentence]] of Object.entries(FEDERATION_FIELDS)) if (!form.test(f[k] ?? "")) problems.push(sentence);
  if ("workspace_id" in f && !/^wrkspc_\w+$/.test(f.workspace_id ?? "")) problems.push("workspace_id is a wrkspc_ id");
  for (const k of Object.keys(f)) if (!(k in FEDERATION_FIELDS) && k !== "workspace_id") problems.push(`${k} is not a field of anthropic_federation`);
  return problems;
}
```

In `deploy/test/config.mjs`, import it (`import { ROOT, chat, federationProblems } from "../build/config.mjs";`) and add inside the first test, after the `provider` line:

```js
    assert.deepEqual(federationProblems(c), [], "anthropic_federation is sound");
```

- [ ] **Step 4: Implement the module**

Append to `deploy/terraform/variables.tf`:

```hcl
# With the Anthropic API, the service trades its own Google identity for a token that lives
# minutes when the owner has made a federation rule for it, and reads the key from the project's
# secret when not. The ids are the rule's, the organization's and the Anthropic service
# account's, and none is a secret: only a token Google signs for this project's chat-run passes
# the rule. The workspace is needed only where the rule spans more than one.
variable "anthropic_federation" {
  type = object({
    rule_id            = string
    organization_id    = string
    service_account_id = string
    workspace_id       = optional(string)
  })
  default = null
  validation {
    condition     = var.anthropic_federation == null || var.model_provider == "anthropic"
    error_message = "anthropic_federation is for model_provider anthropic."
  }
}
```

Change the comment on `model_provider` so it ends: `… or the Anthropic API, with a key the owner put in the project's secret \`chat-anthropic-key\` or, when anthropic_federation is set, with the service's own identity and no secret at all.`

In `deploy/terraform/run.tf`, replace the `locals` block with:

```hcl
locals {
  run_host = var.run_host
  # The SDK's own names, so the environment reads the same to anyone who knows the SDK.
  federation_env = var.anthropic_federation == null ? {} : {
    for k, v in {
      ANTHROPIC_FEDERATION_RULE_ID = var.anthropic_federation.rule_id
      ANTHROPIC_ORGANIZATION_ID    = var.anthropic_federation.organization_id
      ANTHROPIC_SERVICE_ACCOUNT_ID = var.anthropic_federation.service_account_id
      ANTHROPIC_WORKSPACE_ID       = var.anthropic_federation.workspace_id
    } : k => v if v != null
  }
}
```

Change the key's dynamic block's comment and condition to:

```hcl
      # With the Anthropic API and no federation, the key rides in from the project's secret,
      # latest version. The secret is the owner's: the module neither makes it nor grants access
      # to it, so a deploy that mounts it before the owner's three commands fails at Cloud Run's
      # own check, by name. With federation the key is not mounted at all, and the service
      # refuses to start with both, so the switch is this one condition.
      dynamic "env" {
        for_each = var.model_provider == "anthropic" && var.anthropic_federation == null ? [1] : []
```

and add after that block, inside `containers`:

```hcl
      dynamic "env" {
        for_each = local.federation_env
        content {
          name  = env.key
          value = env.value
        }
      }
```

- [ ] **Step 5: Run everything**

```sh
node --test test/deploy-config.test.mjs; echo "exit $?"
npm test; echo "exit $?"
terraform -chdir=deploy/terraform init -backend=false -input=false; echo "exit $?"
terraform -chdir=deploy/terraform validate; echo "exit $?"
terraform fmt -check -recursive deploy; echo "exit $?"
```

Expected: every `exit 0`. If `validate` rejects the conditional's two result types, write the empty branch as `tomap({})`.

- [ ] **Step 6: Commit**

```sh
sh conventions/conventions-format check; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
git add deploy/terraform/variables.tf deploy/terraform/run.tf deploy/build/config.mjs deploy/test/config.mjs test/deploy-config.test.mjs
git commit
```

Subject: `The module takes federation in place of the key`. Body: the new input and its validation, the ids as plain environment entries under the SDK's names, the secret mount dropped when federation is set, `chat-run` needing no new role, and the deployment test checking the ids' form. Then `Verified:` naming the suite, init, validate and fmt, and the trailer.

---

### Task 4: The README, the owner's steps and the version

**Files:**

- Modify: `README.md`, `package.json`, `package-lock.json`

- [ ] **Step 1: The README**

In the environment paragraph (line 27), after `the key is the credential and the provider follows it.` insert: `With \`ANTHROPIC_FEDERATION_RULE_ID\`, \`ANTHROPIC_ORGANIZATION_ID\` and \`ANTHROPIC_SERVICE_ACCOUNT_ID\` set instead, and \`ANTHROPIC_WORKSPACE_ID\` where the rule spans more than one workspace, the service calls the Anthropic API with no key: it asks the Google Cloud it runs on for its own identity token and trades it for an Anthropic token that lives minutes, which is how a deployment runs; a key stays the way to run it on a machine. A key and the federation ids together, or only some of the ids, stop the service at start with the names, since the key would otherwise win without a word.`

In the deployment paragraph (line 31), after the sentence about `model_provider = lookup(local.c, "provider", "vertex")` insert: `A deployment on the Anthropic API names \`anthropic_federation\` in \`chat.json\`, an object of \`rule_id\`, \`organization_id\`, \`service_account_id\` and, where needed, \`workspace_id\`, which \`infra/chat/main.tf\` passes as \`anthropic_federation = try(local.c.anthropic_federation, null)\`; the module then sets those ids in the service's environment and mounts no secret. The ids are no credential and belong in the repository, since only a token Google signs for the project's \`chat-run\` passes the rule.`

In the owner's paragraph (line 35), replace the sentence from `A deployment on the Anthropic API instead makes a workspace` through `Model Garden and the quota then do not apply.` with: `A deployment on the Anthropic API instead makes a workspace in the Anthropic Console with a monthly spend limit, which is the hard stop Google does not give, and connects the service to it once under Settings, Workload identity, Connect workload, Google Cloud: the issuer \`https://accounts.google.com\`, made once for the organization; an Anthropic service account for this deployment, a member of that workspace; and a rule with audience \`https://api.anthropic.com\` matching the claims \`sub\`, the number \`gcloud iam service-accounts describe chat-run@<project>.iam.gserviceaccount.com --format='value(uniqueId)' --project <project>\` prints, and \`email\`, \`chat-run@<project>.iam.gserviceaccount.com\`, scope \`workspace:developer\`, lifetime six hundred seconds; the rule's, the organization's and the service account's ids then go into \`chat.json\`. Never match Google's \`sub\` by prefix: it is a bare number, and a prefix admits service accounts of any project. A deployment that cannot federate keeps a key instead, in the project's secret, made once with the key on stdin and never in a file: \`gcloud services enable secretmanager.googleapis.com --project <project>\`, \`gcloud secrets create chat-anthropic-key --replication-policy automatic --project <project>\`, \`printf '%s' "$KEY" | gcloud secrets versions add chat-anthropic-key --data-file=- --project <project>\`, and \`gcloud secrets add-iam-policy-binding chat-anthropic-key --member serviceAccount:chat-run@<project>.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor --project <project>\`. Model Garden and the quota then do not apply.`

- [ ] **Step 2: The version**

```sh
git show origin/main:package.json | grep '"version"'
npm version 0.13.0 --no-git-tag-version; echo "exit $?"
git diff --stat package.json package-lock.json
```

Expected: `main` is at `0.12.6`, so `0.13.0` is right. If `main` has moved, use the next minor after it instead. `exit 0`, and two files changed, one version line each.

- [ ] **Step 3: Check and commit**

```sh
sh conventions/conventions-format check; echo "exit $?"
sh conventions/conventions-check; echo "exit $?"
npm test; echo "exit $?"
git add README.md package.json package-lock.json
git commit
```

Subject: `The README tells the owner to federate, and the release is 0.13.0`. Body: the environment sentence, the deployment's `anthropic_federation`, the owner's Console step replacing the secret with the secret kept as the fallback, and a line saying nothing breaks, since a deployment without the object runs as before. Then `Verified:` and the trailer.

---

### Task 5: Push and open the pull request

**Files:** none changed.

- [ ] **Step 1: Read the register**

Run: `gh pr list --repo companygraph/chat-server --state merged --limit 2 --json number,title,body`. Write the body in that register.

- [ ] **Step 2: Push and open**

```sh
git -c credential.helper='!/opt/homebrew/bin/gh auth git-credential' push -u origin the-chat-holds-no-key; echo "exit $?"
gh pr create --repo companygraph/chat-server --base main --head the-chat-holds-no-key --title "The chat holds no key" --body-file -
```

Write the body as prose:

- What changes: federation in the config, the model, the module and the deployment test.
- Why a key beside the ids is refused.
- That nothing breaks for a deployment that names no `anthropic_federation`.
- What follows outside this repository, in order: the release, the owner's Console step per deployment, the three deployment re-pins, then retiring the keys and secrets after a day.

End with `Verified:` naming the suite, the conventions scripts, and init, validate and fmt on the module, then the generated-with line.

- [ ] **Step 3: Stop**

Report the pull request's URL and stop. Merging, tagging and releasing are Rob's (release notes in the register, with an Interface line saying nothing breaks).

---

## After the release

These tasks begin only after Rob has merged the pull request and released the tag, and each owner step waits for Rob. The rollout order is the one the last re-pin used: mcp.blust.ch first and measured, then companygraph.io and guestgraph.io on Rob's word.

### Task 6 (Rob): Connect each deployment in the Anthropic Console

Per deployment, with its project (`blust-ch-mcp`, `companygraph-io-mcp`, `guestgraph-io-mcp`, each from its repository's `deployment.json`):

- [ ] **Step 1:** Print the runtime's numeric id: `gcloud iam service-accounts describe chat-run@<project>.iam.gserviceaccount.com --format='value(uniqueId)' --project <project>`.
- [ ] **Step 2:** In the Console, go to Settings, Workload identity, Connect workload, Google Cloud. Register the issuer `https://accounts.google.com` on the first deployment only, and choose the existing one after that. Create the Anthropic service account `chat-<site>` (`chat-blust-ch`, `chat-companygraph-io`, `chat-guestgraph-io`) and add it to the workspace that site's key belongs to today. Create the rule: audience `https://api.anthropic.com`; claims `sub` = the number from Step 1 and `email` = `chat-run@<project>.iam.gserviceaccount.com`; scope `workspace:developer`; lifetime 600.
- [ ] **Step 3:** Hand the agent three ids: the rule (`fdrl_…`), the organization (UUID) and the service account (`svac_…`). They are not secrets.

### Task 7: The three deployment re-pins

One pull request per repository: `robertblust/mcp-blust-ch`, `companygraph/mcp-companygraph-io`, `guestgraph/mcp-guestgraph-io`. Each lives in a sibling worktree `<repo>-the-chat-holds-no-key` on branch `the-chat-holds-no-key`, and each changes these files:

- [ ] **Step 1: The pin, in its four places, plus the lockfile.** Move the tag in `chat/package.json`, `infra/chat/main.tf`'s module `ref=`, `.github/workflows/chat.yml` and `.github/workflows/report.yml`. Re-resolve the lockfile with `cd chat && rm -rf node_modules package-lock.json && npm install; echo "exit $?"`. Then prove it by reading `packages["node_modules/companygraph-chat-server"]` in `chat/package-lock.json` (`version` and `resolved`) and comparing the sha against `gh api repos/companygraph/chat-server/git/refs/tags/v<release>`. A grep for the tag string is not proof. Confirm that nothing else in the lockfile moved.
- [ ] **Step 2: The ids.** Add `"anthropic_federation": { "rule_id": "<from Task 6>", "organization_id": "<from Task 6>", "service_account_id": "<from Task 6>" }` to `chat/chat.json`, next to `"provider": "anthropic"`. In `infra/chat/main.tf`, add `anthropic_federation = try(local.c.anthropic_federation, null)` below `model_provider`.
- [ ] **Step 3: Check.** Run `cd chat && npm test; echo "exit $?"` (the deployment suite now runs `federationProblems`), then `terraform fmt -check -recursive infra; echo "exit $?"`.
- [ ] **Step 4: Commit and open.** Subject: `The chat trades its identity for a token: v<release>`, with the body in the register. The pull request's plan should show one change on the Cloud Run service: `ANTHROPIC_API_KEY`'s secret reference removed and three plain `ANTHROPIC_*` entries added. Read the plan comment and say so in the PR. Stop at the open PR.

### Task 8 (Rob, then the agent on Rob's word): Verify, then retire the key

- [ ] **Step 1:** After the merge and deploy, read the start line: `gcloud logging read 'resource.labels.service_name="chat" AND jsonPayload.kind="start"' --limit 1 --project <project> --format 'value(jsonPayload.message)'`. It must say `via anthropic (federation)`.
- [ ] **Step 2:** Ask one question on the site (for mcp.blust.ch, the same German question as the last measurement). The answer streams, and the Console's authentication history page shows a successful exchange for the rule.
- [ ] **Step 3:** More than ten minutes later, ask again. The answer streams, which proves the refresh and that Google's tokens do not trip the single-use `jti` check. If it fails with `jti_reused`, stop and report; do not disable `check_jti` without Rob's decision.
- [ ] **Step 4:** After every deployment has run on federation for a full day, retire the old credentials per project: delete the key in the Console under Settings, API keys, then run `gcloud secrets delete chat-anthropic-key --project <project>`. This is irreversible, so Rob does it or says so for each project.
- [ ] **Step 5:** Update the memory notes `chat-on-the-sites` and `chat-provider-openai-compatible`: the credential is now federation, and the key survives only as the documented fallback.
