import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "../lib/page.mjs";

const host = {
  title: "Beacon",
  instructions: "Lede one.\n\nSecond line.\n\nTerms the tools use. An id identifies one entity. This server reports what the model says at one commit, and adds nothing.",
  provenance: { commit: "abc1234", repo: "o/r", core: "1.0.0", parser: "v1" },
};

const config = { mcpUrl: "https://mcp.site.test/mcp", origins: ["https://site.test"], monthTokens: 1000, provider: "anthropic" };

const html = renderPage({ config, host, origin: "https://chat.site.test" });

test("the page carries the markup contract a deployment styles against", () => {
  for (const cls of ["bar", "brand", "shell", "title", "r70", "rcl", "tagline", "note", "lede", "ops", "head", "m", "p", "s"])
    assert.ok(new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `class ${cls} is emitted`);
  assert.match(html, /<main class="shell"/);
  assert.match(html, /<h2>The endpoint<\/h2>/);
  assert.match(html, /<h2>What it answers<\/h2>/);
  assert.match(html, /<h2>The fence<\/h2>/);
  assert.match(html, /<h2>What it reads<\/h2>/);
  assert.match(html, /<pre>[\s\S]*X-Chat: 1[\s\S]*<\/pre>/);
  assert.ok(!html.includes("<script"), "the page runs nothing");
});

test("the page says the title, the lede, the site, the host, the commit, the provider and the ceiling", () => {
  assert.match(html, /Beacon/);
  assert.match(html, /Lede one\./);
  assert.match(html, /site\.test/);
  assert.match(html, /mcp\.site\.test/);
  assert.match(html, /abc1234/);
  assert.match(html, /the Anthropic API/);
  assert.match(html, /1,000/);
});

test("a supplied stylesheet replaces the built-in one, a supplied brand replaces the title in the header, and with no brand the mark is present once", () => {
  const styled = renderPage({ config, host, origin: "https://chat.site.test", css: ".mine{}" });
  assert.ok(styled.includes(".mine{}"));
  assert.ok(!styled.includes(".title h1{"), "the built-in sheet is gone");

  const branded = renderPage({ config, host, origin: "https://chat.site.test", brand: "<b>Own <span>brand</span></b>" });
  const header = branded.slice(0, branded.indexOf("</header>"));
  assert.ok(header.includes("Own <span>brand</span>"));
  assert.ok(!header.includes("<svg"), "no built-in mark beside a supplied brand");

  const plain = renderPage({ config, host, origin: "https://chat.site.test" });
  const plainHeader = plain.slice(0, plain.indexOf("</header>"));
  assert.equal((plainHeader.match(/<svg/g) ?? []).length, 1, "the built-in mark stands in for a brand exactly once");
});

test("a vertex provider reads Vertex AI, and a null provenance reads a commit not read yet", () => {
  const vertex = renderPage({ config: { ...config, provider: "vertex" }, host, origin: "https://chat.site.test" });
  assert.match(vertex, /Vertex AI/);

  const unread = renderPage({ config, host: { ...host, provenance: null }, origin: "https://chat.site.test" });
  assert.match(unread, /a commit not read yet/);
});

test("What it reads carries the short commit, in a paragraph that does not wrap; the note keeps the full one, where it does", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const longHost = { ...host, provenance: { ...host.provenance, commit } };
  const out = renderPage({ config, host: longHost, origin: "https://chat.site.test" });

  const readsSection = out.slice(out.indexOf("<h2>What it reads</h2>"));
  assert.ok(readsSection.includes(commit.slice(0, 7)), "the lede carries the seven-character commit");
  assert.ok(!readsSection.includes(commit), "the lede does not carry the full forty-character commit");

  const noteSection = out.slice(out.indexOf('<div class="note">'), out.indexOf("<h2>The endpoint</h2>"));
  assert.ok(noteSection.includes(commit), "the note carries the full commit, where it wraps");
});
