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

// The packs the example takes, since meta-model v0.86.0 the organization pack, whose groups, group
// kinds and jobs it holds, since v0.89.0 the landscape pack, whose systems, system kinds, data
// objects and services it holds, and since v0.94.0 the requirements pack, whose use cases and
// requirements it holds. The example has no manifest to name them, so they are named here
// once; each pack's schemas ride beside core's under `<pack>/<file>`, the key the parser reads a
// pack's schema by, or the parser refuses the pack's folders as declared by no schema (R13).
const EXAMPLE_PACKS = ["organization", "landscape", "requirements"];

export function exampleSnapshot() {
  const files = readDir(path.join(fixtures, "example", "model"));
  const schemas = readDir(path.join(fixtures, "core"));
  for (const pack of EXAMPLE_PACKS) {
    // A fixture fetched at an earlier release holds no such pack, and its example takes none.
    const dir = path.join(fixtures, "packs", pack);
    if (fs.existsSync(dir)) for (const [file, text] of readDir(dir)) schemas.set(`${pack}/${file}`, text);
  }
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

// `front`, where given, stands in for the front end a host sits behind: handed the number of
// requests answered so far, it names a status to answer in the host's place, with the HTML page a
// front end serves while its backend restarts, or `"hang"` for a request accepted and never
// answered, or nothing for the host to answer as it would; `requests()` counts every request it was handed.
export async function startFixtureHost({ front } = {}) {
  const server = createHttpServer(exampleSnapshot());
  let requests = 0;
  if (front) {
    const handlers = server.listeners("request");
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      const answer = front(requests++);
      if (answer === "hang") return;
      if (answer) { res.writeHead(answer, { "content-type": "text/html" }); res.end(`<html><body>${answer} backend read error</body></html>`); return; }
      for (const h of handlers) h.call(server, req, res);
    });
  }
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  // A request left hanging would hold close() open, so a front's connections are ended with it.
  return { url, requests: () => requests, close: () => new Promise((r) => { server.close(r); if (front) server.closeAllConnections(); }) };
}
