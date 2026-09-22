# CompanyGraph — Chat Server

A chat over any CompanyGraph MCP host. A visitor types a question on a site, this service asks the site's MCP host through its tools, and Claude Sonnet 5 on Vertex AI writes the answer from what the tools said, naming the entity each claim rests on. It holds no model and pins no commit: what it answers is what the host answers, at the commit every answer of the host names. A re-pin of the host is a change the chat sees without a deploy.

The design is [`docs/superpowers/specs/2026-09-22-chat-server-design.md`](docs/superpowers/specs/2026-09-22-chat-server-design.md). The routes, the events and the codes are [`docs/INTERFACE.md`](docs/INTERFACE.md).

## What it does

`POST /chat` takes the conversation and answers a stream of events: the text as it is generated, a `cite` for every entity a tool returned, and `done` with what the message cost. The model runs at most four tool rounds a message over the host's own tools, with the host's own instructions as the start of its prompt and a few rules after them: every claim from a tool, every claim naming its entity, the model does not say where it does not.

## The fence

Nothing here can spend more than its deployment wrote down. A message is at most 1,000 characters, the model sees the last eight turns, a tool's answer is cut at 16,000 characters, the output stops at 700 tokens, and a message runs at most four rounds, so one call has a known ceiling. An address gets twenty messages an hour, on a message and on `GET /chat` alike. A meter in one Firestore document counts every call in input-equivalent tokens against a day's share and a month's ceiling and refuses the next message when either is spent; a `closed` flag in the same document switches the chat off without a deploy. Every refusal is made before the model is asked and costs nothing. Around it, the deployment lowers the model's quota on the project and raises its budget.

The bucket holds behind Firebase Hosting, where Google's front end writes the visitor's address into `X-Forwarded-For` at the position `CHAT_PROXY_HOPS` counts back from. A caller that reaches the Cloud Run `run.app` address directly writes that header itself and so chooses its own key, and there the meter alone bounds it — which is why the deployment names its `run_host` and the service refuses its own run.app address to a page. The shape the front end actually writes is read from the first deployment's `GET /chat`, whose `address` field is the key the bucket used, and recorded in this paragraph; it has not been read yet.

## Running it

```sh
CHAT_MCP_URL=https://mcp.example.test/mcp CHAT_ORIGINS=https://example.test CHAT_MONTH_TOKENS=18500000 \
CHAT_PROJECT=example-project CHAT_REGION=eu CHAT_METER=memory \
npx --package github:companygraph/chat-server companygraph-chat-http --model fake
```

`--model fake` answers one sentence and calls no tool; without it the service calls Vertex AI with the credentials the environment gives it. `CHAT_METER=memory` keeps the meter in the process; unset, the meter is Firestore. `CHAT_HOSTS` names the hosts the service answers to, unset meaning any; `CHAT_PROXY_HOPS` is how many front ends sit before it, one by default.

## Deploying it

A deployment of an MCP host adds a `chat/` directory holding `package.json` pinning this package by tag, `chat.json`, a `Dockerfile`, `brand.html`, `own.css` and a `test/` calling `registerDeploymentTests()` from `companygraph-chat-server/deploy/tests`; an `infra/chat/` root of one file calling `deploy/terraform` at the same tag; and a workflow calling `.github/workflows/deployment.yml` at the same tag. The three places name one release, and the pin test holds them to it. That `package.json` also names two devDependencies of the deployment's own: `@robertblust/design`, which `page-css` resolves for the family's fences and the fonts it carries into the sheet, and `playwright`, which the generic page test imports and whose browser the workflow installs on its own. `chat.json` carries `domain`, `site_id`, `mcp_url`, `origins`, `month_tokens` and, after the first apply, `run_host`. Before a deployment's first plan can post, its owner opens the chat's state once: `terraform -chdir=infra/chat init`, run locally on the pull request's branch under the owner's login, creates the empty state at the bucket's `chat` prefix, which a pull request's read-only plan identity may read but never create, since a backend meeting a prefix with no state creates one, lock and all, whatever init is told about locking. A deployment's first deploy fails at the live check by design: with `run_host` empty the service refuses its own run.app address, the apply's warning names that address, and the second deploy with it written passes, as the MCP host's did. `site_id` must differ from the host's site in the same project, and the image lands in the project's `mcp` registry beside the host's. The module needs the deploy identity to hold `roles/datastore.owner` and `roles/resourcemanager.projectIamAdmin`, which the MCP host's bootstrap grants from its next release.

A deployment's `chat/Dockerfile` copies `package.json` and the lockfile and runs `npm ci --omit=dev`, then copies `dist/page.css`, which the build wrote from the design package, `brand.html` and, where the deployment has one, `favicon.svg`; its command is `CMD ["node", "node_modules/.bin/companygraph-chat-deploy", "serve"]`, which starts this package's server in the container's one process with that page.

Four steps are the owner's, because Terraform cannot do them. Claude's terms are accepted and Sonnet 5 enabled in Vertex AI's Model Garden, once per project: no Terraform resource does it, and until it is done the first message fails as `internal` rather than as a refusal with a code, since the fence has nothing to refuse. The model's quota is lowered on the project's Quotas page to a rate a chat needs and an attack does not, on the order of sixty requests and 300,000 input tokens a minute, which is the one layer that holds before this package runs a line. The domain's records are set at the DNS provider from the `dns_records` output of `infra/chat/`, which the apply prints. And the chat is stopped by hand where the meter keeps it: the project's `(default)` Firestore database, document `chat/meter`, field `closed` set to `true`, which refuses the next message with `closed` and spends nothing, and back to `false` to open it again — the day and the month that document counts are UTC, so a share turns over at midnight UTC and not at midnight in Zürich.

One message is sent by hand after the second merge, because the deploy's live check is a `GET /chat` and a GET proves the route, the origins, the ceiling and the MCP host and never the model, the region or the runtime's role binding:

```sh
curl -N -H 'X-Chat: 1' -H 'content-type: application/json' https://<domain>/chat \
  -d '{"messages":[{"role":"user","content":"What does the model say about the owner?"}],"lang":"en"}'
```

The answer streams, its `cite` events name entities of the deployment's own model, and the `done` event's `spent` is what the message cost in the meter's unit. A second message within five minutes costs a fraction of the first, because the prefix is then read from the cache rather than written; `cache_read_input_tokens` itself never leaves the service, so that drop in `spent` is what a cache hit looks like from outside.

## Tests

`npm test` runs the suite against a real MCP host, the server package's own over the meta-model's worked example, started in-process, and a scripted model; nothing reaches Vertex AI, Firestore or a live host.
