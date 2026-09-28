// lib/ and bin/ serve any host; a name of the example or of the reference instance in either is
// a fact this package has no business knowing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exampleSnapshot } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Every file at any depth: the platform adapters sit a folder below lib/, and a folder read as a
// file fails the test for the wrong reason.
const sources = ["lib", "bin"].filter((d) => fs.existsSync(path.join(root, d)))
  .flatMap((d) => fs.readdirSync(path.join(root, d), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name))));

// A name counts only as a whole word: an entity named with a plain word may sit inside a
// longer identifier, as one of the example's sits inside toLocaleString, and that is not the
// code naming an entity.
const wholeWord = (word) => new RegExp(`(?<![A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);

test("lib/ and bin/ name no entity of the example and no fact of an instance", () => {
  const names = exampleSnapshot().entities.map((e) => e.name).filter((n) => n.length > 3);
  const forbidden = [...names, "blust.ch", "mental-model", "Robert", "CompanyGraph"];
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const word of forbidden) assert.ok(!wholeWord(word).test(text), `${file} names "${word}"`);
  }
});

// A cloud's SDK is the platform's business: outside lib/platform/ a module reaches one only by
// a dynamic import, at the moment the choice is made, so a deployment on one cloud never loads
// another's.
const CLOUD = /^\s*import\s[^;]*?from\s+["'](@google-cloud\/[^"']+|google-auth-library|@anthropic-ai\/vertex-sdk|@azure\/[^"']+)["']/m;

// deploy/build/ runs in a deployment's image too, so it is held to the same rule.
const buildSources = fs.readdirSync(path.join(root, "deploy", "build")).map((f) => path.join("deploy", "build", f));

test("no module outside lib/platform/ imports a cloud SDK statically", () => {
  for (const file of [...sources, ...buildSources].filter((f) => !f.startsWith(path.join("lib", "platform") + path.sep))) {
    const m = CLOUD.exec(fs.readFileSync(path.join(root, file), "utf8"));
    assert.equal(m, null, `${file} imports ${m?.[1]}`);
  }
});

test("the guard can hit: a static import of a cloud SDK is found", () => {
  assert.ok(CLOUD.test('import { Firestore } from "@google-cloud/firestore";'));
  assert.ok(!CLOUD.test('const { X } = await import("@google-cloud/firestore");'));
});
