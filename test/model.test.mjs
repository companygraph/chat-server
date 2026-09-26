import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, EFFORT, WEIGHTS, FINAL_NOTE, params, vertexModel, anthropicModel, modelFor, asChatError, googleIdentityToken, METADATA_IDENTITY_URL, credentialFault } from "../lib/model.mjs";
import { MAX_OUTPUT_TOKENS } from "../lib/shape.mjs";

const tools = [{ name: "search", description: "d", input_schema: { type: "object" } }, { name: "fetch", description: "d", input_schema: { type: "object" } }];

test("a request names the model, the effort, the output limit, and marks the prefix for caching", () => {
  const r = params({ system: "S", tools, messages: [{ role: "user", content: "q" }] });
  assert.equal(r.model, MODEL);
  assert.equal(MODEL, "claude-sonnet-5");
  assert.equal(r.max_tokens, MAX_OUTPUT_TOKENS);
  assert.deepEqual(r.output_config, { effort: EFFORT });
  assert.deepEqual(r.system, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.equal(r.tools[1].cache_control, undefined, "the system mark already covers the tools before it");
  assert.equal(r.tools[0].cache_control, undefined);
  assert.deepEqual(r.messages, [{ role: "user", content: [{ type: "text", text: "q", cache_control: { type: "ephemeral" } }] }]);
  assert.equal(r.tool_choice, undefined);
  assert.equal(r.thinking, undefined);
});

test("the newest block carries the mark, whatever its shape, and the caller's messages are left alone", () => {
  const results = [{ type: "tool_result", tool_use_id: "a", content: "x" }, { type: "tool_result", tool_use_id: "b", content: "y" }];
  const messages = [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "text", text: "t" }] }, { role: "user", content: results }];
  const r = params({ system: "S", tools, messages });
  assert.deepEqual(r.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(r.messages.at(-1).content[0].cache_control, undefined);
  assert.equal(r.messages[1].content[0].cache_control, undefined);
  assert.equal(typeof r.messages[0].content, "string", "only the last message is rewritten");
  assert.equal(messages.at(-1).content, results, "the caller's array is not replaced");
  assert.equal(results[1].cache_control, undefined, "nor is a block of it marked in place");
});

test("the final round keeps the tools listed and forbids another call", () => {
  const r = params({ system: "S", tools, messages: [], final: true });
  assert.equal(r.tools.length, 2);
  assert.deepEqual(r.tool_choice, { type: "none" });
});

test("the final round says so to the model: the note follows the last tool answer, and no other round carries it", () => {
  const results = [{ type: "tool_result", tool_use_id: "a", content: "x" }];
  const messages = [{ role: "user", content: "q" }, { role: "assistant", content: [{ type: "tool_use", id: "a", name: "search", input: {} }] }, { role: "user", content: results }];
  const r = params({ system: "S", tools, messages, final: true });
  const last = r.messages.at(-1).content;
  assert.equal(last.length, 2);
  assert.equal(last[0].type, "tool_result");
  assert.equal(last[0].cache_control, undefined);
  assert.deepEqual(last[1], { type: "text", text: FINAL_NOTE, cache_control: { type: "ephemeral" } }, "the note is the newest block and carries the mark");
  assert.equal(results.length, 1, "the caller's array is left alone");
  assert.ok(!JSON.stringify(params({ system: "S", tools, messages }).messages).includes(FINAL_NOTE), "a round that may still call carries no note");
  const s = params({ system: "S", tools, messages: [{ role: "user", content: "q" }], final: true });
  assert.deepEqual(s.messages[0].content.map((b) => b.text), ["q", FINAL_NOTE], "a string message becomes two blocks");
  assert.match(FINAL_NOTE, /No further tool/);
  assert.match(FINAL_NOTE, /the model does not say/);
});

test("the weights are the model's price ratios", () => {
  assert.deepEqual(WEIGHTS, { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
});

test("a Vertex model is built from a project and a region and exposes turn", () => {
  const m = vertexModel({ project: "p", region: "eu" });
  assert.equal(m.name, MODEL);
  assert.equal(typeof m.turn, "function");
});

test("an Anthropic model is built from a key and exposes turn, and the chooser reads the config", () => {
  const a = anthropicModel({ apiKey: "sk-ant-test" });
  assert.equal(a.name, MODEL);
  assert.equal(typeof a.turn, "function");
  const base = { project: "p", region: "eu", anthropicKey: null };
  assert.equal(modelFor(base).provider, "vertex");
  assert.equal(modelFor({ ...base, anthropicKey: "sk-ant-test" }).provider, "anthropic");
});

test("the minute's rate from the model is busy one minute from now, and any other error is what it was", () => {
  const rate = Object.assign(new Error("Too Many Requests"), { status: 429 });
  const busy = asChatError(rate, () => Date.UTC(2026, 8, 23, 14, 5, 0));
  assert.equal(busy.code, "busy");
  assert.equal(busy.status, 429);
  assert.equal(busy.retryAt, "2026-09-23T14:06:00.000Z", "the quantum the quota is counted in");
  const other = Object.assign(new Error("boom"), { status: 500 });
  assert.equal(asChatError(other), other);
  const plain = new Error("no status");
  assert.equal(asChatError(plain), plain);
});

const federation = { ruleId: "fdrl_01test", organizationId: "00000000-0000-4000-8000-000000000000", serviceAccountId: "svac_01test", workspaceId: null };

// The exchange's body is read as JSON, or as a form where the SDK sends one, so the test holds
// the fields and not the encoding.
const fields = (body) => { try { return JSON.parse(body); } catch { return Object.fromEntries(new URLSearchParams(body)); } };

// A fetch that plays the metadata server, the token endpoint and the Messages API, and records
// what each was sent. The Messages API answers 429 with x-should-retry false, so the turn ends
// at once as busy, which proves the request was made with the traded token.
function fakeFetch({ metadata = () => new Response("h.p.s") } = {}) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    seen.push({ url: u, headers: new Headers(init.headers), body: typeof init.body === "string" ? init.body : null });
    if (u.startsWith("http://metadata.google.internal/")) return metadata();
    if (u.endsWith("/v1/oauth/token")) return Response.json({ access_token: "sk-ant-oat01-test", token_type: "Bearer", expires_in: 600 });
    return Response.json({ type: "error", error: { type: "rate_limit_error", message: "slow" } }, { status: 429, headers: { "x-should-retry": "false" } });
  };
  return { fetch, seen };
}

const ask = (m) => m.turn(params({ system: "S", tools, messages: [{ role: "user", content: "q" }] }), () => {});

test("the identity token is asked of the metadata server for the Anthropic audience, in full", async () => {
  assert.equal(METADATA_IDENTITY_URL, "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://api.anthropic.com&format=full");
  const { fetch, seen } = fakeFetch({ metadata: () => new Response("h.p.s\n") });
  assert.equal(await googleIdentityToken(fetch)(), "h.p.s");
  assert.equal(seen[0].headers.get("metadata-flavor"), "Google");
});

test("a metadata answer that is not a token says so by status, before any exchange", async () => {
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("<html>", { status: 404 }) }).fetch)(), /metadata server answered 404/);
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("<html>") }).fetch)(), /not a token/);
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("<html><p>Error. Try again. Later</p></html>") }).fetch)(), /not a token/, "two dots are not a token");
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("h..s") }).fetch)(), /not a token/, "an empty part is not a token");
});

test("a federated model trades the platform's token for a bearer, and a stray key in the environment does not shadow it", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-leftover";
  const { fetch, seen } = fakeFetch();
  try {
    const m = anthropicModel({ federation, fetch });
    assert.equal(m.provider, "anthropic");
    assert.equal(m.credential, "federation");
    await assert.rejects(ask(m), (e) => e.code === "busy");
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved;
  }
  const exchange = seen.find((s) => s.url.endsWith("/v1/oauth/token"));
  assert.ok(exchange, "the token endpoint was asked");
  assert.equal(new URL(exchange.url).origin, "https://api.anthropic.com");
  const f = fields(exchange.body);
  assert.equal(f.grant_type, "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(f.assertion, "h.p.s");
  assert.equal(f.federation_rule_id, "fdrl_01test");
  assert.equal(f.organization_id, "00000000-0000-4000-8000-000000000000");
  assert.equal(f.service_account_id, "svac_01test");
  const message = seen.find((s) => s.url.endsWith("/v1/messages"));
  assert.ok(message, "the Messages API was asked");
  assert.equal(message.headers.get("authorization"), "Bearer sk-ant-oat01-test");
  assert.equal(message.headers.get("x-api-key"), null, "no key rides along");
});

test("a metadata server that fails ends the turn as an error that names it, and never as busy", async () => {
  const { fetch, seen } = fakeFetch({ metadata: () => new Response("<html>", { status: 404 }) });
  await assert.rejects(ask(anthropicModel({ federation, fetch })), (e) => e.code !== "busy" && /metadata server answered 404/.test(`${e?.message} ${e?.cause?.message}`));
  assert.ok(!seen.some((s) => s.url.endsWith("/v1/messages")), "no message was sent without a token");
});

test("the chooser picks federation from the config, and each model names its credential", () => {
  const base = { project: "p", region: "eu", anthropicKey: null, anthropicFederation: null };
  assert.equal(modelFor(base).credential, "google");
  assert.equal(modelFor({ ...base, anthropicKey: "sk-ant-test" }).credential, "key");
  const f = modelFor({ ...base, anthropicFederation: federation });
  assert.equal(f.provider, "anthropic");
  assert.equal(f.credential, "federation");
});

// A fetch that answers nothing until its signal aborts, as a hung server does; without a signal
// it never settles, and the test's own timeout fails it. It holds a timer of its own meanwhile,
// as a real socket would, since AbortSignal.timeout's timer does not keep the process alive and
// on Node 22 the test would end with its promise still pending.
const hang = (_url, init = {}) => new Promise((_, reject) => {
  const held = setTimeout(() => {}, 5000);
  init.signal?.addEventListener("abort", () => { clearTimeout(held); reject(init.signal.reason); });
});

test("a metadata server that cannot be reached, or does not answer in time, is named as such", { timeout: 3000 }, async () => {
  const down = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(googleIdentityToken(down)(), (e) => e.name === "CredentialError" && /metadata server could not be reached: fetch failed/.test(e.message));
  await assert.rejects(googleIdentityToken(hang, { timeoutMs: 50 })(), (e) => e.name === "CredentialError" && /metadata server could not be reached/.test(e.message));
  await assert.rejects(googleIdentityToken(fakeFetch({ metadata: () => new Response("x", { status: 404 }) }).fetch)(), (e) => e.name === "CredentialError");
});

test("a token exchange that does not answer ends the turn in time, and never as busy", { timeout: 3000 }, async () => {
  const fetch = (url, init) => (String(url).endsWith("/v1/oauth/token") ? hang(url, init) : fakeFetch().fetch(url, init));
  await assert.rejects(ask(anthropicModel({ federation, fetch, tokenTimeoutMs: 50 })), (e) => e.code !== "busy");
});

test("a credential's fault is found on the error or its cause, and nothing else is", () => {
  const own = Object.assign(new Error("the metadata server answered 404 when asked for an identity token"), { name: "CredentialError" });
  assert.equal(credentialFault(own), own);
  assert.equal(credentialFault(new Error("wrapped", { cause: own })), own);
  assert.equal(credentialFault(new Error("boom")), null);
  assert.equal(credentialFault(undefined), null);
});
