# Swiss-hosted models behind the chat — research

> A visitor could choose where a question is answered: by Claude through Anthropic, or by a model hosted in Switzerland. Measured against AlpineAI's endpoint with this server's loop and prompt unchanged, neither of the two models that answered is ready for visitors, an answer costs about what Sonnet's does, and one key serves a handful of answers a minute. Nothing was built.

Status: measured, not built. Measured on 2026-10-13 against this repository at `a5e97c9`, release 0.37.0, with a throwaway probe that is not in the repository.

---

## 1. The question

The server speaks one request shape, the Messages surface, to Vertex AI or to the Anthropic API (`lib/model.mjs`), and a deployment does not choose the model. The question was whether a second place can answer beside it: a model hosted in Switzerland, reached through AlpineAI's public API at `https://api.prod.alpineai.ch`, which follows the OpenAI chat-completions form.

Three things were decided with the owner before anything was measured. The visitor chooses, in the widget, and not the deployer for a whole site. The choice is where the question is answered and has two positions, Claude through Anthropic or a model in Switzerland, because the place is what a visitor can weigh and every model offered is one more to measure, price and keep. The server fixes the one Swiss model, and which one is what this measurement was for.

**The measurement says none yet: both models that answered need work on this server's side before a visitor could be offered them.**

## 2. The endpoint

The API offers `/v1/chat/completions` with tools, `tool_choice` and streaming, and `/v1/models`. Its published OpenAPI document declares no security scheme; a request without a key is answered 401, and a bearer key is accepted.

On the day, the key listed three models: `alpineai/nemotron-3-super`, `nemotron-3-nano-30b-a3b-fp8` and `mistral-large-3-675b-nvfp4`. The small Nemotron answered 500 to every request sent to it, a plain one-line question without tools included, so it was not measured.

The key is held to a rate counted across all models. Past it a request is refused with 429 and the code `RATE_LIMIT_EXCEEDED`, in the words “Locked due to rate limit 15 requests in 60 seconds.”

Usage comes back as prompt tokens and completion tokens. A request has no way to mark a prefix for caching; the usage carries a `cached_tokens` detail, which read zero on the one plain request looked at, and whether the endpoint caches a repeated prefix on its own was not measured.

Nemotron Super writes its thinking before its answer and streams it in a field of its own, `delta.reasoning`, beside `delta.content`. The thinking counts as completion tokens and against `max_tokens`. Mistral Large sent no such field.

A streamed tool call ended with the finish reason `tool_calls` on both models. The OpenAPI document warns that Llama 4 ends one with `"None"` and writes either text or a call in a turn, never both; the key listed no Llama model, and one Mistral turn of 56 carried both.

## 3. How it was measured

The loop, the prompt, the host and the meter ran as released, and only the model was swapped: the probe implemented the `Model` that `lib/loop.mjs` calls and translated each request and each streamed answer. So what was measured is these models under a prompt and a last-request handling that were tuned on Sonnet, not these models at their best.

The translation was this:

- the system blocks became one `system` message, and the cache marks were dropped;
- an assistant turn's `tool_use` blocks became `tool_calls`, and a `tool_result` became a `tool` message;
- the notes the loop writes after the tool answers rode on the last tool answer, and in one variant followed as a `user` message;
- the host's tools became functions, with the input schema as `parameters`;
- the last request's `tool_choice` of none was sent as `"none"`, and in one variant the tools were left out of that request;
- calls in the answer made the stop reason `tool_use` whatever the finish reason said, `length` made it `max_tokens`, and prompt and completion tokens became input and output tokens with no cache counts.

Ten questions were asked of the CompanyGraph MCP host, each as a first message unless noted, twice per model:

- What is CompanyGraph?
- Show me the meta-model
- Which packs are there, and what does each add?
- List the processes as a table
- Which process does the Answerer seat work in, and which KPI measures it?
- What was the company's revenue last year?
- Was ist ein Pack, und welche gibt es?
- Welche Regeln gelten für das Schreiben, und wer prüft sie?
- And who owns it? — after a turn about the Answering process
- Can a system outside our model keep a link to an entity after it is renamed? — one of the model's own questions

Sonnet answered the same set through the Anthropic API with a key, with the effort and the caching of the release. Requests to AlpineAI were spaced 4.5 seconds apart to stay under the rate, so the times below are per request and not per answer. Each answer was graded by reading it beside Sonnet's and beside what the tools had returned; the answer check was not run.

## 4. What came back

| | Sonnet 5 | Mistral Large 3 | Nemotron 3 Super |
| --- | --- | --- | --- |
| Answers a visitor could read | 20 of 20 | 20 of 20 | 13 of 20 |
| English question answered in English | 16 of 16 | 5 of 16 | every readable one |
| Seat, process and KPI over two hops | right, 2 of 2 | wrong, 2 of 2 | right, 2 of 2 |
| Requests for the twenty answers | 57 | 56 | 75 |
| Pictures drawn | 2 | 14 | 6 |

Mistral Large never failed and is quick: 38 of its 56 requests came back in under a second, and the slowest, writing a long answer, took ten. It answered an English question in German eleven times of sixteen. With the notes sent as a `user` message, four of eight still came back in German, so where the note stands is part of the cause and not all of it. It reached for the `diagram` tool on the two questions about packs, five pictures under one answer, where Sonnet drew a picture only when asked for one. On the two-hop question it named the phase as the process and said the model names no KPI for it, in both runs and in the variant; the model names two.

Nemotron Super was the more faithful where it answered. It was right on the two-hop question, on the revenue the model does not hold, on the table and on the model's own question, each in both runs, and it kept the visitor's language. Six of its twenty answers were not answers: at the last request, which forbids a call, it wrote the call it still meant to make as text, `<tool_call>` markup and nothing else, and the visitor would have read that. Two more hit the output limit, one of them with no text at all, the thinking having used it up. Its requests took between 1.4 and 9 seconds, three of them between 17 and 22, and an answer took more of them than Sonnet's.

With the tools left out of the last request, the six questions that had ended in markup were asked again. None ended in markup. Three ended empty, the loop's second ask included, all of the output written as thinking; one said the model does not say who owns the Answering process, which it does; two were answers.

## 5. What it costs

The measurement was the key's whole use, so AlpineAI's usage page for the month to 2026-10-13 is its bill: 203 requests, 2,346,774 tokens and CHF 2.04, of which CHF 1.83 for input and CHF 0.21 for output. The probe's own count agrees to the token. Across both models that is CHF 0.80 per million prompt tokens and CHF 4.54 per million completion tokens; the price list per model was not read.

Those requests made 63 answers, about CHF 0.03 each, a little high because the requests of answers the rate limit cut short are in the bill and not in the count. Sonnet's twenty answers cost 314,191 of the meter's units, the input-equivalent token of `lib/meter.mjs`, which at Anthropic's list price of USD 2.00 per million input tokens is USD 0.63, about USD 0.03 each. The two currencies were not converted.

**An answer costs about the same in both places, although a token costs far less in Switzerland, because nothing there is cached.** Every round resends the prompt and the tool list whole, ten to twelve thousand tokens a request at the full price, and nine tenths of the bill is input. On the Messages surface the same prefix is read from the cache at a tenth of the price (`WEIGHTS` in `lib/model.mjs`).

## 6. What a second place asks of the server

A spec would have to settle each of these, and none is settled here.

A second request shape sits behind `turn`, with the loop's notes placed where the model's chat template takes them. The loop, the host's tool list and the meter read Anthropic's types today.

The meter counts in Sonnet's price ratios, cache writes and reads among them. Usage from this endpoint has two numbers, so either each place has its own weights against one ceiling or each has its own ceiling.

A model that thinks in a field of its own needs room in the output limit of `lib/shape.mjs` for the thinking, and an answer that is all thinking has to be told from a silence.

The last request needs its own handling per model. Sonnet's silence was met with a note and a second ask with an empty tool list (`FINAL_NOTE` in `lib/model.mjs`); Nemotron writes the call as text with the tools listed and thinks itself empty without them.

The rule for the answer's language and the naming note were tuned on Sonnet, and Mistral does not follow them as written.

The key's rate is a ceiling for the whole site, far under what the bucket allows each address, so a refusal for rate has to reach the visitor as `busy` with its moment, and a site would need a higher rate from AlpineAI before it offered the choice.

The choice changes the interface: the message has to say which place, `GET /chat` has to say what is offered, and the kept line has to say which place answered.

The widget's notice and each site's privacy page name Anthropic, and would have to name the place the visitor chose.

What “answered in Switzerland” may claim depends on more than the model. The family's chat hosts run in Google's Zurich region, the questions are kept in the deployment's own project, and where a deployment checks its answers, each answer and its evidence go to TypeSafe.

## 7. What was not measured

The sample is ten questions twice, one host and one evening, read by one reader. Not measured: the answer check's verdicts on these answers, the two other hosts, a conversation longer than one follow-up, several visitors at once, AlpineAI's price list per model, whether its endpoint caches a repeated prefix, and either model with a prompt written for it.

## 8. What would reopen this

Three things, in this order. Nemotron Super's last request made reliable, with room for its thinking and a second ask when the answer is markup or empty, and the set measured again to Sonnet's level. A rate from AlpineAI that a site can live on, and an answer on why the small Nemotron fails. Then a design for this server, and after it the widget's switch and the sites' pages, each its own piece.
