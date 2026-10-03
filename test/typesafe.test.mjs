// The judge's wire: a request of lib/verdict.mjs as TypeSafe reads it, and its answers back. A
// fake fetch stands in for the service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wireOf, typesafeJudge, MODEL } from "../lib/typesafe.mjs";
import { CRITERIA } from "../lib/verdict.mjs";

const request = { state: { answers: { a1: "start: 2022-02" } }, questions: { c1: { claim: "It began in 2022.", evidence: ["a1"] } } };
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("each claim is a choice among the five verdicts, on the pinned model, with the state as given", () => {
  const wire = wireOf(request);
  assert.equal(wire.model, MODEL);
  assert.deepEqual(wire.state, request.state);
  assert.equal(wire.questions.c1.type, "choice");
  assert.equal(wire.questions.c1.instructions.claim, "It began in 2022.");
  assert.deepEqual(wire.questions.c1.instructions.evidence, ["a1"]);
  assert.deepEqual(wire.questions.c1.criteria, CRITERIA);
});

test("the answers come back as picks with their probabilities, the key in a header and never in an error", async () => {
  const sent = [];
  const judge = typesafeJudge({ key: "sk-secret", fetch: async (url, init) => { sent.push(init); return reply(200, { answers: { c1: { type: "choice", choice: "supported", probabilities: { supported: 0.9 }, confidence: 0.8 } } }); } });
  assert.deepEqual(await judge(request), { c1: { pick: "supported", probabilities: { supported: 0.9 } } });
  assert.equal(sent[0].headers.authorization, "Bearer sk-secret");
  const failing = typesafeJudge({ key: "sk-secret", fetch: async () => reply(500, {}) });
  await assert.rejects(failing(request), (e) => /TypeSafe answered 500/.test(e.message) && !e.message.includes("sk-secret"));
  const empty = typesafeJudge({ key: "k", fetch: async () => reply(200, { answers: {} }) });
  await assert.rejects(empty(request), /gave no choice for c1/);
});

test("the caller's signal reaches the request, so an overrun is cancelled", async () => {
  const ac = new AbortController();
  let got;
  await typesafeJudge({ key: "k", fetch: async (url, init) => { got = init.signal; return reply(200, { answers: { c1: { type: "choice", choice: "absent" } } }); } })(request, { signal: ac.signal });
  assert.equal(got, ac.signal);
});
