# The servers run on two clouds — design

> The MCP server and the chat server deploy only to Google Cloud: Cloud Run behind Firebase Hosting, a Firestore meter, a Google identity token traded at Anthropic, and kept questions routed by Cloud Logging. A company that runs on Azure cannot deploy either without rewriting both. This design makes the servers' code platform-agnostic behind four small ports, adds Azure beside Google as a second target with its own Terraform and workflows, and leaves the three Google deployments as they are.

Status: proposed. Decided on 2026-09-28 with the owner against `companygraph/chat-server` at `e2882b7` (v0.17.3), `companygraph/mcp-server` at `053e8a1` (v0.38.0), and the deployments `robertblust/mcp-blust-ch`, `companygraph/mcp-companygraph-io` and `guestgraph/mcp-guestgraph-io` at that day's main, whose files were read. This one spec covers both server repositories, because most of the change is in this one; mcp-server's README links here. Five choices were made before the design and hold through it. Google stays as it is where possible, and a change to it is accepted where it makes both platforms simpler. Azure is for another company that deploys its own instance, so done means published modules proven by one real deployment. Kept questions stay log lines that each platform routes, rather than records the app writes. The Google Terraform moves to `deploy/google/`, beside a new `deploy/azure/`. The platform code lives inside each server package and is loaded only when chosen, not in separate adapter packages.

---

## 1. The gap

The mcp-server's code already runs anywhere: it reads `PORT`, logs with `console.log`, and imports no cloud SDK. Only its infrastructure is Google's: the Terraform module and the bootstrap under `deploy/`, and the reusable `deployment.yml` workflow.

The chat server is bound to Google in its code, in four places. `lib/firestore.mjs` keeps the meter in a Firestore document. `lib/model.mjs` asks Google's metadata server for the identity token it trades at Anthropic. `lib/log.mjs` writes Cloud Logging's field names. `deploy/build/report.mjs` reads kept questions through the Logging API and writes the report to a Cloud Storage bucket. `lib/config.mjs` also requires `CHAT_PROJECT` and `CHAT_REGION` although only Vertex uses them. `lib/bucket.mjs` assumes one proxy hop, which is true behind Firebase Hosting.

Anthropic's workload identity federation accepts tokens from Microsoft Entra ID managed identities as it does from Google, so a chat on Azure stays keyless. That was the one open risk and it is closed, at the price of one app registration per tenant, which §2 describes.

**What the change buys is a second platform for both servers, reached by choosing adapters and a Terraform folder, with nothing in the servers' logic knowing which cloud it runs on.**

## 2. The ports

Each port is a small contract with one adapter per platform and a local one for tests and laptops. An adapter is chosen by an environment variable and imported dynamically, so a Google deployment never loads an Azure SDK and the reverse. The cloud SDKs are `optionalDependencies` of the package. npm installs optional dependencies all or none, so every image carries both clouds' packages and the adapter chosen is the only one loaded. An unknown value refuses the start and names the value.

| Port | Contract | Chosen by | Google | Azure | Local |
| --- | --- | --- | --- | --- | --- |
| Meter store | `transact(fn)`: read the document, apply `fn`, write it back, retry on conflict | `CHAT_METER` | `firestore`: `chat/meter` in Firestore | `table`: entity `chat`/`meter` in Table Storage, ETag-checked | `memory` |
| Identity token | `() → JWT` for the platform's audience | `CHAT_IDENTITY` | `google`: the metadata server, audience `https://api.anthropic.com` | `azure`: the managed-identity endpoint, `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`, resource `api://<APP_ID>` | none; a key is used |
| Log line | `line(logger, severity, fields) → string` | `CHAT_LOG` | `google`: `severity` and Cloud Logging's labels, today's line | `plain`: `severity` and `logger` at the top level | `plain` |
| Question source | `entries(from, to)` and `put(week, markdown)` | the report workflow | Logging API and Cloud Storage | Log Analytics query API and Blob Storage | files |

The meter's `transact` contract is today's, which `lib/meter.mjs` already calls, so the meter logic does not change. `CHAT_METER` keeps `firestore` as its default when unset, so a Google deployment sets nothing new.

The two identity-token adapters are plain `fetch` and need no SDK. The Azure one asks the endpoint Container Apps gives the app, `$IDENTITY_ENDPOINT?api-version=2019-08-01&resource=api://<APP_ID>` with the header `X-IDENTITY-HEADER`, and passes the token to the same `oidcFederationProvider` the Google path uses. Entra issues a token only for an audience that exists in the tenant, and `https://api.anthropic.com` cannot be registered there, so each tenant needs one app registration standing for the Claude API: identifier URI `api://<APP_ID>`, `requestedAccessTokenVersion` 2, and a service principal. Creating it takes the right to register applications in the tenant, which Terraform's identities do not hold, so it is an owner's step done once per tenant, like Anthropic's issuer. `chat.json` names its client id as `anthropic_federation.audience`, and the module hands the service `api://<audience>` as `CHAT_IDENTITY_AUDIENCE`. Anthropic's side needs a federation issuer for the tenant, `https://login.microsoftonline.com/<tenant>/v2.0` in discovery mode, with `max_jwt_lifetime_seconds` raised to 86400, since Azure caches a managed identity's token for up to a day and the default rejects it. It also needs one rule per deployment whose audience is the app registration's client id and whose claims are the `chat-run` identity's object id in `oid` and the tenant in `tid`. `CHAT_IDENTITY` defaults to `google` where federation ids are set, so a Google deployment sets nothing new.

The log line stays as it is on Google. `docs/INTERFACE.md` tells the owner to filter the console by `labels.logger`, and that holds only while the line carries Cloud Logging's labels key, so `CHAT_LOG` defaults to `google` and today's line is unchanged. `plain` writes `severity` and `logger` at the top level with the fields after them, which is what Log Analytics reads as columns. Both write `kind` where they write it today, so every filter on it holds.

`lib/report.mjs` keeps its pure part, turning entries into the week's Markdown. The fetching moves behind the question-source port. `CHAT_PROJECT` and `CHAT_REGION` become required only when the provider is Vertex. `CHAT_PROXY_HOPS` keeps its default of one, which holds on Azure too: Container Apps' ingress appends only the client's address.

The mcp-server gets no ports. Its host allowlist already takes any host, and an Azure deployment passes the Container Apps host where a Google one passes the `run.app` host.

## 3. The layout

Both server repositories move their Google infrastructure under `deploy/google/` and add `deploy/azure/` beside it:

```
deploy/
  google/terraform/    today's deploy/terraform
  google/bootstrap/    today's deploy/bootstrap (mcp-server only)
  azure/terraform/
  azure/bootstrap/     (mcp-server only)
  build/               shared
  test/                shared
```

The reusable workflows follow: `deployment.yml` becomes `deploy-google.yml` beside a new `deploy-azure.yml`, and chat-server's `report.yml` becomes `report-google.yml` beside `report-azure.yml`. The pin test learns the new names.

The rename costs the Google deployments nothing until they re-pin, since their pins name a tag and the old tag still has the old path. At the re-pin, each module `source` moves to the new path along with the tag, the workflow `uses:` lines move to the new names, and the state is untouched because Terraform addresses a module by its name, not its source, so no `moved` block is needed.

`deployment.json` and `chat.json` gain `platform`, `google` or `azure`, with `google` when absent. The three existing deployments therefore change no file for it. An Azure deployment's `deployment.json` names `tenant_id`, `subscription_id`, `resource_group`, `location`, `container_registry`, `state_account`, `domain`, `budget_chf`, `budget_start`, `repository`, `repository_id`, `owner_id` and the bootstrap's three client ids, and after the first apply `app_host` and `dns_ready`. An Azure `chat.json` names `domain`, `mcp_url`, `origins`, `month_tokens`, `provider` `anthropic`, `anthropic_federation` with its `audience`, and `storage_account`, and after the first apply `app_host`, `dns_ready`, `questions_workspace_id` and `analyst_client_id`. The deployment test checks each platform's fields and refuses the other platform's.

## 4. Azure

**Bootstrap** (`mcp-server/deploy/azure/bootstrap`), applied once by the owner with local state, as on Google. It makes a resource group, a storage account holding the Terraform state in a versioned container, and a container registry. It makes three user-assigned managed identities, `terraform`, `terraform-plan` and `deploy`, each with a federated credential naming GitHub's immutable subject, `repo:OWNER@OWNER_ID/REPO@REPO_ID`. A repository created after 2026-07-15 has that subject by default; an older one opts in once with `gh api -X PUT repos/<owner>/<repo>/actions/oidc/customization/sub -F use_default=true -F use_immutable_subject=true`. `terraform` and `deploy` trust `ref:refs/heads/main` and `terraform-plan` trusts `pull_request`, the Azure form of Google's trust by repository id. The resource providers are registered by the owner's own provider block, since registering one is a subscription's right no identity made here holds. Roles are scoped to the resource group: Contributor and Role Based Access Control Administrator for `terraform`, Reader for `terraform-plan`, AcrPush for `deploy`, and read or write on the state container for the two Terraform identities. It needs only Owner on the subscription: managed identities with federated credentials need no app registration and no directory role in Entra. The one thing in the tenant beyond the subscription is the chat's audience registration of §2, which any tenant lets its members create unless an administrator has turned that off. Nothing on Azure needs Google's org-policy override, since a container app's external ingress is public without one.

**The mcp module** (`mcp-server/deploy/azure/terraform`) makes a Log Analytics workspace, a Container Apps environment, and the `mcp` container app. The app has external ingress and scales from zero to three replicas at twenty concurrent requests each. It runs at 0.25 vCPU and 0.5 GiB, the smallest size Container Apps offers, where Cloud Run's is 256Mi. It pulls from the registry through its own identity with AcrPull. It adds a custom domain with a free managed certificate in three steps, since azurerm issues the certificate but cannot bind it (terraform-provider-azurerm#27362). The host name is added unbound, the certificate is issued against a CNAME pointing straight at the app, and one azapi PATCH of the app's custom domains binds them. Azure checks the two records when the domain is added, so the domain is added only once deployment.json says dns_ready. The dns_records output gives the asuid TXT record and the CNAME. It makes a monthly budget on the resource group in the billing account's currency, CHF under a CHF account, with warnings at 50, 90 and 100 percent to the resource group's owners, stopping nothing. It also makes a `check "app_host"` that plays the part `run_host` plays on Google: the app's generated host name must be written into `deployment.json` as `app_host` before the service accepts requests on it.

**The chat module** (`chat-server/deploy/azure/terraform`) puts the `chat` container app in the same environment, with a `chat-run` identity and the ports set: `CHAT_METER=table`, `CHAT_IDENTITY=azure`, `CHAT_LOG=plain`. It makes a storage account holding the `chat` table, where `chat-run` gets Storage Table Data Contributor on that table only, and a `reports` container with a lifecycle rule deleting a blob at eighty-three days, the same number as on Google, so that a question quoted in a report is gone ninety days after it was asked.

Kept questions reach a workspace of their own with ninety-day retention. Azure cannot fork one log stream into two tables: a workspace transformation "can't send a single data source to multiple tables". So the environment writes to Azure Monitor and sends its console lines to two workspaces through two diagnostic settings, and a transformation on each decides what stays. The chat's workspace, chat-questions, keeps only the chat's lines whose kind is question, and the environment's general workspace, logs, keeps everything else. A question exists in one place with one retention, as the Google exclusion ensures. The analyst holds Log Analytics Data Reader on chat-questions alone by grant, but the pull-request plan identity's Reader on the resource group very likely reads it too, which piece 3 confirms and narrows. A workspace and its transformation name each other, so azapi links them after both exist.

A `chat-analyst` identity gets a federated credential for the report workflow on `main`, a read right on the questions table only, and Storage Blob Data Contributor on the `reports` container. It holds nothing else. The owner's own reading is granted once by hand, as on Google, because the owner's login belongs in no public repository.

**Workflows.** `deploy-azure.yml` signs in with `azure/login` over OIDC, pushes the image after `az acr login`, and runs the same plan on a pull request, apply on main, and live check as `deploy-google.yml`. `report-azure.yml` runs the weekly report as the analyst.

## 5. Google

Google keeps Firebase Hosting in front, the Firestore meter, the log sink, bucket, view and exclusion, the reports bucket, and every identity and role. The only changes are the folder and the workflow names; the adapters of §2 default to what Google runs today. Replacing Firebase Hosting with Cloud Run's own domain mapping would make the Google side simpler too. It is not part of this design, and it stays open for another day.

## 6. Tests

Every adapter is unit-tested against fakes with no network, as the suite is today: the Table Storage store, including its retry on an ETag conflict; the Azure identity token, with its endpoint, header, audience, and a clear error when `IDENTITY_ENDPOINT` is absent; both log lines, with the `google` line byte-for-byte today's; and the Log Analytics question source. One shared contract test runs against every meter store, memory, a Firestore fake and a Table fake, so the stores cannot drift. The config tests cover the defaults of `CHAT_METER` and `CHAT_IDENTITY`, the refusal of an unknown value, `CHAT_PROJECT` and `CHAT_REGION` required only with Vertex, and an Azure host in the allowlist behaving as a `run.app` host does. The deployment tests check each platform's `deployment.json` and `chat.json`. CI runs `terraform validate` on both Azure modules and the bootstrap. A real plan waits for piece 3.

The proof that Google did not change is a re-pin of each of the three deployments whose Terraform plan shows no change to any resource, whose live check passes, and whose chat answers one message sent by hand. Then comes the check no plan can make: a question sent after the re-pin appears in that project's questions view, which proves the moved code still writes the line the sink reads.

## 7. Order and release

The work comes in three pieces.

Piece 1 makes the code agnostic and moves the Google folders, in chat-server first and then mcp-server, whose part is the rename alone. It needs no Azure. It ships as a minor release of each server, followed by one re-pin wave of the three deployments with the proof of §6.

Piece 2 adds the Azure adapters, modules, bootstrap and workflows, proven offline by the tests and `terraform validate` of §6. It ships as a further minor release of each server. The Google deployments need no re-pin for it, since nothing they use changes.

Piece 3 is the live proof. It waits for an Azure subscription, whose tenant the owner has not chosen yet. It needs from the owner a subscription in a tenant they control, Owner on it for the bootstrap, the audience app registration in that tenant, a federation issuer for the tenant and a rule for the chat at Anthropic, and the DNS records. It makes a new public repository `companygraph/mcp-azure-example`, shaped like the three deployment repositories and serving the meta-model's worked example, the model the servers' test suites use, at `mcp.azure.companygraph.io` and `chat.azure.companygraph.io`. It proves the certificate binding, the questions routing, and the Azure hop count, writes what it learned back into the modules as a patch release, and keeps running at scale to zero as the standing proof. It also measures how often an answer meets Container Apps' 240-second request limit.

Each piece opens pull requests and stops at them; merging needs the owner's word.

## 8. Files

chat-server: `lib/firestore.mjs` moves to `lib/platform/google/meter.mjs`, beside a new `lib/platform/azure/meter.mjs`; the identity-token code leaves `lib/model.mjs` for `lib/platform/google/identity.mjs` and `lib/platform/azure/identity.mjs`; `lib/log.mjs` with its two formats, `lib/config.mjs`, `bin/http.mjs`, `lib/report.mjs`, and `deploy/build/report.mjs` with its sources under `lib/platform/*/questions.mjs`; `deploy/terraform` moves to `deploy/google/terraform`; a new `deploy/azure/terraform`; `.github/workflows/deployment.yml` and `report.yml` renamed, beside the two Azure workflows; `package.json`; `README.md` and `docs/INTERFACE.md`; the tests.

mcp-server: `deploy/terraform` and `deploy/bootstrap` move under `deploy/google/`; new `deploy/azure/terraform` and `deploy/azure/bootstrap`; `.github/workflows/deployment.yml` renamed, beside `deploy-azure.yml`; `deploy/test` for `platform`; `README.md`.

Each deployment repository, at its re-pin: the module `source` paths in `infra/main.tf`, `infra/chat/main.tf` and `infra/bootstrap/main.tf`, and the `uses:` lines in `deploy.yml`, `chat.yml` and `report.yml`.
