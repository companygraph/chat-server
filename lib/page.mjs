// The page at /, for whoever types the host into a browser: built the way the MCP host's own
// page is built, from the model's own words. The host's handshake gives the same instructions a
// tool-calling client is given — the model's taglines, a glossary of terms, and the sentence
// that the host adds nothing — and this page takes only the taglines from it, the paragraphs
// before the glossary's own first line, because a glossary of terms tool descriptions lean on is
// not something a reader of this page needs. What this page adds is its own: that the chat, in
// turn, adds nothing the tools did not say.
//
// A deployment hands in the family's stylesheet and its own wordmark, as the MCP host's page
// takes them; the built-in sheet is plain so that any deployment reads without one. The class
// names are the contract a deployment's sheet is written against.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u ?? ""); } };

const BUILT_IN = `body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222;background:#fff}
main.shell{max-width:1180px;margin:0 auto;padding:1rem}
header{padding:2rem 0}.bar{display:flex;align-items:center}
.brand{display:flex;align-items:center;gap:.5rem;text-decoration:none;color:inherit;font-weight:600}
.brand svg{width:28px;height:28px}.brand b span{color:#3b6}
.title h1{margin:0;font-size:2rem;line-height:1.15}
.title h1 .r70{display:block;font-weight:300;color:#777}
.title h1 .rcl{display:block;font-weight:700}
.title h1 em{font-style:normal;color:#3b6}
.tagline{font-size:1.1rem;color:#555}
.note{margin:1.5rem 0;padding-left:1rem;border-left:2px solid #3b6;color:#333}
.note p{margin:0 0 .75rem}.note p:last-child{margin-bottom:0}
h2{font-size:1.1rem;margin:2rem 0 .5rem}
.lede{color:#555}
pre{background:#f4f4f4;border:1px solid #ddd;border-radius:6px;padding:.75rem 1rem;overflow-x:auto}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
.ops{margin-top:1rem;padding:0;list-style:none;display:grid;gap:.5rem}
.ops>li{background:#f4f4f4;border:1px solid #ddd;border-radius:8px}
.ops .head{display:grid;gap:.15rem .75rem;align-items:baseline;padding:.5rem .75rem}
.ops .m{font-size:.74rem;font-weight:600;letter-spacing:.08em;color:#3b6}
.ops .p{font-size:.9rem}
.ops .s{font-size:.93rem;color:#555}
footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd;color:#777;font-size:.9rem}`;

const MARK = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="14" r="4" fill="currentColor"/></svg>`;

// The events this chat's own stream carries, in docs/INTERFACE.md's words.
const EVENTS = [
  ["text", "a piece of the answer, as it is generated, in order"],
  ["cite", "a tool answered with one entity; the widget links it, and an entity fetched again in a later round is not cited twice"],
  ["done", "the last event: the host's provenance, what the message cost in the meter's unit, and what is left of today's share"],
  ["error", "the last event when something arrives after the stream began: host_down, busy or internal"],
];

const providerName = (provider) => (provider === "vertex" ? "Vertex AI" : "the Anthropic API");

export function renderPage({ config, host, origin, css = null, brand = null, icon = null }) {
  const site = config.origins[0] ?? origin;
  const title = host.title || hostOf(site);
  const p = host?.provenance ?? null;

  // The host's handshake gives the same instructions a tool-calling client reads: the model's
  // taglines, then a glossary of terms a page's reader has no use for, then a sentence the host
  // adds. The glossary's own first line is the boundary; everything before it is a tagline.
  const paragraphs = (host.instructions || "").split("\n\n").map((s) => s.trim()).filter(Boolean);
  const termsAt = paragraphs.findIndex((s) => s.startsWith("Terms the tools use."));
  const taglines = termsAt === -1 ? paragraphs : paragraphs.slice(0, termsAt);
  const [lede, ...restTaglines] = taglines;

  const commitClause = p
    ? `at commit ${esc(p.commit ?? "(uncommitted)")} (core ${esc(p.core)})`
    : "at a commit not read yet";
  const ownSentence = `This chat answers from what ${esc(hostOf(config.mcpUrl))} says ${commitClause}, `
    + `through Claude Sonnet 5 on ${esc(providerName(config.provider))}, and adds nothing the tools did not say.`;
  const noteParas = [...restTaglines.map((s) => `<p>${esc(s)}</p>`), `<p>${ownSentence}</p>`].join("\n");

  const shortCommit = (c) => (c ? c.slice(0, 7) : "(uncommitted)");
  const readsClause = p
    ? `at commit ${esc(shortCommit(p.commit))} with core ${esc(p.core)} and parser ${esc(p.parser)}`
    : "at a commit not read yet";

  const brandInner = brand ?? `${MARK}<b>${esc(title)}</b>`;

  const opRows = [
    ["POST", "/chat", "a message: the conversation and the language, answered as a stream of events."],
    ["GET", "/chat", "what the chat is: the model, the provider, the host, the origins, the ceilings, spending nothing."],
    ["GET", "/health", "whether the service is up, and the host's commit."],
    ["GET", "/", "this page."],
  ].map(([m, path, s]) => `<li><div class="head"><code class="mono m">${esc(m)}</code><code class="mono p">${esc(path)}</code><span class="s">${s}</span></div></li>`).join("\n");

  const eventRows = EVENTS.map(([name, s]) => `<li><div class="head"><code class="mono p">${esc(name)}</code><span class="s">${esc(s)}</span></div></li>`).join("\n");

  const curl = `curl -N -H 'X-Chat: 1' -H 'content-type: application/json' ${origin}/chat -d '{"messages":[{"role":"user","content":"…"}],"lang":"en"}'`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — chat</title>
<meta name="description" content="A chat over one company model: every answer is what the model's MCP host says at one commit.">
<meta name="robots" content="index, follow">
${icon ? `<link rel="icon" href="${icon}">` : ""}
<style>
${css ?? BUILT_IN}
</style>
</head>
<body>
<main class="shell">
<header><div class="bar"><a class="brand" href="${esc(site)}" aria-label="${esc(title)}">${brandInner}</a></div></header>
<div class="title"><h1><span class="r70">${esc(title)}</span><span class="rcl">in a <em>chat</em>.</span></h1></div>
${lede ? `<p class="tagline">${esc(lede)}</p>` : ""}
<div class="note">
${noteParas}
</div>

<h2>The endpoint</h2>
<p class="lede">Four paths, and one of them is the chat: a page of <code class="mono">${esc(site)}</code> opens it, and any client may send a message with the <code class="mono">X-Chat</code> header.</p>
<ul class="ops">
${opRows}
</ul>
<p class="lede">One message by hand:</p>
<pre>${esc(curl)}</pre>

<h2>What it answers</h2>
<ul class="ops tools">
${eventRows}
</ul>

<h2>The fence</h2>
<p class="lede">${config.monthTokens.toLocaleString("en")} input-equivalent tokens a month and a tenth a day, twenty requests an hour for one address, every refusal made before the model is asked, nothing typed kept, a count of what was spent the only thing written.</p>

<h2>What it reads</h2>
<p class="lede">The host at <a href="${esc(config.mcpUrl)}">${esc(config.mcpUrl)}</a>, ${readsClause}, so an answer can be checked against the model it came from.</p>

<footer>Served by <a href="https://github.com/companygraph/chat-server">companygraph/chat-server</a>, the chat over any instance's MCP host · <a href="https://companygraph.io">companygraph.io</a></footer>
</main>
</body>
</html>
`;
}
