export declare const ANTHROPIC_API = "https://api.anthropic.com";
export declare const TOKEN_TIMEOUT_MS = 10000;
/** @param {string} message */
export declare const credentialError: (message: string) => Error & {
    name: string;
};
/**
 * @param {string} text
 * @param {string} source
 */
export declare function asToken(text: string, source: string): string;
