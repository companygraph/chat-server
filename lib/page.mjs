// The page at /, for whoever types the host into a browser: what the chat is, which site opens
// it, which host it reads and at which commit. It runs nothing and links the site. A deployment
// hands in the family's stylesheet and its own wordmark, as the MCP host's page takes them; the
// built-in sheet is plain so that any deployment reads without one. The class names are the
// contract a deployment's sheet is written against.
import { MODEL } from "./model.mjs";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u ?? ""); } };

const BUILT_IN = `body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222;background:#fff}
header{padding:2rem 1rem 0}.brand{display:inline-flex;gap:.5rem;align-items:center;text-decoration:none;color:inherit}
.brand svg{width:28px;height:28px}.brand span{color:#3b6}
main.shell{max-width:1180px;margin:0 auto;padding:1rem}
.title h1{font-size:2rem;line-height:1.15}.title .r70{font-weight:300;color:#777}.title .rcl{font-weight:700}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}.facts dt{color:#777}
.note{color:#555}footer.credit{padding:2rem 1rem;color:#777;font-size:.9rem}`;

const MARK = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="14" r="4" fill="currentColor"/></svg>`;

export function renderPage({ config, host, origin, css = null, brand = null, icon = null }) {
  const site = config.origins[0] ?? origin;
  const p = host?.provenance;
  const facts = [
    ["Opened from", config.origins.map((o) => `<a href="${esc(o)}">${esc(o)}</a>`).join(", ") || "no site yet"],
    ["Reads", `<a href="${esc(config.mcpUrl)}">${esc(config.mcpUrl)}</a>`],
    ["Model", esc(MODEL)],
    ["At commit", p ? `${esc(p.commit ?? "(uncommitted)")} (core ${esc(p.core)}, parser ${esc(p.parser)})` : "not read yet"],
    ["Ceiling", `${config.monthTokens.toLocaleString("en")} input-equivalent tokens a month, a tenth a day`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat — ${esc(hostOf(site))}</title>
<meta name="robots" content="noindex">
${icon ? `<link rel="icon" href="${icon}">` : ""}
<style>
${css ?? BUILT_IN}
</style>
</head>
<body>
<header><a class="brand" href="${esc(site)}">${MARK} ${brand ?? `<b>${esc(hostOf(site))} <span>chat</span></b>`}</a></header>
<main class="shell">
<div class="title"><h1><span class="r70">A chat over</span> <span class="rcl">the model</span></h1></div>
<p class="note">This service answers a visitor's question on the site it is opened from, by asking the site's MCP host through its tools and writing the answer from what the tools said. It holds no model of its own: every answer names the commit the host read it from.</p>
<dl class="facts">
${facts}
</dl>
<p class="note">The endpoint is <code>${esc(origin)}/chat</code>, and it answers only a page of the site named above. Nothing typed into the chat is kept; what is counted is what the answers cost.</p>
</main>
<footer class="credit">companygraph-chat-server</footer>
</body>
</html>
`;
}
