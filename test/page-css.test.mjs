// The deployment's stylesheet inlines the design package's faces, and a face under the SIL Open
// Font License travels only with its notice. So the build is run here against a stand-in design
// package in a temporary deployment: once with the license texts beside the faces, and once
// without them, which has to fail rather than write a sheet with no notice in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../deploy/build/page-css.mjs", import.meta.url));
const FACES = ["Bricolage-var.woff2", "InstrumentSans-var.woff2", "PlexMono-400.woff2", "PlexMono-600.woff2"];
const LICENSES = ["Bricolage.LICENSE.txt", "InstrumentSans.LICENSE.txt", "PlexMono.LICENSE.txt"];

function deployment({ licenses }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "page-css-"));
  const design = path.join(root, "node_modules", "@robertblust", "design");
  fs.mkdirSync(path.join(design, "lib"), { recursive: true });
  fs.mkdirSync(path.join(design, "assets", "fonts"), { recursive: true });
  fs.writeFileSync(path.join(design, "package.json"), JSON.stringify({
    name: "@robertblust/design", type: "module", exports: { "./fences": "./lib/fences.mjs" } }));
  fs.writeFileSync(path.join(design, "lib", "fences.mjs"), 'export const blockFor = (name) => `/* ${name} */`;\n');
  for (const f of FACES) fs.writeFileSync(path.join(design, "assets", "fonts", f), `face ${f}`);
  if (licenses)
    for (const f of LICENSES)
      fs.writeFileSync(path.join(design, "assets", "fonts", f), `Copyright 2022 The ${f} Authors\r\n\r\nSIL Open Font License, Version 1.1\r\n`);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "a-deployment", private: true }));
  fs.writeFileSync(path.join(root, "own.css"), ".shell{}\n");
  return root;
}

const run = (cwd) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

test("the sheet carries each family's license once, ahead of the faces it covers", () => {
  const root = deployment({ licenses: true });
  const r = run(root);
  assert.equal(r.status, 0, r.stderr);
  const css = fs.readFileSync(path.join(root, "dist", "page.css"), "utf8");
  const firstFace = css.indexOf("@font-face");
  for (const f of LICENSES) {
    const at = css.indexOf(`/* ${f}`);
    assert.ok(at >= 0 && at < firstFace, `${f} is written ahead of the faces`);
    assert.equal(css.split(`/* ${f}`).length, 2, `${f} is written once`);
    assert.match(css, new RegExp(`Copyright 2022 The ${f.replace(/\./g, "\\.")} Authors\\n\\nSIL Open Font License`));
  }
  assert.equal(css.includes("\r"), false, "the texts' line endings are the sheet's");
  assert.equal(css.split("@font-face").length - 1, FACES.length);
});

test("a design package without the license texts is refused, naming the first one missing", () => {
  const root = deployment({ licenses: false });
  const r = run(root);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Bricolage\.LICENSE\.txt is not in the design package/);
  assert.equal(fs.existsSync(path.join(root, "dist", "page.css")), false, "no sheet is written");
});
