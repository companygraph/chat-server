// The stylesheet a deployment hands the server for its page: the family's tokens, reset and
// title contract from the design package, which is the deployment's own devDependency, then the
// deployment's own layout from own.css. The fonts travel inside the sheet as data, since the
// page has no static directory.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT, DIST } from "./config.mjs";

const fencesPath = createRequire(path.join(ROOT, "package.json")).resolve("@robertblust/design/fences");
const { blockFor } = await import(pathToFileURL(fencesPath).href);
const DESIGN = path.dirname(path.dirname(fencesPath));
const FONT_DIR = path.join(DESIGN, "assets", "fonts");
const FONTS = [
  { family: "Bricolage Grotesque", file: "Bricolage-var.woff2", weight: "200 800", license: "Bricolage.LICENSE.txt" },
  { family: "Instrument Sans", file: "InstrumentSans-var.woff2", weight: "400 700", license: "InstrumentSans.LICENSE.txt" },
  { family: "Plex Mono", file: "PlexMono-400.woff2", weight: "400", license: "PlexMono.LICENSE.txt" },
  { family: "Plex Mono", file: "PlexMono-600.woff2", weight: "600", license: "PlexMono.LICENSE.txt" },
];
// The faces are under the SIL Open Font License, which asks for the notice and the license text
// in every copy, and this sheet is one. Design v0.83.0 ships each family's text beside its faces;
// each is written once as a comment ahead of them, and a package without them is refused.
const licenses = [...new Set(FONTS.map((f) => f.license))].map((file) => {
  const at = path.join(FONT_DIR, file);
  if (!fs.existsSync(at))
    throw new Error(`${file} is not in the design package at ${FONT_DIR}; a face is not inlined without its license, so take @robertblust/design v0.83.0 or later`);
  const text = fs.readFileSync(at, "utf8").replace(/\r\n/g, "\n").trim();
  if (text.includes("*/")) throw new Error(`${file} contains "*/" and cannot be written as a CSS comment`);
  return `/* ${file}, for the faces below\n\n${text}\n*/`;
}).join("\n\n");
const faces = FONTS.map(({ family, file, weight }) => {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString("base64");
  return `  @font-face{font-family:"${family}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${weight};font-display:swap}`;
}).join("\n");
const tokens = blockFor("design tokens", "page");
const reset = blockFor("prose reset", null);
const title = blockFor("title contract", null);
const own = fs.readFileSync(path.join(ROOT, "own.css"), "utf8");
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, "page.css");
fs.writeFileSync(out, [licenses, faces, tokens, reset, title, own].join("\n\n") + "\n");
console.log(`wrote ${out}: ${fs.statSync(out).size} bytes`);
