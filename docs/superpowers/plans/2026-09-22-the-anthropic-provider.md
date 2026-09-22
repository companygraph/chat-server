# The Anthropic Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deployment call Claude Sonnet 5 through the Anthropic API when it holds a key, and through Vertex AI otherwise, so that a project whose Vertex quota Google has not granted can answer today; release it as v0.2.0.

**Architecture:** The loop is unchanged; `lib/model.mjs` gains a second factory over `@anthropic-ai/sdk`'s `Anthropic` client with the same `turn`, and one chooser that reads the key from the config. The config reads `ANTHROPIC_API_KEY` into `anthropicKey` and names the `provider`. `GET /chat` reports the provider. The Terraform module takes `provider` and, when it is `anthropic`, mounts the project's Secret Manager secret `chat-anthropic-key` into the service as that variable; the secret itself, its first version and the runtime's read access are the owner's three commands, so the module needs no new role. A deployment says `provider` in `chat.json`.

**Tech Stack:** `@anthropic-ai/sdk` (already installed as the Vertex SDK's dependency; now a direct one), Terraform google ~> 8.0 `google_cloud_run_v2_service` env `value_source.secret_key_ref`.

**Spec:** `docs/superpowers/specs/2026-09-22-chat-server-design.md` §2, which names the Anthropic API direct as the swap the loop was written for, "the client's constructor and the credential, not the loop".

## Global Constraints

- The Vertex path stays and stays the default: no key, no change in behavior.
- The model id, effort, output limit, cache marks and price weights are the same on both providers; `params` is untouched.
- `lib/` and `bin/` name no instance fact; every Markdown paragraph is one line; `sh conventions/conventions-check` and `sh conventions/conventions-format check` exit 0 before each commit; commit messages in the git register with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; TDD where a test is named.
- Nothing in the suite reaches Anthropic, Vertex, Firestore or a live host.
- `export PATH=/opt/homebrew/bin:$PATH` before every `node`, `npm` or `terraform` command; work in `/Users/rob/git/companygraph/chat-server-the-anthropic-provider` on branch `the-anthropic-provider`; `npm ci` first, since the worktree is fresh.
- The pull request is opened and it stops there.

---

### Task 1: The provider in the server

**Files:**

- Modify: `lib/model.mjs`, `lib/config.mjs`, `bin/http.mjs`, `lib/http.mjs`, `package.json` (+ lockfile), `docs/INTERFACE.md`, `README.md`
- Test: `test/model.test.mjs`, `test/config.test.mjs`, `test/http.test.mjs`

**Interfaces:**

- Produces: `anthropicModel({ apiKey })` → `{ name, turn }`; `modelFor(config)` → `anthropicModel` when `config.anthropicKey`, else `vertexModel({ project: config.project, region: config.region })`; `config.anthropicKey` (string or null) and `config.provider` (`"anthropic"` or `"vertex"`); `GET /chat` field `provider`.

- [ ] **Step 1: Failing tests**

In `test/config.test.mjs`, extend the first test's `full` object with nothing, and add at the end:

```js
test("a key names the provider; none means Vertex", () => {
  assert.equal(configFromEnv(full).provider, "vertex");
  assert.equal(configFromEnv(full).anthropicKey, null);
  const c = configFromEnv({ ...full, ANTHROPIC_API_KEY: " sk-ant-test " });
  assert.equal(c.anthropicKey, "sk-ant-test");
  assert.equal(c.provider, "anthropic");
  assert.equal(configFromEnv({ ...full, ANTHROPIC_API_KEY: "  " }).provider, "vertex", "a blank key is no key");
});
```

In `test/model.test.mjs`, import `anthropicModel, modelFor` beside the others and add:

```js
test("an Anthropic model is built from a key and exposes turn, and the chooser reads the config", () => {
  const a = anthropicModel({ apiKey: "sk-ant-test" });
  assert.equal(a.name, MODEL);
  assert.equal(typeof a.turn, "function");
  const base = { project: "p", region: "eu", anthropicKey: null };
  assert.equal(modelFor(base).provider, "vertex");
  assert.equal(modelFor({ ...base, anthropicKey: "sk-ant-test" }).provider, "anthropic");
});
```

So each model object also carries `provider`. In `test/http.test.mjs`, in the test "GET /chat says what the chat is and spends nothing", add `assert.equal(c.provider, "vertex");` after the `model` assertion (the test's `config()` names no key), and in the same file's `config()` helper add `anthropicKey: null, provider: "vertex"` to the object.

Run `npm test`: the three fail (missing export, missing field).

- [ ] **Step 2: lib/config.mjs**

Add to the returned object, after `meter`:

```js
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
```

and, since `provider` derives from it, build the object first then set `provider`:

```js
export function configFromEnv(env = process.env) {
  const c = { …the existing fields…, anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null };
  c.provider = c.anthropicKey ? "anthropic" : "vertex";
  return c;
}
```

- [ ] **Step 3: lib/model.mjs**

`npm install @anthropic-ai/sdk@^0.127.0` (the version the lockfile already resolves through the Vertex SDK; if `npm view @anthropic-ai/sdk version` is newer and the Vertex SDK's peer range allows it, the caret takes it). Then:

```js
import Anthropic from "@anthropic-ai/sdk";
```

Refactor the shared body into one helper and two factories, both carrying `provider`:

```js
// One `turn` over either client: send a request, forward text as it comes, hand back the final
// message; a 429 is `busy`. The client is built on the first turn and kept, not at start: the
// Vertex constructor begins resolving Google's credentials, and a process that never answers a
// message — a test run, a build — has none and must not be asked for them.
function over(provider, build) {
  let client;
  return {
    name: MODEL,
    provider,
    async turn(request, onText, { signal } = {}) {
      client ??= build();
      try {
        const stream = client.messages.stream(request, { signal });
        stream.on("text", (delta) => onText(delta));
        return await stream.finalMessage();
      } catch (err) {
        throw asChatError(err);
      }
    },
  };
}

export const vertexModel = ({ project, region }) =>
  over("vertex", () => new AnthropicVertex({ projectId: project, region, maxRetries: 1, timeout: 60_000 }));

// The Anthropic API direct: the same Messages surface, the same model id, a key for a credential.
// The design's documented swap for a project whose Vertex quota is not granted, and the one with
// a hard monthly stop, the Console workspace's spend limit.
export const anthropicModel = ({ apiKey }) =>
  over("anthropic", () => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }));

export const modelFor = (config) =>
  config.anthropicKey ? anthropicModel({ apiKey: config.anthropicKey }) : vertexModel({ project: config.project, region: config.region });
```

Keep `MODEL`, `EFFORT`, `WEIGHTS`, `markTail`, `params`, `asChatError` as they are. Update the file's header comment: the two providers, the same request.

- [ ] **Step 4: bin/http.mjs, lib/http.mjs**

`bin/http.mjs`: import `modelFor` instead of `vertexModel`; `const model = values.model === "fake" ? fakeModel : modelFor(config);` and give `fakeModel` a `provider: "fake"`; in the startup line replace `model ${model.name}` with `model ${model.name} via ${model.provider}`.

`lib/http.mjs`: in the `GET /chat` object add `provider: config.provider,` after `model`.

- [ ] **Step 5: Documents**

`docs/INTERFACE.md`, the `GET /chat` row: add `provider` after `model`, as "`provider`, `vertex` or `anthropic`". Under "What counts as a break" nothing changes (a field added is not one).

`README.md`: the first paragraph's "Claude Sonnet 5 on Vertex AI" becomes "Claude Sonnet 5, on Vertex AI in the deployment's own project or on the Anthropic API with a key". In "Running it", after the sentence about `--model fake`, add: "With `ANTHROPIC_API_KEY` set the service calls the Anthropic API instead of Vertex AI, the same model and the same request; the key is the credential and the provider follows it." In "Deploying it", after the two devDependencies sentence, add: "`chat.json` also says `provider`, `vertex` by default or `anthropic`; with `anthropic` the module mounts the project's Secret Manager secret `chat-anthropic-key` into the service, and the owner makes that secret, adds the key as its first version and grants the runtime read access before the deploy, as the owner's steps say." In the owner's-steps paragraph, add before "The model's quota is lowered": "A deployment on the Anthropic API instead makes a workspace in the Anthropic Console with a monthly spend limit, which is the hard stop Google does not give, and one key; in the project, once, with the key on stdin and never in a file: `gcloud services enable secretmanager.googleapis.com --project <project>`, `gcloud secrets create chat-anthropic-key --replication-policy automatic --project <project>`, `printf '%s' "$KEY" | gcloud secrets versions add chat-anthropic-key --data-file=- --project <project>`, and `gcloud secrets add-iam-policy-binding chat-anthropic-key --member serviceAccount:chat-run@<project>.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor --project <project>`; Model Garden and the quota then do not apply."

- [ ] **Step 6: Run, check, commit**

`npm test` (70 expected), both conventions checks, then:

```sh
git add lib/model.mjs lib/config.mjs bin/http.mjs lib/http.mjs package.json package-lock.json docs/INTERFACE.md README.md test/model.test.mjs test/config.test.mjs test/http.test.mjs
git commit -F - <<'EOF'
The model is reached through Anthropic's API where a deployment holds a key

Google grants a new project no quota for a partner model until its billing account has history, and both projects' requests came back refused, so the chat could not answer on Vertex today. The design named the Anthropic API direct as the swap the loop was written for, the same Messages surface with a key for a credential, and the loop now has it: with ANTHROPIC_API_KEY the service builds the Anthropic client, otherwise Vertex as before, the same model, the same request, the same marks and weights. GET /chat says which.

Verified: npm test passes with none failed and none skipped, and conventions-check and conventions-format check exit 0.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: The provider in the module, and the release

**Files:**

- Modify: `deploy/terraform/variables.tf`, `deploy/terraform/run.tf`, `deploy/terraform/main.tf`, `deploy/test/config.mjs`, `.github/workflows/deployment.yml`, `package.json` (+ lockfile, version 0.2.0)

- [ ] **Step 1: variables.tf**

```hcl
# Which API answers: Vertex AI in this project, or the Anthropic API with the key the owner put
# in the project's secret `chat-anthropic-key`. The secret, its version and the runtime's read
# access are the owner's, made before the deploy that mounts it.
variable "provider" {
  type    = string
  default = "vertex"
  validation {
    condition     = contains(["vertex", "anthropic"], var.provider)
    error_message = "provider is vertex or anthropic."
  }
}
```

`provider` is a reserved word in some Terraform contexts as a block type, not as a variable name; if `terraform validate` refuses it, name the variable `model_provider` and say so in the report and in the README's `chat.json` sentence.

- [ ] **Step 2: run.tf**

Inside the `containers` block, after the last `env` block, add:

```hcl
      # With the Anthropic API, the key rides in from the project's secret, latest version. The
      # secret is the owner's: the module neither makes it nor grants access to it, so a deploy
      # that mounts it before the owner's three commands fails at Cloud Run's own check, by name.
      dynamic "env" {
        for_each = var.provider == "anthropic" ? [1] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = "chat-anthropic-key"
              version = "latest"
            }
          }
        }
      }
```

In `main.tf` add `"secretmanager.googleapis.com"` to the enabled APIs.

Run `terraform -chdir=deploy/terraform init -backend=false -input=false && terraform -chdir=deploy/terraform validate && terraform fmt -check -recursive deploy`.

- [ ] **Step 3: deploy/test/config.mjs and the workflow**

In the first test, after the required keys, add: `if ("provider" in c) assert.ok(["vertex", "anthropic"].includes(c.provider), "provider is vertex or anthropic");`.

In `.github/workflows/deployment.yml`'s live check, after the `for field in mcp_url month_tokens` loop, add a provider comparison that defaults to `vertex` when `chat.json` omits it:

```yaml
          WANT=$(jq -r '.provider // "vertex"' ../../chat/chat.json)
          GOT=$(jq -r .provider live.json)
          echo "provider: reading $GOT, pinned $WANT"; test "$GOT" = "$WANT"
```

A deployment's `infra/chat/main.tf` passes `provider = lookup(local.c, "provider", "vertex")`; say so in the README's `chat.json` sentence from Task 1 (append: "and `infra/chat/main.tf` passes it as `provider = lookup(local.c, "provider", "vertex")`").

- [ ] **Step 4: The version**

`npm version 0.2.0 --no-git-tag-version`. The interface gains a field, so a minor.

- [ ] **Step 5: Run, check, commit, pull request**

`npm test`, both conventions checks, the three Terraform commands, then:

```sh
git add deploy/terraform deploy/test/config.mjs .github/workflows/deployment.yml package.json package-lock.json README.md
git commit -F - <<'EOF'
A deployment mounts the key it chose, and this is 0.2.0

A deployment says provider in chat.json, vertex by default or anthropic, and with anthropic the module mounts the project's secret chat-anthropic-key into the service as ANTHROPIC_API_KEY, latest version. The secret, its first version and the runtime's read access are the owner's three commands, made before the deploy that mounts it, so the module needs no new role and Cloud Run's own check names a secret that is not there. The live check reads the provider back beside the host and the ceiling.

Verified: npm test passes with none failed and none skipped; terraform validate and fmt -check pass on deploy/; conventions-check and conventions-format check exit 0.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git push -u origin the-anthropic-provider
gh pr create --repo companygraph/chat-server --base main --head the-anthropic-provider --title "The model is reached through Anthropic's API where a deployment holds a key" --body-file - <<'EOF'
Google grants a new project no quota for a partner model until its billing account has history, and both projects' requests came back refused, so neither chat could answer on Vertex AI today. The design named the Anthropic API direct as the swap the loop was written for, the same Messages surface with a key for a credential, and this is that swap: with `ANTHROPIC_API_KEY` the service builds the Anthropic client, otherwise Vertex AI as before, the same model, request, marks and weights, and `GET /chat` says which. The Vertex path stays the default and the quota requests stay filed.

A deployment says `provider` in `chat.json`, and with `anthropic` the module mounts the project's Secret Manager secret `chat-anthropic-key` into the service, latest version. The secret, its first version and the runtime's read access are the owner's three `gcloud` commands, made before the deploy that mounts it, so the module needs no role the bootstrap does not grant and a deploy ahead of them fails at Cloud Run's own check, by name. The workspace's monthly spend limit in the Anthropic Console is the hard stop Google's budgets do not give.

This is 0.2.0, since the interface gains a field. Taking it: a deployment re-pins its three places, its owner runs the three commands, and `chat.json` gains `"provider": "anthropic"` in the same pull request; the first message is then the proof.

Release notes to write at tagging: the refused quotas and the swap, the owner's three commands, `Interface` naming the new field, and that a deployment on Vertex changes nothing.

Verified: npm test passes with none failed and none skipped; terraform validate and fmt -check pass on deploy/; conventions-check and conventions-format check exit 0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

The pull request is opened and it stops there.

---

## Self-review

The Vertex path is untouched by construction: `modelFor` without a key is the old factory. The secret's lifecycle is deliberately outside the module because creating a secret and binding its IAM would need `roles/secretmanager.admin` on the deploy identity, a third bootstrap change, where three owner commands do the same once. No placeholder: every file's change is written out; the one contingency, the variable name `provider`, is named with its fallback.
