export declare const MODEL = "jev-1.13.0";
/** @param {import("./verdict.mjs").JudgeRequest} request */
export declare function wireOf({ state, questions }: import("./verdict.mjs").JudgeRequest): {
    model: string;
    state: {
        answers: Record<string, string>;
    };
    questions: Record<string, object>;
};
/**
 * @param {{ key: string; url?: string; fetch?: typeof globalThis.fetch }} options
 */
export declare function typesafeJudge({ key, url, fetch }: {
    key: string;
    url?: string;
    fetch?: typeof globalThis.fetch;
}): (request: import("./verdict.mjs").JudgeRequest, { signal }?: {
    signal?: AbortSignal;
}) => Promise<Record<string, {
    pick: string;
    probabilities: Record<string, number>;
}>>;
