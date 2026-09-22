# The interface

What a page's widget, or any client, may rely on: the routes, the request, the events, the codes, and what counts as a break. It holds for every deployment of the package, since a deployment names a host and changes no route.

## Routes

| Route | Method | Answer |
| --- | --- | --- |
| `/` | GET, HEAD | a page saying what the chat is, which site opens it, which host it reads and at which commit |
| `/health` | GET | `{ ok: true, host }`, `host` the MCP host's provenance as last read |
| `/chat` | GET | what the chat is, without spending anything: `model`, `mcp_url`, `origins`, `provenance`, `month_tokens`, `day_share`, `day_used`, `month_used`, `closed`, and `address`, the caller's own address as the service sees it |
| `/chat` | OPTIONS | the preflight, `204` for an origin the deployment named and `403` for another |
| `/chat` | POST | a message, answered as a stream of events |

A request whose `Host` is not one the deployment named is `421`. Any other path is `404`; any other method on `/chat` is `405`.

## The request

A `POST /chat` carries the header `X-Chat: 1` and a JSON body of at most 64 KiB: `messages`, the conversation as `{ role, content }` turns, `user` and `assistant` alternating and beginning and ending with `user`, each `content` a string; and `lang`, `en` or `de`, for the sentences the server writes itself. A `user` turn is at most 1,000 characters after trimming. The server reads only the last eight turns.

A page whose `Origin` the deployment named gets `Access-Control-Allow-Origin` on the answer; a page whose `Origin` it did not name is refused; a client that sends no `Origin` passes.

## The events

The answer is `text/event-stream`, each event an `event:` line and one `data:` line of JSON:

| Event | Data | When |
| --- | --- | --- |
| `text` | `{ text }` | a piece of the answer, as it is generated, in order |
| `cite` | `{ id, title, type, url }` | a tool answered with one entity; the widget links it |
| `done` | `{ model, spent, dayLeft }` | the last event: the host's provenance, what the message cost in the meter's unit, and what is left of today's share |
| `error` | `{ error: { code, message } }` | the last event when a refusal arrives after the stream began; today only `host_down` |

## The codes

A refusal decided before the stream is JSON, `{ error: { code, message } }`, with the status the table gives. The widget turns a code into a sentence in the visitor's language; the message is for a reader of the raw answer.

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | the body is not JSON, or not the shape above, or the header is missing |
| `too_long` | 400 | a message is over 1,000 characters |
| `foreign` | 403 | the page's origin is not one the deployment named |
| `busy` | 429 | this address has sent twenty messages this hour |
| `over_day` | 429 | today's share of the ceiling is spent |
| `over_month` | 429 | this month's ceiling is spent |
| `host_down` | 502 | the MCP host did not answer |
| `closed` | 503 | the owner switched the chat off |

A body over 64 KiB is refused with status 413 and a plain-text body, not the JSON shape, because it is refused before anything is read.

## The meter's unit

The input-equivalent token: input tokens as they are, cache writes at 1.25, cache reads at 0.1, output tokens at 5, rounded up per call. A deployment states its month in that unit; the day's share is a tenth.

## What counts as a break

A route removed or renamed, a field removed from `GET /chat` or from an event, an event removed, a code removed or its status changed, a bound tightened. A field or an event added is not.
