import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "../lib/page.mjs";

const html = renderPage({
  config: { mcpUrl: "https://mcp.site.test/mcp", origins: ["https://site.test"], monthTokens: 1000 },
  host: { provenance: { commit: "abc", repo: "o/r", core: "1.0.0", parser: "v1" } },
  origin: "https://chat.site.test",
});

test("the page carries the markup contract a deployment styles against", () => {
  for (const cls of ["brand", "shell", "title", "r70", "rcl", "facts", "note", "credit"])
    assert.ok(new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `class ${cls} is emitted`);
  assert.match(html, /<main class="shell"/);
  assert.match(html, /<dl class="facts"/);
});

test("the page says which site opens it, which host it reads, and at which commit", () => {
  assert.match(html, /https:\/\/site\.test/);
  assert.match(html, /mcp\.site\.test/);
  assert.match(html, /abc/);
  assert.match(html, /<title>/);
  assert.ok(!html.includes("<script"), "the page runs nothing");
});

test("a supplied stylesheet replaces the built-in one, and a brand replaces the name", () => {
  const styled = renderPage({ config: { mcpUrl: "u", origins: [], monthTokens: 1 }, host: { provenance: null }, origin: "https://x", css: ".mine{}", brand: "<b>Own <span>brand</span></b>" });
  assert.ok(styled.includes(".mine{}"));
  assert.ok(styled.includes("Own <span>brand</span>"));
  assert.ok(!styled.includes("main.shell{"), "the built-in sheet is gone");
});
