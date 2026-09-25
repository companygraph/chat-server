#!/usr/bin/env node
// One command for a deployment's build, run in its chat/ directory: `page-css` writes dist/page.css
// from the design package, `tag` prints the image tag, `serve` starts the server with the page,
// `report` writes the week's questions to the project's reports bucket.
// An operator error is one line on stderr and exit 2.
const USAGE = "usage: companygraph-chat-deploy <page-css|tag|serve|report>";
try {
  const cmd = process.argv[2];
  switch (cmd) {
    case "page-css": await import("../deploy/build/page-css.mjs"); break;
    case "tag": await import("../deploy/build/tag.mjs"); break;
    case "serve": await import("../deploy/build/serve.mjs"); break;
    case "report": await import("../deploy/build/report.mjs"); break;
    default: console.error(USAGE); process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
