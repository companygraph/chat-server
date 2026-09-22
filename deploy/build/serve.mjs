// The image's start: the server with the deployment's page, in-process rather than spawned, so
// the container runs one Node process and the one Cloud Run's health check sees.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DIST } from "./config.mjs";

const http = createRequire(import.meta.url).resolve("../../bin/http.mjs");
const flags = ["--page-css", path.join(DIST, "page.css"), "--page-brand", "brand.html"];
if (fs.existsSync("favicon.svg")) flags.push("--page-icon", "favicon.svg");
process.argv = [process.execPath, http, ...flags];
await import(pathToFileURL(http).href);
