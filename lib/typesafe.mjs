// The one place this package names a judge: TypeSafe's Jev, over its HTTP API
// (https://docs.typesafe.ai/api). A request of lib/verdict.mjs becomes Jev's wire shape here and
// its answers come back in the module's own, so a second judge is a second file beside this one.
// The model is pinned, since a threshold is measured against one model. One attempt and no
// retry: the check has a second to run in, and a retry would only spend it.
import { CRITERIA } from "./verdict.mjs";

export const MODEL = "jev-1.13.0";
const URL_DEFAULT = "https://api.typesafe.ai/v1/systemone";

const QUESTION = "`claim` is a sentence of an answer written from the tool answers in `answers`. Do the answers that `evidence` names carry it?";

/** @param {import("./verdict.mjs").JudgeRequest} request */
export function wireOf({ state, questions }) {
  /** @type {Record<string, object>} */
  const wire = {};
  for (const [id, q] of Object.entries(questions))
    wire[id] = { type: "choice", instructions: { claim: q.claim, evidence: q.evidence, question: QUESTION }, criteria: CRITERIA };
  return { model: MODEL, state, questions: wire };
}

// The key is sent in a header and never appears in an error.
/**
 * @param {{ key: string; url?: string; fetch?: typeof globalThis.fetch }} options
 */
export function typesafeJudge({ key, url = URL_DEFAULT, fetch = globalThis.fetch }) {
  /**
   * @param {import("./verdict.mjs").JudgeRequest} request
   * @param {{ signal?: AbortSignal }} [options]
   */
  return async (request, { signal } = {}) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(wireOf(request)),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`TypeSafe answered ${res.status}`);
    const body = await res.json();
    /** @type {Record<string, { pick: string; probabilities: Record<string, number> }>} */
    const out = {};
    for (const id of Object.keys(request.questions)) {
      const a = body?.answers?.[id];
      if (a?.type !== "choice" || typeof a.choice !== "string") throw new Error(`TypeSafe gave no choice for ${id}`);
      out[id] = { pick: a.choice, probabilities: a.probabilities ?? {} };
    }
    return out;
  };
}
