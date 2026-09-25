// Three paths. / is a page for whoever types the host into a browser, /health is for the
// deployment, /chat is the chat: GET says what it is, OPTIONS is the browser's preflight, POST
// is a message. Everything else is a 404 from here rather than from whatever sits in front.
//
// Every refusal is made at the door and before the model is asked, so a refusal costs nothing:
// a Host the deployment did not name, a page whose Origin it did not name, a POST without the
// widget's header, a body over the cap, a body that is not the shape, an address over its
// hour, a day or a month that is spent. A refusal decided before the stream is JSON with a
// code; one that arrives mid-stream, a host gone between two rounds, is the stream's last event.
// A refusal for a limit that lifts by itself says when, in the body and, before the stream, in
// the standard header.
//
// A visitor who closes the tab leaves a socket the answer cannot reach, and the rounds after it
// would be spent for nobody, so a POST carries an abort signal the loop and the model read: the
// response closing before it finished aborts it.
//
// Once the visitor has their answer or their refusal, one line of JSON goes to standard output:
// the question as sent, the language, and what the loop saw, which the deployment routes into a
// bucket of its own under the retention the privacy pages state. Nothing else of the request is
// written: no address, no header, no word of the answer. An error that is not a refusal is
// logged as its name, its status and its code and never as the object, since a provider's error
// carries its own message about the request, which can hold more than the question.
import http from "node:http";
import { ChatError, refusal } from "./errors.mjs";
import { MAX_BODY_BYTES, validateMessages } from "./shape.mjs";
import { MODEL } from "./model.mjs";
import { answer } from "./loop.mjs";
import { clientAddress } from "./bucket.mjs";
import { sse } from "./sse.mjs";
import { renderPage } from "./page.mjs";
import { LANGS } from "./prompt.mjs";
import { line } from "./log.mjs";

const HEADER = "x-chat";

function readBoundedBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        if (!res.headersSent) res.writeHead(413, { "Content-Type": "text/plain" }).end("request too large\n");
        req.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!res.headersSent) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("close", () => { if (!res.headersSent) resolve(undefined); });
    req.on("error", reject);
  });
}

// The three fields of an error that say what went wrong without repeating anything sent in.
// A fault names the error and nothing of the request: no address, no header, no word of the
// visitor's. The stack stays out of the log; the name, status and code are what a reader needs.
const logInternal = (err) => console.error(line("chat.error", "ERROR", { kind: "internal", message: "internal error while answering", name: err?.name ?? null, status: err?.status ?? null, code: err?.code ?? null }));

// A 429 says when in the standard header as well as in the body, whole seconds rounded up and
// never below one, since a second that has begun is a second to wait; the body's moment is the
// one the header is computed from, so the two agree.
const retryAfter = (err) => (err.retryAt ? { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(err.retryAt) - Date.now()) / 1000))) } : {});

const json = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body) + "\n"); };

// The question the line keeps is the one the shape accepts: the last user turn, trimmed, within
// the cap. Read here with the shape's own rules, so a refusal made before the loop ran, the
// bucket's busy, never keeps what the loop would have refused; the loop validates again for its
// own refusal, and a body the shape rejects keeps nothing.
const questionOf = (messages) => { try { return validateMessages(messages).at(-1).content; } catch { return null; } };

// The codes that follow from no question the shape accepts, or from a page that is not the
// site's, write no line; every other refusal is a question asked and not answered.
const UNKEPT = new Set(["bad_request", "too_long", "foreign"]);

const NO_SIGNALS = { cited: [], calls: 0, empty: 0, rounds: 0 };

export function createHttpServer({ config, host, model, meter, bucket, log = console.log }, { pageCss = null, pageBrand = null, pageIcon = null } = {}) {
  const hostOk = (req) => !config.hosts || config.hosts.includes((req.headers.host ?? "").replace(/:\d+$/, ""));
  const originOf = (req) => (req.headers.origin ?? "").trim();
  const takeOrBusy = (req) => {
    const taken = bucket.take(clientAddress(req, config.proxyHops));
    if (taken !== true) throw new ChatError("busy", "too many messages from this address; wait a while", { retryAt: taken });
  };
  const cors = (res, origin) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  };

  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let question = null, lang = null, kept = false;
    // The line the log keeps of this question, written once, with the answer or the refusal.
    // `lang` is the request's where it is one the interface names, so nothing in the line but the
    // question is the visitor's to fill, and the question has the shape's cap.
    const keep = (signals, refused) => {
      if (question === null || kept) return;
      kept = true;
      const s = signals ?? NO_SIGNALS;
      log(line("chat.question", "INFO", { kind: "question", question, lang, cited: s.cited, calls: s.calls, empty: s.empty, rounds: s.rounds, refused }));
    };
    try {
      if (!hostOk(req)) { res.writeHead(421, { "Content-Type": "text/plain" }).end("unknown host\n"); return; }
      const { pathname } = new URL(req.url, "http://localhost");
      const forwardedHost = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
      const proto = req.headers["x-forwarded-proto"] ?? (req.socket.encrypted ? "https" : "http");
      const origin = `${proto}://${forwardedHost}`;

      if (pathname === "/health" && req.method === "GET") { json(res, 200, { ok: true, host: host.provenance }); return; }

      if (pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
        const body = renderPage({ config, host, origin, css: pageCss, brand: pageBrand, icon: pageIcon });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(req.method === "HEAD" ? undefined : body);
        return;
      }

      if (pathname !== "/chat") { res.writeHead(404).end(); return; }

      const from = originOf(req);
      const named = from && config.origins.includes(from);

      if (req.method === "OPTIONS") {
        if (!named) { res.writeHead(403).end(); return; }
        cors(res, from);
        res.writeHead(204, { "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": `content-type, ${HEADER}`, "Access-Control-Max-Age": "600" });
        res.end();
        return;
      }

      if (req.method === "GET") {
        if (named) cors(res, from);
        takeOrBusy(req);
        const s = await meter.state();
        json(res, 200, {
          model: MODEL, provider: config.provider, mcp_url: config.mcpUrl, origins: config.origins, provenance: host.provenance,
          month_tokens: s.monthCeiling, day_share: s.dayShare, day_used: s.dayTokens, month_used: s.monthTokens, closed: s.closed,
          address: clientAddress(req, config.proxyHops),
        });
        return;
      }

      if (req.method !== "POST") { res.writeHead(405, { Allow: "GET, POST, OPTIONS" }).end(); return; }

      if (from && !named) throw new ChatError("foreign", `${from} is not a page this chat answers`);
      if (named) cors(res, from);
      if (!(HEADER in req.headers)) throw new ChatError("bad_request", `a message carries the ${HEADER} header`);
      const contentLength = Number(req.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) { res.writeHead(413, { "Content-Type": "text/plain" }).end("request too large\n"); return; }
      const text = await readBoundedBody(req, res);
      if (res.headersSent || text === undefined) return;
      let body;
      try { body = JSON.parse(text); } catch { throw new ChatError("bad_request", "the body is not JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ChatError("bad_request", "the body is not the shape: an object with messages and lang");
      question = questionOf(body.messages);
      lang = LANGS.includes(body.lang) ? body.lang : null;
      takeOrBusy(req);
      const ac = new AbortController();
      res.on("close", () => { if (!res.writableFinished) ac.abort(); });
      const stream = sse(res);
      try {
        const r = await answer({ host, model, meter, questionCap: config.questionIndexChars }, { messages: body.messages, lang: body.lang, signal: ac.signal }, (event, data) => stream.send(event, data));
        keep(r, null);
      } catch (err) {
        // The visitor left: the socket is gone and nothing can be sent, and what the loop had
        // gathered is kept as it is when the abort lands between two rounds, never as a fault.
        if (ac.signal.aborted) { keep(err.signals, null); }
        else if (!stream.opened) throw err;
        else if (err instanceof ChatError) { keep(err.signals, err.code); stream.send("error", refusal(err)); }
        else { logInternal(err); keep(err.signals, "internal"); stream.send("error", { error: { code: "internal", message: "internal error" } }); }
      }
      stream.end();
    } catch (err) {
      const code = err instanceof ChatError ? err.code : "internal";
      if (!UNKEPT.has(code)) keep(err.signals, code);
      if (err instanceof ChatError) { if (!res.headersSent) json(res, err.status, refusal(err), retryAfter(err)); else res.end(); return; }
      logInternal(err);
      if (!res.headersSent) json(res, 500, { error: { code: "internal", message: "internal error" } }); else res.end();
    }
  });
}
