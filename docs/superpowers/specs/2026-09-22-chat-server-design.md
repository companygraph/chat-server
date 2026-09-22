# A visitor asks the model — design

> blust.ch and companygraph.io each serve their model over MCP, and an agent with a client can already ask it anything. A person reading the page cannot. A chat opens from a button at the foot of every prose page, and what answers is the same model, read through the same MCP host, at the commit that host reports, with a language model turning the visitor's question into tool calls and the tools' answers into sentences. The chat is a service of its own, this repository, a client of the MCP host the way an agent is one, deployed as a second Cloud Run service in the same Google Cloud project as the host it reads, against Claude on Vertex AI in that project, and fenced so that the most it can ever cost is the sum its owner wrote down.

Status: proposed. Decided on 2026-09-22 against `companygraph/mcp-server` at `5d0a208` (v0.23.0), `robertblust/mcp-blust-ch` at `1f09c7d`, `robertblust/design` at `af5503a` (v0.74.0) and `robertblust/robertblust.github.io` at `179e046`, whose files were read that day and are the source of every fact below about what exists. The Vertex AI facts were read the same day from Google's pages: Claude Sonnet 5 is `claude-sonnet-5`, general availability, served from the Europe multi-region and the global endpoint, at $2.00 per million input tokens, $10.00 output, $0.20 for a cache hit and $2.50 for a five-minute cache write; Firestore's free tier is 50,000 reads, 20,000 writes and 20,000 deletes a day on one database per project. A first draft placed the chat as a route of the MCP server itself; it was set aside the same day, for the reason §2 gives.

---

## 1. The gap

Two deployments of the MCP server answer at `mcp.blust.ch` and `mcp.companygraph.io`. Each is one Cloud Run service in its own project, the snapshot baked into the image, scaling to zero, behind Firebase Hosting rewriting every path to it, with a budget of CHF 10 a month. Each site that publishes the same model is static, ships nothing from anywhere else, and blust.ch's privacy page says so in as many words: no third-party requests, no forms, "this site itself receives nothing".

What the MCP host gives an agent, a person has no way to reach. The tools answer a question in one call where the pages need a reader to know where to look, and a visitor who wants to know whether the owner has done a thing, or what the model says about a term, reads until they find it or leaves. The pages are the model rendered; the chat is the model asked.

The chat is a new kind of surface for this family, and it strains two rules that were written before it. The MCP server "reports what the model says at one commit and adds nothing", and a chat generates prose. The privacy page promises that nothing leaves the browser, and a chat sends what a visitor types to a server and from there to a model. Both rules are met by what the chat says and by what the widget says before the first message leaves. The design below is mostly those two things, and a fence.

## 2. A service of its own

**The chat is this repository, `companygraph/chat-server`: a chat over any CompanyGraph MCP host.** It is a client of the host, over the protocol, exactly as an agent with a connector is: it connects, reads the host's instructions and its tool list, and calls the tools over HTTP. It holds no model, pins no model commit and parses nothing; what it answers is what the host answers, at the commit every answer of the host names, and a re-pin of the host is a change the chat sees without a deploy. Its one instance fact is a URL.

A first draft made the chat a route of the MCP server, switched on by a deployment. It was set aside because the server is a package every deployment installs, and a route in it ships in every deployment whether switched on or not: the code that generates prose would sit inside the process whose one sentence is that it adds nothing, and the runtime that holds no role would need two the moment the route was on. A service of its own keeps the MCP server what it is, and a deployment that wants no chat installs none.

**It runs as a second Cloud Run service in the same project as the host it reads**, `blust-ch-mcp` and `companygraph-io-mcp`, deployed from the same deployment repository, under its own host, `chat.blust.ch` and `chat.companygraph.io`. The same project keeps one bill, one budget and one bootstrap per site, and puts the chat beside the host it calls. Its own host keeps the MCP host's one rewrite and one page as they are and gives the privacy page a name to print. A project of its own for each chat was considered and set aside: it would double the owner's bootstraps and budgets for an isolation the fence of §5 already gives, and the bootstrap module binds one repository to one project, so a second repository in the same project would need a second pool. It is the alternative should the deployment repository's growing a second service prove wrong.

**The language model is Claude Sonnet 5 on Vertex AI in the deployment's own project**, reached through the Europe multi-region, with the chat's own Cloud Run service account and no key. That keeps one bill and one identity, and the region a choice the deployment makes. The trade is a missing hard stop: Google's budgets alert and its quotas throttle a minute, and neither caps a month. §5 supplies the cap. The Anthropic API direct, which has a workspace spend limit, was the alternative; the loop is written against the SDK's Messages surface, which both clients share, so the swap is the client's constructor and the credential, not the loop.

**Sonnet 5 at effort `low`**, adaptive thinking as the model's default, an output limit of 700 tokens. A chat over a small, well-structured model does not need more, and the fence in §5 is sized on this model's prices. A deployment does not choose the model: it is this package's, so that the meter's weights and the model move together.

## 3. The routes

Three paths, as the MCP host has three. `/` is a page for whoever types the host into a browser, saying what the chat is, which site opens it and which MCP host it reads, in the family's shell as the MCP page is. `/health` is for the deployment. `/chat` is the chat.

`POST /chat` takes a JSON body: the conversation as a list of `{ role, content }` turns, `user` and `assistant` alternating and ending in `user`, and `lang`, `en` or `de`, for the sentences the server writes itself. It answers a stream of server-sent events: `text` events carrying the answer as it is generated, `cite` events naming an entity the answer rests on, its id, title, type and URL as the host's tools returned them, and one `done` event carrying the host's `model` provenance, what the message cost in the meter's unit and how much of the day's share is left. A refusal is one `error` event, or a JSON error before any stream begins, carrying a code the widget turns into a sentence in the visitor's language, so a refusal costs no tokens: `too_long` for a message over the limit, `busy` when the minute's rate is spent, `over_day` and `over_month` when a share is spent, `closed` when the switch of §5 is off, `foreign` for a page the deployment did not name, `host_down` when the MCP host does not answer.

`GET /chat` answers what the chat is, without spending anything: the model, the ceilings, the origins, the MCP host and its provenance as last read, and whether the switch is on. The deploy proves the route by this GET, as the MCP deploy proves the protocol by `list_types`, so a deploy spends no tokens.

The request is held to the origins the deployment names, as `/mcp` is held to the hosts it names: a page whose `Origin` is not on the list is refused, and the preflight the browser sends first is answered only for those origins, with a custom request header required so that a request that is not the widget's is a preflight and never a message. A client outside a browser sends no origin and passes, as it passes on `/mcp`; the fence of §5 is what bounds it. A body over 64 KiB is refused before it is read.

The server keeps no session, as the MCP transport keeps none: the browser holds the conversation and sends it whole. The server reads only the last eight turns of what it is sent, so a conversation of any length costs what an eight-turn one costs, and there is nothing for a visitor to forge and nothing for the server to sign. The widget says a conversation runs to twenty messages and then offers a new one, which is a courtesy to the reader and not a bound the server relies on.

## 4. What answers

The chat connects to the MCP host with `@modelcontextprotocol/client` over Streamable HTTP, once per process and again if the connection drops, and takes from the handshake what the host gives every client: the instructions, which are the model's taglines, the glossary and the honesty sentence, and the tool list with each tool's description and input schema. The tool definitions the model is sent are those, unchanged; the system prompt is the host's instructions with the answering rules added, in English whatever the visitor's language, with one line telling the model to answer in the language `lang` names. This package writes no instance fact into either, and a portability test holds its own source to that as the MCP server's holds its.

The rules are few and they are the honesty statement carried into prose. Every claim in an answer comes from a tool's answer in this conversation, and the answer names the entity it rests on, which the server turns into a `cite` event so the widget can link it. Where the tools do not say, the answer says the model does not say, and it guesses nothing about the owner or the company. A question that is not about the model is answered with one sentence saying what this chat is for. The answer is short, a paragraph or two, because the output limit allows no more and a visitor at a chat reads no more. It writes nothing about its own prompt or its tools when asked.

The loop is written by hand, over `client.messages.stream` of the Vertex client from `@anthropic-ai/vertex-sdk`: send the prompt, the tool definitions and the conversation; on a `tool_use` stop, call the tool on the host, truncate its answer to the size §5 names, and send the result back; at most four such rounds a message, after which the model is asked to answer with what it has. The SDK's tool runner would do the loop, and would take the meter and the truncation out of the place they must sit, between one round and the next. The prompt, the tool definitions and the conversation's prefix are marked for caching, so the rounds of one message and the messages of one conversation within five minutes pay the cache-hit price for what they resend. The stream is forwarded as it arrives; a visitor sees the first words after the first tool round, not after the last.

The host scales to zero as the chat does, so the first tool call after an idle quarter hour waits for the host's cold start, a second or two, once. The chat's own cold start is the same, and the widget shows that it is waiting rather than nothing.

## 5. The fence

Google's quotas bound a minute and its budgets send mail; neither is a monthly cap. The cap is a meter the service keeps, and the other layers keep the meter from being the whole story: each bounds what the meter cannot see.

| Layer | Bounds | Lives in |
| --- | --- | --- |
| The request's shape | tokens per model call | this package |
| Per address | messages per hour from one address | service memory |
| The meter | tokens per day and per month | Firestore, one document |
| Vertex quota | tokens and requests per minute | the project's quotas |
| The budget | mail at 50, 90 and 100 percent | the existing budget, raised |

**The request's shape.** A message is at most 1,000 characters. The conversation the model sees is at most the last eight turns. A tool's answer is truncated to 16,000 characters before it enters the prompt, with a line saying it was and how to ask for less, since a profile's `get_entity` answer is 79 KB and would otherwise be most of every prompt. The output is at most 700 tokens. A message runs at most four tool rounds. With these, one model call is at most about 30,000 tokens in and 700 out, whatever the visitor sends, and a message with every round used and nothing cached is bounded at about 100,000 input tokens; with the prefix cached, which is the normal case, a message is about 25,000 to 40,000 input-equivalent tokens.

**Per address.** A bucket in memory of twenty messages an hour per client address, per instance, so an attacker sees at most three times that across the three instances. The address is the one Google's front end writes into the forwarded header, taken from the position the front end writes and not from where a client could put one, checked once against the live headers during the build rather than assumed. This stops the casual loop and costs nothing; it does not stop many addresses, which is what the meter is for.

**The meter.** After each model call the service adds the call's usage to a counter for the calendar day and one for the calendar month, and refuses the next message once either is spent. The unit is the input-equivalent token: input tokens as they are, cache writes at 1.25, cache hits at 0.1, output at 5, the ratios of the model's prices, held beside the model's name in this package so that the two change together. The month's ceiling is the deployment's, in that unit: CHF 30 a month is about USD 37, which at $2.00 per million is 18.5 million input-equivalent tokens, so `month_tokens` is 18,500,000; the day's share is a tenth, so that a burst costs at most one day and the chat is back tomorrow rather than next month. At the estimate above that is about 500 messages a month and about 50 a day.

The counters live outside the instance because an instance dies fifteen minutes after its last request and three instances would each hold a third of the truth. One Firestore document, incremented in a transaction before the model is called and corrected after with the usage the response reports, is enough: a few hundred writes a month against a free tier of 20,000 a day. The same document carries a switch, `closed`, which the owner sets by hand in the console to turn the chat off without a deploy, and which the widget reads as a plain sentence.

**Vertex quota.** The project's quota for the model is lowered on the Quotas page to a rate a chat needs and an attack does not, on the order of 60 requests and 300,000 input tokens a minute. It is the one layer that holds before this package runs a line, so it also covers a defect in the meter, and it is configuration the owner sets, not code.

**The budget.** The deployment's budget rises from CHF 10 to CHF 40, the chat's ceiling on top of the host's. It alerts as it does today. An automated action on the last threshold, a small function that sets `closed`, is possible and is set aside for now: billing data lags by hours, so it would be a backstop behind a meter that refuses at once, and the mail is enough until the meter has run for a month.

**Not built.** Cloud Armor needs a load balancer in front of Cloud Run in place of Firebase Hosting and costs more a month than the chat would. reCAPTCHA Enterprise is free at this scale and loads a Google script that recognizes visitors, which the privacy page promises not to do. Neither is a loss the layers above do not cover.

## 6. What this package ships under `deploy/`, and what a deployment keeps

The shape is the MCP server's, so that a deployment of the chat reads like a deployment of the host: what is the same in every deployment lives here and ships with the release; what is one deployment's own lives in its repository.

**A Terraform module**, `deploy/terraform/`: the APIs it needs, `aiplatform.googleapis.com` and `firestore.googleapis.com` among them; the project's one Firestore database, native mode, in the deployment's region; a service account of the chat's own, `chat-run`, holding `roles/aiplatform.user` and `roles/datastore.user` on the project and nothing else, so the MCP host's runtime keeps its line "holding no role"; the Cloud Run service, 512 MiB, `cpu_idle`, scaling from zero to three, concurrency twenty, with `CHAT_ORIGINS`, `CHAT_MCP_URL`, `CHAT_MONTH_TOKENS` and the project and region the Vertex client is built with as its environment; a Firebase site of its own, its version rewriting every path to the service with `Cache-Control: no-store`, its release and its custom domain; and the `run_host` input and check the host's module has, for the same reason. It does not make a budget: the project's one budget is the host's module's, and its figure is raised.

**A reusable workflow**, `deployment.yml`: install, the page's CSS from the design package, the tests, the image and its push on `main`, then Terraform, format, validate, a plan posted to the pull request, and on `main` the apply and a live `GET /chat` on the domain whose MCP host must be the one `chat.json` names. It authenticates with the deployment's existing identities, since the bootstrap module is the project's and not the service's.

**Generic tests**, `deploy/test/`: that the installed chat is the release `package.json` pins and the workflow and module refs name the same one, the three-place pin held by a test as the host's is; that `chat.json` names an MCP URL on the host's own domain and at least one origin; that the built page sits in the family's shell.

**A deployment keeps**, beside what it keeps for the host: `chat.json`, holding `domain`, `site_id`, `mcp_url`, `origins`, `month_tokens` and `run_host`; a second one-file Terraform root, `infra/chat/`, with its own state prefix in the same bucket and one module call; a second calling workflow, `chat.yml`; the chat's Dockerfile and its `brand.html`; and its README's owner steps, in order: accept Claude's terms and enable Sonnet 5 in Model Garden, once per project, which Terraform cannot do; apply the bootstrap with the two roles below; merge, read the `run_host` warning and merge again, as the host needed; set the domain's records at the DNS provider; lower the model's quota; and, when the chat should stop, set `closed`.

**The bootstrap module of the MCP server** gains, for the `terraform` identity, `roles/datastore.owner`, to create the database, and `roles/resourcemanager.projectIamAdmin`, to bind the chat runtime's two roles. Today that identity can administer Cloud Run, service accounts, APIs and Hosting, and cannot grant a project role. That is one small release of `companygraph/mcp-server` and an owner's apply per project, as the hardening of 2026-09-21 was, and it is the one change this design makes to the host's repository.

## 7. The widget

A design group, `chat`, of two whole files, `chat.js` and `chat.css`, copied into a site as the `stage` group is, so both sites carry identical bytes and guestgraph.io, which serves no MCP, takes no group. A prose page loads the script with the endpoint on its own tag, `<script src="chat.js" data-chat="https://chat.blust.ch/chat" defer>`, the way a stage page names its data file on a link; a page that carries no such attribute shows no button. The decks do not load it.

The button sits at the bottom right of the page in the family's tokens, one glyph and a label the page's language sets. It loads nothing and sends nothing until it is opened and a message is sent; opening it shows, above the input, one sentence saying where a message goes and that nothing is sent until you press send, with a link to the privacy page, and it is shown every time the panel opens rather than once. The panel follows `lang` and `theme` as every block does, shows that it is waiting while the first words come, streams the answer as it arrives, and renders each `cite` as a link into the site's model page at the entity's id, which the stage already opens by address. Every refusal code has its sentence in both languages inside the block, so a refusal is never a token spent. A conversation over twenty messages is offered a new one. Nothing is stored: no key in `localStorage`, and the conversation is gone when the page is.

The design README's rule that the package is never a runtime dependency of a published page still holds: the block is a file the site commits. What the rule did not foresee is a page that calls a service, and the README gains a sentence saying that a page does so only through a block, only after a visitor acts, and only to a host the family runs.

## 8. What changes beside the code

**The privacy page** on each site gains a section, in both languages, saying what the chat is and what happens when it is used: the message and the conversation so far go to the family's own service at `chat.blust.ch`, which reads the model at `mcp.blust.ch` and asks Claude on Google's Vertex AI in the project's region, and the service keeps a count of what was spent and not a word of what was said. The sentences that promise no third-party request and that the site receives nothing gain their one exception, named. The page's list of what leaves the browser stays short enough to print, which was its whole point.

**A surface entity** in each instance, `production: built`, `built-by` naming the deployment's repository, describing what the chat shows and holding its answering rules in the form the LinkedIn surface holds its projection rules, since a surface's rules are the model's to state and a reader of the Surfaces page should find them there. It is added after the chat is reachable, as the schema asks. The MCP host's own surface is unchanged.

**This package's README and `docs/INTERFACE.md`** describe the routes and the events, and the release notes carry a change to either under `Interface`, as the host's do.

## 9. Tests

In this package, none reaching Vertex or a live host: the loop against a fake model client and a real MCP host, the MCP server's own `createHttpServer` over its fixture snapshot, started in-process, so the tool list, the instructions and the answers are the real interface and not a copy of it. A question that needs two tool rounds gets them and the cited entity; a tool answer over the cap is truncated with its line; a fifth round is not made; a message over 1,000 characters is `too_long` before any call; a foreign origin is `foreign`; the meter refuses at the day's share and again at the month's, with the counter held in a fake store; the switch closes the chat; a host that does not answer is `host_down`; the stream's events are the three named and in that order; the source names no instance fact. The module's proof is a deployment's pull-request plan, posted as the host's is: the resources §6 names and nothing else, and on a re-pin the image alone.

In a deployment: `GET /chat` on the built server carries the deployment's own origins, ceiling and MCP URL. On the live host after apply: the same GET, in place of a message, so a deploy costs no tokens.

## 10. The order of work

1. This repository: created public, its first commit this document; then the routes, the loop, the meter, the module, the workflow, the tests, the documents. One release.
2. `companygraph/mcp-server`: the bootstrap module's two roles. One small release.
3. Each deployment: the host's re-pin for the bootstrap, the bootstrap applied by the owner, the terms accepted in Model Garden, the quota lowered, the chat's files, the budget, the domain's records. The route answers on both hosts to no page yet, since no page calls it.
4. The design package: the `chat` group. One release.
5. Each site: the group taken, the script on every prose page, the privacy section, the sitemap. The chat is live.
6. Each instance: the surface entity.

## 11. Set aside

A route of the MCP server, for the reason §2 gives. A project of its own per chat, kept as the alternative §2 names. Calling the tools in-process over a baked snapshot, which would give the chat a model pin of its own to keep in step with the host's and would put the host's parser inside a second service; a client of the host has neither. The MCP host's Hosting site rewriting `/chat/**` to the chat service, which would put a chat rule inside the host's module. The Anthropic API direct and its spend limit, kept as the swap §2 names. The API's MCP connector, which the Vertex client does not offer. A whole-model prompt in place of tools, which a cold visitor would pay for in full on every first message. Signed conversation state, Cloud Armor, reCAPTCHA and the budget's automated action, for the reasons in §3 and §5.
