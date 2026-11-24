export declare const CHAT: string[];
export declare const SERVER: string[];
export declare const PARSER: string[];
/**
 * The tag a dependency names: the ref after `#` of a git spec, or `v` and the version of an npm one.
 * @param {string} spec
 * @returns {string}
 */
export declare function tagOf(spec: string): string;
/**
 * The first of `names` a package.json depends on, in `dependencies` or `devDependencies`, the
 * spec it gives and the tag that spec names.
 * @param {{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }} pkg
 * @param {string[]} names
 * @returns {{ name: string; spec: string; tag: string }}
 */
export declare function pinOf(pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}, names: string[]): {
    name: string;
    spec: string;
    tag: string;
};
/**
 * The package.json of `name` as Node finds it from `from`: the nearest `node_modules/<name>` on the
 * way up, nested under a package or hoisted beside it.
 * @param {string} name
 * @param {string} from
 * @returns {{ version: string; dependencies?: Record<string, string> }}
 */
export declare function installedPackage(name: string, from: string): {
    version: string;
    dependencies?: Record<string, string>;
};
