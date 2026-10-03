# The servers run on two clouds, piece 2 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Azure beside Google in both servers: the chat's three Azure adapters, deployment checks by platform, Terraform modules and a bootstrap under `deploy/azure/`, and the workflows `deploy-azure.yml` and `report-azure.yml`, proven offline, then released.

**Architecture:** The ports piece 1 made get their Azure adapters under `lib/platform/azure/`: a Table Storage meter store with ETag retries, an identity token from Container Apps' managed-identity endpoint by plain `fetch`, and a question source that queries Log Analytics and writes to Blob Storage. The config reads each adapter's values at start and refuses a missing one by name. The Terraform in this plan was written and validated against azurerm 5.7 and azapi 2.13 under Terraform 1.9.8 and 1.16.3 before the plan quotes it; nothing is applied, because no Azure subscription exists yet.

**Tech Stack:** Node >= 22 ESM, `node:test`, `@azure/identity` ^4.13.3, `@azure/data-tables` ^13.3.2, `@azure/storage-blob` ^12.34.0, Terraform with `hashicorp/azurerm` `~> 5.7` and `Azure/azapi` `~> 2.13`, GitHub reusable workflows with `azure/login@v3`.

**Spec:** `docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md` in chat-server. This plan is piece 2 of its §7. Research done for this plan, with sources, changed three things the spec said; Task 7 writes them into the spec, and they bind this plan:

1. **Kept questions:** Azure cannot fork one log stream into two tables, so the environment sends its console lines to two workspaces through two diagnostic settings, and a workspace transformation on each decides what stays: the chat's workspace `chat-questions` (90 days) keeps only the chat's `kind == "question"` lines, and the general workspace `logs` (30 days) keeps everything else. The analyst reads `chat-questions` alone.
2. **The domain:** azurerm cannot bind a managed certificate (terraform-provider-azurerm#27362), so the bind is one `azapi_resource_action` PATCH, and the domain is added only when `dns_ready` is true, since Azure checks the records at creation.
3. **GitHub trust:** the federated credentials name GitHub's immutable subject, `repo:OWNER@OWNER_ID/REPO@REPO_ID:…`, the default for repositories created after 2026-07-15 and an opt-in for older ones, which is the Azure equivalent of Google's trust by `repository_id`.

## Global Constraints

- Google stays as it is: no Google file, default or behaviour changes, and the three deployments need no re-pin for this piece.
- New choice values: `CHAT_METER` gains `table`; `CHAT_IDENTITY` gains `azure`. Defaults stay `firestore` and `google`.
- `CHAT_METER=table` needs `CHAT_TABLE_URL` and `AZURE_CLIENT_ID`. `CHAT_IDENTITY=azure` with federation needs `IDENTITY_ENDPOINT`, `IDENTITY_HEADER`, `AZURE_CLIENT_ID` and `CHAT_IDENTITY_AUDIENCE`. A missing one refuses the start with `<choice> needs <names>, which is/are not set`.
- A chat on Azure uses the Anthropic API through federation only: `provider` is `anthropic` and `anthropic_federation` names `audience`, the client id (a GUID) of the tenant's app registration standing for the Claude API.
- `deployment.json` gains `platform`, `google` or `azure`, `google` when absent. An Azure `deployment.json` names `tenant_id`, `subscription_id`, `resource_group`, `location`, `container_registry`, `state_account`, `domain`, `budget_chf`, `budget_start`, `repository`, `repository_id`, `owner_id`, `terraform_client_id`, `plan_client_id`, `deploy_client_id`, and after the first applies `app_host` and `dns_ready`. `registry_name` keeps meaning the MCP Registry name, on both platforms.
- An Azure `chat.json` names `domain`, `mcp_url`, `origins`, `month_tokens`, `provider`, `anthropic_federation`, `storage_account`, and after the first applies `app_host`, `dns_ready`, `questions_workspace_id` and `analyst_client_id`.
- No file outside `lib/platform/` imports a cloud SDK statically; the `@azure/*` packages are `optionalDependencies`.
- Terraform: `required_version = ">= 1.9"`, azurerm `~> 5.7`, azapi `~> 2.13`; CI validates with Terraform 1.9.8 as today.
- Every branch lives in a sibling worktree `<repo>-<branch>`; the clone stays on its default branch.
- Commit messages and PR bodies follow the family's git register: a plain-sentence subject under seventy characters with no type prefix and no trailing period; a prose body with no headings and no bullets; a `Verified:` line naming the commands actually run, ending with a period; then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Open each PR and stop. Merging, tagging and releasing each need Rob's word.
- Before running anything: `export PATH=/opt/homebrew/bin:$PATH`.

## Review Focus

1. **Two replicas writing the meter at once.** One `updateEntity` meets a changed ETag and gets 412. The store must read again and retry, and after five lost races refuse with a sentence rather than loop. Pinned in Task 2.
2. **`CHAT_METER=table` or `CHAT_IDENTITY=azure` missing one of its values.** The start must refuse naming every missing variable, not fail at the first message. Pinned in Tasks 1 and 2.
3. **The managed-identity endpoint answering 200 with something that is not a token**, such as JSON without `access_token` or an HTML page. It must be a `CredentialError` naming the endpoint, never sent on to Anthropic. Pinned in Task 1.
4. **A console line in the questions workspace that is not JSON**, such as a stack trace. The report must skip it and count only question lines. Pinned in Task 3.
5. **A Google `chat.json` or `deployment.json` as the three live deployments have them.** The new platform checks must pass them unchanged, and an Azure file carrying a Google field (or the reverse) must be refused by name. Pinned in Tasks 4 and 8.

---

## Part A: chat-server

Work in `/Users/rob/git/companygraph/chat-server-the-servers-run-on-azure`, branch `the-servers-run-on-azure`, made from origin/main at `9f5e16a` (v0.18.0). It holds this plan. Run `npm ci` there once before Task 1 if `node_modules` is absent.

### Task 1: The identity token can come from Azure's managed identity

**Files:**

- Create: `lib/platform/azure/identity.mjs`, `test/azure-identity.test.mjs`
- Modify: `lib/platform.mjs`, `lib/config.mjs`, `bin/http.mjs`, `test/config.test.mjs`, `test/platform.test.mjs`

**Interfaces:**

- Consumes: `ANTHROPIC_API`, `TOKEN_TIMEOUT_MS`, `credentialError`, `asToken` from `lib/credential.mjs`; `IDENTITIES`, `identityTokenSource(kind, adapters = IDENTITIES)` from `lib/platform.mjs`.
- Produces:
  - `azureIdentityToken(fetchFn = fetch, { timeoutMs, identityEndpoint, identityHeader, clientId, audience }) → () => Promise<string>`.
  - `IDENTITIES.azure`.
  - `configFromEnv(env).identityOptions`: `{ identityEndpoint, identityHeader, clientId, audience }` when `identity === "azure"` and federation is set, else `{}`.
  - `needAll(env, choice, names)` inside `lib/config.mjs`, which Task 2 reuses.

- [ ] **Step 1: Write the failing tests**

Create `test/azure-identity.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { azureIdentityToken } from "../lib/platform/azure/identity.mjs";

const opts = { identityEndpoint: "http://localhost:42356/msi/token", identityHeader: "hdr-1", clientId: "11111111-2222-3333-4444-555555555555", audience: "api://66666666-7777-8888-9999-000000000000" };
const answer = (status, body) => async (url, init) => { answer.last = { url: String(url), init }; return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); };

test("the token is asked of the endpoint Container Apps gives, for the audience, as the user-assigned identity", async () => {
  const token = await azureIdentityToken(answer(200, { access_token: "h.p.s", expires_on: "1790000000" }), opts)();
  assert.equal(token, "h.p.s");
  const u = new URL(answer.last.url);
  assert.equal(u.origin + u.pathname, "http://localhost:42356/msi/token");
  assert.equal(u.searchParams.get("api-version"), "2019-08-01");
  assert.equal(u.searchParams.get("resource"), opts.audience);
  assert.equal(u.searchParams.get("client_id"), opts.clientId);
  assert.equal(answer.last.init.headers["X-IDENTITY-HEADER"], "hdr-1");
});

test("an answer that is not a token is a credential error naming the endpoint, before any exchange", async () => {
  await assert.rejects(azureIdentityToken(answer(401, { error: "invalid_request" }), opts)(), (e) => e.name === "CredentialError" && e.statusCode === 401 && /managed identity endpoint answered 401/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, "<html>"), opts)(), (e) => e.name === "CredentialError" && /not JSON/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, { token_type: "Bearer" }), opts)(), (e) => e.name === "CredentialError" && /not a token/.test(e.message));
  await assert.rejects(azureIdentityToken(answer(200, { access_token: "<html>.<p>.x y" }), opts)(), /not a token/);
});

test("an endpoint that cannot be reached, or does not answer in time, is named as such", { timeout: 3000 }, async () => {
  const down = async () => { throw new TypeError("fetch failed"); };
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  await assert.rejects(azureIdentityToken(down, opts)(), (e) => e.name === "CredentialError" && /could not be reached: fetch failed/.test(e.message));
  await assert.rejects(azureIdentityToken(hang, { ...opts, timeoutMs: 50 })(), (e) => e.name === "CredentialError" && /could not be reached/.test(e.message));
});
```

Append to `test/config.test.mjs`:

```js
const azureIdentity = { IDENTITY_ENDPOINT: "http://localhost:42356/msi/token", IDENTITY_HEADER: "hdr-1", AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555", CHAT_IDENTITY_AUDIENCE: "api://66666666-7777-8888-9999-000000000000" };

test("an Azure identity reads its four values, and refuses the start naming every one missing", () => {
  const c = configFromEnv({ ...full, ...fed, CHAT_IDENTITY: "azure", ...azureIdentity });
  assert.deepEqual(c.identityOptions, { identityEndpoint: "http://localhost:42356/msi/token", identityHeader: "hdr-1", clientId: "11111111-2222-3333-4444-555555555555", audience: "api://66666666-7777-8888-9999-000000000000" });
  assert.throws(() => configFromEnv({ ...full, ...fed, CHAT_IDENTITY: "azure", IDENTITY_ENDPOINT: "http://x" }), /^Error: CHAT_IDENTITY=azure needs IDENTITY_HEADER, AZURE_CLIENT_ID, CHAT_IDENTITY_AUDIENCE, which are not set$/);
  assert.throws(() => configFromEnv({ ...full, ...fed, CHAT_IDENTITY: "azure", ...azureIdentity, CHAT_IDENTITY_AUDIENCE: " " }), /^Error: CHAT_IDENTITY=azure needs CHAT_IDENTITY_AUDIENCE, which is not set$/);
  assert.deepEqual(configFromEnv({ ...full, ...fed }).identityOptions, {});
  assert.deepEqual(configFromEnv({ ...full, CHAT_IDENTITY: "azure" }).identityOptions, {}, "without federation no token is asked for, so nothing is needed");
});
```

In `test/config.test.mjs`, the existing test `each choice takes its values and refuses any other by name, whatever the case` asserts `CHAT_IDENTITY: "azure"` is refused. Change that line to:

```js
  assert.throws(() => configFromEnv({ ...full, CHAT_IDENTITY: "aws" }), /^Error: CHAT_IDENTITY is not one of google azure: aws$/);
```

In `test/platform.test.mjs`, change `assert.deepEqual(Object.keys(IDENTITIES), ["google"]);` to `assert.deepEqual(Object.keys(IDENTITIES), ["google", "azure"]);`, then append:

```js
import { azureIdentityToken } from "../lib/platform/azure/identity.mjs";

test("the azure identity is the managed-identity endpoint's token", async () => {
  assert.equal(await identityTokenSource("azure"), azureIdentityToken);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/azure-identity.test.mjs test/config.test.mjs test/platform.test.mjs`

Expected: FAIL with `Cannot find module '…/lib/platform/azure/identity.mjs'`.

- [ ] **Step 3: Create `lib/platform/azure/identity.mjs`**

```js
// Azure's Container Apps give an app a local endpoint that signs a token for the app's managed
// identity, for any audience the tenant knows: here the app registration standing for the Claude
// API, api://<client id>, since Entra issues no token for an audience it does not hold. The app
// has only its user-assigned identity, so the request names it by client id, or the endpoint would
// look for a system-assigned one. The status, the JSON and the token's shape are checked here, and
// the fetch has a deadline of its own, as the Google source does.
import { TOKEN_TIMEOUT_MS, credentialError, asToken } from "../../credential.mjs";

const SOURCE = "the managed identity endpoint";

export const azureIdentityToken = (fetchFn = fetch, { timeoutMs = TOKEN_TIMEOUT_MS, identityEndpoint, identityHeader, clientId, audience } = {}) => async () => {
  const url = new URL(identityEndpoint);
  url.searchParams.set("api-version", "2019-08-01");
  url.searchParams.set("resource", audience);
  url.searchParams.set("client_id", clientId);
  let res;
  try {
    res = await fetchFn(url, { headers: { "X-IDENTITY-HEADER": identityHeader }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw credentialError(`${SOURCE} could not be reached: ${err?.message ?? err}`);
  }
  if (!res.ok) throw Object.assign(credentialError(`${SOURCE} answered ${res.status} when asked for an identity token`), { statusCode: res.status });
  let body;
  try {
    body = await res.json();
  } catch {
    throw credentialError(`${SOURCE} answered something that is not JSON`);
  }
  return asToken(String(body?.access_token ?? ""), SOURCE);
};
```

- [ ] **Step 4: Register it, read its values, and bind them at start**

In `lib/platform.mjs`, replace the `IDENTITIES` block with:

```js
export const IDENTITIES = {
  google: async () => (await import("./platform/google/identity.mjs")).googleIdentityToken,
  azure: async () => (await import("./platform/azure/identity.mjs")).azureIdentityToken,
};
```

In `lib/config.mjs`, add below `choice`:

```js
// The values a chosen adapter needs beyond its name, read here with the rest so a deployment
// missing any fails at start with every name it lacks. Container Apps sets IDENTITY_ENDPOINT and
// IDENTITY_HEADER itself; the deployment's module sets the others.
const needAll = (env, choiceName, names) => {
  const got = Object.fromEntries(Object.entries(names).map(([k, name]) => [k, env[name]?.trim() || null]));
  const missing = Object.entries(names).filter(([k]) => !got[k]).map(([, name]) => name);
  if (missing.length) throw new Error(`${choiceName} needs ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not set`);
  return got;
};
```

In `configFromEnv`, directly before the Vertex check (`// Only Vertex is reached through the project; …`), add:

```js
  // A token is asked for only under federation, so only then does the identity need its values.
  c.identityOptions = c.identity === "azure" && c.anthropicFederation
    ? needAll(env, "CHAT_IDENTITY=azure", { identityEndpoint: "IDENTITY_ENDPOINT", identityHeader: "IDENTITY_HEADER", clientId: "AZURE_CLIENT_ID", audience: "CHAT_IDENTITY_AUDIENCE" })
    : {};
```

In `bin/http.mjs`, replace:

```js
  const identityToken = values.model !== "fake" && config.anthropicFederation ? await identityTokenSource(config.identity) : undefined;
```

with:

```js
  // The model calls a source as (fetch, { timeoutMs }); the platform's own values ride along.
  const source = values.model !== "fake" && config.anthropicFederation ? await identityTokenSource(config.identity) : undefined;
  const identityToken = source && ((fetchFn, options) => source(fetchFn, { ...options, ...config.identityOptions }));
```

- [ ] **Step 5: Run the suite**

Run: `npm test`

Expected: all pass, with the new tests among them.

- [ ] **Step 6: Commit**

```bash
git add lib/platform/azure/identity.mjs lib/platform.mjs lib/config.mjs bin/http.mjs test/azure-identity.test.mjs test/config.test.mjs test/platform.test.mjs
git commit -F - <<'EOF'
The identity token can come from Azure's managed identity

A chat on Azure trades the token its managed identity is given for the tenant's app registration standing for the Claude API, so CHAT_IDENTITY gains azure: a plain fetch of the endpoint Container Apps sets, naming the user-assigned identity by client id, with the status, the JSON and the token's shape checked before anything reaches Anthropic. The config reads the four values it needs only under federation and refuses the start naming every one missing.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

Replace `<count>` with the real totals.

### Task 2: The meter can be kept in Azure Table Storage

**Files:**

- Create: `lib/platform/azure/meter.mjs`, `test/azure-meter.test.mjs`
- Modify: `lib/platform.mjs`, `lib/config.mjs`, `bin/http.mjs`, `package.json`, `package-lock.json`, `test/config.test.mjs`, `test/platform.test.mjs`

**Interfaces:**

- Consumes: `needAll` (Task 1), `load` from `lib/platform.mjs`.
- Produces:
  - `TableStore({ client, tableUrl, clientId, table = "chat", partition = "chat", row = "meter", attempts = 5 })` with `transact(fn)`.
  - `meterStore(kind, options = {}, adapters = METERS)`. The order of the second and third arguments changes, and existing callers are updated in this task.
  - `METERS.table`.
  - `configFromEnv(env).meterOptions`: `{ tableUrl, clientId }` when `meter === "table"`, else `{}`.

- [ ] **Step 1: Add the two Azure packages as optional dependencies**

Run: `npm install --save-optional @azure/identity@^4.13.3 @azure/data-tables@^13.3.2`

Check: `node -e "const p=require('./package.json');console.log(Object.keys(p.optionalDependencies).join(' '))"`

Expected: the list names `@anthropic-ai/vertex-sdk @azure/data-tables @azure/identity @google-cloud/firestore google-auth-library`, in npm's sorted order.

- [ ] **Step 2: Write the failing tests**

Create `test/azure-meter.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TableStore } from "../lib/platform/azure/meter.mjs";

// Table Storage as the store sees it: one entity, an ETag that moves with every write, 404 for
// a missing entity, 409 for a create that lost, 412 for an update whose ETag is stale. `races`
// is how many writes another replica wins first, each moving the entity under the store.
const fakeTable = ({ races = 0 } = {}) => {
  const t = { entity: null, version: 0, races, writes: 0 };
  const fail = (statusCode) => Object.assign(new Error(`status ${statusCode}`), { statusCode });
  const other = () => { t.races--; t.version++; t.entity = { ...(t.entity ?? {}), dayTokens: (t.entity?.dayTokens ?? 0) + 100 }; };
  t.client = {
    async getEntity(partitionKey, rowKey) {
      if (!t.entity) throw fail(404);
      return { ...t.entity, partitionKey, rowKey, etag: `W/"${t.version}"`, timestamp: "2026-09-28T00:00:00Z", "odata.metadata": "m" };
    },
    async createEntity(e) {
      if (t.races > 0) { other(); throw fail(409); }
      if (t.entity) throw fail(409);
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
    async updateEntity(e, mode, { etag }) {
      assert.equal(mode, "Replace");
      if (t.races > 0) { other(); throw fail(412); }
      if (etag !== `W/"${t.version}"`) throw fail(412);
      const { partitionKey, rowKey, ...rest } = e;
      t.entity = rest; t.version++; t.writes++;
    },
  };
  return t;
};

test("the function sees the entity's own fields and nothing of the table's", async () => {
  const t = fakeTable();
  const store = new TableStore({ client: t.client });
  await store.transact(() => ({ day: "2026-09-28", dayTokens: 5, closed: false }));
  let seen;
  await store.transact((d) => { seen = d; return d; });
  assert.deepEqual(seen, { day: "2026-09-28", dayTokens: 5, closed: false });
});

test("what the function hands back unchanged is not written", async () => {
  const t = fakeTable();
  const store = new TableStore({ client: t.client });
  await store.transact(() => ({ dayTokens: 1 }));
  await store.transact((d) => d);
  await store.transact((d) => ({ ...d }));
  assert.equal(t.writes, 1);
});

test("a write another replica got to first is read again and retried, the function run on what is there", async () => {
  const t = fakeTable({ races: 2 });
  const store = new TableStore({ client: t.client });
  let calls = 0;
  const next = await store.transact((d) => { calls++; return { ...d, dayTokens: (d.dayTokens ?? 0) + 1 }; });
  assert.equal(calls, 3);
  assert.deepEqual(next, { dayTokens: 201 }, "two lost races of 100 each, then this write of 1");
  assert.deepEqual(t.entity, { dayTokens: 201 });
});

test("five lost races refuse with a sentence rather than loop", async () => {
  const t = fakeTable({ races: 10 });
  const store = new TableStore({ client: t.client });
  await assert.rejects(store.transact((d) => ({ ...d, dayTokens: 1 })), /^Error: the meter could not be written after 5 attempts: another replica kept writing it$/);
});

test("any other failure of the table is passed on as it was", async () => {
  const boom = Object.assign(new Error("forbidden"), { statusCode: 403 });
  const store = new TableStore({ client: { getEntity: async () => { throw boom; } } });
  await assert.rejects(store.transact((d) => d), (e) => e === boom);
});
```

In `test/platform.test.mjs`:

1. Change `meterStore("firestore", { firestore: async () => … })` to `meterStore("firestore", {}, { firestore: async () => … })`.
2. Change `meterStore("firestore", { firestore: missing(…) })` to `meterStore("firestore", {}, { firestore: missing(…) })`.
3. Change `assert.deepEqual(Object.keys(METERS), ["firestore", "memory"]);` to `assert.deepEqual(Object.keys(METERS), ["firestore", "memory", "table"]);`.
4. Add `import { TableStore } from "../lib/platform/azure/meter.mjs";` and a third entry, `["table", () => new TableStore({ client: fakeTableClient() })]`, to the contract loop's list.
5. Append this helper above the loop:

```js
// The table as the contract test needs it: one entity, ETags that move.
const fakeTableClient = () => {
  let entity = null, version = 0;
  const fail = (statusCode) => Object.assign(new Error(String(statusCode)), { statusCode });
  return {
    async getEntity() { if (!entity) throw fail(404); return { ...entity, etag: String(version) }; },
    async createEntity({ partitionKey, rowKey, ...rest }) { if (entity) throw fail(409); entity = rest; version++; },
    async updateEntity({ partitionKey, rowKey, ...rest }, mode, { etag }) { if (etag !== String(version)) throw fail(412); entity = rest; version++; },
  };
};

test("the table kind is made from its options", async () => {
  const store = await meterStore("table", { client: fakeTableClient() });
  assert.ok(store instanceof TableStore);
});
```

Append to `test/config.test.mjs`:

```js
test("a table meter reads its address and identity, and refuses the start naming what is missing", () => {
  const c = configFromEnv({ ...full, CHAT_METER: "table", CHAT_TABLE_URL: "https://acct.table.core.windows.net/", AZURE_CLIENT_ID: "11111111-2222-3333-4444-555555555555" });
  assert.deepEqual(c.meterOptions, { tableUrl: "https://acct.table.core.windows.net/", clientId: "11111111-2222-3333-4444-555555555555" });
  assert.throws(() => configFromEnv({ ...full, CHAT_METER: "table" }), /^Error: CHAT_METER=table needs CHAT_TABLE_URL, AZURE_CLIENT_ID, which are not set$/);
  assert.deepEqual(configFromEnv(full).meterOptions, {});
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test test/azure-meter.test.mjs test/config.test.mjs test/platform.test.mjs`

Expected: FAIL with `Cannot find module '…/lib/platform/azure/meter.mjs'`.

- [ ] **Step 4: Create `lib/platform/azure/meter.mjs`**

```js
// The meter on Azure: one entity in Table Storage, read and written under its ETag, so two
// replicas adding at once add twice rather than once. A write whose ETag another replica moved
// first, or a create another replica made first, is read again and the function run again on
// what is there, as a Firestore transaction reruns; five lost races in a row refuse. The client
// signs in as the app's user-assigned identity, named by client id; it is loaded only when
// CHAT_METER is table.
//
// A function that hands back what it read has changed nothing, and nothing is written, as with
// Firestore: those are the calls the chat makes most.
import { TableClient } from "@azure/data-tables";
import { ManagedIdentityCredential } from "@azure/identity";

// The table's own properties ride on every entity it returns; the meter's document is the rest.
const own = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !["partitionKey", "rowKey", "etag", "timestamp"].includes(k) && !k.startsWith("odata.")));

const same = (a, b) => {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) return false;
  return true;
};

const LOST = new Set([409, 412]);

export class TableStore {
  constructor({ client, tableUrl, clientId, table = "chat", partition = "chat", row = "meter", attempts = 5 } = {}) {
    this.client = client ?? new TableClient(tableUrl.replace(/\/+$/, ""), table, new ManagedIdentityCredential({ clientId }));
    this.partition = partition;
    this.row = row;
    this.attempts = attempts;
  }

  async transact(fn) {
    for (let i = 0; i < this.attempts; i++) {
      let read = {}, etag = null;
      try {
        const e = await this.client.getEntity(this.partition, this.row);
        read = own(e);
        etag = e.etag;
      } catch (err) {
        if (err?.statusCode !== 404) throw err;
      }
      const next = await fn({ ...read });
      if (same(read, next)) return next;
      const entity = { partitionKey: this.partition, rowKey: this.row, ...next };
      try {
        if (etag) await this.client.updateEntity(entity, "Replace", { etag });
        else await this.client.createEntity(entity);
        return next;
      } catch (err) {
        if (!LOST.has(err?.statusCode)) throw err;
      }
    }
    throw new Error(`the meter could not be written after ${this.attempts} attempts: another replica kept writing it`);
  }
}
```

- [ ] **Step 5: Register it, read its values, and pass them at start**

In `lib/platform.mjs`, replace the `METERS` block and `meterStore` with:

```js
export const METERS = {
  firestore: async () => new (await import("./platform/google/meter.mjs")).FirestoreStore(),
  memory: async () => new (await import("./meter.mjs")).MemoryStore(),
  table: async (options) => new (await import("./platform/azure/meter.mjs")).TableStore(options),
};

export const meterStore = (kind, options = {}, adapters = METERS) => load("CHAT_METER", kind, () => adapters[kind](options));
```

In `lib/config.mjs`, directly above the `c.identityOptions` line from Task 1, add:

```js
  c.meterOptions = c.meter === "table" ? needAll(env, "CHAT_METER=table", { tableUrl: "CHAT_TABLE_URL", clientId: "AZURE_CLIENT_ID" }) : {};
```

In `bin/http.mjs`, change `const store = await meterStore(config.meter);` to `const store = await meterStore(config.meter, config.meterOptions);`.

- [ ] **Step 6: Run the suite**

Run: `npm test`

Expected: all pass, including the portability guard: the new file lives under `lib/platform/`, so its static SDK imports are allowed.

- [ ] **Step 7: Commit**

```bash
git add lib/platform/azure/meter.mjs lib/platform.mjs lib/config.mjs bin/http.mjs package.json package-lock.json test/azure-meter.test.mjs test/config.test.mjs test/platform.test.mjs
git commit -F - <<'EOF'
The meter can be kept in Azure Table Storage

CHAT_METER gains table: the meter's one entity in Table Storage, written under its ETag, so a write another replica got to first is read again and retried, and five lost races in a row refuse with a sentence rather than loop; what the function hands back unchanged is not written, as with Firestore. The store signs in as the app's user-assigned identity. @azure/data-tables and @azure/identity are optional dependencies like the Google packages, and the contract test runs over the table store too.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 3: The weekly report can read its questions from Log Analytics

**Files:**

- Create: `lib/platform/azure/questions.mjs`, `test/azure-questions.test.mjs`
- Modify: `lib/platform.mjs`, `deploy/build/report.mjs`, `package.json`, `package-lock.json`, `test/platform.test.mjs`

**Interfaces:**

- Consumes: `load`, `QUESTIONS`, `questionSource` from `lib/platform.mjs`; `chat()` and `deployment()` from `deploy/build/config.mjs`.
- Produces:
  - `listRows(request, { from, to }) → Promise<Array<entry>>`.
  - `azureQuestions(deployment, chat, { credential, fetchFn, container } = {}) → Promise<{ where, list, put }>`.
  - `QUESTIONS.azure`.
  - An opener is now called as `open(deployment, chat)`; `googleQuestions` ignores the second argument.

- [ ] **Step 1: Add the blob package as an optional dependency**

Run: `npm install --save-optional @azure/storage-blob@^12.34.0`

- [ ] **Step 2: Write the failing tests**

Create `test/azure-questions.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { listRows, azureQuestions, QUERY } from "../lib/platform/azure/questions.mjs";

const range = { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-28T00:00:00Z") };
const table = (rows) => ({ tables: [{ name: "PrimaryResult", columns: [{ name: "TimeGenerated", type: "datetime" }, { name: "Log", type: "string" }], rows }] });
const q = (question, extra = {}) => JSON.stringify({ severity: "INFO", logger: "chat.question", kind: "question", question, lang: "en", cited: [], calls: 1, empty: 0, rounds: 1, refused: null, ...extra });

test("the week's rows are asked for by their own interval, and each question line becomes an entry", async () => {
  let asked;
  const got = await listRows(async (body) => { asked = body; return table([["2026-09-22T10:00:00Z", q("Who?")], ["2026-09-23T10:00:00Z", q("Why?", { lang: "de" })]]); }, range);
  assert.deepEqual(asked, { query: QUERY, timespan: "2026-09-21T00:00:00.000Z/2026-09-28T00:00:00.000Z" });
  assert.deepEqual(got.map((e) => [e.timestamp, e.question, e.lang, e.logger]), [["2026-09-22T10:00:00Z", "Who?", "en", "chat.question"], ["2026-09-23T10:00:00Z", "Why?", "de", "chat.question"]]);
});

test("a line that is not JSON, or not a question, is passed over", async () => {
  const got = await listRows(async () => table([["t1", "Error: boom\n    at x (y.js:1:1)"], ["t2", JSON.stringify({ kind: "start" })], ["t3", q("Kept")], ["t4", null]]), range);
  assert.deepEqual(got.map((e) => e.question), ["Kept"]);
});

test("an answer in part is refused rather than counted short", async () => {
  await assert.rejects(listRows(async () => ({ ...table([]), error: { code: "PartialError", message: "some shards failed" } }), range), /^Error: Log Analytics answered only in part: some shards failed$/);
});

test("the source signs in once, queries the chat's workspace, and writes the week's file to the reports container", async () => {
  const calls = [];
  const credential = { getToken: async (scope) => { calls.push(["token", scope]); return { token: "tok" }; } };
  const fetchFn = async (url, init) => { calls.push(["fetch", url, init.headers.authorization, JSON.parse(init.body).timespan]); return new Response(JSON.stringify(table([["t", q("Q")]]))); };
  const uploads = [];
  const container = { getBlockBlobClient: (name) => ({ upload: async (text, length, opts) => uploads.push({ name, text, length, type: opts.blobHTTPHeaders.blobContentType }) }) };
  const s = await azureQuestions({ platform: "azure" }, { storage_account: "chatacct", questions_workspace_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }, { credential, fetchFn, container });
  assert.equal(s.where, "https://chatacct.blob.core.windows.net/reports");
  assert.equal((await s.list(range)).length, 1);
  assert.deepEqual(calls[0], ["token", "https://api.loganalytics.io/.default"]);
  assert.deepEqual(calls[1], ["fetch", "https://api.loganalytics.azure.com/v1/workspaces/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/query", "Bearer tok", "2026-09-21T00:00:00.000Z/2026-09-28T00:00:00.000Z"]);
  await s.put("reports/2026-W39.md", "# Über\n");
  assert.deepEqual(uploads, [{ name: "reports/2026-W39.md", text: "# Über\n", length: 8, type: "text/markdown; charset=utf-8" }]);
});

test("a chat.json the apply has not yet filled in is named, before anything signs in", async () => {
  const credential = { getToken: async () => { throw new Error("signed in"); } };
  await assert.rejects(azureQuestions({}, { storage_account: "chatacct" }, { credential }), /^Error: chat.json names no questions_workspace_id; write the chat apply's questions_workspace_id output into it$/);
  await assert.rejects(azureQuestions({}, { questions_workspace_id: "x" }, { credential }), /^Error: chat.json names no storage_account$/);
});

test("a query the service refuses is named by its status", async () => {
  const credential = { getToken: async () => ({ token: "tok" }) };
  const s = await azureQuestions({}, { storage_account: "a", questions_workspace_id: "w" }, { credential, fetchFn: async () => new Response("no", { status: 403 }), container: {} });
  await assert.rejects(s.list(range), /^Error: Log Analytics answered 403$/);
});
```

In `test/platform.test.mjs`:

- Change `assert.deepEqual(Object.keys(QUESTIONS), ["google"]);` to `assert.deepEqual(Object.keys(QUESTIONS), ["google", "azure"]);`.
- In the refusal test, change `questionSource("azure", …)` and its expected message to use `"aws"`: `(e) => e.message === "deployment.json names platform aws, which is not one of google"`.

Then append:

```js
import { azureQuestions } from "../lib/platform/azure/questions.mjs";

test("the questions of a deployment on Azure come from Log Analytics", async () => {
  assert.equal(await questionSource("azure"), azureQuestions);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `node --test test/azure-questions.test.mjs test/platform.test.mjs`

Expected: FAIL with `Cannot find module '…/lib/platform/azure/questions.mjs'`.

- [ ] **Step 4: Create `lib/platform/azure/questions.mjs`**

```js
// Kept questions on Azure: the chat's workspace, which a transformation lets hold nothing but the
// chat's question lines, read through the Log Analytics query API for one interval, and the week's
// file written to the reports container. The run signs in as the analyst through the Azure CLI
// login the workflow made. A console line lands whole in the Log column, so each is parsed here,
// and a line that is not JSON or not a question, a stack trace say, is passed over.
import { AzureCliCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

export const QUERY = "ContainerAppConsoleLogs | where ContainerAppName == 'chat' | project TimeGenerated, Log | order by TimeGenerated asc";
const LOGS_API = "https://api.loganalytics.azure.com";
const LOGS_SCOPE = "https://api.loganalytics.io/.default";

export async function listRows(request, { from, to }) {
  const data = await request({ query: QUERY, timespan: `${from.toISOString()}/${to.toISOString()}` });
  // A partial answer is a 200 with an error beside the tables; counting it would report a week short.
  if (data.error) throw new Error(`Log Analytics answered only in part: ${data.error.message ?? data.error.code}`);
  const t = data.tables?.[0];
  if (!t) return [];
  const time = t.columns.findIndex((c) => c.name === "TimeGenerated");
  const log = t.columns.findIndex((c) => c.name === "Log");
  const out = [];
  for (const r of t.rows) {
    let line;
    try {
      line = JSON.parse(r[log]);
    } catch {
      continue;
    }
    if (line?.kind === "question") out.push({ ...line, timestamp: r[time] });
  }
  return out;
}

export async function azureQuestions(deployment, chat, { credential, fetchFn = fetch, container } = {}) {
  if (!chat?.questions_workspace_id) throw new Error("chat.json names no questions_workspace_id; write the chat apply's questions_workspace_id output into it");
  if (!chat?.storage_account) throw new Error("chat.json names no storage_account");
  const cred = credential ?? new AzureCliCredential();
  const account = `https://${chat.storage_account}.blob.core.windows.net`;
  const reports = container ?? new BlobServiceClient(account, cred).getContainerClient("reports");
  const request = async (body) => {
    const { token } = await cred.getToken(LOGS_SCOPE);
    const res = await fetchFn(`${LOGS_API}/v1/workspaces/${chat.questions_workspace_id}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Log Analytics answered ${res.status}`);
    return res.json();
  };
  return {
    where: `${account}/reports`,
    list: (range) => listRows(request, range),
    put: async (name, text) => {
      await reports.getBlockBlobClient(name).upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "text/markdown; charset=utf-8" } });
    },
  };
}
```

- [ ] **Step 5: Register it and hand the report both files**

In `lib/platform.mjs`, replace the `QUESTIONS` block with:

```js
export const QUESTIONS = {
  google: async () => (await import("./platform/google/questions.mjs")).googleQuestions,
  azure: async () => (await import("./platform/azure/questions.mjs")).azureQuestions,
};
```

In `deploy/build/report.mjs`:

- Change `import { deployment } from "./config.mjs";` to `import { chat, deployment } from "./config.mjs";`.
- Change `const source = await open(d);` to `const source = await open(d, chat());`.
- In the opening comment, change `read from where the deployment's platform keeps them` to `read from where the deployment's platform keeps them, named in deployment.json and chat.json`.

- [ ] **Step 6: Run the suite**

Run: `npm test`

Expected: all pass. `test/bin-deploy.test.mjs` still refuses a wrong week before anything is read.

- [ ] **Step 7: Commit**

```bash
git add lib/platform/azure/questions.mjs lib/platform.mjs deploy/build/report.mjs package.json package-lock.json test/azure-questions.test.mjs test/platform.test.mjs
git commit -F - <<'EOF'
The weekly report can read its questions from Log Analytics

On Azure the kept questions live in the chat's own workspace, so the report gains a source that queries it for the week's interval through the Log Analytics API and writes the week's file to the reports container, signed in as the analyst through the workflow's Azure login. A console line lands whole in one column, so each is parsed and anything that is not a question line is passed over; an answer in part is refused rather than counted short. The report hands a source both deployment.json and chat.json, since the chat's workspace and storage are named in the latter.

Verified: npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 4: A deployment's chat.json is checked for its platform

**Files:**

- Modify: `deploy/build/config.mjs`, `deploy/test/config.mjs`, `test/deploy-config.test.mjs`

**Interfaces:**

- Produces:
  - `platformOf(deployment) → "google" | "azure"`, which throws on any other value.
  - `federationProblems(c, platform = "google")`.
  - `chatProblems(c, platform) → string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `test/deploy-config.test.mjs`, and extend its import to `import { federationProblems, chatProblems, platformOf } from "../deploy/build/config.mjs";`:

```js
// A Google chat.json exactly as the three live deployments have one.
const googleChat = {
  domain: "chat.guestgraph.io", site_id: "chat-guestgraph-io", mcp_url: "https://mcp.guestgraph.io/mcp", origins: ["https://guestgraph.io"],
  month_tokens: 18500000, run_host: "chat-pmjo63xwja-oa.a.run.app", provider: "anthropic",
  anthropic_federation: { rule_id: "fdrl_01EvNBuqC4jtGGJiLpN7pqdT", organization_id: "f48c0dfd-3bf9-4c7b-837c-254f7ba27923", service_account_id: "svac_017XvZZdGsnGV2yQmJABgxyY", workspace_id: "wrkspc_01A9iwwm2pEGTgsNAWHsu4ni" },
};
const azureChat = {
  domain: "chat.azure.companygraph.io", mcp_url: "https://mcp.azure.companygraph.io/mcp", origins: ["https://companygraph.io"], month_tokens: 18500000,
  provider: "anthropic", storage_account: "cgazurechat",
  anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC", audience: "66666666-7777-8888-9999-000000000000" },
};

test("the platform is google when deployment.json names none, and any other name is refused", () => {
  assert.equal(platformOf({}), "google");
  assert.equal(platformOf({ platform: "azure" }), "azure");
  assert.throws(() => platformOf({ platform: "aws" }), /^Error: deployment.json names platform aws, which is not one of google azure$/);
});

test("a live Google chat.json and a sound Azure one have no problem", () => {
  assert.deepEqual(chatProblems(googleChat, "google"), []);
  assert.deepEqual(chatProblems(azureChat, "azure"), []);
  assert.deepEqual(chatProblems({ ...azureChat, app_host: "chat.x.azurecontainerapps.io", dns_ready: true, questions_workspace_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", analyst_client_id: "11111111-2222-3333-4444-555555555555" }, "azure"), []);
});

test("each platform refuses the other's fields and names what it lacks", () => {
  assert.deepEqual(chatProblems({ ...googleChat, storage_account: "x" }, "google"), ["storage_account is for a chat on Azure"]);
  const { site_id, ...noSite } = googleChat;
  assert.deepEqual(chatProblems(noSite, "google"), ["chat.json has no site_id, the Hosting site Google serves the chat from"]);
  assert.deepEqual(chatProblems({ ...azureChat, site_id: "x", run_host: "y" }, "azure"), ["site_id is for a chat on Google", "run_host is for a chat on Google"]);
  assert.deepEqual(chatProblems({ ...azureChat, storage_account: "Chat_Acct" }, "azure"), ["storage_account is 3 to 24 lowercase letters and digits"]);
  assert.deepEqual(chatProblems({ ...azureChat, dns_ready: "yes", questions_workspace_id: "w" }, "azure"), ["dns_ready is true or false", "questions_workspace_id is the workspace's GUID"]);
  const { anthropic_federation, ...noFed } = azureChat;
  assert.deepEqual(chatProblems({ ...noFed, provider: "vertex" }, "azure"), ["a chat on Azure has provider anthropic", "a chat on Azure names anthropic_federation"]);
  const { mcp_url, ...noUrl } = azureChat;
  assert.deepEqual(chatProblems(noUrl, "azure"), ["chat.json has no mcp_url"]);
});

test("federation names its audience on Azure and never on Google", () => {
  const f = azureChat.anthropic_federation;
  assert.deepEqual(federationProblems(azureChat, "azure"), []);
  const { audience, ...noAudience } = f;
  assert.deepEqual(federationProblems({ ...azureChat, anthropic_federation: noAudience }, "azure"), ["audience is the client id of the app registration standing for the Claude API"]);
  assert.deepEqual(federationProblems({ ...googleChat, anthropic_federation: { ...googleChat.anthropic_federation, audience: f.audience } }, "google"), ["audience is not a field of anthropic_federation"]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/deploy-config.test.mjs`

Expected: FAIL with `does not provide an export named 'chatProblems'`.

- [ ] **Step 3: Write the checks in `deploy/build/config.mjs`**

Replace `federationProblems` and everything below `FEDERATION_FIELDS` with:

```js
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PLATFORMS = ["google", "azure"];

// A deployment that names no platform is on Google, as every deployment before the field was.
export function platformOf(d) {
  const p = d.platform ?? "google";
  if (!PLATFORMS.includes(p)) throw new Error(`deployment.json names platform ${p}, which is not one of ${PLATFORMS.join(" ")}`);
  return p;
}

// On Azure the federation also names the audience its token is asked for: the client id of the
// tenant's app registration standing for the Claude API. Google's token names its own audience.
export function federationProblems(c, platform = "google") {
  if (!("anthropic_federation" in c)) return [];
  const f = c.anthropic_federation;
  const problems = c.provider === "anthropic" ? [] : ["anthropic_federation needs provider anthropic"];
  if (!f || typeof f !== "object" || Array.isArray(f)) return [...problems, "anthropic_federation is an object"];
  for (const [k, [form, sentence]] of Object.entries(FEDERATION_FIELDS)) if (!form.test(f[k] ?? "")) problems.push(sentence);
  if ("workspace_id" in f && !/^wrkspc_\w+$/.test(f.workspace_id ?? "")) problems.push("workspace_id is a wrkspc_ id");
  if (platform === "azure" && !GUID.test(f.audience ?? "")) problems.push("audience is the client id of the app registration standing for the Claude API");
  const known = new Set([...Object.keys(FEDERATION_FIELDS), "workspace_id", ...(platform === "azure" ? ["audience"] : [])]);
  for (const k of Object.keys(f)) if (!known.has(k)) problems.push(`${k} is not a field of anthropic_federation`);
  return problems;
}

const GOOGLE_ONLY = ["site_id", "run_host"];
const AZURE_ONLY = ["storage_account", "app_host", "dns_ready", "questions_workspace_id", "analyst_client_id"];

// chat.json as its platform needs it: the fields every chat names, the platform's own, and none of
// the other platform's, since a field Terraform does not read would deploy as a missing one.
export function chatProblems(c, platform) {
  const problems = [];
  for (const k of ["domain", "mcp_url", "origins", "month_tokens"]) if (!(k in c)) problems.push(`chat.json has no ${k}`);
  if (platform === "google") {
    if (!("site_id" in c)) problems.push("chat.json has no site_id, the Hosting site Google serves the chat from");
    for (const k of AZURE_ONLY) if (k in c) problems.push(`${k} is for a chat on Azure`);
    if ("provider" in c && !["vertex", "anthropic"].includes(c.provider)) problems.push("provider is vertex or anthropic");
  } else {
    for (const k of GOOGLE_ONLY) if (k in c) problems.push(`${k} is for a chat on Google`);
    if (!/^[a-z0-9]{3,24}$/.test(c.storage_account ?? "")) problems.push("storage_account is 3 to 24 lowercase letters and digits");
    if ("dns_ready" in c && typeof c.dns_ready !== "boolean") problems.push("dns_ready is true or false");
    if ("questions_workspace_id" in c && !GUID.test(c.questions_workspace_id)) problems.push("questions_workspace_id is the workspace's GUID");
    if ("analyst_client_id" in c && !GUID.test(c.analyst_client_id)) problems.push("analyst_client_id is the analyst identity's client id");
    if (c.provider !== "anthropic") problems.push("a chat on Azure has provider anthropic");
    if (!("anthropic_federation" in c)) problems.push("a chat on Azure names anthropic_federation");
  }
  return [...problems, ...federationProblems(c, platform)];
}
```

Keep `FEDERATION_FIELDS` and its comment above exactly as they are.

- [ ] **Step 4: Use them in the deployment's own test**

Replace the body of `registerConfigTests` in `deploy/test/config.mjs` with:

```js
  const c = chat();
  const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));
  const platform = platformOf(deployment);

  test("chat.json names what a chat on its platform needs, and nothing of the other platform", () => {
    assert.deepEqual(chatProblems(c, platform), []);
    assert.ok(Array.isArray(c.origins) && c.origins.length > 0);
    for (const o of c.origins) assert.match(o, /^https:\/\/[^/]+$/, `${o} is an origin, scheme and host only`);
    assert.ok(Number.isInteger(c.month_tokens) && c.month_tokens > 0);
  });

  test("the host it reads is this deployment's own", () => {
    assert.equal(new URL(c.mcp_url).host, deployment.domain);
    assert.equal(new URL(c.mcp_url).pathname, "/mcp");
    if (platform === "google") assert.notEqual(c.site_id, deployment.site_id, "two Hosting sites in one project must differ, or the chat's apply takes the host's site");
  });
```

Change its import to `import { ROOT, chat, chatProblems, platformOf } from "../build/config.mjs";`, and its opening comment to: `// chat.json names what its platform needs, an MCP host on the deployment's own domain and at least one page origin, and the ceiling is a whole number.`

- [ ] **Step 5: Run the suite**

Run: `npm test`

Expected: all pass.

Then run the deployment test against a copy of a live Google deployment, to prove it still passes:

```bash
R=$PWD D=$(mktemp -d) && gh api repos/guestgraph/mcp-guestgraph-io/contents/deployment.json -q .content | base64 -d > $D/deployment.json && mkdir $D/chat && gh api repos/guestgraph/mcp-guestgraph-io/contents/chat/chat.json -q .content | base64 -d > $D/chat/chat.json && (cd $D/chat && node --input-type=module -e "const m = await import('$R/deploy/test/config.mjs'); m.registerConfigTests();"); rm -rf $D
```

Expected: two passing tests, printed by `node:test` as the process ends.

- [ ] **Step 6: Commit**

```bash
git add deploy/build/config.mjs deploy/test/config.mjs test/deploy-config.test.mjs
git commit -F - <<'EOF'
A deployment's chat.json is checked for its platform

The chat's deployment test asked every chat.json for Google's site_id, which a chat on Azure does not have. deployment.json's platform, google when absent, now decides what chat.json must name: Google keeps its site and refuses Azure's fields, Azure asks for its storage account, the Anthropic provider and a federation that names its audience, and refuses Google's. The checks are pure functions tested beside the federation's, and a live Google chat.json passes them unchanged.

Verified: npm test <count>; the deployment's config tests run against guestgraph's live deployment.json and chat.json, passing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 5: The chat's Azure module

**Files:**

- Create: `deploy/azure/terraform/main.tf`, `variables.tf`, `app.tf`, `domain.tf`, `questions.tf`, `outputs.tf`
- Modify: `.github/workflows/test.yml`, `pins.json`

**Interfaces:**

- Consumes: the MCP host's Azure module (Task 9) names its environment `apps` and its general workspace `logs` in the same resource group. This module reads both by those names.
- Produces: outputs `service_url`, `app_host`, `dns_records`, `run_principal_id`, `analyst_client_id`, `questions_workspace_id`, `reports_url`.

- [ ] **Step 1: Write the six files exactly as below**

`deploy/azure/terraform/main.tf`:

```hcl
# The resources every deployment of the chat runs on Azure, beside the MCP host's in the same
# resource group and in its Container Apps environment. The caller holds the backend and the
# providers; this module holds what the service is.
terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 5.7" }
    azapi   = { source = "Azure/azapi", version = "~> 2.13" }
  }
}

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = var.resource_group_name
}

# Made by the MCP host's module, under the names it gives them.
data "azurerm_container_app_environment" "this" {
  name                = "apps"
  resource_group_name = var.resource_group_name
}

data "azurerm_log_analytics_workspace" "logs" {
  name                = "logs"
  resource_group_name = var.resource_group_name
}
```

`deploy/azure/terraform/variables.tf`:

```hcl
# Every value that is one deployment's own. The caller reads them from its deployment.json and
# its chat/chat.json.
variable "resource_group_name" { type = string }
variable "registry_name" { type = string }
variable "domain" { type = string }
variable "mcp_url" { type = string }
variable "origins" { type = list(string) }
variable "month_tokens" { type = number }
# Container Apps' ingress appends one address, the client's, to X-Forwarded-For.
variable "proxy_hops" {
  type    = number
  default = 1
}
variable "image" {
  description = "The image to run, pushed by the same workflow run"
  type        = string
}
# The storage account holding the meter's table and the reports; its name is global across
# Azure, so the deployment chooses it.
variable "storage_account" { type = string }
# As in the MCP host's module: the generated host name, empty on the first apply, and the domain
# added only once its two records are set.
variable "app_host" {
  type    = string
  default = ""
}
variable "dns_ready" {
  type    = bool
  default = false
}
# On Azure the chat reaches the Anthropic API through workload identity federation alone: its
# managed identity asks for a token for the tenant's app registration standing for the Claude API,
# api://<audience>, and trades it. The ids are the rule's, the organization's and the Anthropic
# service account's, and none is a secret.
variable "anthropic_federation" {
  type = object({
    rule_id            = string
    organization_id    = string
    service_account_id = string
    audience           = string
    workspace_id       = optional(string)
  })
}
# The repository whose runs on main write the weekly report, by the ids GitHub's immutable
# subject carries, as the bootstrap names them.
variable "repository" { type = string }
variable "repository_id" { type = string }
variable "owner_id" { type = string }
```

`deploy/azure/terraform/app.tf`:

```hcl
# The service, and the identity of its own that may pull its image, keep the meter and ask for the
# token it trades at Anthropic, and nothing else.
resource "azurerm_user_assigned_identity" "run" {
  name                = "chat-run"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_role_assignment" "pull" {
  scope                = data.azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

# The meter's one entity and the weekly reports, in one account reached with Entra ID alone.
resource "azurerm_storage_account" "this" {
  name                            = var.storage_account
  resource_group_name             = var.resource_group_name
  location                        = data.azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_table" "meter" {
  name               = "chat"
  storage_account_id = azurerm_storage_account.this.id
}

resource "azurerm_role_assignment" "meter" {
  scope                = azurerm_storage_table.meter.resource_manager_id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

locals {
  app_host = var.app_host
  # The SDK's own names, so the environment reads the same to anyone who knows the SDK.
  federation_env = {
    for k, v in {
      ANTHROPIC_FEDERATION_RULE_ID = var.anthropic_federation.rule_id
      ANTHROPIC_ORGANIZATION_ID    = var.anthropic_federation.organization_id
      ANTHROPIC_SERVICE_ACCOUNT_ID = var.anthropic_federation.service_account_id
      ANTHROPIC_WORKSPACE_ID       = var.anthropic_federation.workspace_id
    } : k => v if v != null
  }
  env = merge(local.federation_env, {
    CHAT_MCP_URL           = var.mcp_url
    CHAT_ORIGINS           = join(",", var.origins)
    CHAT_HOSTS             = join(",", compact([var.domain, local.app_host]))
    CHAT_MONTH_TOKENS      = tostring(var.month_tokens)
    CHAT_PROXY_HOPS        = tostring(var.proxy_hops)
    CHAT_METER             = "table"
    CHAT_TABLE_URL         = azurerm_storage_account.this.primary_table_endpoint
    CHAT_IDENTITY          = "azure"
    CHAT_IDENTITY_AUDIENCE = "api://${var.anthropic_federation.audience}"
    CHAT_LOG               = "plain"
    AZURE_CLIENT_ID        = azurerm_user_assigned_identity.run.client_id
  })
}

resource "azurerm_container_app" "chat" {
  name                         = "chat"
  container_app_environment_id = data.azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.run.id]
  }

  registry {
    server   = data.azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.run.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 3
    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
    container {
      name   = "chat"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"
      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [azurerm_role_assignment.pull, azurerm_role_assignment.meter]
}

check "app_host" {
  assert {
    condition     = azurerm_container_app.chat.ingress[0].fqdn == local.app_host
    error_message = "The app's host name is not the app_host in CHAT_HOSTS; a request on that name will be refused until chat.json names the host this app carries as app_host."
  }
}
```

`deploy/azure/terraform/domain.tf`:

```hcl
# The domain in three steps, as the MCP host's module adds its own: the host name added unbound,
# a free certificate issued against a CNAME that points straight at the app, and one PATCH of the
# app's custom domains binding them, since azurerm cannot (terraform-provider-azurerm#27362).
resource "azurerm_container_app_custom_domain" "this" {
  count            = var.dns_ready ? 1 : 0
  name             = var.domain
  container_app_id = azurerm_container_app.chat.id
  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "this" {
  count                        = var.dns_ready ? 1 : 0
  name                         = "chat"
  container_app_environment_id = data.azurerm_container_app_environment.this.id
  subject_name                 = var.domain
  domain_control_validation    = "CNAME"
  depends_on                   = [azurerm_container_app_custom_domain.this]
}

resource "azapi_resource_action" "bind" {
  count       = var.dns_ready ? 1 : 0
  type        = "Microsoft.App/containerApps@2025-07-01"
  resource_id = azurerm_container_app.chat.id
  method      = "PATCH"
  body = {
    properties = {
      configuration = {
        ingress = {
          customDomains = [{
            name          = var.domain
            bindingType   = "SniEnabled"
            certificateId = azurerm_container_app_environment_managed_certificate.this[0].id
          }]
        }
      }
    }
  }
}
```

`deploy/azure/terraform/questions.tf`:

```hcl
# The kept questions, ninety days, where one identity can read them and nothing else. Azure cannot
# fork one log stream into two tables, so the environment's console lines reach a workspace of the
# chat's own through a second diagnostic setting, and a transformation on each workspace decides
# what stays: the chat's workspace keeps the chat's question lines and nothing else, and the
# environment's general workspace keeps everything but them, so a question exists in one place with
# one retention, as the Google sink and its exclusion ensure. A workspace names its transformation
# and the transformation names its workspace, so the link is made by azapi after both exist.
locals {
  question  = "ContainerAppName == 'chat' and tostring(parse_json(Log).kind) == 'question'"
  transform = "Microsoft-Table-ContainerAppConsoleLogs"
}

resource "azurerm_log_analytics_workspace" "questions" {
  name                = "chat-questions"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 90
  lifecycle {
    ignore_changes = [data_collection_rule_id]
  }
}

resource "azurerm_monitor_diagnostic_setting" "questions" {
  name                       = "chat-questions"
  target_resource_id         = data.azurerm_container_app_environment.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.questions.id
  enabled_log { category = "ContainerAppConsoleLogs" }
}

resource "azurerm_monitor_data_collection_rule" "questions" {
  name                = "chat-questions-keep"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  kind                = "WorkspaceTransforms"
  destinations {
    log_analytics {
      name                  = "questions"
      workspace_resource_id = azurerm_log_analytics_workspace.questions.id
    }
  }
  data_flow {
    streams       = [local.transform]
    destinations  = ["questions"]
    transform_kql = "source | where ${local.question}"
  }
}

resource "azapi_update_resource" "questions" {
  type        = "Microsoft.OperationalInsights/workspaces@2022-10-01"
  resource_id = azurerm_log_analytics_workspace.questions.id
  body = {
    properties = {
      defaultDataCollectionRuleResourceId = azurerm_monitor_data_collection_rule.questions.id
    }
  }
}

resource "azurerm_monitor_data_collection_rule" "logs" {
  name                = "logs-without-questions"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  kind                = "WorkspaceTransforms"
  destinations {
    log_analytics {
      name                  = "logs"
      workspace_resource_id = data.azurerm_log_analytics_workspace.logs.id
    }
  }
  data_flow {
    streams       = [local.transform]
    destinations  = ["logs"]
    transform_kql = "source | where not(${local.question})"
  }
}

resource "azapi_update_resource" "logs" {
  type        = "Microsoft.OperationalInsights/workspaces@2022-10-01"
  resource_id = data.azurerm_log_analytics_workspace.logs.id
  body = {
    properties = {
      defaultDataCollectionRuleResourceId = azurerm_monitor_data_collection_rule.logs.id
    }
  }
}

# The weekly report's files, deleted on the eighty-fourth day, so a question quoted in a report is
# gone ninety days after it was asked and the promise has one number.
resource "azurerm_storage_container" "reports" {
  name                  = "reports"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_management_policy" "reports" {
  storage_account_id = azurerm_storage_account.this.id
  rule {
    name    = "reports-83-days"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["reports/"]
    }
    actions {
      base_blob {
        delete_after_days_since_creation_greater_than = 83
      }
    }
  }
}

# The reader: the repository's runs on main, for the weekly report, and nothing more than the
# questions' workspace and the reports' container. The owner's own reading is granted by hand.
resource "azurerm_user_assigned_identity" "analyst" {
  name                = "chat-analyst"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_federated_identity_credential" "analyst" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.analyst.id
  issuer                    = "https://token.actions.githubusercontent.com"
  audience                  = ["api://AzureADTokenExchange"]
  subject                   = "repo:${split("/", var.repository)[0]}@${var.owner_id}/${split("/", var.repository)[1]}@${var.repository_id}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "analyst_questions" {
  scope                = azurerm_log_analytics_workspace.questions.id
  role_definition_name = "Log Analytics Data Reader"
  principal_id         = azurerm_user_assigned_identity.analyst.principal_id
}

resource "azurerm_role_assignment" "analyst_reports" {
  scope                = azurerm_storage_container.reports.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.analyst.principal_id
}
```

`deploy/azure/terraform/outputs.tf`:

```hcl
output "service_url" { value = "https://${azurerm_container_app.chat.ingress[0].fqdn}" }
output "app_host" { value = azurerm_container_app.chat.ingress[0].fqdn }
output "dns_records" {
  description = "What the domain needs before dns_ready; create these at the DNS provider of the deployment's domain"
  value = [
    { name = var.domain, type = "CNAME", value = azurerm_container_app.chat.ingress[0].fqdn },
    { name = "asuid.${var.domain}", type = "TXT", value = azurerm_container_app.chat.custom_domain_verification_id },
  ]
}
output "run_principal_id" { value = azurerm_user_assigned_identity.run.principal_id }
output "analyst_client_id" { value = azurerm_user_assigned_identity.analyst.client_id }
output "questions_workspace_id" { value = azurerm_log_analytics_workspace.questions.workspace_id }
output "reports_url" { value = "${azurerm_storage_account.this.primary_blob_endpoint}reports" }
```

- [ ] **Step 2: Validate with both Terraform versions**

Run: `terraform -chdir=deploy/azure/terraform init -backend=false -input=false && terraform -chdir=deploy/azure/terraform validate && terraform fmt -check -recursive deploy`

Expected: `Success! The configuration is valid.` and no fmt output.

Then download Terraform 1.9.8, the version CI pins, into the session scratchpad (never into the repository) and validate again:

```bash
T=$(mktemp -d) && curl -sSLo $T/tf.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_darwin_arm64.zip && unzip -oq $T/tf.zip terraform -d $T && rm -rf deploy/azure/terraform/.terraform && $T/terraform -chdir=deploy/azure/terraform init -backend=false -input=false >/dev/null && $T/terraform -chdir=deploy/azure/terraform validate
```

Expected: valid. Then run `rm -rf deploy/azure/terraform/.terraform deploy/azure/terraform/.terraform.lock.hcl`. Neither is committed; the Google module commits no lockfile either.

- [ ] **Step 3: Validate it in CI and in the pins verify step**

In `.github/workflows/test.yml`, add after the two `deploy/google/terraform` lines:

```yaml
      - run: terraform -chdir=deploy/azure/terraform init -backend=false -input=false
      - run: terraform -chdir=deploy/azure/terraform validate
```

In `pins.json`, add to `verify`, after the Google validate command: `"terraform -chdir=deploy/azure/terraform init -backend=false -input=false", "terraform -chdir=deploy/azure/terraform validate"`.

- [ ] **Step 4: Commit**

```bash
git add deploy/azure/terraform .github/workflows/test.yml pins.json
git status --short
git commit -F - <<'EOF'
The chat has a Terraform module for Azure

deploy/azure/terraform runs the chat in the MCP host's Container Apps environment. It has an identity of its own that may pull its image, keep the meter in its table and ask for the token it trades at Anthropic, and nothing else. Its domain goes on in three steps, since azurerm cannot bind the free certificate it issues, and only once the owner has set the two records. The kept questions reach a workspace of the chat's own for ninety days: the environment sends its console lines to both workspaces, and a transformation on each keeps the chat's question lines in one and out of the other, so a question lives in one place. The reports container deletes on day eighty-four. An analyst identity reads that workspace and writes that container, for runs on main alone. CI validates it beside the Google module.

Verified: terraform validate under Terraform 1.16.3 and under 1.9.8, the version CI pins; terraform fmt -check -recursive deploy; npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

`git status --short` before the commit must show no `.terraform` entry.

### Task 6: The chat's Azure workflows

**Files:**

- Create: `.github/workflows/deploy-azure.yml`, `.github/workflows/report-azure.yml`

- [ ] **Step 1: Write `.github/workflows/deploy-azure.yml`**

```yaml
# The build, the plan and the apply of a deployment's chat on Azure, called by the release the
# deployment's chat/package.json pins. The deployment's values reach it from deployment.json and
# chat/chat.json; the identities CI acts as and the registry are the bootstrap's, and the
# environment the chat joins is the MCP host's. None of the ids is a secret. The caller holds the
# concurrency group.
name: deployment
on:
  workflow_call:
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    outputs:
      image: ${{ steps.tag.outputs.image }}
    defaults:
      run:
        working-directory: chat
    steps:
      - uses: actions/checkout@v7
      - run: |
          jq -r '"REGISTRY=\(.container_registry)\nTENANT=\(.tenant_id)\nSUBSCRIPTION=\(.subscription_id)\nDEPLOY_CLIENT=\(.deploy_client_id)"' ../deployment.json >> "$GITHUB_ENV"
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx companygraph-chat-deploy page-css
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - id: tag
        run: echo "image=$REGISTRY.azurecr.io/chat:$(npx companygraph-chat-deploy tag)-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      - run: docker build -t "${{ steps.tag.outputs.image }}" .
      # The deploy identity holds AcrPush on the registry and nothing at the subscription, so the
      # login is told not to look for one.
      - if: github.event_name == 'push'
        uses: azure/login@v3
        with:
          client-id: ${{ env.DEPLOY_CLIENT }}
          tenant-id: ${{ env.TENANT }}
          subscription-id: ${{ env.SUBSCRIPTION }}
          allow-no-subscriptions: true
      - if: github.event_name == 'push'
        run: az acr login --name "$REGISTRY" && docker push "${{ steps.tag.outputs.image }}"
  terraform:
    needs: build
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: write
    defaults:
      run:
        working-directory: infra/chat
    # Both providers and the backend read the GitHub token themselves under these; the backend
    # uses Entra ID and no storage key.
    env:
      ARM_USE_OIDC: "true"
      ARM_USE_AZUREAD: "true"
    steps:
      - uses: actions/checkout@v7
      # A pull request plans as terraform-plan, which reads and changes nothing; only a push to
      # main applies, as terraform, and the bootstrap lets neither identity be used the other way.
      - run: |
          jq -r '"ARM_TENANT_ID=\(.tenant_id)\nARM_SUBSCRIPTION_ID=\(.subscription_id)"' ../../deployment.json >> "$GITHUB_ENV"
          KEY=${{ github.event_name == 'push' && 'terraform_client_id' || 'plan_client_id' }}
          echo "ARM_CLIENT_ID=$(jq -r ".$KEY" ../../deployment.json)" >> "$GITHUB_ENV"
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: 1.9.8
          terraform_wrapper: false
      - run: terraform init -input=false
      - run: terraform fmt -check -recursive
      - run: terraform validate
      - if: github.event_name == 'pull_request'
        id: plan
        run: |
          set +e
          terraform plan -input=false -lock=false -no-color -var "image=$IMAGE" > plan.txt 2>&1
          echo "exit=$?" >> "$GITHUB_OUTPUT"
        env:
          IMAGE: ${{ needs.build.outputs.image }}
        continue-on-error: true
      - if: github.event_name == 'pull_request'
        env:
          IMAGE: ${{ needs.build.outputs.image }}
          PR: ${{ github.event.pull_request.number }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          { echo 'Terraform plan for the chat, `'"$IMAGE"'`'; echo; echo '```'; tail -c 60000 plan.txt; echo '```'; } > comment.md
          gh pr comment "$PR" --repo "${{ github.repository }}" --body-file comment.md
          test "${{ steps.plan.outputs.exit }}" = "0"
      - if: github.event_name == 'push'
        env:
          IMAGE: ${{ needs.build.outputs.image }}
        run: terraform apply -input=false -auto-approve -var "image=$IMAGE"
      # The live GET is the deploy's proof, read against everything chat.json states. On a
      # deployment's first apply it fails by design: until chat.json names the app's host as
      # app_host, the service refuses a request on that name.
      - if: github.event_name == 'push'
        run: |
          URL=$(terraform output -raw service_url)
          curl -fsS --retry 10 --retry-all-errors --retry-delay 5 --max-time 30 "$URL/chat" > live.json
          for field in mcp_url month_tokens provider; do
            WANT=$(jq -r ".$field" ../../chat/chat.json)
            GOT=$(jq -r ".$field" live.json)
            echo "$field: reading $GOT, pinned $WANT"; test "$GOT" = "$WANT"
          done
          WANT=$(jq -c .origins ../../chat/chat.json)
          GOT=$(jq -c .origins live.json)
          echo "origins: reading $GOT, pinned $WANT"; test "$GOT" = "$WANT"
```

- [ ] **Step 2: Write `.github/workflows/report-azure.yml`**

```yaml
# The week's report of a deployment's chat questions on Azure, called by the release chat/package.json
# pins on the deployment's own schedule. The run signs in as the chat's analyst, whose federated
# credential admits a run on main, and a schedule runs on main. The log here carries counts and
# never a question: a public repository's log is public.
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
          jq -r '"TENANT=\(.tenant_id)\nSUBSCRIPTION=\(.subscription_id)"' ../deployment.json >> "$GITHUB_ENV"
          echo "ANALYST=$(jq -r .analyst_client_id chat.json)" >> "$GITHUB_ENV"
      # The analyst holds rights on one workspace and one container and none at the subscription.
      - uses: azure/login@v3
        with:
          client-id: ${{ env.ANALYST }}
          tenant-id: ${{ env.TENANT }}
          subscription-id: ${{ env.SUBSCRIPTION }}
          allow-no-subscriptions: true
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx companygraph-chat-deploy report
```

- [ ] **Step 3: Lint both workflows**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/deploy-azure.yml .github/workflows/report-azure.yml .github/workflows/deploy-google.yml`

Expected: no findings on the two new files. Any finding on `deploy-google.yml` is pre-existing: write it in the report, and leave the file unchanged. If Docker is not running, say so in the report instead of skipping silently.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-azure.yml .github/workflows/report-azure.yml
git commit -F - <<'EOF'
The chat has workflows for Azure

deploy-azure.yml builds and tests the chat's image, pushes it to the bootstrap's registry as the deploy identity, and plans on a pull request as terraform-plan or applies on main as terraform, through the same OIDC token GitHub gives the Google workflow. The live GET is read against chat.json, as on Google. report-azure.yml writes the week's report as the chat's analyst. Every id comes from deployment.json and chat.json and none is a secret; the identities with rights on one resource alone log in without a subscription.

Verified: actionlint on both new workflows, no findings.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 7: The README and the spec say how a chat runs on Azure

**Files:**

- Modify: `README.md`, `docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md`

- [ ] **Step 1: Add the Azure paragraph to the README**

In `README.md`, directly after the "Deploying it" section's last paragraph (the one about the message sent by hand after the second merge, which ends with the `cache_read_input_tokens` sentence), add this section, one paragraph per line in the file's form:

```markdown
## Deploying it on Azure

A deployment on Azure names `"platform": "azure"` in its `deployment.json`, which the MCP host's README describes with the bootstrap, and its chat runs in the host's Container Apps environment, so the host's first apply comes before the chat's. `chat/` holds what it holds on Google, with a `chat.json` naming `domain`, `mcp_url`, `origins`, `month_tokens`, `provider` `anthropic`, `anthropic_federation` with its `audience`, and `storage_account`, a name of 3 to 24 lowercase letters and digits that is free across Azure; the deployment test refuses Google's fields there and names any field missing. `infra/chat/main.tf` calls `deploy/azure/terraform` at the pinned tag with an `azurerm` backend on the bootstrap's state account, key `chat`, and the providers `azurerm` with `storage_use_azuread = true` and `resource_provider_registrations = "none"`, and `azapi`; the workflow calls `.github/workflows/deploy-azure.yml` and the weekly report `.github/workflows/report-azure.yml`, both at the same tag. The service runs with `CHAT_METER=table`, `CHAT_IDENTITY=azure` and `CHAT_LOG=plain`, which the module sets.

A chat on Azure reaches the Anthropic API by federation alone, and four steps are the owner's, once per tenant or once per deployment. In the tenant, one app registration stands for the Claude API: `az ad app create --display-name "Claude API" --sign-in-audience AzureADMyOrg`, then `az ad app update --id <appId> --identifier-uris api://<appId> --set api.requestedAccessTokenVersion=2` and `az ad sp create --id <appId>`; its `appId` is `anthropic_federation.audience`. In the Anthropic Console, under Settings, Workload identity, an issuer for the tenant, `https://login.microsoftonline.com/<tenant>/v2.0`, discovery mode, with `max_jwt_lifetime_seconds` raised to 86400 after the wizard, since Azure caches a managed identity's token for up to a day; then a rule whose audience is the `appId` and whose claims are the chat-run identity's object id in `oid`, the `run_principal_id` output, and the tenant in `tid`. After the first apply, the domain's two records from the `dns_records` output are set at the DNS provider, the CNAME pointing straight at the app's own name, and `chat.json` gains `app_host`, `dns_ready: true`, `questions_workspace_id` and `analyst_client_id` from the outputs; the second apply adds the domain and its certificate. The first deploy's live check fails by design until `app_host` is written, as on Google.

The kept questions live ninety days in the workspace `chat-questions`, which holds nothing else; the owner's own reading is granted once, `az role assignment create --assignee <login> --role "Log Analytics Data Reader" --scope <workspace id>`, and read with `az monitor log-analytics query -w <questions_workspace_id> --analytics-query "ContainerAppConsoleLogs | project TimeGenerated, Log" -t P90D`. The chat is stopped by hand where the meter keeps it: the entity with partition `chat` and row `meter` in the account's table `chat`, field `closed` set to `true`. Container Apps ends an HTTP request after 240 seconds, so an answer that needs the full five rounds of sixty seconds can be cut short on Azure where Cloud Run's 300 seconds would not; the first deployment measures how often.
```

Before committing, run `npx -y markdownlint-cli2 README.md`. Expected: no issues.

- [ ] **Step 2: Bring the spec in line with what the research found**

In the spec:

- **§4, "The chat module":** replace the paragraph that begins `Kept questions reach their own table with ninety-day retention.` with:

  `Kept questions reach a workspace of their own with ninety-day retention. Azure cannot fork one log stream into two tables: a workspace transformation "can't send a single data source to multiple tables". So the environment writes to Azure Monitor and sends its console lines to two workspaces through two diagnostic settings, and a transformation on each decides what stays. The chat's workspace, chat-questions, keeps only the chat's lines whose kind is question, and the environment's general workspace, logs, keeps everything else. A question exists in one place with one retention, as the Google exclusion ensures. The analyst holds Log Analytics Data Reader on chat-questions alone. A workspace and its transformation name each other, so azapi links them after both exist.`

- **§4, "The mcp module":** replace `A custom domain with a free managed certificate … piece 3 proves it.` with:

  `A custom domain with a free managed certificate, in three steps, since azurerm issues the certificate but cannot bind it (terraform-provider-azurerm#27362). The host name is added unbound, the certificate is issued against a CNAME pointing straight at the app, and one azapi PATCH of the app's custom domains binds them. Azure checks the two records when the domain is added, so the domain is added only once deployment.json says dns_ready. The dns_records output gives the asuid TXT record and the CNAME.`

- **§4, "Bootstrap":** replace `each with a federated credential for the deployment's GitHub repository:` through `This matches the Google side.` with:

  `each with a federated credential naming GitHub's immutable subject, repo:OWNER@OWNER_ID/REPO@REPO_ID. A repository created after 2026-07-15 has that subject by default; an older one opts in once with gh api -X PUT repos/<owner>/<repo>/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true. terraform and deploy trust ref:refs/heads/main and terraform-plan trusts pull_request, the Azure form of Google's trust by repository id. The resource providers are registered by the owner's own provider block, since registering one is a subscription's right no identity made here holds.`

- **§2, the identity paragraph:** replace `and chat.json names its client id as anthropic_federation.audience` with `chat.json names its client id as anthropic_federation.audience, and the module hands the service api://<audience> as CHAT_IDENTITY_AUDIENCE`.

- **§2, the paragraph on CHAT_PROXY_HOPS:** replace `and piece 3 measures the Azure hop count and writes it into the Azure module` with `which holds on Azure too: Container Apps' ingress appends only the client's address`.

- **§3, the list of an Azure deployment.json's fields:** replace `An Azure deployment's deployment.json names tenant_id, subscription_id, location, domain, budget_chf and, after the first apply, app_host.` with `An Azure deployment's deployment.json names tenant_id, subscription_id, resource_group, location, container_registry, state_account, domain, budget_chf, budget_start, repository, repository_id, owner_id and the bootstrap's three client ids, and after the first apply app_host and dns_ready.` Then replace the Azure chat.json list with `An Azure chat.json names domain, mcp_url, origins, month_tokens, provider anthropic, anthropic_federation with its audience, and storage_account, and after the first apply app_host, dns_ready, questions_workspace_id and analyst_client_id.`

- **§2, the ports' opening paragraph:** replace `Each deployment's Dockerfile installs only the ones its platform uses.` with `npm installs optional dependencies all or none, so every image carries both clouds' packages and the adapter chosen is the only one loaded.`
- **§7, piece 3:** append `It also measures how often an answer meets Container Apps' 240-second request limit.`

Then run `npx -y markdownlint-cli2 docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md`. Expected: no issues.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-28-the-servers-run-on-two-clouds-design.md
git commit -F - <<'EOF'
The README and the design say how a chat runs on Azure

The README gains how a deployment runs its chat on Azure: what chat.json names, the module and the two workflows it calls, the owner's steps for the Claude API's app registration, the Anthropic issuer and rule, and the domain, where the questions are read, and how the chat is stopped. It also names Container Apps' 240-second request limit as the one place Azure is shorter than Cloud Run. The design takes what the research for piece 2 found. Kept questions go to a workspace of their own through two diagnostic settings, since Azure cannot fork a stream into two tables. The certificate is bound by an azapi PATCH. The federated credentials trust GitHub's immutable subject. The hop count holds at one.

Verified: markdownlint-cli2 on README.md and the design, no issues.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

---

## Part B: mcp-server

Work in a new worktree: `git -C /Users/rob/git/companygraph/mcp-server fetch -q && git -C /Users/rob/git/companygraph/mcp-server worktree add ../mcp-server-the-servers-run-on-azure -b the-servers-run-on-azure origin/main`, then `npm ci` there.

### Task 8: A deployment's deployment.json is checked for its platform

**Files:**

- Create: `deploy/test/config.mjs`, `test/deploy-config.test.mjs`
- Modify: `deploy/build/config.mjs`, `deploy/test/index.mjs`

**Interfaces:**

- Produces: `platformOf(d)` and `deploymentProblems(d) → string[]` in `deploy/build/config.mjs`; `registerConfigTests()` in `deploy/test/config.mjs`, registered by `registerDeploymentTests()`.

- [ ] **Step 1: Write the failing tests**

Create `test/deploy-config.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentProblems, platformOf } from "../deploy/build/config.mjs";

// A Google deployment.json exactly as the three live deployments have one.
const google = {
  project: "guestgraph-io-mcp", project_number: "763196875331", billing_account: "011DEB-4A45A0-3A52BB", region: "europe-west6",
  domain: "mcp.guestgraph.io", site_id: "mcp-guestgraph-io", repository: "guestgraph/mcp-guestgraph-io", repository_id: "1385958042",
  registry_name: "io.guestgraph/mental-model", registry_domain: "guestgraph.io", budget_chf: 40, run_host: "mcp-pmjo63xwja-oa.a.run.app",
};
const id = "11111111-2222-3333-4444-555555555555";
const azure = {
  platform: "azure", tenant_id: id, subscription_id: id, resource_group: "companygraph-azure", location: "switzerlandnorth",
  container_registry: "cgazureregistry", state_account: "cgazurestate", domain: "mcp.azure.companygraph.io", budget_chf: 40, budget_start: "2026-10-01",
  repository: "companygraph/mcp-azure-example", repository_id: "123456789", owner_id: "987654", registry_name: "io.companygraph/azure-example",
  terraform_client_id: id, plan_client_id: id, deploy_client_id: id,
};

test("the platform is google when deployment.json names none, and any other name is refused", () => {
  assert.equal(platformOf(google), "google");
  assert.equal(platformOf(azure), "azure");
  assert.throws(() => platformOf({ platform: "aws" }), /^Error: deployment.json names platform aws, which is not one of google azure$/);
});

test("a live Google deployment.json and a sound Azure one have no problem", () => {
  assert.deepEqual(deploymentProblems(google), []);
  assert.deepEqual(deploymentProblems(azure), []);
  assert.deepEqual(deploymentProblems({ ...azure, app_host: "mcp.x.azurecontainerapps.io", dns_ready: false }), []);
});

test("each platform names what it lacks and refuses the other's fields", () => {
  const { site_id, ...noSite } = google;
  assert.deepEqual(deploymentProblems(noSite), ["deployment.json has no site_id"]);
  assert.deepEqual(deploymentProblems({ ...google, tenant_id: id }), ["tenant_id is for a deployment on Azure"]);
  const { state_account, ...noState } = azure;
  assert.deepEqual(deploymentProblems(noState), ["deployment.json has no state_account"]);
  assert.deepEqual(deploymentProblems({ ...azure, project: "p", run_host: "r" }), ["project is for a deployment on Google", "run_host is for a deployment on Google"]);
  assert.deepEqual(deploymentProblems({ ...azure, tenant_id: "t", budget_start: "2026-10-02", dns_ready: "yes" }), ["tenant_id is a GUID", "budget_start is the first of a month, YYYY-MM-01", "dns_ready is true or false"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/deploy-config.test.mjs`

Expected: FAIL with `does not provide an export named 'deploymentProblems'`.

- [ ] **Step 3: Write the checks**

Append to `deploy/build/config.mjs`:

```js
// deployment.json as its platform needs it: the fields every deployment names, its platform's own,
// and none of the other platform's, since a field Terraform does not read would deploy as a
// missing one. A deployment that names no platform is on Google, as every deployment before the
// field was. registry_name is the MCP Registry's name on both platforms.
export const PLATFORMS = ["google", "azure"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NEEDS = {
  google: ["project", "project_number", "region", "domain", "site_id", "budget_chf"],
  azure: ["tenant_id", "subscription_id", "resource_group", "location", "container_registry", "state_account", "domain", "budget_chf", "budget_start", "repository", "repository_id", "owner_id", "terraform_client_id", "plan_client_id", "deploy_client_id"],
};
const ONLY = {
  google: ["project", "project_number", "billing_account", "region", "site_id", "run_host"],
  azure: ["tenant_id", "subscription_id", "resource_group", "location", "container_registry", "state_account", "budget_start", "owner_id", "terraform_client_id", "plan_client_id", "deploy_client_id", "app_host", "dns_ready"],
};
const NAME = { google: "Google", azure: "Azure" };

export function platformOf(d) {
  const p = d.platform ?? "google";
  if (!PLATFORMS.includes(p)) throw new Error(`deployment.json names platform ${p}, which is not one of ${PLATFORMS.join(" ")}`);
  return p;
}

export function deploymentProblems(d) {
  const platform = platformOf(d);
  const other = platform === "google" ? "azure" : "google";
  const problems = NEEDS[platform].filter((k) => !(k in d)).map((k) => `deployment.json has no ${k}`);
  for (const k of ONLY[other]) if (k in d && !ONLY[platform].includes(k)) problems.push(`${k} is for a deployment on ${NAME[other]}`);
  if (platform === "azure") {
    for (const k of ["tenant_id", "subscription_id", "terraform_client_id", "plan_client_id", "deploy_client_id"]) if (k in d && !GUID.test(d[k])) problems.push(`${k} is a GUID`);
    if ("budget_start" in d && !/^\d{4}-\d{2}-01$/.test(d.budget_start)) problems.push("budget_start is the first of a month, YYYY-MM-01");
    if ("dns_ready" in d && typeof d.dns_ready !== "boolean") problems.push("dns_ready is true or false");
  }
  return problems;
}
```

Create `deploy/test/config.mjs`:

```js
// deployment.json names what a deployment on its platform needs and nothing of the other platform.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deployment, deploymentProblems } from "../build/config.mjs";

export function registerConfigTests() {
  test("deployment.json names what its platform needs, and nothing of the other platform", () => {
    assert.deepEqual(deploymentProblems(deployment()), []);
  });
}
```

In `deploy/test/index.mjs`, import `registerConfigTests` from `./config.mjs` and call it first in `registerDeploymentTests()`.

- [ ] **Step 4: Run the suite, and the check against the three live deployments**

Run: `npm test`

Expected: all pass. `registerDeploymentTests()` now runs the config check too, so a test in `test/` that builds a fixture deployment for the shared tests, such as `test/deploy-tools.test.mjs`, may need its fixture `deployment.json` to carry the six Google fields; add exactly the missing ones to the fixture and say so in the report, never loosen the check.

Then run:

```bash
for r in robertblust/mcp-blust-ch companygraph/mcp-companygraph-io guestgraph/mcp-guestgraph-io; do gh api repos/$r/contents/deployment.json -q .content | base64 -d > /tmp/d.json; node --input-type=module -e "import fs from 'node:fs'; const { deploymentProblems } = await import('$PWD/deploy/build/config.mjs'); console.log('$r', JSON.stringify(deploymentProblems(JSON.parse(fs.readFileSync('/tmp/d.json','utf8')))))"; done; rm -f /tmp/d.json
```

Expected: `[]` for all three.

- [ ] **Step 5: Commit**

```bash
git add deploy/build/config.mjs deploy/test/config.mjs deploy/test/index.mjs test/deploy-config.test.mjs
git commit -F - <<'EOF'
A deployment's deployment.json is checked for its platform

A deployment names platform google or azure in deployment.json, google when absent, and the deployment's own suite now checks that the file names what that platform needs and nothing of the other's. Google keeps its project, region, site and budget. Azure names its tenant, subscription, resource group, registry, state account, budget start, the repository's ids and the bootstrap's three client ids. registry_name keeps meaning the MCP Registry's name on both. The three live deployment.json files pass unchanged.

Verified: npm test <count>; deploymentProblems on the three live deployment.json files, [] for each.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

### Task 9: The MCP host's Azure module and bootstrap

**Files:**

- Create: `deploy/azure/terraform/main.tf`, `variables.tf`, `app.tf`, `domain.tf`, `budget.tf`, `outputs.tf`; `deploy/azure/bootstrap/main.tf`, `deploy/azure/bootstrap/README.md`
- Modify: `.github/workflows/test.yml`

**Interfaces:**

- Produces:
  - An environment named `apps` and a workspace named `logs` in the resource group, which the chat's module reads by those names.
  - Module outputs `service_url`, `app_host`, `environment_name`, `logs_workspace_name`, `dns_records`.
  - Bootstrap outputs `tenant_id`, `terraform_client_id`, `plan_client_id`, `deploy_client_id`, `registry`, `state_account`.

- [ ] **Step 1: Write the module's six files exactly as below**

`deploy/azure/terraform/main.tf`:

```hcl
# The resources every deployment of the server runs on Azure: the Container Apps environment the
# chat joins, its general log workspace, the service and its domain, and the budget. The caller
# holds the backend and the providers; the resource group, the registry and the identities CI
# acts as are the bootstrap's.
terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 5.7" }
    azapi   = { source = "Azure/azapi", version = "~> 2.13" }
  }
}

data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

data "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = var.resource_group_name
}
```

`deploy/azure/terraform/variables.tf`:

```hcl
# Every value that is one deployment's own. The caller reads them from its deployment.json.
variable "resource_group_name" { type = string }
variable "registry_name" { type = string }
variable "domain" { type = string }
variable "budget_chf" { type = number }
# The first of the month the budget starts counting from. Azure replaces a budget whose start
# changes, so the date is written down once rather than taken from the clock.
variable "budget_start" {
  type = string
  validation {
    condition     = can(regex("^\\d{4}-\\d{2}-01$", var.budget_start))
    error_message = "budget_start is the first of a month, YYYY-MM-01."
  }
}
variable "image" {
  description = "The image to run, pushed by the same workflow run"
  type        = string
}
# Container Apps gives the app a generated host name that is not knowable before it exists, and
# the service's own environment needs it. Empty on a deployment's first apply; the check in
# app.tf then names it.
variable "app_host" {
  type    = string
  default = ""
}
# Azure checks the domain's two records when the domain is added, so the domain is added only
# once the owner has set them from the dns_records output and said so here.
variable "dns_ready" {
  type    = bool
  default = false
}
```

`deploy/azure/terraform/app.tf`:

```hcl
# The environment the server and the chat share, and the workspace that keeps its general logs
# thirty days. The environment writes to Azure Monitor rather than to one workspace, so the chat's
# module can send its kept questions to a workspace of their own through a second diagnostic
# setting; a transformation the chat's module sets on this workspace keeps them out of it.
resource "azurerm_log_analytics_workspace" "logs" {
  name                = "logs"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  lifecycle {
    ignore_changes = [data_collection_rule_id]
  }
}

resource "azurerm_container_app_environment" "this" {
  name                = "apps"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
  logs_destination    = "azure-monitor"
}

resource "azurerm_monitor_diagnostic_setting" "logs" {
  name                       = "logs"
  target_resource_id         = azurerm_container_app_environment.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  enabled_log { category = "ContainerAppConsoleLogs" }
  enabled_log { category = "ContainerAppSystemLogs" }
}

# The service's own identity, which may pull its image and holds nothing else.
resource "azurerm_user_assigned_identity" "run" {
  name                = "mcp-run"
  location            = data.azurerm_resource_group.this.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_role_assignment" "pull" {
  scope                = data.azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.run.principal_id
}

locals {
  app_host = var.app_host
}

resource "azurerm_container_app" "mcp" {
  name                         = "mcp"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.run.id]
  }

  registry {
    server   = data.azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.run.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 3
    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
    container {
      name   = "mcp"
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"
      env {
        name  = "MCP_ALLOWED_HOSTS"
        value = join(",", compact([var.domain, local.app_host]))
      }
    }
  }

  depends_on = [azurerm_role_assignment.pull]
}

check "app_host" {
  assert {
    condition     = azurerm_container_app.mcp.ingress[0].fqdn == local.app_host
    error_message = "The app's host name is not the app_host in MCP_ALLOWED_HOSTS; a POST to /mcp on that name will be refused until deployment.json names the host this app carries as app_host."
  }
}
```

`deploy/azure/terraform/domain.tf`:

```hcl
# The domain in three steps, because azurerm adds a host name and issues a free certificate for it
# but cannot bind the one to the other (hashicorp/terraform-provider-azurerm#27362): the host
# name is added unbound, the certificate is issued against a CNAME that points straight at the
# app, and one PATCH of the app's custom domains binds them. The binding's two fields change
# under the custom domain once the PATCH lands, so they are ignored there.
resource "azurerm_container_app_custom_domain" "this" {
  count            = var.dns_ready ? 1 : 0
  name             = var.domain
  container_app_id = azurerm_container_app.mcp.id
  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "this" {
  count                        = var.dns_ready ? 1 : 0
  name                         = "mcp"
  container_app_environment_id = azurerm_container_app_environment.this.id
  subject_name                 = var.domain
  domain_control_validation    = "CNAME"
  depends_on                   = [azurerm_container_app_custom_domain.this]
}

resource "azapi_resource_action" "bind" {
  count       = var.dns_ready ? 1 : 0
  type        = "Microsoft.App/containerApps@2025-07-01"
  resource_id = azurerm_container_app.mcp.id
  method      = "PATCH"
  body = {
    properties = {
      configuration = {
        ingress = {
          customDomains = [{
            name          = var.domain
            bindingType   = "SniEnabled"
            certificateId = azurerm_container_app_environment_managed_certificate.this[0].id
          }]
        }
      }
    }
  }
}
```

`deploy/azure/terraform/budget.tf`:

```hcl
# A monthly budget of budget_chf in the billing account's currency, three warnings, to the resource
# group's owners. It warns and stops nothing, as the Google budget does.
resource "azurerm_consumption_budget_resource_group" "monthly" {
  name              = "monthly"
  resource_group_id = data.azurerm_resource_group.this.id
  amount            = var.budget_chf
  time_grain        = "Monthly"
  time_period {
    start_date = "${var.budget_start}T00:00:00Z"
  }
  dynamic "notification" {
    for_each = [50, 90, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_roles  = ["Owner"]
    }
  }
}
```

`deploy/azure/terraform/outputs.tf`:

```hcl
output "service_url" { value = "https://${azurerm_container_app.mcp.ingress[0].fqdn}" }
output "app_host" { value = azurerm_container_app.mcp.ingress[0].fqdn }
output "environment_name" { value = azurerm_container_app_environment.this.name }
output "logs_workspace_name" { value = azurerm_log_analytics_workspace.logs.name }
output "dns_records" {
  description = "What the domain needs before dns_ready; create these at the DNS provider of the deployment's domain"
  value = [
    { name = var.domain, type = "CNAME", value = azurerm_container_app.mcp.ingress[0].fqdn },
    { name = "asuid.${var.domain}", type = "TXT", value = azurerm_container_app.mcp.custom_domain_verification_id },
  ]
}
```

- [ ] **Step 2: Write the bootstrap exactly as below**

`deploy/azure/bootstrap/main.tf`:

```hcl
# What has to exist before GitHub Actions can authenticate and push, on Azure: applied once by the
# owner under their own login, with local state, and changed only when a repository joins.
# Everything CI can create lives in ../terraform and is applied by CI. The caller holds the
# provider block, and registers there the resource providers the modules use, since registering
# one is a subscription's right that no identity made here holds.
terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 5.7" }
  }
}

variable "resource_group_name" { type = string }
variable "location" { type = string }
# The state's storage account and the image registry: both names are global across Azure, so the
# deployment chooses them.
variable "state_account" { type = string }
variable "registry_name" { type = string }
# The repository's owner and name, and GitHub's numeric ids for both. The subjects below name the
# ids, the immutable form GitHub gives a repository created after 2026-07-15 or one that opted
# in, so a name freed by a delete or a rename is worth nothing to whoever takes it:
# `gh api repos/<owner>/<name> --jq '.id, .owner.id'`.
variable "repository" { type = string }
variable "repository_id" { type = string }
variable "owner_id" { type = string }

locals {
  owner   = split("/", var.repository)[0]
  name    = split("/", var.repository)[1]
  subject = "repo:${local.owner}@${var.owner_id}/${local.name}@${var.repository_id}"
  issuer  = "https://token.actions.githubusercontent.com"
  aud     = ["api://AzureADTokenExchange"]
}

resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_storage_account" "state" {
  name                            = var.state_account
  resource_group_name             = azurerm_resource_group.this.name
  location                        = azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  blob_properties {
    versioning_enabled = true
  }
}

resource "azurerm_storage_container" "state" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"
}

resource "azurerm_container_registry" "this" {
  name                = var.registry_name
  resource_group_name = azurerm_resource_group.this.name
  location            = azurerm_resource_group.this.location
  sku                 = "Basic"
  admin_enabled       = false
}

# Applies ../terraform and the chat's module: everything in the resource group, and the role
# assignments that give the apps' own identities their few rights. A run on main only.
resource "azurerm_user_assigned_identity" "terraform" {
  name                = "terraform"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
}

resource "azurerm_federated_identity_credential" "terraform" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.terraform.id
  issuer                    = local.issuer
  audience                  = local.aud
  subject                   = "${local.subject}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "terraform" {
  for_each             = toset(["Contributor", "Role Based Access Control Administrator"])
  scope                = azurerm_resource_group.this.id
  role_definition_name = each.value
  principal_id         = azurerm_user_assigned_identity.terraform.principal_id
}

resource "azurerm_role_assignment" "terraform_state" {
  scope                = azurerm_storage_container.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.terraform.principal_id
}

# Plans a pull request: reads the resource group and the state, and can change neither.
# -lock=false in the plan is what lets it do without write on the container.
resource "azurerm_user_assigned_identity" "plan" {
  name                = "terraform-plan"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
}

resource "azurerm_federated_identity_credential" "plan" {
  name                      = "github-pull-request"
  user_assigned_identity_id = azurerm_user_assigned_identity.plan.id
  issuer                    = local.issuer
  audience                  = local.aud
  subject                   = "${local.subject}:pull_request"
}

resource "azurerm_role_assignment" "plan" {
  scope                = azurerm_resource_group.this.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.plan.principal_id
}

resource "azurerm_role_assignment" "plan_state" {
  scope                = azurerm_storage_container.state.id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.plan.principal_id
}

# Pushes images and nothing else. A run on main only.
resource "azurerm_user_assigned_identity" "deploy" {
  name                = "deploy"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
}

resource "azurerm_federated_identity_credential" "deploy" {
  name                      = "github-main"
  user_assigned_identity_id = azurerm_user_assigned_identity.deploy.id
  issuer                    = local.issuer
  audience                  = local.aud
  subject                   = "${local.subject}:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "deploy" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPush"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

output "tenant_id" { value = azurerm_user_assigned_identity.terraform.tenant_id }
output "terraform_client_id" { value = azurerm_user_assigned_identity.terraform.client_id }
output "plan_client_id" { value = azurerm_user_assigned_identity.plan.client_id }
output "deploy_client_id" { value = azurerm_user_assigned_identity.deploy.client_id }
output "registry" { value = azurerm_container_registry.this.login_server }
output "state_account" { value = azurerm_storage_account.state.name }
```

`deploy/azure/bootstrap/README.md`:

```markdown
# Bootstrap on Azure

What GitHub Actions needs before it can authenticate and push on Azure: the resource group, the state's storage account and container, the image registry, and three user-assigned identities. `terraform` applies on main, with Contributor and Role Based Access Control Administrator on the resource group. `terraform-plan` plans a pull request as Reader. `deploy` pushes images with AcrPush. The owner applies it once, under their own `az login`, with local state kept outside the repository, and again only when a repository joins.

Each identity's federated credential names GitHub's immutable subject, `repo:OWNER@OWNER_ID/REPO@REPO_ID:…`, so a repository name freed by a delete or a rename is worth nothing to whoever takes it. A repository created after 2026-07-15 has that subject by default. An older one opts in once, before the bootstrap: `gh api -X PUT repos/<owner>/<repo>/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true`. The ids come from `gh api repos/<owner>/<repo> --jq '.id, .owner.id'`. Before the first workflow run, decode one token's `sub` in a throwaway step and compare it with the subject here, because a credential that does not match fails without saying why.

A module cannot configure its own provider and still be called for more than one deployment, so the calling root holds the provider block. That block also registers the resource providers the modules use, since registering one is a subscription's right that no identity made here holds:

    provider "azurerm" {
      features {}
      subscription_id                 = local.d.subscription_id
      storage_use_azuread             = true
      resource_provider_registrations = "none"
      resource_providers_to_register = [
        "Microsoft.App", "Microsoft.OperationalInsights", "Microsoft.ContainerRegistry", "Microsoft.Storage",
        "Microsoft.ManagedIdentity", "Microsoft.Insights", "Microsoft.Consumption",
      ]
    }

    module "bootstrap" {
      source              = "git::https://github.com/companygraph/mcp-server.git//deploy/azure/bootstrap?ref=<tag>"
      resource_group_name = local.d.resource_group
      location            = local.d.location
      state_account       = local.d.state_account
      registry_name       = local.d.container_registry
      repository          = local.d.repository
      repository_id       = local.d.repository_id
      owner_id            = local.d.owner_id
    }

where `local.d = jsondecode(file("${path.module}/../../deployment.json"))`. The outputs `tenant_id`, `terraform_client_id`, `plan_client_id` and `deploy_client_id` go into `deployment.json`. None of them is a secret: only a token GitHub signs for this repository passes a credential.
```

- [ ] **Step 3: Validate with both Terraform versions**

Run: `for d in deploy/azure/terraform deploy/azure/bootstrap; do terraform -chdir=$d init -backend=false -input=false >/dev/null && terraform -chdir=$d validate; done && terraform fmt -check -recursive deploy && npx -y markdownlint-cli2 deploy/azure/bootstrap/README.md`

Expected: two `Success! The configuration is valid.` lines, no fmt output, and no markdownlint issues.

Then validate both folders with Terraform 1.9.8, downloaded into a temporary directory as in chat-server's Task 5 Step 2, removing `.terraform/` and `.terraform.lock.hcl` from both folders afterwards.

- [ ] **Step 4: Validate them in CI**

In `.github/workflows/test.yml`, add after the `deploy/google/bootstrap` lines:

```yaml
      - run: terraform -chdir=deploy/azure/terraform init -backend=false -input=false
      - run: terraform -chdir=deploy/azure/terraform validate
      - run: terraform -chdir=deploy/azure/bootstrap init -backend=false -input=false
      - run: terraform -chdir=deploy/azure/bootstrap validate
```

- [ ] **Step 5: Commit**

```bash
git add deploy/azure .github/workflows/test.yml
git status --short
git commit -F - <<'EOF'
The MCP host has a Terraform module and a bootstrap for Azure

deploy/azure/terraform runs the server on Container Apps. It makes the environment the chat joins and a thirty-day workspace for its general logs, which the environment reaches through a diagnostic setting so the chat's module can add a second one. The service has an identity that may pull its image and nothing else. Its domain goes on in three steps, since azurerm cannot bind the free certificate it issues, and only once dns_ready says the two records are set. A monthly budget warns the resource group's owners and stops nothing. deploy/azure/bootstrap makes what CI needs first: the resource group, the state's account, the registry, and three identities. Each identity trusts GitHub's immutable subject, the Azure form of Google's trust by repository id. CI validates both.

Verified: terraform validate on both folders under Terraform 1.16.3 and 1.9.8; terraform fmt -check -recursive deploy; markdownlint-cli2 on the bootstrap README.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

`git status --short` before the commit must show no `.terraform` entry.

### Task 10: The MCP host's Azure workflow and README

**Files:**

- Create: `.github/workflows/deploy-azure.yml`
- Modify: `README.md`

- [ ] **Step 1: Write `.github/workflows/deploy-azure.yml`**

```yaml
# The build, the plan and the apply of a deployment on Azure, called by the release its
# package.json pins. The deployment's values reach it from deployment.json; the identities CI acts
# as and the registry are the bootstrap's. None of the ids is a secret. The caller holds the
# concurrency group: a caller and its called workflow sharing one group is a deadlock.
name: deployment
on:
  workflow_call:
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    outputs:
      image: ${{ steps.tag.outputs.image }}
    steps:
      - uses: actions/checkout@v7
      - run: |
          jq -r '"REGISTRY=\(.container_registry)\nTENANT=\(.tenant_id)\nSUBSCRIPTION=\(.subscription_id)\nDEPLOY_CLIENT=\(.deploy_client_id)"' deployment.json >> "$GITHUB_ENV"
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npm ci
      - run: npx companygraph-mcp-deploy snapshot
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npx companygraph-mcp-deploy page-css
      - run: npx companygraph-mcp-deploy jsonld
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - id: tag
        run: echo "image=$REGISTRY.azurecr.io/server:$(npx companygraph-mcp-deploy tag)-${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      - run: docker build -t "${{ steps.tag.outputs.image }}" .
      # The deploy identity holds AcrPush on the registry and nothing at the subscription.
      - if: github.event_name == 'push'
        uses: azure/login@v3
        with:
          client-id: ${{ env.DEPLOY_CLIENT }}
          tenant-id: ${{ env.TENANT }}
          subscription-id: ${{ env.SUBSCRIPTION }}
          allow-no-subscriptions: true
      - if: github.event_name == 'push'
        run: az acr login --name "$REGISTRY" && docker push "${{ steps.tag.outputs.image }}"
  terraform:
    needs: build
    if: github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: write
    defaults:
      run:
        working-directory: infra
    env:
      ARM_USE_OIDC: "true"
      ARM_USE_AZUREAD: "true"
    steps:
      - uses: actions/checkout@v7
      # A pull request plans as terraform-plan, which reads and changes nothing; only a push to
      # main applies, as terraform, and the bootstrap lets neither identity be used the other way.
      - run: |
          jq -r '"ARM_TENANT_ID=\(.tenant_id)\nARM_SUBSCRIPTION_ID=\(.subscription_id)"' ../deployment.json >> "$GITHUB_ENV"
          KEY=${{ github.event_name == 'push' && 'terraform_client_id' || 'plan_client_id' }}
          echo "ARM_CLIENT_ID=$(jq -r ".$KEY" ../deployment.json)" >> "$GITHUB_ENV"
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: 1.9.8
          terraform_wrapper: false
      - run: terraform init -input=false
      - run: terraform fmt -check -recursive
      - run: terraform validate
      - if: hashFiles('infra/bootstrap/*.tf') != ''
        run: terraform -chdir=bootstrap init -backend=false -input=false && terraform -chdir=bootstrap validate
      - if: github.event_name == 'pull_request'
        id: plan
        run: |
          set +e
          terraform plan -input=false -lock=false -no-color -var "image=$IMAGE" > plan.txt 2>&1
          echo "exit=$?" >> "$GITHUB_OUTPUT"
        env:
          IMAGE: ${{ needs.build.outputs.image }}
        continue-on-error: true
      - if: github.event_name == 'pull_request'
        env:
          IMAGE: ${{ needs.build.outputs.image }}
          PR: ${{ github.event.pull_request.number }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          { echo 'Terraform plan for `'"$IMAGE"'`'; echo; echo '```'; tail -c 60000 plan.txt; echo '```'; } > comment.md
          gh pr comment "$PR" --repo "${{ github.repository }}" --body-file comment.md
          test "${{ steps.plan.outputs.exit }}" = "0"
      - if: github.event_name == 'push'
        env:
          IMAGE: ${{ needs.build.outputs.image }}
        run: terraform apply -input=false -auto-approve -var "image=$IMAGE"
      # Fails by design on a deployment's first apply: until deployment.json names the app's host
      # as app_host, the service refuses a POST on that name.
      - if: github.event_name == 'push'
        run: |
          URL=$(terraform output -raw service_url)
          WANT=$(jq -r .commit ../source.json)
          GOT=$(curl -fsS --retry 10 --retry-all-errors --retry-delay 5 --max-time 30 -X POST "$URL/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_types","arguments":{}}}' | jq -r .result.structuredContent.model.commit)
          echo "serving $GOT, pinned $WANT"; test "$GOT" = "$WANT"
```

- [ ] **Step 2: Lint it**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/deploy-azure.yml`

Expected: no findings.

- [ ] **Step 3: Add the Azure paragraph to the README**

In `README.md`, directly after the paragraph on line 62 that begins `A deployment names the release in three places`, add one paragraph, one line in the file:

```markdown
A deployment on Azure names `"platform": "azure"` in `deployment.json` with its tenant, subscription, resource group, location, `container_registry`, `state_account`, `budget_start`, the repository's `repository_id` and `owner_id`, and the bootstrap's three client ids; `registry_name` keeps meaning the MCP Registry's name, and the deployment's own suite checks the file against its platform. Its `infra/main.tf` calls `deploy/azure/terraform` and its `infra/bootstrap/main.tf` calls `deploy/azure/bootstrap`, whose [README](deploy/azure/bootstrap/README.md) gives the owner's once-only steps, and its workflow calls `.github/workflows/deploy-azure.yml`, all at the pinned tag; the three places are held to one by the same pin test. The first apply makes the app and prints the domain's two records; once they are set, `deployment.json` gains `app_host` and `dns_ready: true`, and the second apply adds the domain with a free certificate. The environment the chat's module joins is this module's, named `apps`, and so is the thirty-day workspace `logs`.
```

Then run `npx -y markdownlint-cli2 README.md`. Expected: no issues.

- [ ] **Step 4: Run the suite**

Run: `npm test`

Expected: all pass. The pin test's regex matches `deploy-azure.yml@v…` exactly as it matches `deploy-google.yml@v…`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-azure.yml README.md
git commit -F - <<'EOF'
The MCP host has a workflow for Azure

deploy-azure.yml builds and tests a deployment's image, pushes it to the bootstrap's registry as the deploy identity, and plans on a pull request as terraform-plan or applies on main as terraform. The live POST of list_types is read against the model pin, as on Google. The README says what an Azure deployment.json names, which module, bootstrap and workflow it calls, and how its domain goes on in a second apply.

Verified: actionlint on deploy-azure.yml, no findings; markdownlint-cli2 on README.md; npm test <count>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='[%s]'
```

---

## Part C: pull requests and releases

### Task 11: Open both pull requests and stop

The controller does this after the whole-branch review of each repository.

- [ ] **Step 1: Read the last two merged PR bodies of each repository for form**

Run: `gh pr list -R companygraph/<repo> --state merged --limit 2 --json number -q '.[].number'`, then read each with `gh pr view <n> -R companygraph/<repo> --json body -q .body`.

- [ ] **Step 2: chat-server**

Push with `git -c credential.helper='!gh auth git-credential' push -u https://github.com/companygraph/chat-server.git the-servers-run-on-azure`, then open the PR titled `The chat can run on Azure`. The body is prose with no headings or bullets:

- First, why: the gap piece 2 closes.
- Then what changed: the three adapters, the checks by platform, the module and the workflows.
- Then what the research changed in the design.
- Then that Google and the three deployments are untouched and need no re-pin.
- Then `Release notes to write at tagging: …`.
- Then `Verified: …`, naming the commands that actually ran.
- Last, the 🤖 line.

Watch the checks, report the link and stop.

- [ ] **Step 3: mcp-server**

The same, titled `The MCP host can run on Azure`. It opens after chat-server's PR, and its README may link the spec, which is already on main.

### Task 12: Release both servers

Only on Rob's word, after both PRs are merged. It follows piece 1's Task 11 exactly.

- A worktree per repository named `<repo>-this-release-is-<version-with-dashes>`, based on `origin/main`.
- `npm version minor --no-git-tag-version`, the version read from `package.json` at that moment.
- Commit `This release is <version>` with one prose paragraph and `Verified: package.json and package-lock.json read <version>; npm test <count> on this head.`
- A PR, and stop.
- After Rob merges, run `gh release create v<version> -R companygraph/<repo> --target <merge commit> --title v<version> --notes "<the release-notes sentence>"`, then remove the release worktree and branches.

The three Google deployments need no re-pin for this release. Nothing they use changes, and they re-pin whenever their next wave comes.
