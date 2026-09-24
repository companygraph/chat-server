// The fixture host: the MCP server package's own HTTP server over the meta-model's worked
// example, started in-process on a free port. The suite talks to a real host over the real
// protocol and never to a copy of its interface.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDir } from "companygraph-mcp-server/read";
import { buildSnapshot } from "companygraph-mcp-server/snapshot";
import { createHttpServer } from "companygraph-mcp-server/http";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "meta-model");
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export function exampleSnapshot() {
  const files = readDir(path.join(fixtures, "example", "model"));
  const schemas = readDir(path.join(fixtures, "core"));
  return buildSnapshot({ files, schemas, sub: "example/model/", core: "core/", commit: COMMIT, repo: "companygraph/meta-model" });
}

// The example's root, read from the fixture rather than typed, so a release that renames the
// example company changes nothing here.
export const EXAMPLE_ROOT = fs.readFileSync(path.join(fixtures, "example", "model", "identity.md"), "utf8").match(/^# (.+)$/m)[1];

// The example's own questions (core 0.40.0), read from the fixture the same way EXAMPLE_ROOT is,
// in the order `list_entities` serves them: by id, and an id sorts as its filename does. Titles,
// not typed here, so a release that changes the example's wording changes nothing here either.
const questionFiles = fs.readdirSync(path.join(fixtures, "example", "model", "questions")).filter((f) => f.endsWith(".md")).sort();
export const QUESTION_TITLES = questionFiles.map((f) => fs.readFileSync(path.join(fixtures, "example", "model", "questions", f), "utf8").match(/^# (.+)$/m)[1]);

export async function startFixtureHost() {
  const server = createHttpServer(exampleSnapshot());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}
