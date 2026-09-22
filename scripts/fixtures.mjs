// Fetches companygraph/meta-model into test/fixtures/ at the tag the installed
// companygraph-mcp-server pins, for its worked example and core/. The example is content, not a
// dependency: the server package ships lib/, bin/ and deploy/ and no fixture.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = JSON.parse(fs.readFileSync(path.join(root, "node_modules/companygraph-mcp-server/package.json"), "utf8"));
const [, repo, tag] = server.dependencies["companygraph-meta-model"].match(/^github:([^#]+)#(.+)$/);
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
