import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "deploy.mjs");
const run = (args, cwd) => new Promise((resolve) => {
  const child = spawn(process.execPath, [bin, ...args], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  child.on("exit", (code) => resolve({ code, err }));
});

// The command's operator errors are one line and exit 2, as the other commands' are; a report
// asked for outside a deployment's chat/ has no deployment.json to read and says so.
test("report outside a deployment is one line on stderr and exit 2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-report-"));
  const { code, err } = await run(["report"], dir);
  assert.equal(code, 2);
  assert.match(err, /deployment\.json/);
  assert.ok(!err.includes("    at "), "no stack");
});

test("report with a name that is not a week says what a week is, before it looks for a deployment", async () => {
  const { code, err } = await run(["report", "last-week"], os.tmpdir());
  assert.equal(code, 2);
  assert.match(err, /a week is YYYY-Www/);
  assert.ok(!err.includes("deployment.json"), "the week is checked first");
});

test("an unknown command names report among the commands", async () => {
  const { code, err } = await run(["nothing"], os.tmpdir());
  assert.equal(code, 2);
  assert.match(err, /usage: companygraph-chat-deploy <page-css\|tag\|serve\|report \[week\]>/);
});
