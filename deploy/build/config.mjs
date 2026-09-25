// A deployment's chat values, read from the directory the command runs in: the deployment's
// `chat/` folder, which holds chat.json, the Dockerfile, brand.html and own.css.
import fs from "node:fs";
import path from "node:path";
export const ROOT = process.cwd();
export const DIST = path.join(ROOT, "dist");
export const chat = () => JSON.parse(fs.readFileSync(path.join(ROOT, "chat.json"), "utf8"));
// The project's values, one directory up: a deployment's chat/ sits beside its deployment.json.
export const deployment = () => JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));
