# Only the answer is sent, and a person's role is theirs — design

> Measured at v0.29.1, one answer of five opened with the model saying what it was about to call, which the prompt forbids, and two of five read a person's latest role as something other than their latest role, one of them as the model's own type `role`. This sends a round's text only where the round calls no tool, and tells the model that a person's role is one of their experiences.

Status: proposed. Decided on 2026-10-06 with the owner against this repository at `4b8db62`, from the measurement recorded in [the chat knows the date](2026-10-05-the-chat-knows-the-date-design.md).

---

## 1. A preface is never sent

The rule "Call a tool without a preface; write only the answer" stands in the prompt, and one run in five still opened with "so let me get every experience entity". A sentence asks; the loop can make sure. Text the model writes in a round that ends by calling a tool is by its place the model saying what it will do, so `answer()` in `lib/loop.mjs` holds each round's text until the round ends and sends it only where the round calls nothing: the round that answers, or the last request, which may call nothing. The check reads what was sent, so it judges the answer the visitor reads.

The page loses nothing it shows. The widget holds an answer until the stream ends and draws it whole, so text sent at the end of a round reaches the visitor at the same moment as text sent piece by piece. What changes for a client is that `text` comes once per answering round rather than in pieces, and that the stream opens on a tool's first `cite` or `names` rather than on a preface, so a host gone in the first round is a JSON refusal before the stream rather than its last event. The interface document says so under `text`.

## 2. A person's role is theirs

`FACTS_RULE` gains a sentence: a question about a person's role, job or position is about their experiences, kept with `where` on the kind that names such a period and ordered `by` start, and never about the type `role`, whose entities are the seats of the model's own processes. It names no kind, since which kind names a period of employment is the instance's word, and it rides on the rule that is sent only where the host's list takes the arguments it names.

## 3. Tests and release

`test/loop.test.mjs` holds that a round that calls a tool sends none of its text, that the answering round's text is the answer and what the check reads, and that the last request's text is sent whatever it asked for. `test/http.test.mjs` holds the mid-stream refusal with a stream opened by a `cite`, and a visitor who leaves before anything was sent. `test/prompt.test.mjs` holds the sentence on roles.

The next minor, since a client receives `text` differently. Once deployed, the two questions it answers, his latest role and his whole work history, are each asked five times on chat.blust.ch.
