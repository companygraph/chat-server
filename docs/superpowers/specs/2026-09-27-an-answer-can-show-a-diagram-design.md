# An answer can show a diagram — design

> Asked to paint the concepts, the chat answers that it cannot draw and gives a table. The model holds what a picture needs: the concepts' Relations with their cardinality, the phases of a process chained by their gates, every edge any entity draws. This design lets an answer show that picture: a tool on the MCP host builds Mermaid from the graph, the chat forwards it as its own event, and the widget draws it under the answer. The model writes the sentence around it and never a node or an edge.

Status: proposed. Decided on 2026-09-27 with the owner against this repository at `70620f3` (v0.13.6), `companygraph/mcp-server` at `eb9778f` (v0.30.4) and `robertblust/design` at `8258088` (v0.100.0), whose files were read. Five choices were made before the design and hold through it. The diagram shows in the chat's answers, not on the model pages. A tool builds it, not the Answerer, so every edge is one the model draws. Three shapes, `concepts`, `process` and a capped `neighborhood`. Mermaid is vendored in design and served from each site's own origin, loaded only when a first diagram arrives. The diagram reaches the widget as its own event, not as text the Answerer copies.

---

## 1. The gap

The prompt allows paragraphs, emphasis, code spans, lists and tables, and forbids code blocks; the widget's `md()` renders that subset and escapes the rest. A visitor who asks to see how the concepts relate, or how the Delivery process runs, receives a table of titles and a sentence saying no picture can be drawn. The relation is in the model and the answer loses it: a table of concepts shows each one, not the edges between them.

Letting the Answerer write Mermaid would close the gap and open another. The Answering process never lets a claim stand that no tool returned, and the Grounded Answer Rate measures that; an edge in a diagram is a claim, and a model copying or composing a diagram can draw one no tool answered. So the diagram is built where the edges are, and reaches the visitor without passing through the model's pen.

**What the change buys is a picture under an answer, every node an entity at the pinned commit and every edge one the model draws, for any client of the MCP host and not only the chat.**

## 2. The tool

`companygraph/mcp-server` gains a tool `diagram`. Its input is `shape`, one of `concepts`, `process` and `neighborhood`; `domain`, optional, for `concepts`; and `id`, required for `process` and `neighborhood`. It answers `{ shape, title, mermaid, nodes, omitted, model }`: the Mermaid source, the number of nodes drawn, the number of edges left out past the cap, and the model's commit as every answer carries it. The source is generated from the snapshot and never from prose. A node's id is a sanitized form of the entity's id, its label is the entity's title escaped for Mermaid, so that a title holding a quote, a bracket or `-->` stays a label, and every node is followed by a `click` line naming the entity's id, which the widget turns into a link (§5).

`concepts` is a `classDiagram`, one class per concept. Each row of a concept's Relations table is one association, the row's one edge by the qualifier rule, labeled with the row's Cardinality and, where it is filled, its As. With `domain`, the concepts whose domain is that one are drawn, and a concept outside it that one of them reaches is drawn as a bare class, so an edge is never hidden by the filter.

`process` is a `flowchart LR` for the one process `id` names. One node per phase, in the order of the process's Phases table, the node's second line naming who executes it; an arrow for each `gate-to`, labeled with the phase's gate approvers. The process's tracks do not name their phases, so they are not lanes: they are named in `title`, as in "Delivery · tracks Prose, Code". A process of one phase and no gate, as Answering is, is a diagram of one node.

`neighborhood` is a `flowchart LR` with the entity `id` names in the middle, the entities it references to the right and those that reference it to the left, one hop and no further. Edges are grouped by `via`, so ten evidence rows reaching one skill are one edge labeled `Evidence ×10`, and nesting draws as `nested-in`. At most fifty nodes are drawn; past that, the `via` groups with the fewest edges are dropped first, counted into `omitted`, and a last node reads "+N more", so the picture says what it left out.

Where there is nothing to draw, an unknown id, an id of the wrong type, a process with no phases, a domain with no concepts, the tool refuses with a typed `error.code` as every tool does, and `describe_errors` lists the codes. A source longer than 20,000 characters is refused as too large rather than truncated, since a truncated diagram draws edges that are not all there.

## 3. The event

The chat takes its tools from the host unchanged, so it sees `diagram` once its host pins the release that has it. The loop in `lib/loop.mjs` reads a `diagram` tool answer as it reads a cite: an answer with `mermaid` becomes a `diagram` event `{ shape, title, mermaid, nodes, omitted }`, at most one per message, the last such answer winning. What the model is shown of that tool answer is not the source but one line, that a diagram of N nodes, titled so, is shown under the answer, with N and the omitted count, so the model can say what the picture shows and cannot restate it. The source costs no input tokens after the call and no output tokens at all, and the output limit of 2,400 tokens is untouched.

`docs/INTERFACE.md` gains the row for `diagram` in the table of events. An event added is not a break.

## 4. The prompt

`lib/prompt.mjs` gains one sentence beside the Markdown subset: when the visitor asks to see how concepts relate, how a process runs, or how something connects, call `diagram`, write a sentence or two about what it shows and never the diagram itself, because the widget draws it under the answer. The rule that code blocks are not written stays as it is. Where the tool refuses, the Answerer answers in words and a table, as it does today.

## 5. The widget

`robertblust/design` vendors `mermaid.min.js`, the release pinned in `package.json` and copied into `assets/` by the sync that carries `chat.js`, with its MIT license beside it. `chat.js` handles the `diagram` event. It reserves a place under the answer's bubble, then, the first time in a page's life, adds a `<script>` for `mermaid.min.js` from the folder its own tag was loaded from, and renders once the script has loaded, with `startOnLoad: false`, `securityLevel: "strict"`, `theme: "base"` and theme variables read from the tokens at render time. A change of theme renders it again. The SVG sits in a box as wide as the bubble that scrolls sideways, captioned with `title`, and an Expand opens it full-screen as the stage's does on a phone.

The `click` lines are not given to Mermaid; `strict` ignores them. The widget reads the node ids from the source, finds each node in the SVG, and wraps it in a link to `link(model, id)`, the target the cite line uses. The source is kept with its answer in the tab's `sessionStorage`, so following a link and coming back draws the picture again.

When the script does not load or the source does not render, the place shows the source in a `<pre>` under one sentence in the page's language, that the diagram could not be drawn, and the answer stands. `rbChat` gains `diagramNodes(source)`, pure, returning the ids and titles the `click` lines name, and the strings gain the sentence and the Expand label in both languages.

No host is added: the script comes from the site's own origin, so the sentence at the head of `chat.js`, that the conversation reaches no server but the one the tag names, and the privacy pages stay true. Each site's third-party licenses page gains a row for Mermaid.

## 6. Tests

`mcp-server`: a generator test per shape against a fixture instance, comparing the whole Mermaid source; the cap, the dropping order and `omitted`; a title with a quote, a bracket and `-->`; a concept outside the domain drawn bare; and every refusal. `chat-server`, `test/loop.test.mjs`: a `diagram` answer emits one `diagram` event, a second in the same message replaces the first, the model is shown the line and not the source, and a refused `diagram` emits nothing; `test/prompt.test.mjs`: the sentence is present. `design`: `node --test` on `diagramNodes`, the fallback, and the stored conversation carrying the source; and a render in a browser on one site, light and dark, a node's link followed.

Before the chat's pull request, the local measurement runs control against change on the host of blust.ch with three questions, "paint me a diagram of the concepts", "show me the Delivery process" and "how does Claim connect?", and the answers are read, not scored.

## 7. Files

`mcp-server`: a `lib/diagram.mjs`, `lib/tools.mjs`, `lib/errors.mjs`, the tests, and the README's list of tools. `chat-server`: `lib/loop.mjs`, `lib/prompt.mjs`, `docs/INTERFACE.md`, the tests. `design`: `assets/chat.js`, `assets/chat.css`, `assets/mermaid.min.js` and its license, `package.json`, the tests. Each site: the re-pin and the licenses row.

## 8. Release and order

The tool first: an `mcp-server` release, and the three MCP hosts re-pinned to it, so the tool answers agents before the chat asks for it. Then `chat-server`'s event and sentence, released and re-pinned in the three chat deployments; until the widget knows the event it ignores it, and the answer reads as it does today. Then `design`'s widget and vendored script, released, and the re-pin wave on blust.ch, companygraph.io and guestgraph.io. Each merge and each release waits for the owner's word.

Left out: diagrams on the model's own pages and in the Obsidian plugin, and any shape but the three. A fourth shape is a new value of `shape` and needs nothing of this design changed.
