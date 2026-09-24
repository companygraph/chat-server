# The interface

What a page's widget, or any client, may rely on: the routes, the request, the events, the codes, and what counts as a break. It holds for every deployment of the package, since a deployment names a host and changes no route.

## Routes

| Route | Method | Answer |
| --- | --- | --- |
| `/` | GET, HEAD | a page in the family's shell: the model's own taglines, the four paths, the events, the fence and what it reads, built the way the MCP host's page is |
| `/health` | GET | `{ ok: true, host }`, `host` the MCP host's provenance as last read |
| `/chat` | GET | what the chat is, without spending a token: `model`, `provider`, `vertex` or `anthropic`, `mcp_url`, `origins`, `provenance`, `month_tokens`, `day_share`, `day_used`, `month_used`, `closed`, and `address`, the caller's own address as the service sees it; held by the same per-address bucket as a message |
| `/chat` | OPTIONS | the preflight, `204` for an origin the deployment named and `403` for another |
| `/chat` | POST | a message, answered as a stream of events |

A request whose `Host` is not one the deployment named is `421`. Any other path is `404`; any other method on `/chat` is `405`.

The host's types, which `provenance` on `/health` and `/chat` both read, are refreshed at connect and again when the host's commit moves; a refresh that fails holds off trying the host again for thirty seconds, meanwhile answering from whatever was last read, before trying once more.

## The request

A `POST /chat` carries the header `X-Chat: 1` and a JSON body of at most 64 KiB: `messages`, the conversation as `{ role, content }` turns, `user` and `assistant` alternating and beginning and ending with `user`, each `content` a string; and `lang`, `en` or `de`, for the sentences the server writes itself. A `user` turn is at most 1,000 characters after trimming. The server reads only the last eight turns.

A page whose `Origin` the deployment named gets `Access-Control-Allow-Origin` on the answer; a page whose `Origin` it did not name is refused; a client that sends no `Origin` passes.

The bucket of twenty an hour is keyed on the address Google's front end writes into `X-Forwarded-For`, so it holds for a page that arrives through Firebase Hosting; a caller that reaches the Cloud Run address directly writes that header itself and chooses its own key, and there the meter is the only bound.

## The events

The answer is `text/event-stream`, each event an `event:` line and one `data:` line of JSON:

| Event | Data | When |
| --- | --- | --- |
| `text` | `{ text }` | a piece of the answer, as it is generated, in order |
| `cite` | `{ id, title, type, url }`, `url` null where the host names no file | a tool answered with one entity, or evidence for one skill; the widget links it, and an entity cited already in this message is not cited twice |
| `names` | `{ names: [{ id, title }] }` | every entity a list answer named, at most sixty a message, each once and never one the answer also cites; the widget links these names where the text writes them |
| `done` | `{ model, spent, dayLeft, cut }` | the last event: the host's provenance, what the message cost in the meter's unit, and what is left of today's share; `cut` is `true` where the output limit stopped the answer mid-sentence and is absent where it did not |
| `error` | `{ error: { code, message } }`, with `retryAt` where the code is `busy` | the last event when something arrives after the stream began: `host_down`, `busy` or `internal` |

## The codes

A refusal decided before the stream is JSON, `{ error: { code, message } }`, with the status the table gives. The widget turns a code into a sentence in the visitor's language; the message is for a reader of the raw answer. A refusal for a limit that lifts by itself, `busy`, `over_day` or `over_month`, also carries `retryAt`, the moment it lifts as an ISO 8601 time in UTC, and the response carries `Retry-After`, the same moment in whole seconds from now, rounded up and never below one; every other code carries neither, since a bad request, a foreign origin, a closed chat and a host that did not answer have no moment.

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | the body is not JSON, or not the shape above, or the header is missing |
| `too_long` | 400 | a message is over 1,000 characters |
| `foreign` | 403 | the page's origin is not one the deployment named |
| `busy` | 429 | this address has sent twenty messages this hour, and `retryAt` is when the oldest of them is an hour old; or the model is at the project's rate for the minute, and `retryAt` is one minute on |
| `over_day` | 429 | today's share of the ceiling is spent; `retryAt` is the next midnight UTC |
| `over_month` | 429 | this month's ceiling is spent; `retryAt` is the first of the next month at midnight UTC |
| `internal` | 500 | an error that is not a refusal; before the stream it is this JSON, after the stream began it is the last event |
| `host_down` | 502 | the MCP host did not answer |
| `closed` | 503 | the owner switched the chat off |

A body over 64 KiB is refused with status 413 and a plain-text body, not the JSON shape, because it is refused before or while it is read: the `Content-Length` decides it where there is one, and otherwise the bytes are counted as they arrive and the request is dropped when they pass the cap.

The moment is the truth of the instance that refused. The bucket is in memory per instance and a second instance counts an address on its own, so a visitor may find the chat open earlier than the moment says, and never later.

## The meter's unit

The input-equivalent token: input tokens as they are, cache writes at 1.25, cache reads at 0.1, output tokens at 5, rounded up per call. A deployment states its month in that unit; the day's share is a tenth.

## What counts as a break

A route removed or renamed, a field removed from `GET /chat` or from an event, an event removed, a code removed or its status changed, a bound tightened. A field or an event added is not.

The page's class names are the contract a deployment's stylesheet is written against; one of them removed or renamed is a break.
