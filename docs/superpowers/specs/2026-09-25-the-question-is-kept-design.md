# The question is kept — design

> The chat answers a visitor and forgets the question the moment the stream ends, so nobody can see what the model was asked and could not say. The privacy pages promise exactly that: the service stores no word of what was said. This design changes the promise once and narrowly: the question, and the signals that say whether the model answered it, are kept for ninety days in the deployment's own project, no address with them and nothing of the answer, so the owner and an agent working for the owner can read what the model is missing.

Status: proposed. Decided on 2026-09-25 with the owner against this repository at `8a88c5c` (v0.11.0), `robertblust/mcp-blust-ch` and `robertblust/robertblust.github.io` at that day's main, whose files were read. Three choices were made before the design and hold through it: the words are kept, not only their shape, because only the words say what the model should say next; the boolean is derived when the entries are read, from signals the server writes, not judged by the server; and the reader is a dedicated identity per project, impersonated from the owner's login on a laptop and bound to the repository's runs on main for a weekly report, never a key.

---

## 1. The gap

A message reaches the route, the loop asks the model up to four rounds, the widget receives the text and the cites, and the meter records the cost. Nothing else remains. The owner cannot answer "what did people ask this week?" nor "how often did the model have to say it does not say?", and the model's next entry is written from guesswork about what a reader wanted. The privacy page on each site says, in both languages, that the service counts what an answer cost and stores no word of what was said, and that sentence has been true; a log of questions was left out by design on 2026-09-24.

**What the change buys is one line per question, kept ninety days where only the deployment's project can read it, and one identity that may read those lines and nothing else.**

## 2. The entry

Once per message that passed the origin check and the shape check, the route writes one line of JSON to standard output, which Cloud Run reads as a structured entry with the moment and the revision on it. The line holds `kind: "question"`, `question`, the last user turn as the visitor sent it, at most the 1,000 characters the shape allows; `lang`, the request's language; `cited`, the ids of the entities the answer linked, in the order they were cited, so a report can say which entities the questions reach; `calls`, how many tool calls the loop made; `empty`, how many of those found nothing or failed; `rounds`, how many turns of the model were run; and `refused`, `null` when the model answered, or the code when the model was never asked or did not finish: `busy`, `over_day`, `over_month`, `closed`, `internal`. No address, no session, no header, no word of the answer, and no name for the site: a project runs one chat, and the entry's resource names the service.

`foreign` and `bad_request` write nothing: the first is not a visitor of the page and the second sent no question the shape accepts. A stream the visitor closed before the answer ended writes the line with what the loop had gathered, since the question was asked. The line is written after the stream ends or the refusal is sent, never before, so a line's presence in the log means the visitor got their answer or their refusal.

The boolean the owner asked for is not a field. It is `cited` being non-empty when the entries are read, and `empty` says why it is false; a rule fixed at write time would have to be re-decided against history that no longer exists, and a rule applied at read time can change with the history intact. The earlier idea of matching the sentence "the model does not say" in the text was set aside: the prompt mandates it in English and the model writes it in the visitor's language, so matching it is a guess in every language but one.

Where it is written. `answer()` in `lib/loop.mjs` returns `{ cited, calls, empty, rounds }` when it resolves, and carries the same on the error it throws, so the route has the signals either way; the route in `lib/http.mjs` composes the line and hands it to a `log` function the server is given, standard output by default, a captured array in the tests. The loop's `emit` is not the place: the events are the widget's, and the widget must not receive the line.

## 3. Where it lives

The chat module in `deploy/terraform` gains, so that every deployment takes it on re-pin: a log bucket `chat-questions` in the deployment's region with `retention_days = 90`; a sink from the project into that bucket whose filter is the chat service's revisions and `jsonPayload.kind = "question"`; an exclusion of the same filter on the `_Default` sink, so the entry exists in one place with one retention and the request log holds none of it; and a log view `questions` on the bucket. Ninety days is stated in the module once and is the number the privacy pages give; a deployment that wants another number changes the module, not its page.

The internal error line the route already writes, `chat: internal`, stays where it is: it names no question.

## 4. Who reads

The module makes a service account `chat-analyst` in the project, holding `roles/logging.viewAccessor` on the project under a condition naming the one view, and `roles/storage.objectUser` on the reports bucket of §5. It holds nothing else: not the request logs, which carry addresses, not the meter, not the service.

Two principals act as it. The repository's runs on `main` are bound as workload identity users, the same principal set the bootstrap gives the deploy account, `attribute.ref/refs/heads/main` of the pool `github` the bootstrap made, whose name the module composes from the project number; a scheduled run is a run on the default branch, so the report of §5 passes without a new pool or provider, and a pull request's run does not pass. The owner's login is granted `roles/iam.serviceAccountTokenCreator` on the account by the owner, once per project, by `gcloud iam service-accounts add-iam-policy-binding`, an owner's step in the README beside the four it already has, because the login's address belongs in no public repository's Terraform. On the laptop, under the owner's own `gcloud auth login`, an agent's environment carries `CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=chat-analyst@<project>.iam.gserviceaccount.com`, the property every `gcloud` command reads, so every `gcloud logging read` and `gcloud storage cat` the agent runs is the analyst's in the audit log and can reach the view and the bucket and nothing further. This is workload identity done the way a laptop can do it; a federated identity needs a token issuer, and a local agent has none.

An MCP server in front of the reads was considered and left out: it would declare the read as a tool but add no capability and no restriction the identity does not already hold. It can be added later without touching this design.

## 5. The report

The package's `bin/deploy.mjs` gains a `report` command. Under the analyst's credentials it lists the view's entries of the past seven days through the Logging API, with the auth library the Firestore client already brings and no further dependency, and writes one Markdown file, `YYYY-WW.md` by the ISO week, to the bucket: how many questions, how many answered, by language, the entities most cited, and the unanswered questions in full, each with its `empty` and its `refused`. It prints the counts and never a question, because the run's log in a public repository is public.

The module makes the bucket, `chat-reports-<project>`, in the region, uniform access, public access prevention enforced, and a lifecycle rule deleting an object at eighty-three days with no soft-delete retention, since a report quotes questions up to a week old, so a question quoted in a report is gone ninety days after it was asked and the promise has one number. A deployment gains `.github/workflows/report.yml`: a schedule on Monday morning, as the sites' link check runs, authenticating through the pool as `chat-analyst` and running the command at the release `chat/package.json` pins. The deployment reads the report with `gcloud storage cat` under the same identity.

## 6. The promise

The privacy pages of blust.ch, companygraph.io and guestgraph.io, in English and German, replace the sentence that the service stores no word of what was said. The new sentence says that the service keeps the question you sent, and whether the model could answer it, for ninety days, to see what the model cannot yet say; that it keeps no address with it and nothing of the answer; and that the same is true of a weekly summary the owner reads. The paragraph on what the browser keeps in the tab does not change. Each site's German is the translator's, reviewed as the pipeline says, and never a machine's.

The README's paragraph on the ceiling gains what the service keeps; `docs/INTERFACE.md` gains a section "What is kept" naming the entry's fields and the ninety days, so a client of the interface reads it where it reads the codes.

## 7. Tests

`test/http.test.mjs`, on a `log` the test captures: an answered turn writes one line with every field of §2 and `refused: null`; a turn the meter refused writes `refused: "over_day"` with `rounds: 0`; a turn whose calls all came back empty writes `cited: []` and `empty` equal to `calls`; a turn from a foreign origin and a body that fails the shape write nothing; and no line contains the request's address, which the test sets to a fixed value and searches for. `test/loop.test.mjs`: `answer()` resolves to the four signals and the error it throws carries them. `test/report.test.mjs`, on fixture entries and a fake bucket writer: the counts, the week's name, the unanswered list, and that standard output holds a count and no question. The deployment tests in `deploy/test/` need nothing new: they read `GET /chat`. The module is validated by the deployments' plans.

## 8. Files

`lib/loop.mjs`, `lib/http.mjs`, `bin/deploy.mjs`, a `lib/report.mjs`; `deploy/terraform/main.tf`, `run.tf`, `variables.tf` and `outputs.tf`; `deploy/workflows/report.yml` or the equivalent the deployments call; `docs/INTERFACE.md`; `README.md`; the three test files.

## 9. Release and order

A minor release of this package, since the interface gains a section and a deployment gains a workflow and an owner's step and loses nothing. The `terraform` identity the MCP host's bootstrap makes holds no role over Logging or Storage, so before any deployment can plan the module, `companygraph/mcp-server`'s bootstrap grants it `roles/logging.configWriter` and `roles/storage.admin`, and the `terraform-plan` identity `roles/storage.bucketViewer` and `roles/iam.securityReviewer`, since a pull request's plan refreshes the reports bucket and its policy once they exist, in a release of its own that the owner applies in each project, as the datastore and IAM roles were granted when the chat first arrived. Then, in order: the three sites' privacy pages change, English and German, and go live, so the promise changes before a line is written; the three deployments re-pin, each taking the module and adding `report.yml`, and each plan shows the bucket, the sink, the exclusion, the view, the account and its bindings; the owner runs the token-creator grant per project; the first Monday's reports are read.
