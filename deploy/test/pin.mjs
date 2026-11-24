// The pin a deployment carries in three places: chat/package.json names the release, and the
// workflow and the Terraform module that fetch it by tag have to name the same one. The
// installed package's own version is the one thing the tag cannot lie about.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../build/config.mjs";
import { pinOf, installedPackage, CHAT } from "../../lib/pin.mjs";

// A deployment takes the chat from git as companygraph-chat-server or from npm as
// @companygraph/chat-server, so the pin is read under whichever name and in whichever form it is
// written, and held by its tag.
export function registerPinTests() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const chat = pinOf(pkg, CHAT);
  const installed = installedPackage(chat.name, ROOT);
  const repo = path.join(ROOT, "..");

  test("the installed chat server is the release chat/package.json pins", () => {
    assert.equal("v" + installed.version, chat.tag);
  });

  test("the chat's release is named once, in chat/package.json, the workflow and the module", () => {
    const tag = chat.tag;
    const refs = [];
    for (const dir of [".github/workflows", "infra/chat"]) {
      const d = path.join(repo, dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d).filter((f) => /\.(ya?ml|tf)$/.test(f)))
        for (const m of fs.readFileSync(path.join(d, f), "utf8").matchAll(/companygraph\/chat-server[^\s"']*?(@|\?ref=)(v[\d.]+)/g))
          refs.push({ file: `${dir}/${f}`, kind: m[1] === "@" ? "workflow" : "module", ref: m[2] });
    }
    assert.ok(refs.some((r) => r.kind === "workflow"), "a deployment names the release in a workflow, by @tag");
    assert.ok(refs.some((r) => r.kind === "module"), "a deployment names the release in its Terraform module, by ?ref=tag");
    for (const { file, ref } of refs) assert.equal(ref, tag, `${file} names ${ref}; chat/package.json pins ${tag}`);
  });
}
