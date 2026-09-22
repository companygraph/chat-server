# CompanyGraph — Chat Server

A chat over any CompanyGraph MCP host. A visitor types a question on a site, this service asks the site's MCP host through its tools, and Claude Sonnet 5 on Vertex AI writes the answer from what the tools said, naming the entity each claim rests on. It holds no model and pins no commit: what it answers is what the host answers, at the commit every answer of the host names. A re-pin of the host is a change the chat sees without a deploy.

The design is [`docs/superpowers/specs/2026-09-22-chat-server-design.md`](docs/superpowers/specs/2026-09-22-chat-server-design.md). The routes, the events and the codes are [`docs/INTERFACE.md`](docs/INTERFACE.md).

## What it does

`POST /chat` takes the conversation and answers a stream of events: the text as it is generated, a `cite` for every entity a tool returned, and `done` with what the message cost. The model runs at most four tool rounds a message over the host's own tools, with the host's own instructions as the start of its prompt and a few rules after them: every claim from a tool, every claim naming its entity, the model does not say where it does not.

## The fence

Nothing here can spend more than its deployment wrote down. A message is at most 1,000 characters, the model sees the last eight turns, a tool's answer is cut at 16,000 characters, the output stops at 700 tokens, and a message runs at most four rounds, so one call has a known ceiling. An address gets twenty messages an hour. A meter in one Firestore document counts every call in input-equivalent tokens against a day's share and a month's ceiling and refuses the next message when either is spent; a `closed` flag in the same document switches the chat off without a deploy. Every refusal is made before the model is asked and costs nothing. Around it, the deployment lowers the model's quota on the project and raises its budget.

## Running it

```sh
CHAT_MCP_URL=https://mcp.example.test/mcp CHAT_ORIGINS=https://example.test CHAT_MONTH_TOKENS=18500000 \
CHAT_PROJECT=example-project CHAT_REGION=eu CHAT_METER=memory \
npx --package github:companygraph/chat-server companygraph-chat-http --model fake
```

`--model fake` answers one sentence and calls no tool; without it the service calls Vertex AI with the credentials the environment gives it. `CHAT_METER=memory` keeps the meter in the process; unset, the meter is Firestore. `CHAT_HOSTS` names the hosts the service answers to, unset meaning any; `CHAT_PROXY_HOPS` is how many front ends sit before it, one by default.

## Deploying it

A deployment of an MCP host adds a `chat/` directory holding `package.json` pinning this package by tag, `chat.json`, a `Dockerfile`, `brand.html`, `own.css` and a `test/` calling `registerDeploymentTests()` from `companygraph-chat-server/deploy/tests`; an `infra/chat/` root of one file calling `deploy/terraform` at the same tag; and a workflow calling `.github/workflows/deployment.yml` at the same tag. The three places name one release, and the pin test holds them to it. `chat.json` carries `domain`, `site_id`, `mcp_url`, `origins`, `month_tokens` and, after the first apply, `run_host`. A deployment's first deploy fails at the live check by design: with `run_host` empty the service refuses its own run.app address, the apply's warning names that address, and the second deploy with it written passes, as the MCP host's did. `site_id` must differ from the host's site in the same project, and the image lands in the project's `mcp` registry beside the host's. The module needs the deploy identity to hold `roles/datastore.owner` and `roles/resourcemanager.projectIamAdmin`, which the MCP host's bootstrap grants.

## Tests

`npm test` runs the suite against a real MCP host, the server package's own over the meta-model's worked example, started in-process, and a scripted model; nothing reaches Vertex AI, Firestore or a live host.
