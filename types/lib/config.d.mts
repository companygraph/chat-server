export type Env = Record<string, string | undefined>;
export type Federation = {
    ruleId: string;
    organizationId: string;
    serviceAccountId: string;
    workspaceId: string | null;
};
export type Config = {
    mcpUrl: string;
    origins: string[];
    hosts: string[] | null;
    monthTokens: number;
    project: string | null;
    region: string | null;
    proxyHops: number;
    questionIndexChars: number;
    port: number;
    meter: string;
    identity: string;
    log: string;
    anthropicKey: string | null;
    anthropicFederation: Federation | null;
    verdict: boolean;
    typesafeKey: string | null;
    verdictThreshold: number | null;
    inferenceGeo: "global" | "us" | null;
    provider: "anthropic" | "vertex";
    credential: "key" | "federation" | "google";
    meterOptions: Record<string, string>;
    identityOptions: Record<string, string>;
};
/**
 * @param {Env} [env]
 * @returns {Config}
 */
export declare function configFromEnv(env?: Env): Config;
