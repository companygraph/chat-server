/**
 * @param {typeof globalThis.fetch} [fetchFn]
 * @param {{ timeoutMs?: number; identityEndpoint?: string; identityHeader?: string; clientId?: string; audience?: string }} [options]
 */
export declare const azureIdentityToken: (fetchFn?: typeof globalThis.fetch, { timeoutMs, identityEndpoint, identityHeader, clientId, audience }?: {
    timeoutMs?: number;
    identityEndpoint?: string;
    identityHeader?: string;
    clientId?: string;
    audience?: string;
}) => () => Promise<string>;
