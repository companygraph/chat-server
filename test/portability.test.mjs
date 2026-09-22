// lib/ and bin/ serve any host; a name of the example or of the reference instance in either is
// a fact this package has no business knowing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exampleSnapshot } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["lib", "bin"].filter((d) => fs.existsSync(path.join(root, d)))
  .flatMap((d) => fs.readdirSync(path.join(root, d)).map((f) => path.join(d, f)));

test("lib/ and bin/ name no entity of the example and no fact of an instance", () => {
  const names = exampleSnapshot().entities.map((e) => e.name).filter((n) => n.length > 3);
  const forbidden = [...names, "blust.ch", "mental-model", "Robert", "CompanyGraph"];
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const word of forbidden) assert.ok(!text.includes(word), `${file} names "${word}"`);
  }
});
