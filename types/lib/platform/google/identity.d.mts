export declare const METADATA_IDENTITY_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://api.anthropic.com&format=full";
export declare const googleIdentityToken: (fetchFn?: typeof fetch, { timeoutMs }?: {
    timeoutMs?: number | undefined;
}) => () => Promise<string>;
