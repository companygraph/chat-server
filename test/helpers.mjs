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

export async function startFixtureHost() {
  const server = createHttpServer(exampleSnapshot());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

// The example's core does not carry the type `question` yet (core 0.40.0, not released into the
// pinned meta-model tag this package's fixtures fetch), so the chat's question-index tests add it
// beside the real example rather than into it: a schema entry so `list_types` and `requireType`
// know it, a types entry so it carries no owner, and one entity per title so `list_entities`
// serves them for real, paged like any other type. Ids are zero-padded so the server's own
// id-order sort (`list_entities`'s ordering) matches the order `titles` was given in.
export function questionsSnapshot(titles) {
  const s = exampleSnapshot();
  const width = String(titles.length).length;
  s.schemas = [...s.schemas, { id: "core/question", name: "Question", tagline: "A question a visitor asks, routed to the entities it rests on." }];
  s.types = [...s.types, { type: "question", owner: null }];
  s.entities = [...s.entities, ...titles.map((name, i) => ({ id: `question/q${String(i).padStart(width, "0")}`, type: "question", name, tagline: name, owner: null }))];
  return s;
}

export async function startFixtureHostWithQuestions(titles) {
  const server = createHttpServer(questionsSnapshot(titles));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}
