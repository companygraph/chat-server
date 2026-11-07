/**
 * The secret at a vault URL without a version, the latest one. A rotation reaches each replica
 * as it starts, and Container Apps starts one on each scale from zero and on each revision.
 * @param {string} url
 * @param {{ fetchFn?: typeof globalThis.fetch; timeoutMs?: number; identityEndpoint?: string; identityHeader?: string; clientId?: string }} [options]
 * @returns {Promise<string>}
 */
export declare function vaultSecret(url: string, { fetchFn, timeoutMs, ...identity }?: {
    fetchFn?: typeof globalThis.fetch;
    timeoutMs?: number;
    identityEndpoint?: string;
    identityHeader?: string;
    clientId?: string;
}): Promise<string>;
