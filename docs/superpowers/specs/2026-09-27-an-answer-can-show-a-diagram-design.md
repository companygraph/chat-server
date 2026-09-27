# An answer can show a diagram — design

> Asked to paint the concepts, the chat answers that it cannot draw and gives a table. The model holds what a picture needs: the concepts' Relations with their cardinality, the phases of a process chained by their gates, every edge any entity draws. This design lets an answer show that picture: a tool on the MCP host builds Mermaid from the graph, the chat forwards it as its own event, and the widget draws it under the answer. The model writes the sentence around it and never a node or an edge.

Status: proposed. Decided on 2026-09-27 with the owner against this repository at `70620f3` (v0.13.6), `companygraph/mcp-server` at `eb9778f` (v0.30.4) and `robertblust/design` at `8258088` (v0.100.0), whose files were read. Five choices were made before the design and hold through it. The diagram shows in the chat's answers, not on the model pages. A tool builds it, not the Answerer, so every edge is one the model draws. Three shapes, `concepts`, `process` and a capped `neighborhood`. Mermaid is vendored in design and served from each site's own origin, loaded only when a first diagram arrives. The diagram reaches the widget as its own event, not as text the Answerer copies.

---

## 1. The gap

The prompt allows paragraphs, emphasis, code spans, lists and tables, and forbids code blocks; the widget's `md()` renders that subset and escapes the rest. A visitor who asks to see how the concepts relate, or how the Delivery process runs, receives a table of titles and a sentence saying no picture can be drawn. The relation is in the model and the answer loses it: a table of concepts shows each one, not the edges between them.

Letting the Answerer write Mermaid would close the gap and open another. The Answering process never lets a claim stand that no tool returned, and the Grounded Answer Rate measures that; an edge in a diagram is a claim, and a model copying or composing a diagram can draw one no tool answered. So the diagram is built where the edges are, and reaches the visitor without passing through the model's pen.

**What the change buys is a picture under an answer, every node an entity at the pinned commit and every edge one the model draws, for any client of the MCP host and not only the chat.**

## 2. The tool

`companygraph/mcp-server` gains a tool `diagram`. Its input is `shape`, one of `concepts`, `process` and `neighborhood`; `domain`, optional, the id of a domain, for `concepts`; and `id`, required for `process` and `neighborhood`. It answers `{ shape, title, mermaid, nodes, edges, omitted, model }`. `title` is the name of what the diagram is of, the process, the entity or the domain, and null for every concept, so it carries no word of any one language and the widget captions it in the page's. `mermaid` is the source, generated from the snapshot and never from prose. `nodes` lists what was drawn, each `{ node, id, title, type }`, `node` being the source's name for it, `n0`, `n1` and on in the order drawn, so that nothing in the source has to be read back to link it. `edges` counts the edges drawn and `omitted` those left out past the cap. `model` is the commit, as every answer carries it. A label is the entity's title escaped for Mermaid, so that a title holding a quote, a bracket, a `#` or `-->` stays a label.

`concepts` is a `classDiagram`, one class per concept. Each edge a concept's Relations table draws, `Relations.Concept` with its Cardinality and As as qualifiers, is one association, labeled with the Cardinality and, where it is filled, the As. With `domain`, the concepts whose `domain` names that one are drawn, and a concept outside it that one of them reaches is drawn too, annotated with its own domain's name, so an edge is never hidden by the filter.

`process` is a `flowchart LR` for the one process `id` names. One node per phase, in the order of the process's Phases table, since its `Phases.Phase` edges carry no order, the node's second line naming who executes it; an arrow for each `gate-to` between two drawn phases, labeled with the phase's gate approvers. A process of one phase and no gate, as Answering is, is a diagram of one node.

`neighborhood` is a `flowchart LR` with the entity `id` names in the middle, the entities it references to one side and those that reference it to the other, one hop and no further. The edges between the middle and one entity by one `via` are one arrow, labeled with the `via` and, where there are several, how many, so ten rows reaching one skill are one arrow labeled `Evidence.Skill ×10`; nesting draws as `nested-in`. At most fifty nodes are drawn besides the middle. The `via` groups are taken smallest first, each whole, while they fit; a group that does not fit is left out whole, its edges counted into `omitted`, and a last node reads "+N" with the `via` of each group left out, so the picture says what it left out and the many kinds of connection an entity has are seen before the one it has most of.

A `concepts` or `process` diagram over fifty nodes is refused rather than cut, since a cut diagram draws edges that are not all there, and a `domain` narrows the first. So is one with nothing to draw: a domain with no concepts, a process with no phases. Both are the new code `cannot_draw`, its details `{ shape, reason, nodes, limit }` with `reason` one of `too_large` and `empty`. An unknown id is `unknown_entity`, an id of the wrong type `invalid_argument` on `id` or `domain`, and a core without the `concept` or `phase` type `unknown_type`, as every tool refuses them, and `describe_errors` lists them all.

## 3. The event

The chat takes its tools from the host unchanged, so it sees `diagram` once its host pins the release that has it. The loop in `lib/loop.mjs` reads a `diagram` tool answer as it reads a cite: an answer with `mermaid` becomes a `diagram` event `{ shape, title, mermaid, nodes, omitted }`, and the widget draws the last one a message brings. What the model is shown of that tool answer is not the source but what it drew: the shape, the title, the titles of the nodes, how many edges and how many left out, and that it is drawn under the answer. So the model can say what the picture shows, in the names the widget links, and cannot restate the picture. The nodes are also a `names` event, as a list answer's entities are, so a title the answer writes is linked. The source costs no output tokens, and the output limit of 2,400 tokens is untouched.

`docs/INTERFACE.md` gains the row for `diagram` in the table of events. An event added is not a break.

## 4. The prompt

`lib/prompt.mjs` gains one sentence beside the Markdown subset: when the visitor asks to see how concepts relate, how a process runs, or how something connects, call `diagram`, write a sentence or two about what it shows and never the diagram itself, because the widget draws it under the answer. The rule that code blocks are not written stays as it is. Where the tool refuses, the Answerer answers in words and a table, as it does today.

## 5. The widget

`robertblust/design` vendors `mermaid.min.js` from Mermaid 12.0.0 unmodified, 5.6 MB and 1.6 MB compressed, in the `chat` group beside `chat.js`, with its MIT license beside it; the bundle carries its dependencies' notices inline. `chat.js` handles the `diagram` event. It reserves a place under the answer's bubble, then, the first time in a page's life, adds a `<script>` for `mermaid.min.js` from the folder its own tag was loaded from, and renders once the script has loaded, with `startOnLoad: false`, `securityLevel: "strict"`, `theme: "base"` and theme variables read from the tokens at render time. A change of theme renders it again. The SVG sits in a box as wide as the bubble that scrolls sideways, captioned with the shape in the page's language and the `title` after it, and an Expand opens it full-screen as the stage's does on a phone.

The source holds no `click` line, which `strict` would ignore. The widget finds each of `nodes` in the SVG by its `node` name and makes it a link to `link(model, id)`, the target the cite line uses. The source is kept with its answer in the tab's `sessionStorage`, so following a link and coming back draws the picture again.

When the script does not load or the source does not render, the place shows the source in a `<pre>` under one sentence in the page's language, that the diagram could not be drawn, and the answer stands. `rbChat` gains `mermaidConfig(styles)`, pure, the configuration read from the tokens, and `nodeElement(svg, node)`, the one place that knows how Mermaid names a node in its SVG; the strings gain the three shapes' captions, the sentence and the Expand label in both languages.

No host is added: the script comes from the site's own origin, so the sentence at the head of `chat.js`, that the conversation reaches no server but the one the tag names, and the privacy pages stay true. The license travels in the `chat` group beside the script, as d3's does in the `stage` group, design's NOTICE names it, and each site's README names the file among those it does not write.

## 6. Tests

`mcp-server`: a generator test per shape against a fixture instance, comparing the whole Mermaid source; the cap, the order groups are left out in and `omitted`; a title with a quote, a bracket, a `#` and `-->`; a concept outside the domain drawn with its domain's name; and every refusal, `cannot_draw` among them. `chat-server`, `test/loop.test.mjs`: a `diagram` answer emits a `diagram` event and its nodes as names, the model is shown the titles and not the source, and a refused `diagram` emits nothing; `test/prompt.test.mjs`: the sentence is present. `design`: `node --test` on `mermaidConfig`; and in Chromium through Playwright, which the suite already drives, the vendored script rendering the three shapes and a title with every escaped character, each node found by `nodeElement` and linked, the fallback when the script is missing, and the stored conversation drawing the picture again. Then a look on one site, light and dark, a node's link followed.

Before the chat's pull request, the local measurement runs control against change on the host of blust.ch with three questions, "paint me a diagram of the concepts", "show me the Delivery process" and "how does Claim connect?", and the answers are read, not scored.

## 7. Files

`mcp-server`: a `lib/diagram.mjs`, `lib/tools.mjs`, `lib/errors.mjs`, `lib/schemas.mjs`, `lib/contract.mjs`, `scripts/interface.mjs`, `docs/INTERFACE.md`, the tests, and the README's list of tools. `chat-server`: `lib/loop.mjs`, `lib/prompt.mjs`, `docs/INTERFACE.md`, the pin of `companygraph-mcp-server` its tests run against, the tests. `design`: `assets/chat.js`, `assets/chat.css`, `assets/mermaid.min.js` and `assets/mermaid.LICENSE.txt`, `lib/groups.mjs`, `NOTICE`, `README.md`, the tests. Each site: the re-pin, and the README's License paragraph naming `mermaid.min.js`.

## 8. Release and order

The tool first: an `mcp-server` release, and the three MCP hosts re-pinned to it, so the tool answers agents before the chat asks for it. Then `chat-server`'s event and sentence, released and re-pinned in the three chat deployments; until the widget knows the event it ignores it, and the answer reads as it does today. Then `design`'s widget and vendored script, released, and the re-pin wave on blust.ch, companygraph.io and guestgraph.io. Each merge and each release waits for the owner's word.

Left out: diagrams on the model's own pages and in the Obsidian plugin, and any shape but the three. A fourth shape is a new value of `shape` and needs nothing of this design changed.
