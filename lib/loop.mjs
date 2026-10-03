// One message answered. The shape and the meter refuse before the first call, so a refusal
// costs nothing; then at most MAX_ROUNDS tool rounds, each a full request to the model with the
// tool's answer cut to size, and a last request that forbids another call. Text is forwarded as
// it comes. A tool answer that is one entity, with an id and a url, is a cite: the widget links
// it, once per message however many rounds fetch it, and every entity a list answer named is a
// `names` event, so that the widget can link those names where the answer writes them. A diagram
// the host drew is a `diagram` event, and the model reads only what it holds. Usage is metered
// around every call, whatever the visitor's message turns out to be.
//
// A message is up to five calls, so a reservation taken once for the message would let sixty
// messages in flight carry the counters far past the ceiling before any reserve refused. Each
// call reserves the estimate for itself and settles it at once against what the call really
// cost, which is what §5 means by adding the usage after each call: the counters follow the
// calls and not the messages. A reserve refused between two rounds throws where it stands; the
// stream is open by then, so the HTTP layer makes it the last error event and no done follows.
//
// A message of no text and no call is an answer the visitor cannot read: the model at its last
// request, told only by the tool choice that it may call nothing more, answers that way when it
// still meant to call. The last request says so in words, and a silence is asked once more, as
// the last request, before the loop takes it for the answer; an answer the output limit cut is
// not a silence, and a second silence is what it is.
//
// Where the deployment checks its answers, the loop keeps what the check reads as it goes: the
// text it forwarded, every entity a tool returned, and for each the tool answer that carried it,
// cut where the model's was, so the evidence is exactly what the model saw. The check runs after
// the last `text` and before `done`, within its own budget, and a check that could not run sends
// nothing and takes nothing from the answer.
//
// A visitor who closes the tab is a socket that is gone, and every remaining round would be
// spent writing into it, so the signal the request carries reaches the model and is read between
// rounds: the loop stops where it stands, the meter is settled, and nothing more is emitted.
import { validateMessages, window, truncate, MAX_ROUNDS } from "./shape.mjs";
import { systemPrompt, DEFAULT_QUESTION_INDEX_CHARS, nameNote } from "./prompt.mjs";
import { params } from "./model.mjs";
import { units, ESTIMATE } from "./meter.mjs";

// get_entity answers the entity under `entity`, fetch answers it flat with `title`, and
// find_evidence answers the skill the evidence is for under `skill`. Each of the three is one
// entity with an id; a list, a schema or a refusal is not, and carries none of these keys bare.
const citeOf = (data) => {
  const e = data && !data.error ? (data.entity ?? data.skill ?? data) : null;
  return e && typeof e.id === "string"
    ? { id: e.id, title: e.title ?? e.name ?? e.id, type: e.type ?? null, url: e.url ?? null }
    : null;
};

// Every entity a tool named, whether or not the answer is about one of them. An answer that
// lists ten skills drawn on names ten entities the model holds, and a reader wants each of them
// where it lives; the cite above is one entity and cannot carry them. So a list answer — search
// results, a type's entities, the rows of a table of references — gives up the id and the name
// of everything in it, and the widget links those names where they appear in the text. What is
// emitted is what the model was shown, or what the entity it was shown references past the cap
// below, so a name in the answer is a name from here. An id is named once, however many edges
// reach it: a profile's evidence rows reach the same skill again and again, and counting each of
// them against the cap spent it on repeats.
const NAME_KEYS = ["results", "entities", "references", "rows", "evidence", "items", "edges", "nodes"];
export const NAME_CAP = 300;
export function namesIn(data, out = []) {
  if (!data || typeof data !== "object" || data.error) return out;
  // One entity's answer carries its lists under the entity itself: the skills an experience
  // drew on are rows of `entity.references`, not of anything at the top. So the one entity a
  // tool answered with is scanned too, which is how an answer listing what an engagement drew
  // on gets a link for each of them.
  for (const inner of [data.entity, data.skill]) if (inner && typeof inner === "object") namesIn(inner, out);
  if (out.length >= NAME_CAP) return out.slice(0, NAME_CAP);
  for (const key of NAME_KEYS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      // A type in a picture of the schemas is no entity the model page holds, and its title is a
      // word like role or value that prose uses for other things, so it is linked in the picture
      // alone, to its schema's file.
      if (key === "nodes" && row.type === "schema") continue;
      // A reference row is an edge: the entity at its far end is the one a reader wants, and
      // the near end is the entity they are already reading about.
      const id = row.id ?? row.entity?.id ?? row.to?.id ?? row.from?.id;
      const title = row.title ?? row.name ?? row.entity?.title ?? row.entity?.name ?? row.to?.title ?? row.to?.name ?? row.from?.name;
      if (typeof id === "string" && typeof title === "string" && title.length > 2 && !out.some((n) => n.id === id)) out.push({ id, title });
      if (out.length >= NAME_CAP) return out;
    }
  }
  return out;
}

// A call that found nothing: the host refused it, its answer is an error, or it is a list with
// no rows. An entity with no references is that entity and not nothing, so only a list at the
// top counts, never one inside an entity; a schema or a type list is neither and never counts.
const LIST_KEYS = ["results", "entities", "references", "evidence"];
export function foundNothing(r) {
  if (r.isError || !r.data || typeof r.data !== "object" || r.data.error) return true;
  if (r.data.entity || r.data.skill || typeof r.data.id === "string") return false;
  return LIST_KEYS.some((k) => Array.isArray(r.data[k]) && r.data[k].length === 0);
}

// A picture the host drew is the widget's to draw, not the model's to write: the source goes out
// as its own event, and the model reads only what the picture holds, by title and type, so it can say what
// the picture shows in names the widget links and cannot restate the picture. An answer without
// both a source and its nodes is no picture, and the model reads it as any tool's answer. The
// host's own links ride along on `links`, a key the event never carries: the widget draws the
// arrows itself and needs no list of them, so `links` is stripped where the picture becomes the
// `diagram` event and kept only for the note built from the same picture. The same holds for a
// picture of the schemas' `everyType`, what every other type declares and no arrow draws, and for
// the core the answer names, which the note gives so the model can say what the schemas are.
export function diagramOf(name, r) {
  const d = r && !r.isError ? r.data : null;
  if (name !== "diagram" || !d || typeof d.mermaid !== "string" || !Array.isArray(d.nodes)) return null;
  const nodes = d.nodes.filter((n) => n && typeof n.node === "string" && typeof n.id === "string" && typeof n.title === "string");
  if (!nodes.length) return null;
  const kept = new Set(nodes.map((n) => n.node));
  const links = Array.isArray(d.links) ? d.links.filter((l) => l && kept.has(l.from) && kept.has(l.to) && typeof l.label === "string") : [];
  const everyType = Array.isArray(d.everyType) ? d.everyType.filter((x) => x && typeof x.via === "string" && typeof x.to === "string" && typeof x.multiplicity === "string") : [];
  const core = typeof d.model?.core === "string" ? d.model.core : null;
  return { shape: d.shape, title: d.title ?? null, mermaid: d.mermaid, nodes, omitted: d.omitted ?? 0, links, ...(d.shape === "schema" ? { everyType, core } : {}) };
}

// The note reads no more than this many relations; a picture at the diagram cap can still draw
// more arrows than a sentence or two should name, and the rest is a count, not a guess.
const RELATIONS_CAP = 60;

export const diagramNote = (d) => {
  const nodeOf = new Map(d.nodes.map((n) => [n.node, n]));
  const links = d.links ?? [];
  const relations = links.slice(0, RELATIONS_CAP).map((l) => ({
    from: nodeOf.get(l.from)?.title, fromType: nodeOf.get(l.from)?.type,
    to: nodeOf.get(l.to)?.title, toType: nodeOf.get(l.to)?.type,
    label: l.label,
  }));
  const relationsOmitted = links.length - relations.length;
  return JSON.stringify({
    drawn: "The widget draws this diagram under your answer, the last one if you drew several. Write one or two sentences naming what it shows, by the titles in nodes, calling each by its type as given, and state only the relations listed in relations, as they are labeled, never another, and never write the diagram itself.",
    shape: d.shape, title: d.title ?? null, nodes: d.nodes.map((n) => ({ title: n.title, type: n.type })), edges: d.edges ?? 0, omitted: d.omitted ?? 0,
    relations, ...(relationsOmitted > 0 ? { relationsOmitted } : {}),
    // A picture of the schemas: the types each node is, the core they are declared in, and what
    // every other type declares, said once, since the picture draws no arrow for it.
    ...(d.shape === "schema" ? {
      schemas: `Each node is a type the schemas of core ${d.core ?? "(version not named)"} declare, and each relation a reference its schema declares, labeled with the field and how many one entity may hold; nested-in joins an owned type to its owner. Name the core version once. The picture is the answer: write two or three sentences, naming a few of the types and relations that carry its structure, never a list of every relation. In German core stays core, never Kern, and a schema deklariert, never erklärt.${d.everyType?.length ? " everyType lists what every other type also declares, which the picture leaves out: say it once, in a sentence of its own." : ""}`,
      everyType: d.everyType ?? [],
    } : {}),
    // A picture of a process: its arrows are gates and where a failed gate sends the work, and a
    // label is the seats that approve or decide, which a reader takes for owners unless told.
    ...(d.shape === "process" ? {
      process: "Each node is a phase, in the order the process passes through them, and each relation goes from the phase the work leaves to the phase it reaches. A relation whose label has no colon is a gate: the work moves on once the seats named in the label approve it. A seat is a role, whatever it is called: it approves the gate and owns nothing, so write that the seat approves the gate, or leave the seats out, and never that a phase or a seat owns, or is the owner of, another. A relation whose label has a colon is where a failed gate sends the work: before the colon the seat that decides, after it the outcomes; it may lead back to an earlier phase or stay in the same one. Where an outcome stops the process the picture shows a Stop node that is not a relation; do not name stops unless a tool said so. In German a gate is das Gate, and its seats geben es frei; a seat never besitzt.",
    } : {}),
  });
};

// An entity answer holds at most fifty edges a list, and an entity with more says so in its
// counts. The model still reads the rest of it — a table's cells are plain text in the answer,
// with no id beside them — so an answer can name a skill whose edge fell past the fifty, and the
// widget, holding no id for it, leaves that name plain. The outgoing edges past the cap are read
// here, from the host, a few pages at most: nothing of them goes to the model, and they cost no
// tokens, only the names that let the widget link what the answer writes.
const PAST_CAP_PAGE = 200;
const PAST_CAP_PAGES = 3;
export async function namesPastTheCap(host, data) {
  const e = data && !data.error ? data.entity : null;
  if (!e || typeof e.id !== "string" || !Array.isArray(e.references)) return [];
  const total = e.referenceCounts?.references;
  if (!(typeof total === "number" && total > e.references.length)) return [];
  const out = [];
  let cursor;
  try {
    for (let i = 0; i < PAST_CAP_PAGES; i++) {
      const r = await host.call("list_references", { entity: e.id, direction: "out", limit: PAST_CAP_PAGE, ...(cursor ? { cursor } : {}) });
      if (r.isError) break;
      namesIn(r.data, out);
      if (!r.data?.page?.hasMore || typeof r.data.page.nextCursor !== "string") break;
      cursor = r.data.page.nextCursor;
    }
  } catch {
    // A page the host could not give is a few names left plain, never an answer lost.
  }
  return out;
}

export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTION_INDEX_CHARS, verdict = null }, { messages, lang, signal }, emit) {
  const turns = window(validateMessages(messages));
  let spent = 0;
  const conv = turns.map((t) => ({ role: t.role, content: t.content }));
  const questions = await host.questions();
  const system = systemPrompt(host.instructions, lang, await host.types(), questions.titles, questionCap, questions.more, host.tools.some((t) => t.name === "diagram"));
  const note = nameNote(turns.at(-1).content);
  const cited = new Set();
  const named = new Set();
  let settled;
  let last;
  // A call between its reserve and its settle, so that an exception thrown in it — the model,
  // the host, the socket — still gives that one reservation back rather than leaving it booked.
  let outstanding = false;
  let askedAgain = false;
  // What the route keeps of this question, counted as the loop goes and handed back on the
  // answer and on the error alike; the widget's events never carry them.
  let callCount = 0, empty = 0, rounds = 0;
  /** @type {{ claims: number; unsupported: number } | null} */
  let counted = null;
  const signals = () => ({ cited: [...cited], calls: callCount, empty, rounds, ...(counted ?? {}) });
  // What the check reads: the text forwarded, each returned entity with every tool answer that
  // carried it, and every tool answer of the message, each as the model was given it.
  let said = "";
  const returned = new Map();
  const evidence = new Map();
  const toolAnswers = [];
  const heard = (entities, text) => {
    for (const { id, title } of entities) {
      if (!returned.has(id)) returned.set(id, { id, title });
      const texts = evidence.get(id) ?? [];
      if (!texts.includes(text)) evidence.set(id, [...texts, text]);
    }
  };

  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const final = round === MAX_ROUNDS;
      await meter.reserve(ESTIMATE);
      outstanding = true;
      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final }), (text) => { said += text; emit("text", { text }); }, { signal });
      last = msg;
      rounds++;
      const cost = units(msg.usage);
      spent += cost;
      settled = await meter.settle(ESTIMATE, cost);
      outstanding = false;
      const calls = msg.content.filter((c) => c.type === "tool_use");
      // The silent message is not pushed: the next request is this conversation again, as the
      // last request, with the note after whatever the model was last given.
      const silent = calls.length === 0 && msg.stop_reason !== "max_tokens" && !msg.content.some((c) => c.type === "text" && c.text.trim());
      if (silent && !askedAgain && !signal?.aborted) { askedAgain = true; round = MAX_ROUNDS - 1; continue; }
      if (final || calls.length === 0 || msg.stop_reason !== "tool_use") break;
      if (signal?.aborted) break;
      conv.push({ role: "assistant", content: msg.content });
      const results = [];
      for (const call of calls) {
        const r = await host.call(call.name, call.input);
        callCount++;
        if (foundNothing(r)) empty++;
        const cite = r.isError ? null : citeOf(r.data);
        // What the model is given of this answer: a picture's note, or the answer cut to size.
        const picture = diagramOf(call.name, r);
        const given = picture ? diagramNote({ ...picture, edges: r.data.edges ?? 0 }) : truncate(r.text);
        if (verdict) toolAnswers.push(given);
        if (verdict && cite) heard([cite], given);
        if (cite && !cited.has(cite.id)) { cited.add(cite.id); emit("cite", cite); }
        // A name is emitted once a message, and never for an entity the answer already cites:
        // the cite carries the same id, and the widget links it from either.
        const found = r.isError ? [] : namesIn(r.data);
        if (!r.isError) for (const n of await namesPastTheCap(host, r.data)) if (!found.some((f) => f.id === n.id)) found.push(n);
        const names = [];
        for (const n of found) {
          if (named.size >= NAME_CAP) break;
          if (named.has(n.id) || cited.has(n.id)) continue;
          named.add(n.id); names.push(n);
        }
        if (names.length) emit("names", { names });
        if (verdict) heard(found, given);
        if (picture) { const { links, everyType, core, ...event } = picture; emit("diagram", event); }
        results.push({ type: "tool_result", tool_use_id: call.id, content: given, is_error: r.isError });
      }
      // The naming note follows the tool answers, so the model reads it just before it writes.
      conv.push({ role: "user", content: [...results, { type: "text", text: note }] });
    }
  } catch (err) {
    err.signals = signals();
    throw err;
  } finally {
    if (outstanding) settled = await meter.settle(ESTIMATE, 0);
  }
  if (signal?.aborted) return { spent, ...signals() };
  const done = { model: host.provenance, spent, dayLeft: Math.max(0, meter.dayShare - settled.dayTokens) };
  // The output limit stopped the last call mid-sentence, which the visitor would otherwise read
  // as the answer ending there; the widget says so instead.
  if (last?.stop_reason === "max_tokens") done.cut = true;
  if (verdict && said.trim()) {
    const v = await verdict({ text: said, lang: lang ?? null, returned: [...returned.values()], evidence, answers: toolAnswers, calls: callCount, empty, signal });
    // A visitor who left while the check ran gets nothing more, and the answer is not kept as
    // checked.
    if (signal?.aborted) return { spent, ...signals() };
    if (v) {
      emit("verdict", v.event);
      counted = { claims: v.claims, unsupported: v.unsupported };
    }
  }
  emit("done", done);
  return { spent, ...signals() };
}
