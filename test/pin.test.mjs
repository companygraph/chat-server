// A deployment takes the chat from git as companygraph-chat-server or from npm as
// @companygraph/chat-server. The pin test and the image tag ship in this package and run in the
// deployment's chat/, so both are run here over a deployment of each kind, with this checkout
// linked in under the name that deployment installed it by.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tagOf, pinOf, installedPackage, CHAT, SERVER } from "../lib/pin.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const own = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const OWN = `v${own.version}`;

test("a pin names its tag from git by its ref and from npm by its version", () => {
  assert.equal(tagOf("github:companygraph/chat-server#v0.45.0"), "v0.45.0");
  assert.equal(tagOf("0.46.0"), "v0.46.0");
});

test("a package is found under its npm name first, in dependencies or devDependencies", () => {
  assert.deepEqual(pinOf({ dependencies: { "companygraph-chat-server": "github:companygraph/chat-server#v0.45.0" } }, CHAT), { name: "companygraph-chat-server", spec: "github:companygraph/chat-server#v0.45.0", tag: "v0.45.0" });
  assert.deepEqual(pinOf(own, SERVER).name, "@companygraph/mcp-server");
  assert.throws(() => pinOf({}, CHAT), /depends on none of @companygraph\/chat-server, companygraph-chat-server/);
});

test("an installed package is found nested under a package or hoisted above it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
  const write = (at, version) => {
    fs.mkdirSync(at, { recursive: true });
    fs.writeFileSync(path.join(at, "package.json"), JSON.stringify({ version }));
  };
  const server = path.join(dir, "node_modules", "@companygraph", "mcp-server");
  write(path.join(dir, "node_modules", "@companygraph", "meta-model"), "0.98.0");
  write(server, "0.76.0");
  assert.equal(installedPackage("@companygraph/meta-model", server).version, "0.98.0");
  write(path.join(server, "node_modules", "@companygraph", "meta-model"), "0.97.0");
  assert.equal(installedPackage("@companygraph/meta-model", server).version, "0.97.0");
  assert.throws(() => installedPackage("@companygraph/chat-server", server), /is not installed/);
});

// A deployment's chat/ with this checkout installed in it, and the workflow and the module of the
// repository around it naming `tag`.
function deployment({ tag, from }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "chat-deployment-"));
  const chat = path.join(repo, "chat");
  const name = from === "npm" ? "@companygraph/chat-server" : "companygraph-chat-server";
  const spec = from === "npm" ? tag.replace(/^v/, "") : `github:companygraph/chat-server#${tag}`;
  fs.mkdirSync(path.join(chat, "node_modules", ...name.split("/").slice(0, -1)), { recursive: true });
  fs.writeFileSync(path.join(chat, "package.json"), JSON.stringify({ dependencies: { [name]: spec } }));
  fs.symlinkSync(root, path.join(chat, "node_modules", name), "dir");
  fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".github", "workflows", "chat.yml"), `jobs:\n  chat:\n    uses: companygraph/chat-server/.github/workflows/deploy-google.yml@${tag}\n`);
  fs.mkdirSync(path.join(repo, "infra", "chat"), { recursive: true });
  fs.writeFileSync(path.join(repo, "infra", "chat", "main.tf"), `module "chat" {\n  source = "github.com/companygraph/chat-server//deploy/google/terraform?ref=${tag}"\n}\n`);
  return chat;
}

// The child names its reporter and drops the mark `node --test` leaves in its environment, which
// would otherwise make the nested run step aside and pass on nothing.
function pinTests(chat) {
  const shared = pathToFileURL(path.join(root, "deploy", "test", "pin.mjs")).href;
  fs.writeFileSync(path.join(chat, "pin.test.mjs"), `import { registerPinTests } from ${JSON.stringify(shared)};\nregisterPinTests();\n`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", "pin.test.mjs"], { cwd: chat, env, encoding: "utf8" });
}

for (const from of ["git", "npm"]) {
  test(`the shipped pin tests pass over a deployment that takes this release from ${from}, and fail over one that names another`, () => {
    const ok = pinTests(deployment({ tag: OWN, from }));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^ok \d+ - the installed chat server is the release chat\/package.json pins/m);
    const off = pinTests(deployment({ tag: "v0.0.1", from }));
    assert.notEqual(off.status, 0);
    assert.match(off.stdout, /^not ok \d+ - the installed chat server is the release chat\/package.json pins/m);
  });

  test(`the image tag is the installed chat's version when the deployment takes it from ${from}`, () => {
    const r = spawnSync(process.execPath, [path.join(root, "deploy", "build", "tag.mjs")], { cwd: deployment({ tag: OWN, from }), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${own.version}\n`);
  });
}
