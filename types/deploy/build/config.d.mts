export type DeploymentFile = Record<string, any>;
export type Platform = "google" | "azure";
/**
 * chat.json and deployment.json are the deployment's own files, read as they are and checked
 * below by form, so a value is read where it is used.
 * @typedef {Record<string, any>} DeploymentFile
 */
/**
 * @typedef {"google" | "azure"} Platform
 */
export declare const ROOT: string;
export declare const DIST: string;
/** @returns {DeploymentFile} */
export declare const chat: () => DeploymentFile;
/** @returns {DeploymentFile} */
export declare const deployment: () => DeploymentFile;
export declare const PLATFORMS: readonly ["google", "azure"];
/**
 * @param {DeploymentFile} d
 * @returns {Platform}
 */
export declare function platformOf(d: DeploymentFile): Platform;
/**
 * @param {DeploymentFile} c
 * @param {Platform} [platform]
 * @returns {string[]}
 */
export declare function federationProblems(c: DeploymentFile, platform?: Platform): string[];
/**
 * @param {DeploymentFile} c
 * @param {Platform} platform
 * @returns {string[]}
 */
export declare function chatProblems(c: DeploymentFile, platform: Platform): string[];
