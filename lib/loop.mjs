// One message answered. The shape and the meter refuse before the first call, so a refusal
// costs nothing; then at most MAX_ROUNDS tool rounds, each a full request to the model with the
// tool's answer cut to size, and a last request that forbids another call. Text is forwarded as
// it comes. A tool answer that is one entity, with an id and a url, is a cite: the widget links
// it, once per message however many rounds fetch it, and every entity a list answer named is a
// `names` event, so that the widget can link those names where the answer writes them. Usage is metered around every call,
// whatever the visitor's message turns out to be.
//
// A message is up to five calls, so a reservation taken once for the message would let sixty
// messages in flight carry the counters far past the ceiling before any reserve refused. Each
// call reserves the estimate for itself and settles it at once against what the call really
// cost, which is what §5 means by adding the usage after each call: the counters follow the
// calls and not the messages. A reserve refused between two rounds throws where it stands; the
// stream is open by then, so the HTTP layer makes it the last error event and no done follows.
//
// A visitor who closes the tab is a socket that is gone, and every remaining round would be
// spent writing into it, so the signal the request carries reaches the model and is read between
// rounds: the loop stops where it stands, the meter is settled, and nothing more is emitted.
import { validateMessages, window, truncate, MAX_ROUNDS } from "./shape.mjs";
import { systemPrompt } from "./prompt.mjs";
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
// emitted is what the model was shown, so a name in the answer is a name from here.
const NAME_KEYS = ["results", "entities", "references", "rows", "evidence", "items"];
const NAME_CAP = 60;
export function namesIn(data, out = []) {
  if (!data || typeof data !== "object" || data.error) return out;
  for (const key of NAME_KEYS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const id = row.id ?? row.entity?.id ?? row.to?.id;
      const title = row.title ?? row.name ?? row.entity?.title ?? row.entity?.name ?? row.to?.title ?? row.to?.name;
      if (typeof id === "string" && typeof title === "string" && title.length > 2) out.push({ id, title });
      if (out.length >= NAME_CAP) return out;
    }
  }
  return out;
}

export async function answer({ host, model, meter }, { messages, lang, signal }, emit) {
  const turns = window(validateMessages(messages));
  let spent = 0;
  const conv = turns.map((t) => ({ role: t.role, content: t.content }));
  const system = systemPrompt(host.instructions, lang, await host.types());
  const cited = new Set();
  const named = new Set();
  let settled;
  let last;
  // A call between its reserve and its settle, so that an exception thrown in it — the model,
  // the host, the socket — still gives that one reservation back rather than leaving it booked.
  let outstanding = false;

  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const final = round === MAX_ROUNDS;
      await meter.reserve(ESTIMATE);
      outstanding = true;
      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final }), (text) => emit("text", { text }), { signal });
      last = msg;
      const cost = units(msg.usage);
      spent += cost;
      settled = await meter.settle(ESTIMATE, cost);
      outstanding = false;
      const calls = msg.content.filter((c) => c.type === "tool_use");
      if (final || calls.length === 0 || msg.stop_reason !== "tool_use") break;
      if (signal?.aborted) break;
      conv.push({ role: "assistant", content: msg.content });
      const results = [];
      for (const call of calls) {
        const r = await host.call(call.name, call.input);
        const cite = r.isError ? null : citeOf(r.data);
        if (cite && !cited.has(cite.id)) { cited.add(cite.id); emit("cite", cite); }
        // A name is emitted once a message, and never for an entity the answer already cites:
        // the cite carries the same id, and the widget links it from either.
        const names = r.isError ? [] : namesIn(r.data).filter((n) => !named.has(n.id) && !cited.has(n.id));
        for (const n of names) named.add(n.id);
        if (names.length) emit("names", { names });
        results.push({ type: "tool_result", tool_use_id: call.id, content: truncate(r.text), is_error: r.isError });
      }
      conv.push({ role: "user", content: results });
    }
  } finally {
    if (outstanding) settled = await meter.settle(ESTIMATE, 0);
  }
  if (signal?.aborted) return { spent };
  const done = { model: host.provenance, spent, dayLeft: Math.max(0, meter.dayShare - settled.dayTokens) };
  // The output limit stopped the last call mid-sentence, which the visitor would otherwise read
  // as the answer ending there; the widget says so instead.
  if (last?.stop_reason === "max_tokens") done.cut = true;
  emit("done", done);
  return { spent };
}
