// The JavaScript in `lib/`, `bin/` and `deploy/` is the source and what a consumer runs; its
// types are JSDoc in the same files. The declarations a TypeScript consumer reads are written
// from that JSDoc into `types/` by `npm run build`, and committed, because a consumer takes the
// package from a tag and builds nothing. This holds the committed declarations to what that build
// writes. It builds into a temporary folder, never over the committed files, because CI never
// writes what the repository commits; it only says whether the two are the same.
//
// Two failures, each named by path. A declaration the build writes that is missing or differs
// byte for byte is JSDoc edited without `npm run build` after it, or an edit to a declaration
// that the next build would undo. A committed declaration the build did not write is one left
// behind by a module that is gone, and a consumer would still read it.
//
//   node tools/build-check.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "types";

// The compiler as installed by `npm ci`, run by this Node rather than through a shell, so the
// same line works on Windows, where `node_modules/.bin/tsc` is a `.cmd`.
const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");

// Every file under a folder, keyed by its path from `base` with `/`, whatever the platform says.
function filesUnder(base, rel) {
  const out = [];
  if (!existsSync(join(base, rel))) return out;
  for (const entry of readdirSync(join(base, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(base, child));
    else out.push(child);
  }
  return out;
}

const temp = mkdtempSync(join(tmpdir(), "chat-server-build-"));
const failures = [];
let refused = null;
try {
  const built = spawnSync(process.execPath, [tsc, "--project", ROOT, "--outDir", join(temp, OUT)], { cwd: ROOT, encoding: "utf8" });
  if (built.status !== 0) refused = `${built.stdout}${built.stderr}\n✗ tsc answered ${built.status ?? built.signal}; nothing was compared`;
  else {
    const written = new Set(filesUnder(temp, OUT));
    for (const path of [...written].sort()) {
      const committed = join(ROOT, path);
      if (!existsSync(committed)) failures.push(`${path} is what the build writes, and it is not committed`);
      else if (!readFileSync(committed).equals(readFileSync(join(temp, path))))
        failures.push(`${path} is not what the build writes from the JSDoc; run npm run build and commit what it writes`);
    }
    for (const path of filesUnder(ROOT, OUT).sort())
      if (!written.has(path)) failures.push(`${path} is in ${OUT}/, and no module writes it`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (refused) {
  console.error(refused);
  process.exit(1);
}
if (failures.length) {
  console.error(`\n✗ ${failures.length} declaration${failures.length > 1 ? "s" : ""} out of step with the JSDoc\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ ${OUT}/ is what the JSDoc in lib/, bin/ and deploy/ declares`);
