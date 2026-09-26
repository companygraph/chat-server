# The answer is checked — design

> The chat answers any question and names the entity each claim rests on, but nothing checks that the entity says what the claim says. A claim can name the right entity and state the wrong date, or name an entity the tools never returned. This design has the service read its own answer back against the tool answers the model was given, claim by claim, before the stream ends, and tell the widget and the kept line which claims the evidence carries and which it does not.

Status: draft. Written on 2026-09-26 against this repository at `8accf2e` (v0.12.2), whose files were read, for the owner to decide. It rests on one outside release, TypeSafe AI's Jev, published on Sep 15, 2026: a model that takes state and typed questions and returns typed answers with probabilities, trained so that those probabilities are calibrated, and which writes no text. Its wire format, its price and its latency are TypeSafe's published figures and were not measured here; §8 says what is measured before any number in this design is relied on.

---

## 1. The gap

The prompt's second rule asks the model to take every claim from a tool's answer and to name the entity it rests on by its title. The loop holds everything needed to hold the model to that rule: every tool answer it passed on, every entity it cited and every name it emitted. It checks none of it. The kept line of 2026-09-25 says whether a question was answered, by `cited` and `empty`, and says nothing of whether the answer was right. A visitor who reads a wrong date under a correct link has no way to tell, and neither does the owner.

**What the change buys is a verdict per claim, drawn from the evidence the model itself was shown, sent to the widget before `done` and counted in the kept line.**

## 2. Why a second model, and why this one

The check is a classification: given a sentence and the text of the entities it names, does the text carry the sentence. A second call to the chat's own model could make it, and would be a text model grading its own kind of output at the chat's own price and latency. Jev answers a closed set of options with a probability for each, so a verdict cannot be anything but one of the options this design names, and the probability is what a threshold reads. The check needs no prose, and a model that writes none cannot put a new claim into it.

Calibration is the property the design leans on and the one it does not take on trust. A verdict near an even split is read as a finding about the model, not the chat: the entity is worded too loosely for its claim to be judged, which is a change to the model, as an unanswered question is.

## 3. The claims

A claim is found without a model. The answer is the Markdown subset the prompt allows, so its units are fixed by its form: a sentence of a paragraph, split by `Intl.Segmenter` in the visitor's language; a list item; a table row. Each claim keeps its start and end in the answer's text, counted over the concatenated `text` events, so the widget can mark it where it stands.

A claim names an entity where it writes the title of one the message cited or named, the same match the widget already makes to link them. From that, three findings need no model. A claim that names no entity breaks the second rule and is `unnamed`. A claim that writes a title the model holds but no tool returned in this message is `unsourced`, since the model had nothing to take it from. And a claim that is only connective prose, a sentence that introduces a list, is left to the model below, which has an option for it.

## 4. The verdict

The evidence of a claim is the text of every tool answer that carried an entity it names: the entity's own answer where the loop cited it, the row of the list where it was only named. The loop keeps a map from id to that text as it goes, cut at the 16,000 characters the model was given, never more, so the evidence is exactly what the model saw.

All claims of one answer go to Jev in one request, each a question with its own state, answered in parallel. Each is one choice of five: `supported`, the evidence says what the claim says; `partial`, it says some of it; `contradicted`, it says otherwise; `absent`, it does not say; and `says-nothing`, the claim is that the model holds nothing on the matter. The last is the one the prompt's third rule asks for, and the design does not look for its wording, since the model writes it in the visitor's language and the design of 2026-09-25 already set matching it aside as a guess. Jev's option is checked against the loop instead: a `says-nothing` claim in a message where `empty` is below `calls` is `withheld`, a finding that the tools answered and the answer said they did not.

A claim in German judged against English evidence is the case the design is least sure of. It is the first thing §8 measures, and until it is measured a German answer is checked and its verdicts are kept but not shown.

## 5. What the widget and the line receive

The stream gains one event, `verdict`, sent after the last `text` and before `done`, since `docs/INTERFACE.md` makes `done` the last event and a client may rely on that. Its data is `{ claims: [{ from, to, ids, verdict, p }] }`, `from` and `to` the claim's place in the text, `ids` the entities it names, `verdict` one of `supported`, `partial`, `contradicted`, `absent`, `says-nothing`, `withheld`, `unnamed` and `unsourced`, and `p` the probability of that verdict where Jev gave it. An event added is not a break. The widget marks a claim whose verdict is not `supported` or `says-nothing` and whose `p` passes the threshold, and shows nothing where the event does not come; how it marks it is the widget's.

A verdict that fails, Jev down or slow past its budget, sends no `verdict` event and never an `error`: the answer is the answer, and a check that could not run takes nothing from it. The budget is one second from the last `text`, which delays `done` by at most that.

The kept line gains `claims`, the number found, and `unsupported`, the number whose verdict is `partial`, `contradicted`, `absent`, `withheld`, `unnamed` or `unsourced`. Both are counts. The line still carries no word of the answer, as the design of 2026-09-25 promised, and the weekly report gains the same two counts per question beside the ones it has.

## 6. The promise and the fence

The check sends the answer's claims and the tool answers to TypeSafe, a processor the privacy pages do not name. The tool answers are the model's public content; the claims are the chat's own words and follow from the visitor's question. Before the check runs on any deployment, the three sites' privacy pages, English and German, name TypeSafe as a processor of the answer, not of the question or the address, and the German is the translator's, as the pipeline says.

The meter counts input-equivalent tokens of the chat's model and has no unit for a second provider. Jev's spend is kept out of it: a deployment gives TypeSafe its own key with a spend limit set at TypeSafe, which is the hard stop, as the Anthropic workspace is for the chat's own model. The check runs only on a message the meter already let through, so a refused message costs nothing in either.

## 7. Configuration

`chat.json` gains `verdict`, `false` by default, so a deployment that re-pins gains nothing it did not ask for. With `true`, the module mounts the project's Secret Manager secret `typesafe-key` into the service as the Anthropic key is mounted, and the owner makes that secret the way the README's steps make `chat-anthropic-key`. `CHAT_VERDICT_THRESHOLD` is the `p` above which the widget marks a claim, and has no default until §8 gives one: with it unset, verdicts are kept and sent with `p`, and the widget marks nothing.

## 8. Tests and what is measured

`test/verdict.test.mjs`, on a scripted Jev: claims are split by sentence, item and row with their offsets; a claim naming no title is `unnamed` and one naming a title no tool returned is `unsourced`, both with no call made; the evidence of a claim is the text its entities arrived in and no more than 16,000 characters of it; `says-nothing` in a message with an answered call is `withheld`; a Jev that fails or overruns sends no `verdict` and the `done` that follows is unchanged. `test/loop.test.mjs`: `verdict` comes after the last `text` and before `done`, and not at all with `verdict` off. `test/http.test.mjs`: the kept line carries `claims` and `unsupported` and still no word of the answer, which the test searches for.

The threshold and the German case are measured, not assumed, by a script run by hand with a key and never in CI, since the suite reaches no live service: the fixture host over the worked example, a set of answers written with a known fault planted in each, a wrong date, a skill the entity does not claim, a title no tool returned, an empty search said to be full, and the same set in German. The script prints, per verdict, how often a `p` in each tenth was right. Where that curve is near the diagonal, the threshold is read off it and written into this section; where it is not, the check ships with the widget marking nothing and the kept counts as the only use.

## 9. Files

A new `lib/verdict.mjs` for the claims, the evidence map and the call; `lib/loop.mjs` to keep the evidence and call the check before `done`; `lib/http.mjs` for the two fields of the kept line; `lib/config.mjs` for `verdict` and the threshold; `lib/report.mjs` for the counts; `deploy/terraform/run.tf` and `variables.tf` for the secret; `docs/INTERFACE.md` for the event and the two fields; `README.md` for the owner's step and the fence; the three test files and the measuring script under `scripts/`.

## 10. Release and order

A minor release, since the interface gains an event and the kept line two fields and nothing is removed. In order: the measuring script runs against the fixtures in English and German, and its curve decides whether the widget marks at all; the privacy pages name TypeSafe and go live; one deployment sets `verdict` and runs a week with the threshold unset, its report read for the counts; then the threshold is set and the other deployments take it on re-pin.

Three choices are left to the owner: whether the check runs at all given the new processor on the privacy pages; whether a German answer is checked before §8 has measured it; and whether the widget marks claims or the counts in the report are the whole use.
