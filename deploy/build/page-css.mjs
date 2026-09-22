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
  { family: "Bricolage Grotesque", file: "Bricolage-var.woff2", weight: "200 800" },
  { family: "Instrument Sans", file: "InstrumentSans-var.woff2", weight: "400 700" },
  { family: "Plex Mono", file: "PlexMono-400.woff2", weight: "400" },
  { family: "Plex Mono", file: "PlexMono-600.woff2", weight: "600" },
];
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
fs.writeFileSync(out, [faces, tokens, reset, title, own].join("\n\n") + "\n");
console.log(`wrote ${out}: ${fs.statSync(out).size} bytes`);
