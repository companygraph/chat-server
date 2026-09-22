// One message answered. The shape and the meter refuse before the first call, so a refusal
// costs nothing; then at most MAX_ROUNDS tool rounds, each a full request to the model with the
// tool's answer cut to size, and a last request that forbids another call. Text is forwarded as
// it comes. A tool answer that is one entity, with an id and a url, is a cite: the widget links
// it. Usage is metered after every call, whatever the visitor's message turns out to be.
import { validateMessages, window, truncate, MAX_ROUNDS } from "./shape.mjs";
import { systemPrompt } from "./prompt.mjs";
import { params } from "./model.mjs";
import { units, ESTIMATE } from "./meter.mjs";

// get_entity answers the entity under `entity`; fetch answers it flat, with `title`. Either is one
// entity with an id and an address; a list, a schema or a refusal is not.
const citeOf = (data) => {
  const e = data && !data.error ? (data.entity ?? data) : null;
  return e && typeof e.id === "string" && typeof e.url === "string"
    ? { id: e.id, title: e.title ?? e.name ?? e.id, type: e.type ?? null, url: e.url }
    : null;
};

export async function answer({ host, model, meter }, { messages, lang }, emit) {
  const turns = window(validateMessages(messages));
  await meter.reserve(ESTIMATE);
  let spent = 0;
  const conv = turns.map((t) => ({ role: t.role, content: t.content }));
  const system = systemPrompt(host.instructions, lang);

  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const final = round === MAX_ROUNDS;
      const msg = await model.turn(params({ system, tools: host.tools, messages: conv, final }), (text) => emit("text", { text }));
      spent += units(msg.usage);
      const calls = msg.content.filter((c) => c.type === "tool_use");
      if (final || calls.length === 0 || msg.stop_reason !== "tool_use") break;
      conv.push({ role: "assistant", content: msg.content });
      const results = [];
      for (const call of calls) {
        const r = await host.call(call.name, call.input);
        const cite = r.isError ? null : citeOf(r.data);
        if (cite) emit("cite", cite);
        results.push({ type: "tool_result", tool_use_id: call.id, content: truncate(r.text), is_error: r.isError });
      }
      conv.push({ role: "user", content: results });
    }
  } finally {
    await meter.settle(ESTIMATE, spent);
  }
  const state = await meter.state();
  emit("done", { model: host.provenance, spent, dayLeft: Math.max(0, state.dayShare - state.dayTokens) });
  return { spent };
}
