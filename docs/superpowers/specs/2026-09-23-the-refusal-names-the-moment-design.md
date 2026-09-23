# The refusal names the moment — design

> A visitor who has sent twenty messages in an hour is refused with a sentence that says to try again in a minute, and the wait is anywhere up to an hour. The server knows the moment to the second and says nothing; the widget guesses and guesses wrong. A refusal for a limit carries the moment it lifts, in the body and in the standard header, and the widget writes it in the visitor's language and local time.

Status: proposed. Decided on 2026-09-23 with the owner, who ran into the limit on blust.ch, against this repository at `82047a4` (v0.7.0) and `robertblust/design` at v0.80.2, whose files were read that day. The widget's half is `robertblust/design`'s and has a spec of its own beside this one; both deployments take this release in `chat/` and both sites take the widget's by re-pin.

---

## 1. The gap

Three refusals are limits that lift by themselves. `busy` is the bucket, twenty messages an hour per address in a sliding window, so the wait is until the oldest of the last twenty is an hour old: seconds, or the whole hour. `busy` is also the model's own rate for the minute, which the loop maps to the same code. `over_day` lifts at midnight UTC and `over_month` on the first of the month, since the meter counts its day and its month in UTC. In every case the server holds the moment: the bucket's list, the clock, the calendar. What it sends is `{ error: { code, message } }` and a 429, and the widget turns the code into a sentence written before the bucket existed in this form, "try again in a minute", which is right for the model's minute and wrong for the bucket's hour. A visitor who does as told is refused again, and again.

**What the change buys is one field that says when, from the one place that knows, so the widget never has to guess and the sentence is true.**

## 2. The field and the header

A refusal whose code is `busy`, `over_day` or `over_month` carries `error.retryAt`, the moment the limit lifts as an ISO 8601 time in UTC, and the response carries `Retry-After` in whole seconds from now, rounded up and never below one, which is what a 429 is meant to say and what a client that is not the widget will read. The other codes carry neither: a bad request, a foreign origin, a closed chat and a host that did not answer have no moment.

Where the moment comes from. The bucket's `take` returns, on refusal, the time the oldest hit in the window leaves it, and the route puts it on the error; the class gains an optional `retryAt` and `refusal()` writes it when present. The meter's refusals name the next midnight UTC for the day and the first of the next month at midnight UTC for the month, computed from the meter's own clock, the one the tests already inject. The model's rate for the minute names one minute from now, since that is the quantum the quota is counted in and the SDK's error carries nothing more exact that this service reads.

The moment is the truth of the instance that refused. The bucket is in memory per instance, and a second instance counts an address on its own, so a visitor may find the chat open earlier than the moment says and never later; the widget's sentence says "at" and not "exactly at", and the interface document says why.

## 3. The interface

`docs/INTERFACE.md`, in the codes section: the refusal shape gains `retryAt` as optional, the sentence says which three codes carry it and what each names, and a line names the `Retry-After` header. Additive: a client reading `code` and `message` reads what it read. The three rows of the table each gain the moment they name.

## 4. Tests

`test/errors.test.mjs`: a `ChatError` with `retryAt` writes it, one without writes no field. `test/bucket.test.mjs`, or the file that holds the bucket: the twenty-first take within the hour is refused with the moment the first hit leaves the window, and a take after that moment is allowed, on the injected clock. `test/meter.test.mjs`: the day's refusal names the next midnight UTC and the month's the first of the next month, on the injected clock. `test/http.test.mjs`: the bucket's refusal answers 429 with `retryAt` in the body and `Retry-After` in the header agreeing with it to the second; a `foreign` refusal carries neither. The deployment tests in `deploy/test/` need nothing: they read `GET /chat` and never a refusal.

## 5. The widget

In `robertblust/design`, the chat group's widget keeps `retryAt` beside the code when it reads a refused response, and the refusal sentence for the three codes ends with the moment in the visitor's language and local time: within the hour, in minutes; later the same day, at a time of day; on another day, that day and the time, so midnight UTC reads as the local hour it is. Where the field is absent, the sentences stand as they are, except that `busy` stops promising a minute. The formatting is a pure part on `rbChat`, so the suite holds it in Node with a fixed clock. That is the design spec beside this one, and the widget's release is design's; a widget that meets a server without the field, or a server that meets a widget without the reading, each degrade to today.

## 6. Files

`lib/bucket.mjs`, `lib/errors.mjs`, `lib/meter.mjs`, `lib/http.mjs`, `lib/model.mjs` for the minute; `docs/INTERFACE.md`; the four test files. The README's sentence on the bucket gains the clause that a refusal names when it lifts.

## 7. Release

One release, the next minor after whatever `main` carries when this merges, additive. The two deployments take it in `chat/`, in the three places the chat's pin test holds; the sites take the widget's release by re-pin. Merging, the tag and the re-pins each wait for the owner's word.

## 8. Out of scope

Raising or lowering the bucket's twenty, or making it shared across instances. A moment for `closed`, which lifts when the owner says. A retry the widget makes on its own: the visitor decides when to ask again, and the sentence tells them when they can.
