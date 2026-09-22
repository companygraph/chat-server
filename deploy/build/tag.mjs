// The image tag: the installed chat server's version, so a tag names what runs. The repository
// commit is appended by the workflow.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/companygraph-chat-server/package.json"), "utf8"));
process.stdout.write(`${pkg.version}\n`);
