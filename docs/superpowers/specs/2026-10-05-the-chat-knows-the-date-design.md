# The chat knows the date and asks for what it needs — design

> Asked on blust.ch what Robert is working on today, the chat answered in general terms and said the model does not tell. The model does, in four experiences with no `end`, and companygraph/mcp-server now lets a list be kept to a date, ordered by one and kept to a value. This gives the chat today's date, the rules that use those arguments, a question rule that no longer stops at the model's nearest question, and pages that arrive whole.

Status: proposed. Decided on 2026-10-05 with the owner against this repository at `de96eef` (v0.28.0), together with companygraph/mcp-server's `2026-10-05-a-list-carries-its-facts-design.md`, whose arguments the rules here name.

---

## 1. What went wrong

Three things, each enough on its own. The question rule told the chat that a visitor's question that is one of the model's questions "in any language or wording" is answered from what that question rests on, and the chat read "what is Robert working on today?" as "What does Robert do?", which rests on no experience. The prompt holds no date, so even a chat that listed the experiences could not tell a running period from one that has not begun. And a tool answer is cut at 16,000 characters, while the experience list on that model, measured over a snapshot of it, is 19,904 characters without the facts a list now carries and 27,375 with them: the cut takes the end of the list and the `page` that says how to go on.

## 2. The changes

**The date.** The prompt says `Today is YYYY-MM-DD.`, the server's date in UTC, after the map of the model's types. `answer()` takes a `today` function, the clock by default, so a test can fix it. A date that changes once a day changes the prompt's cached prefix once a day.

**The rule for dates and values**, `FACTS_RULE`, stands right after the rule for a kind of thing, which it narrows. A question about now, today, currently or what is running is answered by `list_entities` with `on` set to today's date; one about the latest, the last or the first, by `by` and `order`; one about the things of one kind or status, by `where`. A list too long to read whole is narrowed with these before it is paged through. It is sent only where the host's `list_entities` takes all three, read from the tool's input schema, so a host on an older server reads exactly as before.

**The question rule** matches a question that asks the same thing as one of the model's, in any language or wording, and adds that a model question is where the answer starts, not all of it: where the visitor asks more than the question does, a time, a period, a number or a kind, the answer gets that too.

**Pages that arrive whole.** A call to `list_entities`, `list_references`, `search` or `find_evidence` that names no `limit`, or one above 50, is sent with `limit: 50`. The cut rises to 32,000 characters. The largest page of 50 over the three instances, with every entity's short facts, measured 24,348 characters at about 490 an entry, and the largest entry about 540, so a page of 50 fits with entries of up to 640. The page says how to go on, and the chat follows it, at most four rounds a message as before.

## 3. Cost

A tool answer can now be twice as long, and each later round of a message sends the earlier answers again, so the dearest message can cost more than before; the meter still reserves 30,000 a round and settles what each round cost, and the day's share and the month's ceiling still refuse what would pass them. Narrowing makes the common question cheaper: the running experiences come back in 1,898 characters where the whole list is 27,375.

## 4. Tests and measuring

`test/prompt.test.mjs` holds that the date and the rule come in only where given and that the prompt is unchanged without them, that the rule names `on` with today's date, `by` with `newest` and `where`, and that it stands after the rule for a kind of thing. `test/loop.test.mjs` holds that a list call is sent with a page that fits and a call of another tool as the model made it, and that the date reaches the prompt with the rule for a host whose list takes the arguments and without it for one that does not.

Measured on chat.blust.ch at v0.29.0 with mcp-server v0.58.0, on 2026-10-05: the owner's question, what Robert is working on today, named all four running experiences in two runs of four, and a variant asking for his current roles and projects in its one run. Both misses went one way: the chat matched the model's question "Is Robert studying anything now?" and answered from what it rests on alone. The rule for now stood before the question rule, and the question rule, read after it, won.

So the rule for now stands after the question rule and the rule for its kinds, as the exception to them, and says so: a question about now calls the list on today's date first even where it also matches one of the model's questions, and that question's entities are added beside the list, never in its place. Measured on chat.blust.ch at v0.29.1 with mcp-server v0.58.0, on 2026-10-06, five runs each. What Robert is working on today named all four running experiences in five of five, and what he is doing at the moment in five of five; in two of those the chat still matched the model's question about studying now and added its entities beside the list. His latest role named IT Architect in three of five: one run named his latest talk, and one read role as the model's own type, the seats of its processes. Which decisions are standing listed the seventeen with that status in five of five. His whole work history was answered in five of five as his roles in order, kept with `where` on `kind` and dated from their facts, all eight in three runs and all but the career break in two; one of the five opened with a sentence about what it was going to call, which the rule against a preface forbids.

Two questions stay open: a role of a person against the model's own `role` type, and a preface the rule did not stop.

## 5. Release

The next minor: the date, the rules and the page size change what the chat does and nothing a deployment configures. It waits for the mcp-server release, since a host without the arguments gets the date and the question rule and none of the rest. The MCP hosts re-pin both.
