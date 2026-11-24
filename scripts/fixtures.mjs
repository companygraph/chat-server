// Fetches companygraph/meta-model into test/fixtures/ at the tag the installed MCP server pins, for its worked example and core/. The example is content, not a
// dependency: the server package ships lib/, bin/ and deploy/ and no fixture.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pinOf, installedPackage, SERVER, PARSER } from "../lib/pin.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const own = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const server = installedPackage(pinOf(own, SERVER).name, root);
// The server takes the parser from npm by version, which names its tag; a git pin names its
// repository too.
const { spec, tag } = pinOf(server, PARSER);
const repo = /^github:([^#]+)#/.exec(spec)?.[1] ?? "companygraph/meta-model";
const url = `https://codeload.github.com/${repo}/tar.gz/${/^[0-9a-f]{40}$/.test(tag) ? tag : `refs/tags/${tag}`}`;
const target = path.join(root, "test", "fixtures", "meta-model");
const marker = path.join(target, ".ref");

if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === tag) {
  console.log(`fixtures: ${repo}@${tag} already present`);
} else {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync("tar", ["-xz", "--strip-components=1", "-C", target], { input: Buffer.from(await res.arrayBuffer()) });
  fs.writeFileSync(marker, tag + "\n");
  console.log(`fixtures: ${repo}@${tag} fetched into test/fixtures/meta-model`);
}
