// Three paths. / is a page for whoever types the host into a browser, /health is for the
// deployment, /chat is the chat: GET says what it is, OPTIONS is the browser's preflight, POST
// is a message. Everything else is a 404 from here rather than from whatever sits in front.
//
// Every refusal is made at the door and before the model is asked, so a refusal costs nothing:
// a Host the deployment did not name, a page whose Origin it did not name, a POST without the
// widget's header, a body over the cap, a body that is not the shape, an address over its
// hour, a day or a month that is spent. A refusal decided before the stream is JSON with a
// code; one that arrives mid-stream, a host gone between two rounds, is the stream's last event.
import http from "node:http";
import { ChatError, refusal } from "./errors.mjs";
import { MAX_BODY_BYTES } from "./shape.mjs";
import { MODEL } from "./model.mjs";
import { answer } from "./loop.mjs";
import { clientAddress } from "./bucket.mjs";
import { sse } from "./sse.mjs";
import { renderPage } from "./page.mjs";

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

const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body) + "\n"); };

export function createHttpServer({ config, host, model, meter, bucket }, { pageCss = null, pageBrand = null, pageIcon = null } = {}) {
  const hostOk = (req) => !config.hosts || config.hosts.includes((req.headers.host ?? "").replace(/:\d+$/, ""));
  const originOf = (req) => (req.headers.origin ?? "").trim();
  const cors = (res, origin) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  };

  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
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
        const s = await meter.state();
        json(res, 200, {
          model: MODEL, mcp_url: config.mcpUrl, origins: config.origins, provenance: host.provenance,
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
      if (!bucket.take(clientAddress(req, config.proxyHops))) throw new ChatError("busy", "too many messages from this address; wait a while");
      const stream = sse(res);
      try {
        await answer({ host, model, meter }, { messages: body.messages, lang: body.lang }, (event, data) => stream.send(event, data));
      } catch (err) {
        if (!stream.opened) throw err;
        if (err instanceof ChatError) { stream.send("error", refusal(err)); }
        else { console.error(err); stream.send("error", { error: { code: "internal", message: "internal error" } }); }
      }
      stream.end();
    } catch (err) {
      if (err instanceof ChatError) { if (!res.headersSent) json(res, err.status, refusal(err)); else res.end(); return; }
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: { code: "internal", message: "internal error" } }); else res.end();
    }
  });
}
