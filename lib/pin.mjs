// What a package.json pins of a family package, whichever way it takes it: from git, under any
// name, as `github:owner/repo#tag`, or from npm as `@owner/repo` at an exact version. A
// deployment may take this chat either way, and the chat's tests take the MCP server from npm,
// so every reader of a pin reads both, and the tag is the one fact the two forms share.
import fs from "node:fs";
import path from "node:path";

// The names each package has gone by, its npm name first.
export const CHAT = ["@companygraph/chat-server", "companygraph-chat-server"];
export const SERVER = ["@companygraph/mcp-server", "companygraph-mcp-server"];
export const PARSER = ["@companygraph/meta-model", "companygraph-meta-model"];

/**
 * The tag a dependency names: the ref after `#` of a git spec, or `v` and the version of an npm one.
 * @param {string} spec
 * @returns {string}
 */
export function tagOf(spec) {
  const hash = spec.indexOf("#");
  return hash >= 0 ? spec.slice(hash + 1) : `v${spec}`;
}

/**
 * The first of `names` a package.json depends on, in `dependencies` or `devDependencies`, the
 * spec it gives and the tag that spec names.
 * @param {{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }} pkg
 * @param {string[]} names
 * @returns {{ name: string; spec: string; tag: string }}
 */
export function pinOf(pkg, names) {
  for (const name of names) {
    const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    if (spec) return { name, spec, tag: tagOf(spec) };
  }
  throw new Error(`package.json depends on none of ${names.join(", ")}`);
}

/**
 * The package.json of `name` as Node finds it from `from`: the nearest `node_modules/<name>` on the
 * way up, nested under a package or hoisted beside it.
 * @param {string} name
 * @param {string} from
 * @returns {{ version: string; dependencies?: Record<string, string> }}
 */
export function installedPackage(name, from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", name, "package.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    if (path.dirname(dir) === dir) throw new Error(`${name} is not installed at or above ${from}`);
  }
}
