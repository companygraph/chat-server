# The questions speak the page's language — design

> On the German page the chat's intro reads German down to its last section, and then offers the model's own questions in English, as the follow-ups after an answer are. The model is written in English and stays so. This design lets the chat server render the model's question titles into the page's language, once per commit and language, so the widget offers them in the language the rest of the panel speaks, and a visitor who presses one sends German and is answered in German.

Status: proposed. Written on 2026-10-01 against this repository at `7a96c52` (v0.21.1) and `robertblust/design` at `8403b3c` (v0.131.0), whose files were read: `lib/prompt.mjs`, `lib/host.mjs`, `lib/http.mjs`, `lib/meter.mjs` and `docs/INTERFACE.md` here, and `assets/chat.js` there. Two choices were made with the owner before the design. The model is not changed: it carries no German, and nothing here asks it to. The rendering is the chat server's, since it already holds the question titles, a model client and a meter.

---

## 1. The gap

The widget builds its intro from two sources. The sentences it writes itself are in `STRINGS` in both languages, so “Probieren Sie” and its three asks read German. The section “Aus dem Modell” is the `name` of every entity of type `question` in the site's `model.json`, offered as it stands, and the follow-ups after an answer come from the same list through `follow()`. Those titles are the model's, and the model is English, so on a German page three lines of six are English, and a visitor who presses one sends English and is answered in English, since the prompt answers in the language of the visitor's last message.

The answer itself already crosses the language: `QUESTION_RULE` matches a visitor's question to one of the model's “in any language or wording”, and `NAME_NOTE` names every entity in German with its title in parentheses. Only the questions the widget offers stay behind.

**What the change buys is an intro and follow-ups in the page's language, on every deployment, with no German written into any model.**

## 2. Approaches

| Approach | Why not, or why |
| --- | --- |
| German titles in the model | Ruled out: the model stays English, and a model that declares `de-CH` in `model/localization.md` is a different change, made by the translator's roles. |
| The widget asks the chat server when the panel opens | Breaks a promise the panel makes in its first lines and `chat.js` keeps in a comment: nothing reaches the chat's host before the visitor presses send. Parked for the owner in section 7. |
| The answer call returns follow-ups in its own language | Covers the follow-ups and not the intro, costs output tokens on every message, and lets the Answerer write question text no entity holds. |
| **The chat server renders the titles, the site's build fetches them** | Recommended. One rendering per commit and language, served from the site's own origin, so the promise holds and the visitor's page asks nothing new. |

## 3. The route

`GET /chat/questions?lang=de` answers `{ model, lang, questions: [{ title, text }] }`. `title` is the model's title exactly as `host.questions()` read it, the key a client matches by; `text` is the same question in `lang`. `model` is the host's provenance the rendering was made at. `lang` is one of `LANGS`, `en` or `de`, and any other value is `bad_request`.

For `en`, `text` is `title` and no model call is made. For `de`, the server renders every title the host's `questions()` gives in one request to the deployment's model, `MODEL` as it stands, since that is the one model a deployment on Vertex has enabled. The instruction asks for Swiss Standard German as `WRITING.md` writes it, Sie, ss and never ß, each title rendered as a question a visitor would type, an entity's name rendered where German has a word for it and kept where it does not, and answered as JSON of the same length and order. A response that is not that shape, or not the same length, is not kept.

The rendering is kept in memory per instance, keyed by provenance and language, and made again when the provenance moves, as the types are. A second request while the first is rendering waits on the same call. Where the call fails or the meter refuses it, the route answers `200` with `text` equal to `title` and a field `fallback: true`, and keeps nothing, so the next request tries again; an English title on the German page is today's state, not a fault.

The route is not held by the per-address bucket. What it spends is bounded by the instance, not the caller: one call per commit and language, and `lang` admits two values, of which one costs nothing. The call is spent through the meter like a message's, in the same unit, so the day's share and `closed` hold for it.

Titles the host did not fetch, past `questionIndexChars` or a page limit, are not rendered and stay English wherever a client offers them.

`docs/INTERFACE.md` gains the row in the table of routes and a short section for the answer. A route added is not a break, so this is a minor release.

## 4. The site's build

The site already fetches the pinned model into `model.json` at build. Its build gains one step: for `de`, fetch `GET /chat/questions?lang=de` from the site's own chat deployment and write `questions.de.json` beside `model.json`, holding the `questions` as answered. A rendering with `fallback: true` fails the build step loudly rather than shipping English under a German name. A rendering whose `model` differs from the site's pinned commit is written anyway: a title the two commits share matches, and a title only one of them has stays English, which is the fallback a reader already accepts.

Where this step lives, in each site or once in design's `bin/design.mjs` beside the fences, is the plan's question, not the design's.

## 5. The widget

`robertblust/design` changes `assets/chat.js` in a pull request of its own. A tag gains `data-questions-de`, a same-origin path to that file. On a page whose `<html lang>` is `de`, the widget reads it with the same timeout and the same once-per-page rule as `data-questions`, and keeps a map from `title` to `text`. Wherever it offers a model question, the intro's “Aus dem Modell” and the follow-ups `follow()` and `spread()` choose, it shows and sends `text` where the map has one and `title` where it does not. The choice of which questions to offer stays on `title`, since `rests` and kinds are keyed by the model's own entities.

`unasked()` compares what was sent with what is offered, so it compares against the text the widget would send in the page's language, or a German question already asked would be offered again.

A tag without `data-questions-de`, an English page, or a file that fails to load reads exactly as today. This is a minor release of design.

## 6. What this changes nowhere

The prompt is not changed: `QUESTION_RULE` already matches a German question to its English entity, and the kept line already holds the question as sent, now in German where a chip sent German. The model is not changed. The meter's unit and the events of `POST /chat` are not changed.

## 7. Parked for the owner

**Follow-ups in the answer's language.** The widget offers the page's language, and the answer follows the visitor's message. A visitor writing English on the German page is answered in English and offered German follow-ups. The cheap fix is for `done` to say which language the answer was written in, which the server does not know today without asking the model; the design leaves the page's language deciding until the owner says this case matters.

**The runtime fetch.** Fetching the rendering when the panel opens would drop the build step and the second file, and would serve a rendering at the host's commit rather than the site's. It also means the visitor's address reaches the chat before send, so the panel's first lines and the privacy page would have to say so. The owner decides whether that trade is wanted.

## 8. Releases

This repository: a minor, the route. `robertblust/design`: a minor, `data-questions-de`. The three deployments re-pin this package and design; each site with a German page takes the build step and the attribute. Nothing asks a consumer for more than a re-pin and the new attribute, so neither release is a major.
