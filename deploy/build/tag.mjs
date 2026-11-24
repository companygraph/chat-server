// The image tag: the installed chat server's version, so a tag names what runs. The repository
// commit is appended by the workflow.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";
import { pinOf, installedPackage, CHAT } from "../../lib/pin.mjs";
const pkg = installedPackage(pinOf(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")), CHAT).name, ROOT);
process.stdout.write(`${pkg.version}\n`);
