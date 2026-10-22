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
// the last request with an empty tool list, since the same request again was answered the same
// way and a model with nothing to call writes; an answer the output limit cut is not a silence, and
// a second silence is what it is.
//
// Where the deployment checks its answers, the loop keeps what the check reads as it goes: the
// text it forwarded, every entity a tool returned, and for each the tool answer that carried it,
// cut where the model's was, so the evidence is exactly what the model saw. The check runs after
// the last `text` and before `done`, within its own budget, and a check that could not run sends
// nothing and takes nothing from the answer.
//
// The model and effort are the request's choice, which the route has already checked against the
// reader's grants: they reach every request, set how long a call may run, and are named in
// `done`. A signed-in reader's call is held on the site's month, never the day's share, which is
// the visitors', and on the reader's own month; a reader refused there gives the site's hold back
// before the refusal goes on, so a refused message has cost nothing anywhere. A model that
// declines a question, as the dearer ones' classifiers may, ends the message with a refusal of its
// own, read from the stop reason before anything of the round is used.
//
// A visitor who closes the tab is a socket that is gone, and every remaining round would be
// spent writing into it, so the signal the request carries reaches the model and is read between
// rounds: the loop stops where it stands, the meter is settled, and nothing more is emitted.
import { validateMessages, window, truncate, MAX_ROUNDS, pageSized } from "./shape.mjs";
import { ChatError } from "./errors.mjs";
import { systemPrompt, DEFAULT_QUESTION_INDEX_CHARS, nameNote, LANGS } from "./prompt.mjs";
import { languageOf } from "./verdict.mjs";
import { params } from "./model.mjs";
import { units, estimateFor } from "./meter.mjs";
import { DEFAULT_CHOICE, callTimeoutMs } from "./models.mjs";

/**
 * @import Anthropic from "@anthropic-ai/sdk"
 * @import { Host, Title, Provenance } from "./host.mjs"
 * @import { Model } from "./model.mjs"
 * @import { Meter, ReaderMeter, RolledDoc } from "./meter.mjs"
 * @import { Choice } from "./models.mjs"
 * @import { Signals } from "./errors.mjs"
 * @import { Message } from "./shape.mjs"
 * @import { verdictCheck } from "./verdict.mjs"
 */

// A host's answers are the tools' own JSON. It is read defensively wherever it is used, each key
// asked for and its type checked first, so what a reader here holds of it is `any` where it
// enters and a named type once a key has been checked.

/**
 * The one entity a tool answered with, which the widget links.
 * @typedef {{ id: string; title: string; type: string | null; url: string | null }} Cite
 */
/**
 * A picture the host drew, as the `diagram` event and the note carry it. diagramOf checks the
 * source, each node's three keys, each link and each row of everyType; the shape, the title, the
 * count left out, a node's type and the count of edges are the host's, held by the diagram tool's
 * output schema. A picture of the schemas' `unit` and each row of its `units` are checked as well. A lifecycle's `transitions` are checked too, since a state is no node a link joins,
 * and a scenario's `steps` and `extensions`, since a step is a box and no node.
 * @typedef {{ aggregate: string; from: string | null; to: string; command: string | null }} Transition
 * @typedef {{ step: string; actor: string; action: string }} Step
 * @typedef {{ step: string; condition: string; handling: string }} Extension
 * @typedef {{ shape: string; title: string | null; mermaid: string; nodes: { node: string; id: string; title: string; type?: string }[]; omitted: number; links: { from: string; to: string; label: string }[]; everyType?: { via: string; to: string; multiplicity: string }[]; core?: string | null; unit?: string; units?: { unit: string; types: number }[]; transitions?: Transition[]; steps?: Step[]; extensions?: Extension[]; actor?: string; edges?: number }} Diagram
 */
// get_entity answers the entity under `entity`, fetch answers it flat with `title`, and
// find_evidence answers the skill the evidence is for under `skill`. Each of the three is one
// entity with an id; a list, a schema or a refusal is not, and carries none of these keys bare.
/**
 * @param {any} data
 * @returns {Cite | null}
 */
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
// them against the cap spent it on repeats. An entity's answer lists the edges that reach it as
// `referencedBy`, whose far end is where the edge starts: what a context holds and what draws on
// it are named there, and a title the model was shown there and not named here was counted
// against the answer as one no tool returned.
const NAME_KEYS = ["results", "entities", "references", "referencedBy", "rows", "evidence", "items", "edges", "nodes"];
export const NAME_CAP = 300;
/**
 * @param {any} data
 * @param {Title[]} [out]
 * @returns {Title[]}
 */
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
      const far = key === "referencedBy" ? row.from : row.to ?? row.from;
      const id = row.id ?? row.entity?.id ?? far?.id;
      const title = row.title ?? row.name ?? row.entity?.title ?? row.entity?.name ?? far?.title ?? far?.name;
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
/** @param {{ isError?: boolean; data?: any }} r */
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
// the core the answer names, which the note gives so the model can say what the schemas are, and
// for a lifecycle's `transitions`, the steps between states, a scenario's `steps` and `extensions`
// and a use case's `actor`, which the widget reads from the source.
/**
 * @param {string} name
 * @param {{ isError?: boolean; data?: any } | null | undefined} r
 * @returns {Diagram | null}
 */
export function diagramOf(name, r) {
  const d = r && !r.isError ? r.data : null;
  if (name !== "diagram" || !d || typeof d.mermaid !== "string" || !Array.isArray(d.nodes)) return null;
  const nodes = /** @type {Diagram["nodes"]} */ (d.nodes.filter((/** @type {any} */ n) => n && typeof n.node === "string" && typeof n.id === "string" && typeof n.title === "string"));
  // A scenario's boxes are steps, no entity, so one whose actors are no seat lists no node and
  // is a picture all the same; any other shape without a node is nothing to draw.
  if (!nodes.length && d.shape !== "scenario") return null;
  const kept = new Set(nodes.map((n) => n.node));
  const links = Array.isArray(d.links) ? d.links.filter((/** @type {any} */ l) => l && kept.has(l.from) && kept.has(l.to) && typeof l.label === "string") : [];
  const everyType = Array.isArray(d.everyType) ? d.everyType.filter((/** @type {any} */ x) => x && typeof x.via === "string" && typeof x.to === "string" && typeof x.multiplicity === "string") : [];
  const core = typeof d.model?.core === "string" ? d.model.core : null;
  // The unit of the meta-model a picture of the schemas draws, where it draws one, and every
  // unit there is with how many types it declares.
  const unit = typeof d.unit === "string" && d.unit ? d.unit : null;
  const units = Array.isArray(d.units) ? d.units.filter((/** @type {any} */ u) => u && typeof u.unit === "string" && typeof u.types === "number") : [];
  /** @param {unknown} v */
  const blankOr = (v) => v == null || typeof v === "string";
  const transitions = Array.isArray(d.transitions) ? d.transitions.filter((/** @type {any} */ t) => t && typeof t.aggregate === "string" && typeof t.to === "string" && blankOr(t.from) && blankOr(t.command)) : [];
  /** @param {string[]} keys @param {unknown} v */
  const allStrings = (keys, v) => !!v && typeof v === "object" && keys.every((k) => typeof (/** @type {Record<string, unknown>} */ (v))[k] === "string");
  const steps = /** @type {Step[]} */ (Array.isArray(d.steps) ? d.steps.filter((/** @type {unknown} */ x) => allStrings(["step", "actor", "action"], x)) : []);
  const extensions = /** @type {Extension[]} */ (Array.isArray(d.extensions) ? d.extensions.filter((/** @type {unknown} */ x) => allStrings(["step", "condition", "handling"], x)) : []);
  const actor = typeof d.actor === "string" ? d.actor : "";
  return { shape: d.shape, title: d.title ?? null, mermaid: d.mermaid, nodes, omitted: d.omitted ?? 0, links, ...(d.shape === "schema" ? { everyType, core, ...(unit ? { unit } : {}), units } : {}), ...(d.shape === "lifecycle" ? { transitions } : {}), ...(d.shape === "scenario" ? { steps, extensions } : {}), ...(d.shape === "usecase" ? { actor } : {}) };
}

// A question of the model's says where its answer lies and holds none of it: its page names the
// entities it rests on, each with the part of the answer it carries, and gives nothing of what
// their pages say. Read alone it looks like an answer, and the chat wrote one from it, true and
// thin, without opening a page: asked what is kept of a message it said that a question is kept
// and never for how long. So the question's own tool answer ends with a note that names each
// page it rests on, by title, type and id, and asks for them before the answer is written. The
// rule in the prompt says the same once and far from the moment; the note says it where the
// model has just read the page that tempts it to stop.
/**
 * The entities a question rests on, read off get_entity's answer: each `Rests on` reference
 * once, in the answer's order. Empty for anything that is no question, for a question mastered
 * on its own page, for fetch, which carries no references, and for a refusal.
 * @param {string} name
 * @param {{ isError?: boolean; data?: any } | null | undefined} r
 * @returns {{ id: string; title: string; type: string | null }[]}
 */
export function restsOf(name, r) {
  const e = name === "get_entity" && r && !r.isError ? r.data?.entity : null;
  if (!e || e.type !== "question" || !Array.isArray(e.references)) return [];
  /** @type {{ id: string; title: string; type: string | null }[]} */
  const out = [];
  for (const x of e.references) {
    const to = x && typeof x.via === "string" && x.via.startsWith("Rests on.") ? x.to : null;
    if (!to || typeof to.id !== "string" || out.some((o) => o.id === to.id)) continue;
    out.push({ id: to.id, title: typeof to.name === "string" && to.name ? to.name : to.id, type: typeof to.type === "string" ? to.type : null });
  }
  return out;
}
/** @param {{ id: string; title: string; type: string | null }[]} rests */
export const restsNote = (rests) => (rests.length
  ? `This is one of the model's questions: its page says where the answer lies and is not the answer. Before you answer, call get_entity on each entity it rests on that this message has not read, and write the answer from what those pages say. They are: ${rests.map((r) => `${r.title}${r.type ? ` (${r.type})` : ""}, id ${r.id}`).join("; ")}.`
  : "");

// What a flow's and a lifecycle's note ask of each relation: its says, said in words.
const SAYS_IN_WORDS = "Each relation's says states it as the picture draws it. State each relation as its says states it, in the answer's language, in words.";

// The note reads no more than this many relations; a picture at the diagram cap can still draw
// more arrows than a sentence or two should name, and the rest is a count, not a guess.
const RELATIONS_CAP = 60;

/** @param {Diagram} d */
export const diagramNote = (d) => {
  const nodeOf = new Map(d.nodes.map((n) => [n.node, n]));
  const links = d.links ?? [];
  // A context map's label packs a direction into text, so a context relation names its roles and
  // carries the sentence that states it. Only the patterns the pack declares are worded; any
  // other label keeps the plain form, and says nothing it cannot back.
  const DOWN = "U → D · ";
  /** @type {Record<string, (a: string | undefined, b: string | undefined) => string>} */
  const SYMMETRIC = {
    "partnership": (a, b) => `${a} and ${b} are partners`,
    "shared kernel": (a, b) => `${a} and ${b} share a kernel`,
    "separate ways": (a, b) => `${a} and ${b} go separate ways`,
  };
  // An aggregate's arrows are the root holding its members, drawn with composition cardinalities,
  // so each one is worded as what the root holds, in words, and emits names an event the aggregate emits.
  /** @type {Record<string, (a: string | undefined, b: string | undefined) => string>} */
  const HOLDS = {
    "1": (a, b) => `${a} holds exactly one ${b}`,
    "0..1": (a, b) => `${a} holds at most one ${b}`,
    "*": (a, b) => `${a} holds any number of ${b}`,
    "1..*": (a, b) => `${a} holds one or more ${b}`,
    "": (a, b) => `${a} holds ${b}`,
  };
  // A system's lines carry the model's word for each, and two read backwards as drawn: part-of
  // runs from the part to its host, provided-by from the system to its service. So each is said
  // from the system's side, and an access token says whose copy of the data it is.
  /** @type {Record<string, (a: string | undefined, b: string | undefined) => string>} */
  const SYSTEM = {
    "part-of": (a, b) => `${a} runs on ${b}`,
    "provided-by": (a, b) => `${a} provides the service ${b}`,
    "master": (a, b) => `${a} holds the master copy of ${b}`,
    "writes": (a, b) => `${a} writes a copy of ${b}`,
    "reads": (a, b) => `${a} reads ${b}`,
  };
  // A use case's lines carry the field or section that drew them, and a requirement's arrow is
  // drawn into what it applies to, so each is said from the side the word names: the use case
  // includes and asks, the requirement applies and follows, and an unlabeled arrow into the use
  // case is its primary actor.
  /** @type {Record<string, (a: string | undefined, b: string | undefined) => string>} */
  const REQ = {
    "includes": (a, b) => `${a} includes ${b}`,
    "features": (a, b) => `${a} asks something of the feature ${b}`,
    "Applies to": (a, b) => `${a} applies to ${b}`,
    "follows": (a, b) => `${a} follows the rule ${b}`,
    "": (a, b) => `${a} is the primary actor of ${b}`,
  };
  /** @type {Record<string, (a: string, b: string) => string>} */
  const ORG = {
    "part-of": (a, b) => `${b} answers to ${a}`,
    "Staff": (a, b) => `${b} serves ${a} as staff`,
    "staff": (a, b) => `${b} serves ${a} from beside, as a staff unit`,
  };
  // A reference of the schemas is drawn from the type that declares it to the type it names, and
  // two types can name each other, so each is said from the declaring side with how many it names
  // in words. A label is the field, or Section.Column, and then the multiplicity.
  /** @type {Record<string, string>} */
  const MANY = { "1": "exactly one", "0..1": "at most one", "0..*": "any number of", "1..*": "one or more" };
  /** @param {string} label */
  const declaredOf = (label) => {
    const m = /^(.+) (\d+)(?:\.\.(\d+|\*))?$/.exec(label);
    if (!m) return null;
    const dot = m[1].indexOf(".");
    const many = m[3] === undefined ? m[2] : `${m[2]}..${m[3]}`;
    return {
      where: dot < 0 ? `the field ${m[1]}` : `the column ${m[1].slice(dot + 1)} of its section ${m[1].slice(0, dot)}`,
      many: MANY[many] ?? (m[3] === undefined ? m[2] : m[3] === "*" ? `${m[2]} or more` : `${m[2]} to ${m[3]}`),
    };
  };
  /** @param {string} node */
  const nameOf = (node) => {
    const n = nodeOf.get(node);
    return n?.type === "job" ? `the open ${n.title} position` : n?.type === "group" ? `the unit ${n.title}` : String(n?.title);
  };
  /** @param {Diagram["links"][number]} l */
  const relationOf = (l) => {
    const from = nodeOf.get(l.from)?.title, to = nodeOf.get(l.to)?.title;
    if (d.shape === "schema" && typeof l.label === "string") {
      if (l.label === "nested-in") return { from, to, label: l.label, says: `every ${from} is nested in one ${to}, its owner` };
      const declared = declaredOf(l.label);
      if (declared) return { from, to, label: l.label, says: `${from} declares ${declared.where}, which names ${declared.many} ${to}` };
    }
    if (d.shape === "aggregate" && typeof l.label === "string") {
      if (Object.hasOwn(HOLDS, l.label)) return { holder: from, held: to, says: HOLDS[l.label](from, to) };
      if (l.label === "emits") return { emitter: from, event: to, says: `${from} emits ${to}` };
    }
    // A flow's arrow is an aggregate emitting an event, labeled with the command that makes it emit
    // and, where the command has several outcomes, the When of this one after a middle dot.
    if (d.shape === "flow" && typeof l.label === "string") {
      const at = l.label.indexOf(" · ");
      const command = at < 0 ? l.label : l.label.slice(0, at), when = at < 0 ? null : l.label.slice(at + 3);
      return { emitter: from, event: to, command, when, says: `${from} emits ${to} on ${command}${when ? ` when ${when}` : ""}` };
    }
    // An organization's line is labeled with the model's word for it, which reads backwards as a
    // relation: part-of sits on the arrow drawn from the upper lead down. So each is said in words,
    // the lower answering to the upper, and a box of type job, an open position, is named as one.
    if (d.shape === "organization" && typeof l.label === "string" && Object.hasOwn(ORG, l.label)) {
      return { from: nameOf(l.from), to: nameOf(l.to), label: l.label, says: ORG[l.label](nameOf(l.from), nameOf(l.to)) };
    }
    // A system's picture: a line with the model's word is said from the system's side, and an
    // arrow between two systems is the data one takes from the other, over the interface it names.
    if ((d.shape === "system" || d.shape === "holds") && typeof l.label === "string") {
      if (Object.hasOwn(SYSTEM, l.label)) return { from, to, label: l.label, says: SYSTEM[l.label](from, to) };
      if (nodeOf.get(l.from)?.type === "system" && nodeOf.get(l.to)?.type === "system") return { from, to, label: l.label, says: `${to} takes data from ${from}${l.label ? ` over ${l.label}` : ""}` };
    }
    if ((d.shape === "usecase" || d.shape === "requirements") && typeof l.label === "string" && Object.hasOwn(REQ, l.label)) {
      return { from, to, label: l.label, says: REQ[l.label](from, to) };
    }
    if (d.shape === "context" && typeof l.label === "string") {
      if (l.label.startsWith(DOWN)) {
        const pattern = l.label.slice(DOWN.length);
        const says = pattern === "conformist"
          ? `${to} conforms to ${from}, its upstream`
          : `${to} is downstream of ${from}, and the two relate as ${pattern}`;
        return { upstream: from, downstream: to, pattern, says };
      }
      if (Object.hasOwn(SYMMETRIC, l.label)) return { between: [from, to], pattern: l.label, says: SYMMETRIC[l.label](from, to) };
    }
    return { from, fromType: nodeOf.get(l.from)?.type, to, toType: nodeOf.get(l.to)?.type, label: l.label };
  };
  // A lifecycle draws no arrow between nodes: its relations are its transitions, a blank From the
  // state an aggregate starts in, and a blank command a step the aggregate takes on its own.
  /** @param {Transition} t */
  const transitionOf = (t) => ({ ...t, says: `${t.aggregate} ${t.from ? `moves from ${t.from} to` : "starts in"} ${t.to}${t.command ? ` on ${t.command}` : ""}` });
  // A scenario draws boxes that are no entity: its relations are its steps in order, then its
  // extensions, each with the step it departs from, which is its number without its letter.
  /** @param {Step} s */
  const stepOf = (s) => ({ ...s, says: `Step ${s.step}: ${s.actor}, ${s.action}` });
  /** @param {Extension} x */
  const extensionOf = (x) => ({ ...x, says: `Extension ${x.step} departs from step ${x.step.replace(/[a-z]+$/, "")}. Condition: ${x.condition}. Then: ${x.handling}` });
  const stepNumbers = new Set((d.steps ?? []).map((s) => s.step));
  // An extension naming no step was left out of the picture, so it is not stated as departing from one.
  const steps = d.shape === "lifecycle" ? (d.transitions ?? []).map(transitionOf)
    : d.shape === "scenario" ? [...(d.steps ?? []).map(stepOf), ...(d.extensions ?? []).filter((x) => stepNumbers.has(x.step.replace(/[a-z]+$/, ""))).map(extensionOf)] : null;
  // A use case's actor that is no seat is a box and no node, so its arrow is no link; the answer
  // names it, and the note states it first, as the seat's link would have.
  const actor = d.shape === "usecase" && d.actor && !d.nodes.some((n) => n.title === d.actor) ? [{ actor: d.actor, says: REQ[""](d.actor, d.title ?? undefined) }] : [];
  // A unit's picture draws every nesting and every reference of the unit's own types, so the note
  // groups them: the types an owner nests, the types nested in none, and the types that declare a
  // field several declare. Each group is closed, which the note's line says once and no sentence
  // repeats, since an answer copies a sentence as an item of its list.
  /** @param {string[]} xs */
  const listed = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const groups = () => {
    const own = d.nodes.filter((n) => n.id.startsWith(`${d.unit}/`));
    const mine = new Set(own.map((n) => n.node)), nested = new Set();
    /** @type {Map<string, string[]>} */
    const owned = new Map();
    /** @type {Map<string, { where: string; to: string; by: string[] }>} */
    const fields = new Map();
    for (const l of links) {
      if (!mine.has(l.from)) continue;
      const from = String(nodeOf.get(l.from)?.title), to = String(nodeOf.get(l.to)?.title);
      if (l.label === "nested-in") { nested.add(l.from); owned.set(to, [...(owned.get(to) ?? []), from]); continue; }
      const declared = declaredOf(l.label);
      if (!declared) continue;
      const key = `${declared.where}\n${to}`, field = fields.get(key) ?? { where: declared.where, to, by: [] };
      fields.set(key, { ...field, by: [...field.by, from] });
    }
    const top = own.filter((n) => !nested.has(n.node)).map((n) => n.title).sort();
    return {
      owns: [
        ...[...owned].sort(([a], [b]) => (a < b ? -1 : 1)).map(([owner, types]) => `${owner} owns ${listed(types.sort())}`),
        ...(top.length ? [`${listed(top)} ${top.length === 1 ? "is" : "are"} nested in no type`] : []),
      ],
      shared: [...fields.values()].filter((f) => f.by.length > 1).map((f) => `${listed(f.by.sort())} each declare ${f.where}, which names ${f.to}`),
    };
  };
  // What every other type declares is drawn by no arrow and said once, after the list. Written by
  // the model in its own words, a true sentence of it read to the check as one the note does not
  // carry, so it comes with its sentence, as a relation does. A row whose multiplicity is in no
  // form read here has none, and the line then asks for no sentence it could not give.
  const every = (d.everyType ?? []).map((x) => {
    const declared = declaredOf(`${x.via} ${x.multiplicity}`);
    return declared ? { ...x, says: `every type also declares ${declared.where}, which names ${declared.many} ${x.to}` } : x;
  });
  const relations = steps ? steps.slice(0, RELATIONS_CAP) : [...actor, ...links.slice(0, RELATIONS_CAP - actor.length).map(relationOf)];
  const relationsOmitted = (steps ?? links).length - relations.length;
  return JSON.stringify({
    drawn: "The widget draws every diagram you draw under your answer, in the order drawn: every diagram you draw is shown. Write one or two sentences naming what it shows, by the titles in nodes, calling each by its type as given, and state only the relations listed in relations, as they are labeled, never another, and never write the diagram itself.",
    shape: d.shape, title: d.title ?? null, nodes: d.nodes.map((n) => ({ title: n.title, type: n.type })), edges: d.edges ?? 0, omitted: d.omitted ?? 0,
    relations, ...(relationsOmitted > 0 ? { relationsOmitted } : {}),
    // A picture of the schemas: the types each node is, the core they are declared in, and what
    // every other type declares, said once, since the picture draws no arrow for it. Its relations
    // are asked for as a list, one to an item: the check reads an answer claim by claim, a list
    // item is a claim, and a sentence joining several relations passes with a wrong one in it.
    ...(d.shape === "schema" ? {
      schemas: `Each node is a type the schemas of core ${d.core ?? "(version not named)"} declare, and each relation a reference its schema declares, labeled with the field and how many one entity may hold; nested-in joins an owned type to its owner. Each relation's says states it from the type that declares it: state a relation as its says states it, in the answer's language, never turned around, since a field is the type's that declares it and never the type's it names. Name the core version once. The picture is the answer, and for this picture a list takes the place of the one or two sentences: write one sentence saying what the picture shows, then the relations that carry its structure as a Markdown list of at most six items, never every relation. An item states one relation and no more: ${d.unit ? "one sentence of owns or shared, or " : ""}one relation's says, never two joined by and, a comma or a semicolon; a relation that has no says is not listed. Say it in plain words, as a reader would say it, keeping who declares and who is named as the sentence has them. In German core stays core, never Kern, and a schema deklariert, never erklärt.${every.length ? ` everyType lists what every other type also declares, which the picture leaves out: say it once, in a sentence of its own${every.every((x) => "says" in x) ? ", as its says states it" : ""}.` : ""}${d.unit ? ` This picture draws one unit of the meta-model, ${d.unit}, ${d.unit === "core" ? "core alone" : "the pack's own types with the core types they declare to"}, because the meta-model is drawn a unit at a time; units lists every unit with how many types it declares. Say which unit this is, and name the other units as what can be shown next, a pack by its name and the word pack; where the visitor asked for the meta-model as a whole, say in one sentence that it is drawn a unit at a time. owns says which types each owner nests and which types of the unit are nested in none, and shared which types declare a field that several declare, each sentence closed: a type it does not name has no such nesting or field. Where you group types, group them as owns and shared do, and give no type a nesting or a field they do not.` : ""}`,
      everyType: every, ...(d.unit ? { unit: d.unit, units: d.units ?? [], ...groups() } : {}),
    } : {}),
    // A picture of a context map: each relation comes with the sentence that states it, so the model
    // repeats that sentence and never decodes a direction.
    ...(d.shape === "context" ? {
      map: "Each relation's says states it as the map draws it. State each relation as its says states it, in the answer's language, one by one, and never turn a relation around.",
    } : {}),
    // A picture of an aggregate: a cardinality such as 1..* or * is copied into the answer, where
    // Markdown reads the asterisk as emphasis and drops it, so each relation is said in words.
    ...(d.shape === "aggregate" ? {
      aggregate: "Each relation's says states it as the picture draws it. State each relation as its says states it, in the answer's language, in words: never write a cardinality as 1..* or * or any other symbol.",
    } : {}),
    // A picture of a flow or a lifecycle: each event emitted and each step between states comes
    // with the sentence that states it, so the model never reads a direction off the source. The
    // host links a command only to an event it emits, so a flow whose commands emit nothing has no
    // relation and still draws every command; read as nothing drawn, the answer said the picture
    // drew no relation, so the flow's sentence says what relations leaves out.
    ...(d.shape === "flow" ? {
      flow: `${SAYS_IN_WORDS} relations lists only the events a command emits; the picture also draws, as a message from Caller, every command the aggregate handles, including those that emit nothing, so never say the flow draws no relation or shows the aggregate alone.`,
    } : {}),
    ...(d.shape === "lifecycle" ? { lifecycle: SAYS_IN_WORDS } : {}),
    // A picture of a use case or of what a thing is held to: a requirement's arrow is drawn into
    // what it applies to, which reads backwards as a relation, so each line comes with its sentence.
    ...(d.shape === "usecase" || d.shape === "requirements" ? {
      usecase: "Each relation's says states a line of the picture; state it as its says states it, never turned around: a use case includes another and asks something of a feature, a requirement applies to what it is drawn into and follows a rule, and the actor outside the frame is the use case's primary actor, a seat where it is in nodes and a name of its own where it is not. What a use case is for and what a requirement demands come from get_entity on their pages, never from the picture.",
    } : {}),
    // A picture of a scenario: its boxes are steps and extensions and no entity, so relations lists
    // the steps in order and then the extensions, each with the sentence that states it.
    ...(d.shape === "scenario" ? {
      scenario: "relations lists the steps in order, each with who acts and what they do, then the extensions, each with the step it departs from, its condition and what happens then; state them in that order as their says state them, in the answer's language, and never as arrows. A step whose actor is in nodes is a seat; any other actor is named as the scenario names it.",
    } : {}),
    // A picture of an organization: the lead of a group and each person's job are drawn by form
    // and are in no relation, and a box of type job reads as someone's job unless told; omitted,
    // read as relations, was reported as a relation left out. The answer takes a group's people
    // from its page, which get_entity gives, and the note says so.
    ...(d.shape === "organization" ? {
      organization: "Each relation's says states a line of the chart; state it as its says states it, never turned around. Who leads each group, who its members are and what it is looking to fill come from get_entity on that group's page, never from the nodes: a node of type job is an open position, never a person's job. omitted counts the groups outside the disciplinary line that the picture leaves out, never relations; say so only where it is above zero.",
    } : {}),
    // A picture of a system: part-of and provided-by are drawn from the part and from the system,
    // which read backwards as relations, and what a system is for is on its page, not in the picture.
    ...(d.shape === "system" || d.shape === "holds" ? {
      system: "Each relation's says states a line of the landscape; state it as its says states it, never turned around: a system runs on its host, provides its service, and holds the master copy of, writes a copy of or reads the data a cylinder stands for. What a system is for, who owns and runs it and which party is behind it come from get_entity on its page, never from the picture.",
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
/**
 * @param {Host} host
 * @param {any} data
 * @returns {Promise<Title[]>}
 */
export async function namesPastTheCap(host, data) {
  const e = data && !data.error ? data.entity : null;
  if (!e || typeof e.id !== "string" || !Array.isArray(e.references)) return [];
  const total = e.referenceCounts?.references;
  if (!(typeof total === "number" && total > e.references.length)) return [];
  /** @type {Title[]} */
  const out = [];
  /** @type {string | undefined} */
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

/**
 * @param {{ host: Host; model: Model; meter: Meter; questionCap?: number; verdict?: ReturnType<typeof verdictCheck> | null; today?: () => string }} services
 * @param {{ messages: unknown; lang?: string | null | undefined; signal?: AbortSignal | undefined; choice?: Choice; reader?: ReaderMeter | null }} request
 * @param {(event: string, data: unknown) => void} emit
 * @returns {Promise<Signals & { spent: number }>}
 */
export async function answer({ host, model, meter, questionCap = DEFAULT_QUESTION_INDEX_CHARS, verdict = null, today = () => new Date().toISOString().slice(0, 10) }, { messages, lang, signal, choice = DEFAULT_CHOICE, reader = null }, emit) {
  const turns = window(validateMessages(messages));
  let spent = 0;
  /** @type {Anthropic.MessageParam[]} */
  const conv = turns.map((t) => ({ role: t.role, content: t.content }));
  const questions = await host.questions();
  // The host's list keeps to a date, orders by one and keeps to a value where its input says so.
  const list = /** @type {Record<string, unknown>} */ (host.tools.find((t) => t.name === "list_entities")?.input_schema?.properties ?? {});
  const facts = ["on", "by", "where"].every((k) => k in list);
  const system = systemPrompt(host.instructions, lang, await host.types(), questions.titles, questionCap, questions.more, host.tools.some((t) => t.name === "diagram"), { today: today(), facts });
  const note = nameNote(/** @type {Message} */ (turns.at(-1)).content);
  const cited = new Set();
  const named = new Set();
  /** @type {RolledDoc | undefined} */
  let settled;
  /** @type {Anthropic.Message | undefined} */
  let last;
  // What one call is held at, and where: the site's day is the visitors' alone.
  const estimate = estimateFor(choice);
  const day = !reader;
  // A call between its reserve and its settle, so that an exception thrown in it — the model,
  // the host, the socket — still gives that one reservation back rather than leaving it booked.
  // The site's and the reader's are kept apart, so neither is given back twice.
  let outstanding = false, readerOutstanding = false;
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
  /** @type {Map<string, Title>} */
  const returned = new Map();
  /** @type {Map<string, string[]>} */
  const evidence = new Map();
  /** @type {string[]} */
  const toolAnswers = [];
  /**
   * @param {Title[]} entities
   * @param {string} text
   */
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
      await meter.reserve(estimate, { day });
      outstanding = true;
      // A reader's month refused gives the site's hold back in the `finally`, at { day: false }.
      if (reader) { await reader.reserve(estimate); readerOutstanding = true; }
      // A round's text is held until the round ends: text in a round that goes on to call a tool
      // is the model saying what it will do, never the answer, and is not sent.
      let written = "";
      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final, again: askedAgain, choice }), (text) => { written += text; }, { signal, timeoutMs: callTimeoutMs(choice.effort) });
      last = msg;
      rounds++;
      const cost = units(msg.usage, choice.model);
      spent += cost;
      settled = await meter.settle(estimate, cost, { day });
      outstanding = false;
      if (reader) { await reader.settle(estimate, cost); readerOutstanding = false; }
      if (msg.stop_reason === "refusal") throw new ChatError("declined", "the model declined to answer this question");
      const calls = /** @type {Anthropic.ToolUseBlock[]} */ (msg.content.filter((c) => c.type === "tool_use"));
      // The silent message is not pushed: the next request is this conversation again, as the
      // last request with the note after whatever the model was last given, and an empty tool list.
      const silent = calls.length === 0 && msg.stop_reason !== "max_tokens" && !msg.content.some((c) => c.type === "text" && c.text.trim());
      if (silent && !askedAgain && !signal?.aborted) { askedAgain = true; round = MAX_ROUNDS - 1; continue; }
      const answered = final || calls.length === 0 || msg.stop_reason !== "tool_use";
      if (answered && written && !signal?.aborted) { said += written; emit("text", { text: written }); }
      if (answered) break;
      if (signal?.aborted) break;
      conv.push({ role: "assistant", content: msg.content });
      /** @type {Anthropic.ToolResultBlockParam[]} */
      const results = [];
      for (const call of calls) {
        const r = await host.call(call.name, pageSized(call.name, /** @type {Record<string, unknown>} */ (call.input)));
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
        /** @type {Title[]} */
        const names = [];
        for (const n of found) {
          if (named.size >= NAME_CAP) break;
          if (named.has(n.id) || cited.has(n.id)) continue;
          named.add(n.id); names.push(n);
        }
        if (names.length) emit("names", { names });
        if (verdict) heard(found, given);
        if (picture) { const { links, everyType, core, unit, units, transitions, steps, extensions, actor, ...event } = picture; emit("diagram", event); }
        // A question's pages this message has not read, named after its answer while a round
        // in which they can be read is still to come. The note is the model's alone: it is no
        // part of what the answer is checked against.
        const unread = round + 1 < MAX_ROUNDS ? restsNote(restsOf(call.name, r).filter((x) => !cited.has(x.id))) : "";
        results.push({ type: "tool_result", tool_use_id: call.id, content: unread ? `${given}\n\n${unread}` : given, is_error: r.isError });
      }
      // The naming note follows the tool answers, so the model reads it just before it writes.
      conv.push({ role: "user", content: [...results, { type: "text", text: note }] });
    }
  } catch (err) {
    (/** @type {{ signals?: Signals }} */ (err)).signals = signals();
    throw err;
  } finally {
    if (outstanding) settled = await meter.settle(estimate, 0, { day });
    if (readerOutstanding) await /** @type {ReaderMeter} */ (reader).settle(estimate, 0);
  }
  if (signal?.aborted) return { spent, ...signals() };
  // The answer's language, read from its words, since the prompt answers in the visitor's
  // language whatever the page's; where its words do not tell, the request's, and English where
  // that names none, as the prompt falls back. The widget offers what follows in it.
  const written = languageOf(said) ?? (LANGS.includes(/** @type {string} */ (lang)) ? /** @type {string} */ (lang) : "en");
  /** @type {{ model: Provenance | null; by: Choice; spent: number; dayLeft: number; lang: string; cut?: boolean }} */
  const done = { model: host.provenance, by: { model: choice.model, effort: choice.effort }, spent, dayLeft: Math.max(0, meter.dayShare - /** @type {RolledDoc} */ (settled).dayTokens), lang: written };
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
