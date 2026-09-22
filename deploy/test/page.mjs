import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderPage } from "companygraph-chat-server/page";
import { ROOT, DIST, chat } from "../build/config.mjs";

export function registerPageTests() {
  describe("the page a deployment serves", () => {
    let browser, html;
    before(async () => {
      const c = chat();
      html = renderPage({
        config: { mcpUrl: c.mcp_url, origins: c.origins, monthTokens: c.month_tokens },
        host: { provenance: null },
        origin: `https://${c.domain}`,
        css: fs.readFileSync(path.join(DIST, "page.css"), "utf8"),
        brand: fs.readFileSync(path.join(ROOT, "brand.html"), "utf8").trim(),
      });
      browser = await chromium.launch();
    });
    after(async () => { await browser?.close(); });

    test("the content sits in the family's shell", async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.setContent(html);
      const shell = await page.evaluate(() => {
        const m = document.querySelector("main.shell"); const cs = getComputedStyle(m);
        return { padRight: cs.paddingRight, outer: Math.round(m.getBoundingClientRect().width), bodyPadTop: getComputedStyle(document.body).paddingTop };
      });
      assert.equal(shell.padRight, "80px");
      assert.equal(shell.outer, 1180);
      assert.equal(shell.bodyPadTop, "0px");
      await page.close();
    });

    test("the title contract shapes the headline", async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.setContent(html);
      const h = await page.evaluate(() => {
        const w = (s) => Number(getComputedStyle(document.querySelector(s)).fontWeight);
        return { family: getComputedStyle(document.querySelector(".title h1")).fontFamily, light: w(".title h1 .r70"), heavy: w(".title h1 .rcl") };
      });
      assert.match(h.family, /Bricolage/);
      assert.ok(h.heavy > h.light);
      await page.close();
    });

    test("on a phone the wordmark holds and nothing scrolls sideways", async () => {
      const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
      await page.setContent(html);
      const shut = await page.evaluate(() => ({
        brand: Math.round(document.querySelector(".brand").getBoundingClientRect().height),
        mark: Math.round(document.querySelector(".brand svg").getBoundingClientRect().height),
        wide: document.documentElement.scrollWidth > window.innerWidth,
      }));
      assert.ok(shut.brand <= shut.mark, `the wordmark broke: ${shut.brand}px against a ${shut.mark}px mark`);
      assert.ok(!shut.wide);
      await page.close();
    });
  });
}
