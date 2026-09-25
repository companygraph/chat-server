import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../lib/http.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { Bucket } from "../lib/bucket.mjs";
import { MAX_BODY_BYTES } from "../lib/shape.mjs";
import { startFixtureHost, COMMIT, EXAMPLE_ROOT } from "./helpers.mjs";

const raw = (base, path, headers) => new Promise((resolve, reject) => {
  const u = new URL(base);
  http.get({ host: u.hostname, port: u.port, path, headers }, (res) => {
    let body = "";
    res.on("data", (d) => { body += d; });
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on("error", reject);
});

let fixture, host;
before(async () => { fixture = await startFixtureHost(); host = await connectHost(fixture.url); });
after(async () => { await host.close(); await fixture.close(); });

const usage = { input_tokens: 10, output_tokens: 1 };
const scripted = (...texts) => ({ name: "fake", async turn(req, onText) { const t = texts.shift() ?? "…"; onText(t); return { content: [{ type: "text", text: t }], stop_reason: "end_turn", usage }; } });

const config = (over = {}) => ({ mcpUrl: host.url, origins: ["https://site.test"], hosts: null, monthTokens: 1_000_000, project: "p", region: "eu", proxyHops: 1, port: 0, meter: "memory", anthropicKey: null, provider: "vertex", ...over });

async function listen({ model = scripted("hello"), cfg = config(), meter = new Meter(new MemoryStore(), { monthTokens: cfg.monthTokens }), bucket = new Bucket(), log = () => {}, opts = {} } = {}) {
  const server = createHttpServer({ config: cfg, host, model, meter, bucket, log }, opts);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, body, headers = {}) => fetch(`${base}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test", "x-chat": "1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function events(res) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((chunk) => {
    const ev = /^event: (.+)$/m.exec(chunk)[1];
    const data = JSON.parse(/^data: (.+)$/m.exec(chunk)[1]);
    return [ev, data];
  });
}

test("GET /chat says what the chat is and spends nothing", async () => {
  const base = await listen();
  const r = await fetch(`${base}/chat`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const c = await r.json();
  assert.equal(c.model, "claude-sonnet-5");
  assert.equal(c.provider, "vertex");
  assert.deepEqual(c.origins, ["https://site.test"]);
  assert.equal(c.mcp_url, host.url);
  assert.equal(c.provenance.commit, COMMIT);
  assert.equal(c.month_tokens, 1_000_000);
  assert.equal(c.day_share, 100_000);
  assert.equal(c.closed, false);
  assert.equal(typeof c.address, "string");
});

test("GET /chat is held by the same bucket as a message", async () => {
  const base = await listen();
  const headers = { "x-forwarded-for": "203.0.113.9, 35.0.0.1" };
  for (let i = 0; i < 20; i++) assert.equal((await fetch(`${base}/chat`, { headers })).status, 200);
  const r = await fetch(`${base}/chat`, { headers });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error.code, "busy");
});

test("a message is answered as a stream of events", async () => {
  const base = await listen();
  const r = await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://site.test");
  const ev = await events(r);
  assert.deepEqual(ev[0], ["text", { text: "hello" }]);
  assert.equal(ev.at(-1)[0], "done");
  assert.equal(ev.at(-1)[1].model.commit, COMMIT);
});

test("the preflight is answered for a named origin and refused for another", async () => {
  const base = await listen();
  const ok = await fetch(`${base}/chat`, { method: "OPTIONS", headers: { origin: "https://site.test", "access-control-request-method": "POST" } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://site.test");
  assert.match(ok.headers.get("access-control-allow-headers"), /x-chat/i);
  const no = await fetch(`${base}/chat`, { method: "OPTIONS", headers: { origin: "https://other.test", "access-control-request-method": "POST" } });
  assert.equal(no.status, 403);
});

test("a foreign page, a request without the header, and a bad body are refused with a code", async () => {
  const base = await listen();
  const foreign = await post(base, { messages: [{ role: "user", content: "hi" }] }, { origin: "https://other.test" });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error.code, "foreign");
  const bare = await fetch(`${base}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(bare.status, 400);
  assert.equal((await bare.json()).error.code, "bad_request");
  const long = await post(base, { messages: [{ role: "user", content: "x".repeat(1001) }] });
  assert.equal(long.status, 400);
  assert.equal((await long.json()).error.code, "too_long");
  const notJson = await post(base, "{nope");
  assert.equal(notJson.status, 400);
  const noOrigin = await post(base, { messages: [{ role: "user", content: "hi" }] }, { origin: "" });
  assert.equal(noOrigin.status, 200, "a client outside a browser sends no origin and passes");
});

test("a body over the cap is refused before it is read", async () => {
  const base = await listen();
  const r = await post(base, { messages: [{ role: "user", content: "x" }], pad: "y".repeat(MAX_BODY_BYTES) });
  assert.equal(r.status, 413);
});

// The bucket knows the moment to the second; the response says it twice, in the body for the
// widget and in the header for any other client, and the two agree. A refusal with no moment
// carries neither, so a client is never told to wait for something that will not change.
test("the twenty-first message from one address in an hour is busy, and says until when", async () => {
  const base = await listen({ model: scripted(...Array(25).fill("ok")) });
  const from = { "x-forwarded-for": "203.0.113.7, 35.0.0.1" };
  for (let i = 0; i < 20; i++) assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }] }, from)).status, 200);
  const r = await post(base, { messages: [{ role: "user", content: "hi" }] }, from);
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.equal(body.error.code, "busy");
  assert.match(body.error.retryAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "an ISO time in UTC");
  const wait = Number(r.headers.get("retry-after"));
  assert.ok(Number.isInteger(wait) && wait >= 1, `Retry-After is whole seconds, never below one: ${r.headers.get("retry-after")}`);
  const fromBody = Math.ceil((Date.parse(body.error.retryAt) - Date.now()) / 1000);
  assert.ok(Math.abs(wait - fromBody) <= 1, `the header says ${wait}, the body ${fromBody}`);
  assert.ok(wait <= 3600 && wait > 3590, `the bucket's hour: ${wait}`);
  const gate = await fetch(`${base}/chat`, { headers: from });
  assert.equal(gate.status, 429, "GET /chat is held by the same bucket");
  assert.ok((await gate.json()).error.retryAt, "and says until when");
  const foreign = await post(base, { messages: [{ role: "user", content: "hi" }] }, { origin: "https://other.test" });
  assert.equal(foreign.status, 403);
  assert.ok(!("retryAt" in (await foreign.json()).error), "a foreign page has no moment");
  assert.equal(foreign.headers.get("retry-after"), null, "and no header");
});

test("a spent ceiling and a closed switch are refused before the stream", async () => {
  // The month is checked before the day, so a ceiling below one call's estimate is over_month.
  const cfg = config({ monthTokens: 100 });
  const meter = new Meter(new MemoryStore(), { monthTokens: 100 });
  const base = await listen({ cfg, meter });
  const r = await post(base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.status, 429);
  const spent = await r.json();
  assert.equal(spent.error.code, "over_month");
  assert.match(spent.error.retryAt, /T00:00:00\.000Z$/, "the first of the next month at midnight UTC");
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  await meter.store.transact((d) => ({ ...d, closed: true }));
  const c = await post(base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(c.status, 503);
  assert.equal((await c.json()).error.code, "closed");
  assert.equal(c.headers.get("retry-after"), null, "closed lifts when the owner says, so no header");
});

test("a host that is gone before any text is a JSON refusal, and gone mid-stream is the last event", async () => {
  const second = await startFixtureHost();
  const h = await connectHost(second.url);
  await second.close();
  const call = { content: [{ type: "tool_use", id: "t", name: "list_types", input: {} }], stop_reason: "tool_use", usage };
  const silent = { name: "fake", async turn() { return call; } };
  const talking = { name: "fake", async turn(req, onText) { onText("Looking…"); return { ...call, content: [{ type: "text", text: "Looking…" }, ...call.content] }; } };
  const start = async (model) => {
    const server = createHttpServer({ config: config(), host: h, model, meter: new Meter(new MemoryStore(), { monthTokens: 1_000_000 }), bucket: new Bucket() });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
  };
  const before = await post(await start(silent), { messages: [{ role: "user", content: "hi" }] });
  assert.equal(before.status, 502);
  assert.equal((await before.json()).error.code, "host_down");
  const mid = await post(await start(talking), { messages: [{ role: "user", content: "hi" }] });
  assert.equal(mid.status, 200);
  const ev = await events(mid);
  assert.deepEqual(ev[0], ["text", { text: "Looking…" }]);
  assert.equal(ev.at(-1)[0], "error");
  assert.equal(ev.at(-1)[1].error.code, "host_down");
  await h.close();
});

test("the other paths: the page, health, 404, 405, and the host check", async () => {
  const base = await listen();
  assert.equal((await fetch(`${base}/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/chat`, { method: "DELETE" })).status, 405);
  const h = await fetch(`${base}/health`);
  assert.equal(h.status, 200);
  assert.equal((await h.json()).host.commit, COMMIT);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /main class="shell"/);
  // Node's fetch sends its own Host whatever the caller sets, so the host check is exercised
  // over a raw request.
  const held = await listen({ cfg: config({ hosts: ["chat.site.test"] }) });
  assert.equal((await raw(held, "/", { host: "chat.site.test" })).status, 200);
  assert.equal((await raw(held, "/", { host: "evil.test" })).status, 421);
});

test("a null body is a refusal with a code, not an internal error", async () => {
  const base = await listen();
  const r = await post(base, "null");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "bad_request");
});

test("the page answers even when no site is named and the forwarded host is not an address", async () => {
  const base = await listen({ cfg: config({ origins: [] }) });
  const r = await raw(base, "/", { "x-forwarded-host": "%" });
  assert.equal(r.status, 200);
  assert.match(r.body, /main class="shell"/);
});

test("a body with no length is counted as it arrives, cut off at the cap, and the server answers on", async () => {
  // Node's fetch always sends a Content-Length, so only the header branch of the cap is reached
  // over it; a chunked request with no length is what makes the counting branch run.
  const base = await listen();
  const u = new URL(base);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname, port: u.port, path: "/chat", method: "POST",
      headers: { "content-type": "application/json", origin: "https://site.test", "x-chat": "1", "transfer-encoding": "chunked" },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    // The server drops the request where the cap is passed, so the writes after it land in a
    // socket that is gone; that is the point of the test and not a failure of it.
    req.on("error", () => {});
    req.on("close", () => reject(new Error("the request closed with no answer")));
    const chunk = "x".repeat(8 * 1024);
    let sent = 0;
    const write = () => {
      while (sent <= MAX_BODY_BYTES) {
        sent += chunk.length;
        if (!req.write(chunk)) { req.once("drain", write); return; }
      }
      req.end();
    };
    write();
  });
  assert.equal(status, 413);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

// The line the log keeps of a question: the words, the language, and what the loop saw. It is
// written once the visitor has their answer or their refusal, never for a body that carried no
// question the shape accepts, and it carries no address and no word of the answer.
const KEYS = ["severity", "logging.googleapis.com/labels", "kind", "question", "lang", "cited", "calls", "empty", "rounds", "refused"];
// The two keys before kind are Cloud Logging's: it lifts them out of the payload into the entry's severity and labels, so the console filters the line as labels.logger="chat.question".
const HEAD = { severity: "INFO", "logging.googleapis.com/labels": { logger: "chat.question" } };
const lines = () => { const out = []; return { out, log: (s) => out.push(s) }; };
const tools = (...turns) => ({ name: "fake", async turn(req, onText) { const t = turns.shift(); for (const c of t.content) if (c.type === "text") onText(c.text); return t; } });
const toolTurn = (name, input) => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop_reason: "tool_use", usage });
const textTurn = (text) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });

test("an answered question is kept as one line with the words, the language and the loop's signals", async () => {
  const rootId = (await host.call("search", { query: EXAMPLE_ROOT, match: "name" })).data.results[0].id;
  const { out, log } = lines();
  const base = await listen({ model: tools(toolTurn("get_entity", { id: rootId }), textTurn("It is the company.")), log });
  const r = await post(base, { messages: [{ role: "user", content: "What is it?" }], lang: "de" }, { "x-forwarded-for": "203.0.113.77, 35.0.0.1" });
  await r.text();
  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]);
  assert.deepEqual(Object.keys(line), KEYS);
  assert.deepEqual(line, { ...HEAD, kind: "question", question: "What is it?", lang: "de", cited: [rootId], calls: 1, empty: 0, rounds: 2, refused: null });
  assert.ok(!out[0].includes("203.0.113.77"), "no address in the line");
  assert.ok(!out[0].includes("It is the company"), "no word of the answer in the line");
});

test("a lang the interface does not name is kept as null, so the line holds nothing unbounded but the question", async () => {
  const { out, log } = lines();
  const base = await listen({ model: tools(textTurn("Hello.")), log });
  await (await post(base, { messages: [{ role: "user", content: "hi" }], lang: "x".repeat(50_000) })).text();
  assert.equal(out.length, 1);
  assert.equal(JSON.parse(out[0]).lang, null);
  assert.ok(out[0].length < 1_000, "the line is bounded");
});

test("a question the model could not find is kept with an empty cited list and the empty count", async () => {
  const { out, log } = lines();
  const base = await listen({ model: tools(toolTurn("search", { query: "xqzv wvkq", match: "words" }), textTurn("The model does not say.")), log });
  await (await post(base, { messages: [{ role: "user", content: "who is xqzv?" }], lang: "en" })).text();
  const line = JSON.parse(out[0]);
  assert.deepEqual(line.cited, []);
  assert.equal(line.calls, 1);
  assert.equal(line.empty, 1);
  assert.equal(line.refused, null);
});

test("a refusal after the question was read is kept with its code, and one before it is not", async () => {
  const { out, log } = lines();
  const meter = new Meter(new MemoryStore(), { monthTokens: 100 });
  const base = await listen({ cfg: config({ monthTokens: 100 }), meter, log });
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" })).status, 429);
  assert.deepEqual(JSON.parse(out[0]), { ...HEAD, kind: "question", question: "hi", lang: "en", cited: [], calls: 0, empty: 0, rounds: 0, refused: "over_month" });
  await meter.store.transact((d) => ({ ...d, closed: true }));
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" })).status, 503);
  assert.equal(JSON.parse(out[1]).refused, "closed");
  const foreign = await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, { origin: "https://other.test" });
  assert.equal(foreign.status, 403);
  const bad = await post(base, "null");
  assert.equal(bad.status, 400);
  const long = await post(base, { messages: [{ role: "user", content: "x".repeat(1001) }], lang: "en" });
  assert.equal((await long.json()).error.code, "too_long");
  assert.equal(out.length, 2, "a foreign page, a bad body and a message over the cap write nothing");
});

test("the twenty-first message is kept as busy", async () => {
  const { out, log } = lines();
  const base = await listen({ log });
  const headers = { "x-forwarded-for": "203.0.113.9, 35.0.0.1" };
  for (let i = 0; i < 20; i++) await (await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, headers)).text();
  assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }], lang: "en" }, headers)).status, 429);
  assert.equal(out.length, 21);
  assert.equal(JSON.parse(out[20]).refused, "busy");
  assert.ok(out.every((l) => !l.includes("203.0.113.9")), "no address in any line");
});

test("a question with a newline, a quote and a backslash is one line that parses back, and no lang is null", async () => {
  const { out, log } = lines();
  const base = await listen({ log });
  const question = "Was ist \"das\"?\nUnd \\ dann?";
  await (await post(base, { messages: [{ role: "user", content: question }] })).text();
  assert.equal(out.length, 1);
  assert.ok(!out[0].includes("\n"), "one line");
  const line = JSON.parse(out[0]);
  assert.equal(line.question, question);
  assert.equal(line.lang, null);
});

test("a busy refusal keeps no question the shape would refuse, and keeps the accepted one trimmed", async () => {
  const { out, log } = lines();
  const base = await listen({ log });
  const headers = { "x-forwarded-for": "203.0.113.21, 35.0.0.1" };
  for (let i = 0; i < 20; i++) await (await post(base, { messages: [{ role: "user", content: "  hi  " }], lang: "en" }, headers)).text();
  assert.equal(JSON.parse(out[0]).question, "hi", "an accepted question is kept trimmed");
  const long = await post(base, { messages: [{ role: "user", content: "x".repeat(1001) }], lang: "en" }, headers);
  assert.equal(long.status, 429);
  const wrongRole = await post(base, { messages: [{ role: "assistant", content: "hi" }], lang: "en" }, headers);
  assert.equal(wrongRole.status, 429);
  const padded = await post(base, { messages: [{ role: "user", content: " ".repeat(50000) + "hi" }], lang: "en" }, headers);
  assert.equal(padded.status, 429);
  assert.equal(out.length, 21, "twenty answers and one busy line for the padded question, nothing for the two the shape refuses");
  assert.deepEqual(JSON.parse(out[20]), { ...HEAD, kind: "question", question: "hi", lang: "en", cited: [], calls: 0, empty: 0, rounds: 0, refused: "busy" });
});

test("a visitor who leaves mid-answer is kept with what the loop had, not as internal", async () => {
  const { out, log } = lines();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  after(() => { console.error = original; });
  const model = {
    name: "fake",
    turn: (req, onText, { signal }) => new Promise((resolve, reject) => {
      onText("Looking…");
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })));
    }),
  };
  const base = await listen({ model, log });
  const ac = new AbortController();
  const r = await fetch(`${base}/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test", "x-chat": "1" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], lang: "en" }), signal: ac.signal });
  const reader = r.body.getReader();
  await reader.read();
  ac.abort();
  const until = Date.now() + 5000;
  while (out.length === 0 && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]);
  assert.equal(line.refused, null);
  assert.equal(line.rounds, 0, "a turn the model never answered is not a round");
  assert.ok(!errors.some((e) => e.includes("chat.error")), "leaving is not a fault");
});

test("a fault while answering is one JSON line under chat.error, with the error's name and no word of the visitor's", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  after(() => { console.error = original; });
  const { out, log } = lines();
  const base = await listen({ model: { name: "fake", async turn() { throw new Error("boom"); } }, log });
  const body = await (await post(base, { messages: [{ role: "user", content: "secret words" }], lang: "en" })).text();
  assert.match(body, /"code":"internal"/);
  const faults = errors.filter((e) => e.includes("chat.error")).map((e) => JSON.parse(e));
  assert.equal(faults.length, 1);
  assert.equal(faults[0].severity, "ERROR");
  assert.deepEqual(faults[0]["logging.googleapis.com/labels"], { logger: "chat.error" });
  assert.equal(faults[0].name, "Error");
  assert.ok(!errors.join("").includes("secret words"), "no visitor text on standard error");
  assert.equal(JSON.parse(out[0]).refused, "internal", "and the question is kept as refused internal");
});
