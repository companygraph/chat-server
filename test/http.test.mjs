import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHttpServer } from "../lib/http.mjs";
import { connectHost } from "../lib/host.mjs";
import { Meter, MemoryStore } from "../lib/meter.mjs";
import { Bucket } from "../lib/bucket.mjs";
import { MAX_BODY_BYTES } from "../lib/shape.mjs";
import { startFixtureHost, COMMIT } from "./helpers.mjs";

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

const config = (over = {}) => ({ mcpUrl: host.url, origins: ["https://site.test"], hosts: null, monthTokens: 1_000_000, project: "p", region: "eu", proxyHops: 1, port: 0, meter: "memory", ...over });

async function listen({ model = scripted("hello"), cfg = config(), meter = new Meter(new MemoryStore(), { monthTokens: cfg.monthTokens }), bucket = new Bucket(), opts = {} } = {}) {
  const server = createHttpServer({ config: cfg, host, model, meter, bucket }, opts);
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

test("the twenty-first message from one address in an hour is busy", async () => {
  const base = await listen({ model: scripted(...Array(25).fill("ok")) });
  for (let i = 0; i < 20; i++) assert.equal((await post(base, { messages: [{ role: "user", content: "hi" }] }, { "x-forwarded-for": "203.0.113.7, 35.0.0.1" })).status, 200);
  const r = await post(base, { messages: [{ role: "user", content: "hi" }] }, { "x-forwarded-for": "203.0.113.7, 35.0.0.1" });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error.code, "busy");
});

test("a spent ceiling and a closed switch are refused before the stream", async () => {
  // The month is checked before the day, so a ceiling below one call's estimate is over_month.
  const cfg = config({ monthTokens: 100 });
  const meter = new Meter(new MemoryStore(), { monthTokens: 100 });
  const base = await listen({ cfg, meter });
  const r = await post(base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error.code, "over_month");
  await meter.store.transact((d) => ({ ...d, closed: true }));
  const c = await post(base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(c.status, 503);
  assert.equal((await c.json()).error.code, "closed");
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
