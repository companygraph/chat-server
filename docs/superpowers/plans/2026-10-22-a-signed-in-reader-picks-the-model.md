# A signed-in reader picks the model — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader signed in at `id.blust.ch` picks a model and an effort in any of the three chats with `/model` and `/effort`, for each model a ZITADEL role grants on that site, while every visitor keeps `claude-sonnet-5` at `low`.

**Architecture:** A new repository, `robertblust/id-blust-ch`, runs ZITADEL v4 on Cloud Run in `europe-west6` and holds its configuration as Terraform. `companygraph/chat-server` verifies a ZITADEL JWT access token on `POST /chat`, chooses the model and effort the token's roles allow, meters each call at its own model's price, and keeps a month per reader. The widget in `robertblust/design` signs in by authorization code with PKCE and adds the four commands; the three hosts and the three sites take the releases one at a time, blust.ch first.

**Tech Stack:** Node 22 ESM with JSDoc types (`tsc --noEmit`), `node --test`, Playwright for the widget, `@anthropic-ai/sdk`, `jose` for JWT verification, Terraform with `hashicorp/google ~> 8.0` and `zitadel/zitadel`, GitHub Actions, ZITADEL v4 and its login v2 container, Cloud SQL PostgreSQL 18, Firestore.

**Spec:** `docs/superpowers/specs/2026-10-22-a-signed-in-reader-picks-the-model-design.md` in this repository.

## Global Constraints

- The default and every visitor's model is `claude-sonnet-5` at effort `low`; nothing a visitor sends changes that.
- Roles and model ids: `sonnet-5-5` → `claude-sonnet-5-5`, `opus` → `claude-opus-5-5`, `fable` → `claude-fable-5-1`, `haiku` → `claude-haiku-5-5`; every signed-in reader may also pick `claude-sonnet-5`.
- Efforts: `low`, `medium`, `high`, `xhigh`, `max`; output limits 2400, 8000, 16000, 32000, 64000.
- Meter unit: one `claude-sonnet-5` input token. Weights (input, cache write, cache read, output): Sonnet 5 and 5.5 `1, 1.25, 0.1, 5`; Opus 5.5 `2, 2.5, 0.1, 10`; Fable 5.1 `5, 6.25, 0.125, 25`; Haiku 5.5 `0.05, 0.0625, 0.005, 0.25`. Confirm every figure on Anthropic's price list before the release (Task B9).
- A signed-in reader's calls count against the site's month and the reader's own month, never the day's share.
- Each host starts at `user_month_tokens` 5000000 and keeps `month_tokens` 18500000.
- No `thinking` field is sent; `tool_choice` stays `{ type: "none" }` on the final round only.
- New refusal codes: `not_granted` 403, `signed_out` 401, `over_user_month` 429, `declined` 422.
- No person, address, key or token in any repository; the reader's meter key is HMAC-SHA256 of `sub` under the deployment's secret.
- The question line gains `model` and `effort` and nothing about the reader.
- Without the `sign_in` block a deployment behaves exactly as at `v0.37.0`; the Azure module and `CHAT_METER=table` refuse `sign_in`.
- Every repository's own register holds: `conventions/WRITING.md`, a Markdown paragraph is one line, en-US, `sh conventions/conventions-check` exits 0 before each commit, commit messages as a plain subject under seventy characters, prose body, a `Verified:` line naming the commands run, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Merges and releases are the owner's: ask the owner to name each merge and each release before doing it; a bare "yes" is not enough.

## Review Focus

- A token whose role was granted in another site's organization: refused as `not_granted`, never answered (Task B4 test `roleOfAnotherSite`).
- A token that lapses between two messages of one conversation: the next message is refused as `signed_out`, the panel offers `/login`, and the conversation is kept (Task C2 test `lapsedTokenKeepsConversation`).
- A reader's month refused while the site's is not, and the site's reservation given back (Task B2 test `readerRefusalGivesBackSite`).
- A remembered `/model` choice the reader no longer holds a role for: the widget falls back to `claude-sonnet-5` before sending, never sends a refused model (Task C3 test `revokedChoiceFallsBack`).
- A visitor body naming `"model": "claude-sonnet-5", "effort": "low"` explicitly: answered as a visitor's, not refused (Task B5 test `visitorNamingDefaultIsAnswered`).

---

## Part A — `robertblust/id-blust-ch`

### Task A1: The repository and its bootstrap

**Files:**
- Create: `README.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE` (Apache-2.0), `conventions.json`, `pins.json`, `.github/dependabot.yml`, `.gitignore`, `.markdownlint-cli2.jsonc`, `deployment.json`
- Create: `infra/bootstrap/main.tf`, `infra/bootstrap/README.md`
- Create: `.github/workflows/conventions.yml`

**Interfaces:**
- Produces: `deployment.json` `{ "project": "id-blust-ch", "project_number": "<from bootstrap>", "billing_account": "011DEB-4A45A0-3A52BB", "region": "europe-west6", "domain": "id.blust.ch", "repository": "robertblust/id-blust-ch", "repository_id": "<from GitHub>", "budget_chf": <owner's figure> }`; the state bucket `id-blust-ch-tfstate`; the CI identity `deploy@id-blust-ch.iam.gserviceaccount.com` reachable by workload identity federation from this repository's `main` and its pull requests.

- [ ] **Step 1: Create the repository** with `gh repo create robertblust/id-blust-ch --public`, and copy the layout of `robertblust/mcp-blust-ch` for everything listed above except the server; take `conventions/` through `pins.json`'s conventions pin, as that repository does.
- [ ] **Step 2: Write `infra/bootstrap/main.tf`** after `/Users/rob/git/robertblust/mcp-blust-ch/infra/bootstrap/main.tf`: the project, the APIs `run`, `sqladmin`, `secretmanager`, `compute`, `iam`, `iamcredentials`, `sts`, `cloudresourcemanager`, `billingbudgets`, the state bucket, the CI identity and its pool, and a budget alert at `budget_chf`. Ask the owner for `budget_chf` before applying; state stays local, as there.
- [ ] **Step 3: Validate** with `terraform -chdir=infra/bootstrap init -backend=false && terraform -chdir=infra/bootstrap validate`; expected `Success! The configuration is valid.`
- [ ] **Step 4: Owner applies** the bootstrap by hand, as `infra/bootstrap/README.md` says, and writes `project_number` and `repository_id` into `deployment.json`.
- [ ] **Step 5: Run** `sh conventions/conventions-check`; expected exit 0. Commit: `The repository and its bootstrap`.

### Task A2: ZITADEL on Cloud Run

**Files:**
- Create: `infra/main.tf`, `infra/database.tf`, `infra/secrets.tf`, `infra/run.tf`, `infra/domain.tf`, `infra/outputs.tf`, `infra/variables.tf`
- Create: `.github/workflows/infra.yml`
- Modify: `README.md` (owner's steps)

**Interfaces:**
- Consumes: `deployment.json` (Task A1).
- Produces: `https://id.blust.ch` serving ZITADEL v4 with login v2; Secret Manager secrets `zitadel-masterkey`, `zitadel-db-password`, `zitadel-login-token`, `zitadel-admin-key`; output `dns_records`.

- [ ] **Step 1: Decide the front.** Check whether Cloud Run domain mappings are offered in `europe-west6` (`gcloud beta run domain-mappings list --region europe-west6 --project id-blust-ch`, and the regions list in Cloud Run's domain-mapping documentation). A domain mapping sends a whole domain to one service, and login v2 is a second container served at `/ui/v2/login` of the same domain. Use a domain mapping only if Zurich offers it and ZITADEL v4 serves its login from the one service; otherwise use a global load balancer with path routing, as at Läderach. The owner has said to take the load balancer where it is the better choice. Write down which, and why, in `infra/domain.tf`'s first comment.
- [ ] **Step 2: Write `infra/database.tf`**: Cloud SQL PostgreSQL 18, Enterprise edition, the smallest shared-core tier, one database `zitadel`, its user, no public IP beyond what the Cloud SQL socket needs, as `/Users/rob/git/laderach/notes/test-setup/terraform/database.tf` does it.
- [ ] **Step 3: Write `infra/secrets.tf`**: `random_password` for the 32-character masterkey and the database password into Secret Manager, as the Läderach `secrets.tf` does; empty secrets `zitadel-login-token` and `zitadel-admin-key` whose versions the owner adds by hand (Step 7).
- [ ] **Step 4: Write `infra/run.tf`** after the Läderach `cloudrun.tf` `zitadel` service: image `ghcr.io/zitadel/zitadel:<pinned v4 release>`, args `["start-from-init", "--masterkeyFromEnv", "--tlsMode", "external"]`, port named `h2c` 8080, `min_instance_count = 0`, `max_instance_count = 2`, the Cloud SQL socket, `ZITADEL_EXTERNALDOMAIN=id.blust.ch`, `ZITADEL_EXTERNALPORT=443`, `ZITADEL_EXTERNALSECURE=true`, the first instance's organization named `blust.ch` and its human admin from `ZITADEL_FIRSTINSTANCE_ORG_HUMAN_*` with the owner's login name entered as a Terraform variable from a GitHub secret, never a file. A second service runs `ghcr.io/zitadel/zitadel-login` at the same release, port 3000, `min_instance_count = 0`, with `ZITADEL_SERVICE_USER_TOKEN` from `zitadel-login-token` and `ZITADEL_SESSION_COOKIE_SECRET` from a `random_password`.
- [ ] **Step 5: Write `infra/domain.tf`** for the front Step 1 chose, and `outputs.tf` with `dns_records`.
- [ ] **Step 6: Write `.github/workflows/infra.yml`**: plan on pull requests, apply on push to `main`, authenticated as the CI identity, `terraform -chdir=infra` with backend prefix `infra`; after apply, `curl -fsS https://id.blust.ch/.well-known/openid-configuration` and compare its `issuer` with `https://id.blust.ch`.
- [ ] **Step 7: Write the owner's steps** in `README.md`: add the DNS records at Hostpoint; after the first start, sign in as the admin, create the login client's machine user with its PAT and add it as the first version of `zitadel-login-token`; create a machine user `terraform` with the instance's `IAM_OWNER` role and a JSON key, added as the first version of `zitadel-admin-key`, with the key on stdin and never in a file.
- [ ] **Step 8: Validate** with `terraform -chdir=infra init -backend=false && terraform -chdir=infra validate && terraform fmt -check -recursive infra`; expected success and no output from `fmt`. Commit: `ZITADEL runs on Cloud Run at id.blust.ch`.
- [ ] **Step 9: Owner merges** (named merge), the apply runs, the owner follows Step 7, and `curl -fsS https://id.blust.ch/.well-known/openid-configuration` returns the issuer. A first request after an idle hour may take seconds; that is accepted.

### Task A3: What ZITADEL holds

**Files:**
- Create: `zitadel/main.tf`, `zitadel/orgs.tf`, `zitadel/project.tf`, `zitadel/apps.tf`, `zitadel/policy.tf`, `zitadel/outputs.tf`, `sites.json`
- Create: `.github/workflows/zitadel.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `https://id.blust.ch` and the `zitadel-admin-key` secret (Task A2).
- Produces: output `sign_in` per site, `{ "<origin>": { "issuer": "https://id.blust.ch", "project_id": "…", "org_id": "…", "client_id": "…" } }`, which Tasks D1 and E1 copy; role keys `sonnet-5-5`, `opus`, `fable`, `haiku`.

- [ ] **Step 1: Confirm the grant model** against ZITADEL v4's documentation and the running instance: can an authorization (user grant) in the organization `companygraph.io`, on the project `chat` granted to it, name a user whose home organization is `blust.ch`? Try it by hand in the console with the owner's user. If yes, the roles are the four keys above and the site is the organization a role was granted in. If no, the roles are per site and model, `<site>-<model>` with `<site>` one of `blust-ch`, `companygraph-io`, `guestgraph-io` (for example `companygraph-io-opus`), all granted in `blust.ch`. Write the answer in `zitadel/project.tf`'s first comment and tell the Part B implementer which variant Task B4 builds.
- [ ] **Step 2: Write `sites.json`**: `[{ "site": "blust.ch", "origin": "https://blust.ch" }, { "site": "companygraph.io", "origin": "https://companygraph.io" }, { "site": "guestgraph.io", "origin": "https://guestgraph.io" }]`.
- [ ] **Step 3: Write the roots' resources** with the `zitadel/zitadel` provider, its key read from Secret Manager in the workflow: the organizations `companygraph.io` and `guestgraph.io` beside the first instance's `blust.ch`; `zitadel_project` `chat` in `blust.ch` with `project_role_assertion = true`; the roles of Step 1; `zitadel_project_grant` of `chat` to the two other organizations with every role; per site a `zitadel_application_oidc` with `app_type = "OIDC_APP_TYPE_USER_AGENT"`, `auth_method_type = "OIDC_AUTH_METHOD_TYPE_NONE"`, `grant_types = ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"]`, `response_types = ["OIDC_RESPONSE_TYPE_CODE"]`, `access_token_type = "OIDC_TOKEN_TYPE_JWT"`, `access_token_role_assertion = true`, `id_token_role_assertion = true`, `id_token_userinfo_assertion = true`, redirect and post-logout URIs `"<origin>/"`; the instance's login policy with registration off and passkeys allowed; the instance's label policy in blust.ch's colors and mark.
- [ ] **Step 4: Validate** with `terraform -chdir=zitadel init -backend=false && terraform -chdir=zitadel validate`; expected success. Commit: `ZITADEL holds three organizations, the chat project and its roles`.
- [ ] **Step 5: Owner merges** (named merge); the workflow applies; the owner confirms in the Anthropic Console that the workspace allows all five models and that the organization's data retention allows Claude Fable 5.1, then grants their own user every role on all three sites in the console.
- [ ] **Step 6: Check one token by hand**, as the README's owner's steps say: sign in through the blust.ch application in a browser with PKCE (the README gives the URL with the four scopes of the spec's section 4) and decode the access token; expected `iss` `https://id.blust.ch`, `aud` holding the project id, and `urn:zitadel:iam:org:project:roles` holding each granted role with the org id of each site.

---

## Part B — `companygraph/chat-server` 0.38.0

Work on the branch `a-signed-in-reader-picks-the-model`, which holds the spec.

### Task B1: The model table and the request it builds

**Files:**
- Create: `lib/models.mjs`
- Modify: `lib/model.mjs:40-102` (`MODEL`, `EFFORT`, `WEIGHTS`, `params`), `lib/model.mjs:120-150` (`over`, `turn`)
- Test: `test/models.test.mjs`, `test/model.test.mjs`

**Interfaces:**
- Produces, in `lib/models.mjs`:
  - `DEFAULT_MODEL = "claude-sonnet-5"`, `DEFAULT_EFFORT = "low"`
  - `MODELS: Record<string, { label: string; role: string | null; weights: { input: number; cacheWrite: number; cacheRead: number; output: number } }>` with the five ids of the Global Constraints, `role: null` for `claude-sonnet-5`
  - `EFFORTS = ["low", "medium", "high", "xhigh", "max"]`
  - `outputLimit(effort: Effort): number` → 2400, 8000, 16000, 32000, 64000
  - `callTimeoutMs(effort: Effort): number` → 60000 at `low`, 840000 otherwise
  - `@typedef {{ model: string; effort: Effort }} Choice`; `DEFAULT_CHOICE: Choice`
- Changes: `MODEL` stays exported as `DEFAULT_MODEL` and `WEIGHTS` as `MODELS[DEFAULT_MODEL].weights` so existing importers keep working; `EFFORT` goes. `params({ system, tools, messages, final, again, choice = DEFAULT_CHOICE })` sends `model: choice.model`, `max_tokens: outputLimit(choice.effort)`, `output_config: { effort: choice.effort }`. `turn(request, onText, { signal, timeoutMs })` passes `timeout: timeoutMs` to `messages.stream`'s options when given.

- [ ] **Step 1: Write the failing tests.** In `test/models.test.mjs`: `everyModelHasWeights` (each of the five ids has four numeric weights, `claude-sonnet-5`'s are `{ input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 }`, `claude-fable-5-1`'s `{ input: 5, cacheWrite: 6.25, cacheRead: 0.125, output: 25 }`); `outputLimitPerEffort` (`assert.deepEqual(EFFORTS.map(outputLimit), [2400, 8000, 16000, 32000, 64000])`); `rolesAreTheSpecs` (`assert.deepEqual(Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.role])), { "claude-sonnet-5": null, "claude-sonnet-5-5": "sonnet-5-5", "claude-opus-5-5": "opus", "claude-fable-5-1": "fable", "claude-haiku-5-5": "haiku" })`). In `test/model.test.mjs`: `paramsTakeTheChoice` (`params({ ..., choice: { model: "claude-opus-5-5", effort: "high" } })` has `model` `claude-opus-5-5`, `max_tokens` 16000, `output_config.effort` `high`, and no `thinking` key); `paramsDefaultIsToday` (no `choice` gives `claude-sonnet-5`, 2400, `low`); `turnPassesTimeout` (a fake client's `stream` receives `{ signal, timeout: 840000 }`).
- [ ] **Step 2: Run** `node --test test/models.test.mjs test/model.test.mjs`; expected FAIL, `lib/models.mjs` not found.
- [ ] **Step 3: Implement** `lib/models.mjs` and the changes to `lib/model.mjs`; the existing assertions on `MODEL` and `EFFORT` in `test/model.test.mjs` move to `DEFAULT_MODEL` and `DEFAULT_EFFORT`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit**: `The models a reader may pick, with their prices and limits`.

### Task B2: The meter at each model's price, and a reader's month

**Files:**
- Modify: `lib/meter.mjs`, `lib/errors.mjs`, `lib/platform.mjs`
- Test: `test/meter.test.mjs`, `test/platform.test.mjs`

**Interfaces:**
- Consumes: `MODELS`, `outputLimit` (Task B1).
- Produces:
  - `units(usage, model = DEFAULT_MODEL): number` with that model's weights
  - `ESTIMATE_INPUT = 18000`; `estimateFor(choice: Choice): number` = `Math.ceil(ESTIMATE_INPUT * w.input + outputLimit(choice.effort) * w.output)`, so `estimateFor(DEFAULT_CHOICE) === 30000 === ESTIMATE`
  - `Meter.reserve(estimate, { day = true } = {})`, `Meter.settle(estimate, actual, { day = true } = {})`: with `day: false` neither checks nor moves `dayTokens`
  - `class ReaderMeter { constructor(store: Store, { monthTokens, now }); reserve(estimate): Promise<void>; settle(estimate, actual): Promise<{ month: string; monthTokens: number }> }`, refusing `over_user_month` with `retryAt` the first of the next month in UTC
  - `CODES` gains `not_granted: 403`, `signed_out: 401`, `over_user_month: 429`, `declined: 422`
  - `readerStore(kind: string, key: string, adapters = READERS): Promise<Store>` in `lib/platform.mjs`: `firestore` → `new FirestoreStore({ path: "chat-readers/" + key })`, `memory` → one `MemoryStore` per key for the process; any other kind throws `CHAT_METER=<kind> keeps no readers' months; sign-in needs firestore or memory`

- [ ] **Step 1: Write the failing tests** in `test/meter.test.mjs`: `unitsAtFable` (`units({ input_tokens: 1000, output_tokens: 100 }, "claude-fable-5-1") === 7500`); `unitsDefaultUnchanged` (today's existing assertions pass with no model given); `estimateForDefaultIs30000`; `estimateForFableMax` (`estimateFor({ model: "claude-fable-5-1", effort: "max" }) === 1690000`); `signedInSkipsDay` (with `monthTokens` 1000000 and `dayTokens` already at the day share, `reserve(50000, { day: false })` passes and leaves `dayTokens` unchanged and `monthTokens` up by 50000); `readerMonthRefuses` (a `ReaderMeter` at `monthTokens` 100 refuses `reserve(101)` with code `over_user_month` and `retryAt` the first of the next month); `readerRefusalGivesBackSite` is Task B5's. In `test/platform.test.mjs`: `readerStoreMemoryPerKey` (two keys, two stores; one key twice, one store); `readerStoreTableRefused`.
- [ ] **Step 2: Run** `node --test test/meter.test.mjs test/platform.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the interfaces above; `ReaderMeter` keeps `{ month, monthTokens }` in its document and rolls it by month alone, reusing `monthOf` and `nextMonth`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit**: `The meter counts each model at its price and keeps a reader's month`.

### Task B3: Configuration of sign-in

**Files:**
- Modify: `lib/config.mjs` (typedef `Config`, `configFromEnv`)
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces: `Config.signIn: { issuer: string; projectId: string; orgId: string; userMonthTokens: number; readerSecret: string; rolePrefix: string | null } | null`, read from `CHAT_OIDC_ISSUER`, `CHAT_OIDC_PROJECT`, `CHAT_OIDC_ORG`, `CHAT_USER_MONTH_TOKENS`, `CHAT_READER_SECRET` and, only in Task A3's per-site variant, `CHAT_OIDC_ROLE_PREFIX` (for example `blust-ch-`).

- [ ] **Step 1: Write the failing tests**: `signInAbsentIsNull`; `signInAllFive` (the five variables give the object, `userMonthTokens` a number); `signInPartialRefused` (any of the five missing throws naming the missing ones, as `federationFromEnv` does); `signInIssuerIsHttps` (`http://` refused); `signInNeedsReaderMeter` (`CHAT_METER=table` with sign-in throws `sign-in needs CHAT_METER firestore or memory`).
- [ ] **Step 2: Run** `node --test test/config.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** `signInFromEnv(env): SignIn | null` beside `federationFromEnv`, and its call in `configFromEnv`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit**: `The configuration names the identity service a reader signs in at`.

### Task B4: The token and its grants

**Files:**
- Create: `lib/signin.mjs`
- Modify: `package.json` (dependency `jose` `^6.1.0`), `package-lock.json`
- Test: `test/signin.test.mjs`

**Interfaces:**
- Consumes: `Config.signIn` (Task B3), `MODELS`, `DEFAULT_MODEL` (Task B1), `ChatError` codes (Task B2).
- Produces:
  - `signInVerifier(signIn, { jwks } = {}) → { reader(authorization: string | undefined): Promise<Reader | null> }`, where `jwks` defaults to `createRemoteJWKSet(new URL(signIn.issuer + "/oauth/v2/keys"))`; no header gives `null`; a header not `Bearer <jwt>`, or a token failing `jwtVerify(token, jwks, { issuer: signIn.issuer, audience: signIn.projectId })`, throws `ChatError("signed_out", ...)`
  - `@typedef {{ sub: string; models: Set<string> }} Reader`, where `models` is `DEFAULT_MODEL` plus each model whose role the claim `urn:zitadel:iam:org:project:roles` holds granted in `signIn.orgId` (`claim[role]?.[orgId] !== undefined`), or, with `rolePrefix`, whose role `rolePrefix + role` the claim holds at all
  - `readerKey(sub: string, secret: string): string`, hex HMAC-SHA256

- [ ] **Step 1: Write the failing tests** with a key pair from `jose.generateKeyPair("RS256")`, tokens signed by `new SignJWT(...)`, and `jwks: createLocalJWKSet({ keys: [publicJwk] })`: `noHeaderIsVisitor` (→ `null`); `badSignatureSignedOut`; `foreignIssuerSignedOut`; `otherAudienceSignedOut`; `expiredSignedOut`; `roleOfThisSite` (claim `{ opus: { "<site org>": "blust.ch" } }` → `models` has `claude-opus-5-5` and `claude-sonnet-5`); `roleOfAnotherSite` (claim `{ opus: { "<other org>": "x" } }` → `models` only `claude-sonnet-5`); `prefixVariant` (with `rolePrefix: "blust-ch-"`, claim `{ "blust-ch-fable": {...} }` → `claude-fable-5-1`; `{ "companygraph-io-fable": {...} }` → not); `readerKeyIsStable` (same input, same 64 hex characters; another secret, another key).
- [ ] **Step 2: Run** `node --test test/signin.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** `lib/signin.mjs`; `npm install jose@^6.1.0`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit**: `The chat reads a reader's grants from the identity service's token`.

### Task B5: The request chooses, the loop answers with the choice

**Files:**
- Modify: `lib/http.mjs` (preflight, POST, GET), `lib/loop.mjs:504-641` (`answer`), `lib/shape.mjs` (`chosen`)
- Test: `test/http.test.mjs`, `test/loop.test.mjs`, `test/shape.test.mjs`

**Interfaces:**
- Consumes: Tasks B1–B4.
- Produces:
  - `Services` gains `signIn: ReturnType<typeof signInVerifier> | null` and `readers: ((key: string) => Promise<ReaderMeter>) | null`
  - `chosen(body, reader: Reader | null): Choice` in `lib/shape.mjs`: absent `model` and `effort` give `DEFAULT_CHOICE`; a `model` not in `MODELS` or an `effort` not in `EFFORTS` throws `bad_request`; without a reader anything but the default throws `not_granted`; with one, a model not in `reader.models` throws `not_granted`
  - `answer(services, { messages, lang, signal, choice = DEFAULT_CHOICE, reader = null }, emit)` where `reader` is a `ReaderMeter` or `null`; each round reserves `estimateFor(choice)` on the site with `{ day: !reader }` and then on the reader, giving the site's back by `settle(est, 0, { day: false })` if the reader's refuses; settles both with `units(msg.usage, choice.model)`; passes `choice` to `params` and `callTimeoutMs(choice.effort)` to `turn`; a `stop_reason` of `"refusal"` throws `ChatError("declined", "the model declined to answer this question")`; `done` gains `by: { model: choice.model, effort: choice.effort }`
  - The question line gains `model` and `effort`; `Access-Control-Allow-Headers` is `content-type, x-chat, authorization`; `GET /chat` gains `models: Object.keys(MODELS)` and `sign_in: config.signIn ? config.signIn.issuer : null`

- [ ] **Step 1: Write the failing tests.** `test/shape.test.mjs`: `chosenDefault`, `chosenUnknownModelBadRequest`, `visitorNamingDefaultIsAnswered` (`chosen({ model: "claude-sonnet-5", effort: "low" }, null)` is the default), `visitorOtherModelNotGranted`, `visitorOtherEffortNotGranted`, `readerUngrantedModelNotGranted`, `readerGrantedAnyEffort`. `test/loop.test.mjs`, with the fake model capturing requests: `choiceReachesRequest` (Opus at `high` → request `model` `claude-opus-5-5`, `max_tokens` 16000); `doneNamesBy`; `refusalDeclines` (a fake `stop_reason: "refusal"` → `ChatError` code `declined`); `readerCountsTwice` (a reader's message moves the reader's month and the site's month, and not `dayTokens`); `readerRefusalGivesBackSite` (a reader at its ceiling: refused `over_user_month`, the site's `monthTokens` unchanged afterwards). `test/http.test.mjs`: `preflightAllowsAuthorization`; `bearerWithoutSignInIgnored` (a deployment without sign-in given an `Authorization` header answers as today, ignoring it); `signedOutIs401` (sign-in configured, a bad token → 401 `{ error: { code: "signed_out" } }`); `notGrantedIs403`; `questionLineHasModelAndEffort` (the logged line has `model` and `effort` and no `sub`); `getChatListsModels`.
- [ ] **Step 2: Run** `node --test test/shape.test.mjs test/loop.test.mjs test/http.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement.** In the POST handler, after the body parses: `const r = signIn ? await signIn.reader(req.headers.authorization) : null; const choice = chosen(body, r); const reader = r && readers ? await readers(readerKey(r.sub, config.signIn.readerSecret)) : null;`, then `answer(..., { messages, lang, signal, choice, reader }, ...)`. Refusals before the stream use the existing JSON path, so `signed_out` and `not_granted` arrive with their status.
- [ ] **Step 4: Run** `npm test && npm run typecheck`; expected PASS.
- [ ] **Step 5: Commit**: `A signed-in reader's message is answered by the model they chose`.

### Task B6: The process, the page and the report

**Files:**
- Modify: `bin/http.mjs`, `lib/page.mjs:88-89`, `lib/report.mjs`, `README.md`
- Test: `test/page.test.mjs`, `test/report.test.mjs`

**Interfaces:**
- Consumes: Tasks B2–B5.

- [ ] **Step 1: Write the failing tests**: `pageNamesThePick` (with `config.signIn` set the sentence reads `through Claude Sonnet 5, or the model a signed-in reader picks, on the Anthropic API, and adds nothing the tools did not say.`; without it, today's sentence unchanged); `reportCountsByModel` (questions with `model` fields give a `By model` table with a count per model id; lines without `model` count as `claude-sonnet-5`).
- [ ] **Step 2: Run** `node --test test/page.test.mjs test/report.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement**; in `bin/http.mjs`, with `config.signIn`, build `signInVerifier(config.signIn)` and `readers = async (key) => new ReaderMeter(await readerStore(config.meter, key), { monthTokens: config.signIn.userMonthTokens })`, pass both to `createHttpServer`, and add `sign-in <issuer>` to the start line. The README's "The chat" sections say what a signed-in reader may do, the four new codes, the reader's document `chat-readers/<key>`, and that a reader's month is stopped by deleting the reader's grants in ZITADEL.
- [ ] **Step 4: Run** `npm test && npm run typecheck && sh conventions/conventions-check`; expected PASS and exit 0.
- [ ] **Step 5: Commit**: `The service signs readers in where the deployment names an issuer`.

### Task B7: The deployment carries sign-in

**Files:**
- Modify: `deploy/build/config.mjs` (`chatProblems`), `deploy/google/terraform/variables.tf`, `deploy/google/terraform/run.tf`, `deploy/google/terraform/main.tf` (APIs), `.github/workflows/deploy-google.yml` (live check)
- Create: `deploy/google/terraform/signin.tf`
- Test: `test/deploy-config.test.mjs`

**Interfaces:**
- Consumes: the env names of Task B3.
- Produces: module variables `sign_in = object({ issuer = string, project_id = string, org_id = string, role_prefix = optional(string) })`, default `null`, and `user_month_tokens = number`, default `null`, required when `sign_in` is set; `chat.json` keys `sign_in` (`{ issuer, project_id, org_id, client_id, role_prefix? }`; `client_id` is the widget's and is checked but not passed) and `user_month_tokens`.

- [ ] **Step 1: Write the failing tests** in `test/deploy-config.test.mjs`: `signInChecked` (a `sign_in` with an `http://` issuer, a missing `project_id`, a numeric `org_id` or an unknown key each give a problem); `signInNeedsUserMonth`; `signInNotOnAzure` (`sign_in is for a chat on Google`); `noSignInNoProblem`.
- [ ] **Step 2: Run** `node --test test/deploy-config.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the checks; in Terraform, `signin.tf` makes `random_password` `reader_secret` (length 48) into the secret `chat-reader-secret` with accessor for `chat-run`, only when `sign_in` is set; `run.tf` adds `CHAT_OIDC_ISSUER`, `CHAT_OIDC_PROJECT`, `CHAT_OIDC_ORG`, `CHAT_USER_MONTH_TOKENS`, `CHAT_READER_SECRET` (from the secret) and `CHAT_OIDC_ROLE_PREFIX` where set, and `timeout = var.sign_in == null ? "300s" : "900s"`; the live check after apply also compares `sign_in` from `GET /chat` with `chat.json`'s `sign_in.issuer`.
- [ ] **Step 4: Run** the `verify` list of `pins.json`: `npm test`, both `terraform init -backend=false` and `validate`, `terraform fmt -check -recursive deploy`; expected all pass.
- [ ] **Step 5: Commit**: `A deployment names its identity service and a reader's month`.

### Task B8: Effort on every model, measured

**Files:**
- Create: `scripts/measure-effort.mjs`
- Modify: `lib/models.mjs` only if the measurement says so; the spec's section 6 gains the measured figures

**Interfaces:**
- Consumes: Tasks B1 and B5; a key in `ANTHROPIC_API_KEY` from the owner's shell, never a file.

- [ ] **Step 1: Ask the owner** to approve the spend: one replay of the last weekly report's answered questions per model at `low`, and at every effort on Fable 5.1 and Opus 5.5, through the fixture host, about the figure the script prints first as its estimate.
- [ ] **Step 2: Write** `scripts/measure-effort.mjs`: for each `(model, effort)` it runs `answer()` over the fixture host with the real model and records per question the rounds, the seconds, `stop_reason` of the last call, whether it was cut (`max_tokens`) and the units; it prints one table.
- [ ] **Step 3: Run** it; expected no `cut` at any effort and no message over 840 seconds. Where a cut or a timeout shows, raise that effort's limit or lower its rounds in `lib/models.mjs`, run again, and write the final table into the spec's section 6 with the date.
- [ ] **Step 4: Run** `npm test`; expected PASS. Commit: `The output limits per effort, from a replay`.

### Task B9: Release 0.38.0

- [ ] **Step 1: Confirm the prices** of every model in `lib/models.mjs` against Anthropic's price list, and Haiku 5.5's cache read in particular; correct the weights and the spec's table if they differ.
- [ ] **Step 2: Ask the owner** for the named merge of the branch's pull request and the named release; open the pull request with `gh pr create`, a body in the repository's register ending with the Claude Code line.
- [ ] **Step 3: After the merge**, run `pins.json`'s release, `npm version 0.38.0 --no-git-tag-version`, commit `The package is released as 0.38.0`, merge that as the owner names it, and tag `v0.38.0` on `main`.

---

## Part C — `robertblust/design`, the next minor

### Task C1: The command line's four words and the sign-in pure parts

**Files:**
- Modify: `assets/chat.js` (`command`, `strings`, the `rbChat` export list and its header comment, a new section `// ─── Sign-in ───` beside `// ─── The terminal ───`)
- Test: `test/chat.test.mjs`

**Interfaces:**
- Produces, exported on `window.rbChat`:
  - `command(text)` also returns `"login"`, `"logout"`, `"model"`, `"effort"` for `/login`, `/logout`, `/model`, `/effort`
  - `CHAT_MODELS`: `[{ id: "claude-sonnet-5", label: "Sonnet 5", role: null }, { id: "claude-sonnet-5-5", label: "Sonnet 5.5", role: "sonnet-5-5" }, { id: "claude-opus-5-5", label: "Opus 5.5", role: "opus" }, { id: "claude-fable-5-1", label: "Fable 5.1", role: "fable" }, { id: "claude-haiku-5-5", label: "Haiku 5.5", role: "haiku" }]` and `CHAT_EFFORTS` the five efforts, the same as chat-server's table
  - `grantedModels(claims, org, prefix)`: the ids `CHAT_MODELS` holds that the claim `urn:zitadel:iam:org:project:roles` grants in `org` (or, with `prefix`, under `prefix + role`), Sonnet 5 always first
  - `authorizeUrl({ issuer, client, project }, challenge, state, redirect)`: `issuer + "/oauth/v2/authorize?"` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid profile urn:zitadel:iam:org:project:id:<project>:aud urn:zitadel:iam:org:projects:roles`, `code_challenge`, `code_challenge_method=S256`, `state`
  - `returnOf(href)`: `{ code, state }` from a URL that carries both, else `null`
  - `lapsed(token, now)`: true when the JWT's `exp` is at or before `now` in seconds, or the token cannot be read
  - `strings(lang)` gains, in English and German, the `/help` rows of the four words, the menus' titles, the keys line's `{model} · {effort}`, "Sign in with /login to choose a model.", and refusal texts for `not_granted`, `signed_out`, `over_user_month` (with its moment) and `declined`

- [ ] **Step 1: Write the failing tests** in `test/chat.test.mjs`: `commandFourWords`; `grantedThisSite` (claim `{ opus: { o1: "x" } }`, org `o1` → `["claude-sonnet-5", "claude-opus-5-5"]`); `grantedAnotherSite` (org `o2` → `["claude-sonnet-5"]`); `grantedPrefix`; `authorizeUrlHasPkce` (each parameter present, `code_challenge_method` `S256`); `returnOfNeedsBoth`; `lapsedReadsExp`; `refusalTextsBothLanguages` (each of the four codes gives a non-empty sentence in `en` and `de`).
- [ ] **Step 2: Run** `node --test test/chat.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement** the pure parts in the file's existing ES5 style.
- [ ] **Step 4: Run** `npm test`; expected PASS.
- [ ] **Step 5: Commit**: `The chat's command line knows /login, /logout, /model and /effort`.

### Task C2: Signing in and out

**Files:**
- Modify: `assets/chat.js` (the panel's `send()` dispatch at the `command(typed)` branch, start-up after `ENDPOINT` is read)
- Create: `test/chat-signin.test.mjs`, `test/fixtures/issuer.mjs`

**Interfaces:**
- Consumes: Task C1.
- Produces: the tag attributes `data-issuer`, `data-client`, `data-org`, `data-project`, optional `data-role-prefix`; `localStorage` key `chat-signin` holding `{ access, id }`; `sessionStorage` key `chat-pkce` holding `{ verifier, state, path }` across the redirect.

- [ ] **Step 1: Write `test/fixtures/issuer.mjs`**: a local HTTP server that answers `/oauth/v2/authorize` by redirecting to `redirect_uri` with a `code` and the `state`, `/oauth/v2/token` (checking the PKCE verifier against the challenge) with an access token and an ID token signed by a test key and a roles claim it is told to give, and `/oidc/v1/end_session` by redirecting to `post_logout_redirect_uri`.
- [ ] **Step 2: Write the failing Playwright tests** in the style of `test/chat-ask.test.mjs`: `loginRoundTrip` (typing `/login` lands back on the same path, signed in, the code gone from the address, the keys line naming the reader); `postCarriesBearer` (the next POST has `Authorization: Bearer <access>`); `noIssuerNoWords` (without `data-issuer`, `/login` is sent as a question and `/help` names none of the four); `logoutClears` (`/logout` empties `chat-signin` and the next POST has no `Authorization`); `lapsedTokenKeepsConversation` (a lapsed token before sending: the panel offers `/login`, sends nothing, and the conversation is still there after signing in again).
- [ ] **Step 3: Run** `node --test test/chat-signin.test.mjs`; expected FAIL.
- [ ] **Step 4: Implement**: the verifier from `crypto.getRandomValues`, the challenge by `crypto.subtle.digest("SHA-256", ...)` in base64url; the code exchanged at `issuer + "/oauth/v2/token"` with `grant_type=authorization_code`, `code`, `redirect_uri` the site origin plus `/`, `client_id`, `code_verifier`; `history.replaceState` back to the kept path; every read and write of storage in `try`, as the file's storage already is.
- [ ] **Step 5: Run** `npm test`; expected PASS.
- [ ] **Step 6: Commit**: `A reader signs in at the identity service from the chat`.

### Task C3: Choosing the model and the effort

**Files:**
- Modify: `assets/chat.js` (menus, the request at the `fetch(ENDPOINT, ...)` call, the cite line, the refusal path, `TIMEOUT`)
- Create: `test/chat-model.test.mjs`

**Interfaces:**
- Consumes: Tasks C1 and C2; `done.by` and the codes of Part B.
- Produces: `localStorage` key `chat-choice` holding `{ model, effort }`; the optional tag attribute `data-chat-direct`.

- [ ] **Step 1: Write the failing Playwright tests**: `modelMenuShowsGranted` (a reader granted `opus` types `/model` and sees `1 Sonnet 5`, `2 Opus 5.5`, the current one marked; `2` picks Opus and the keys line says `Opus 5.5 · low`); `effortMenu` (`/effort`, `3` → `high`); `postCarriesChoice` (the POST body has `"model": "claude-opus-5-5", "effort": "high"`); `visitorSendsNoChoice` (no `model` or `effort` keys in a visitor's body); `visitorModelSaysLogin`; `revokedChoiceFallsBack` (`chat-choice` names Fable, the token grants no `fable`: the body carries `claude-sonnet-5`); `byLineShown` (`done.by` `{ model: "claude-opus-5-5", effort: "high" }` puts `Opus 5.5 · high` beside the cite line); `notGrantedRefused` (a 403 `not_granted` shows its sentence and keeps the question in the line); `directForHighEffort` (with `data-chat-direct` set, a message above `low` posts there and a `low` one to `data-chat`).
- [ ] **Step 2: Run** `node --test test/chat-model.test.mjs`; expected FAIL.
- [ ] **Step 3: Implement**; the menus reuse the panel's numbered rows so that `picked()` takes the number; `TIMEOUT` stays 90000 at `low` and is 900000 above it.
- [ ] **Step 4: Run** `npm test`; expected PASS. Commit: `A signed-in reader chooses the model and the effort`.
- [ ] **Step 5: Release** as the next minor after the owner names the merge and the release, by `pins.json`'s release and a tag, as the repository's releases are made.

---

## Part D — the three hosts, blust.ch first

### Task D1: A host takes sign-in

Do this once per host, in the order `robertblust/mcp-blust-ch`, `companygraph/mcp-companygraph-io`, `guestgraph/mcp-guestgraph-io`, each merged and checked before the next begins.

**Files (per host):**
- Modify: `chat/chat.json`, `infra/chat/main.tf`, and through `pins.json`'s move every place that names the chat-server release (`chat/package.json`, `chat/package-lock.json`, `.github/workflows/chat.yml`, `.github/workflows/report.yml`, `infra/chat/main.tf`'s `?ref=`), `README.md`'s "The chat"

**Interfaces:**
- Consumes: Task A3's `sign_in` output for the host's site; release `v0.38.0` (Task B9).

- [ ] **Step 1: Move the pin** to `v0.38.0` with the host's `pins.json` move command; expected every place above names `v0.38.0` and `npm install` succeeds in `chat/`.
- [ ] **Step 2: Add** to `chat/chat.json` `"sign_in": { "issuer": "https://id.blust.ch", "project_id": "…", "org_id": "…", "client_id": "…" }` from Task A3 (with `role_prefix` in the per-site variant) and `"user_month_tokens": 5000000`; in `infra/chat/main.tf` pass `sign_in = try(local.c.sign_in, null)` and `user_month_tokens = try(local.c.user_month_tokens, null)`, and for guestgraph and blust.ch nothing else changes.
- [ ] **Step 3: Run** the host's tests (`npm test` in `chat/`) and `terraform -chdir=infra/chat init -backend=false && terraform -chdir=infra/chat validate`; expected PASS and valid.
- [ ] **Step 4: Commit** `The chat signs readers in at id.blust.ch and takes chat-server 0.38.0`, open the pull request, and ask the owner to name the merge.
- [ ] **Step 5: After the deploy**, by hand with the owner's token: one message per model at `low` and one on Fable 5.1 at `max` through the host's domain; expected `done.by` names each, the reader's document moves, the site's `dayTokens` does not. Time the Fable `max` message: if it is cut near sixty seconds by Firebase Hosting, send it again to the service's `run.app` address and record that this site's tag needs `data-chat-direct` (Task E1).

---

## Part E — the three sites

### Task E1: A site offers sign-in

Once per site, after its host's Task D1: `robertblust/robertblust.github.io`, then the companygraph.io and guestgraph.io site repositories.

**Files (per site):**
- Modify: `package.json` (`@robertblust/design` to the Part C release), the synced `chat.js` and `chat.css` by `npm run design`, every page or generator that writes `<script src="chat.js" data-chat=...>` (find them with `grep -rl 'data-chat=' --exclude-dir=node_modules .`), the privacy page in English and German

**Interfaces:**
- Consumes: Task A3's output for the site; the Part C release; Task D1 Step 5's finding on `data-chat-direct`.

- [ ] **Step 1: Take the release** and run `npm run design` and `npm run design:check`; expected no difference left.
- [ ] **Step 2: Add** `data-issuer="https://id.blust.ch" data-client="<client id>" data-org="<org id>" data-project="<project id>"`, and `data-chat-direct="https://<run_host>/chat"` if Task D1 found it needed, to every chat script tag, by changing the generator where the pages are generated rather than each page.
- [ ] **Step 3: Write the privacy paragraph** of the spec's section 7 in English and German, in the page's register: an account only by the owner's invitation, held at `id.blust.ch` in Zurich with the reader's name and address, the chat keeping of a signed-in reader only a month's count under a key it cannot turn back into the account, and the question line the same for every reader.
- [ ] **Step 4: Run** the site's own checks (`npm test` where it has one, `sh conventions/conventions-check`); expected pass. Commit `Readers sign in to choose the chat's model`, and ask the owner to name the merge.
- [ ] **Step 5: After the deploy**, the owner signs in on the live site, types `/model`, picks Opus 5.5 and asks one question; expected the answer's line names `Opus 5.5 · low`, and a private window without signing in sees no picker and is answered by Sonnet 5.
