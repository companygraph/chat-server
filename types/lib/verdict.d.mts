export declare const CRITERIA: {
    supported: string;
    partial: string;
    contradicted: string;
    absent: string;
    "says-nothing": string;
    connective: string;
};
/** @param {string} verdict */
export declare const isUnsupported: (verdict: string) => boolean;
export declare const VERDICT_BUDGET_MS = 1000;
export declare const STATE_BUDGET = 78000;
export declare const REQUEST_BUDGET = 160000;
/** @param {string} text */
export declare function languageOf(text: string): "de" | "en" | null;
/**
 * @param {string} text
 * @param {string} [lang]
 * @returns {{ from: number; to: number; text: string }[]}
 */
export declare function claimsOf(text: string, lang?: string): {
    from: number;
    to: number;
    text: string;
}[];
/**
 * @param {string} text
 * @param {{ id: string; title: string }[]} titles
 * @returns {string[]}
 */
export declare function namedIn(text: string, titles: {
    id: string;
    title: string;
}[]): string[];
export type Claim = {
    from: number;
    to: number;
    ids: string[];
    verdict: string;
    p: number | null;
};
export type JudgeRequest = {
    state: {
        answers: Record<string, string>;
    };
    questions: Record<string, {
        claim: string;
        evidence: string[];
    }>;
};
export type Judge = (request: JudgeRequest) => Promise<Record<string, {
    pick: string;
    probabilities: Record<string, number>;
}>>;
/**
 * @typedef {{ from: number; to: number; ids: string[]; verdict: string; p: number | null }} Claim
 * @typedef {{ state: { answers: Record<string, string> }; questions: Record<string, { claim: string; evidence: string[] }> }} JudgeRequest
 * @typedef {(request: JudgeRequest) => Promise<Record<string, { pick: string; probabilities: Record<string, number> }>>} Judge
 * @param {{ text: string; lang: string | null; returned: { id: string; title: string }[]; index: { id: string; title: string }[]; promptTitles?: string[]; evidence: Map<string, string[]>; answers: string[]; calls: number; empty: number }} message
 * @param {Judge} judge
 * @returns {Promise<{ claims: Claim[] } | { failed: string }>}
 */
export declare function verdictOf(message: {
    text: string;
    lang: string | null;
    returned: {
        id: string;
        title: string;
    }[];
    index: {
        id: string;
        title: string;
    }[];
    promptTitles?: string[];
    evidence: Map<string, string[]>;
    answers: string[];
    calls: number;
    empty: number;
}, judge: Judge): Promise<{
    claims: Claim[];
} | {
    failed: string;
}>;
/**
 * @param {Parameters<typeof verdictOf>[0] & { signal?: AbortSignal | undefined }} message
 * @param {(request: JudgeRequest, options: { signal: AbortSignal }) => ReturnType<Judge>} judge
 * @param {number} [ms]
 * @returns {Promise<{ claims: Claim[] } | { failed: string }>}
 */
export declare function checked(message: Parameters<typeof verdictOf>[0] & {
    signal?: AbortSignal | undefined;
}, judge: (request: JudgeRequest, options: {
    signal: AbortSignal;
}) => ReturnType<Judge>, ms?: number): Promise<{
    claims: Claim[];
} | {
    failed: string;
}>;
/**
 * @param {{ judge: Parameters<typeof checked>[1]; titles: () => { id: string; title: string }[] | Promise<{ id: string; title: string }[]>; promptTitles?: () => string[] | Promise<string[]>; threshold: number | null; budget?: number; warn?: (fields: { reason: string }) => void }} options
 */
export declare function verdictCheck({ judge, titles, promptTitles, threshold, budget, warn }: {
    judge: Parameters<typeof checked>[1];
    titles: () => {
        id: string;
        title: string;
    }[] | Promise<{
        id: string;
        title: string;
    }[]>;
    promptTitles?: () => string[] | Promise<string[]>;
    threshold: number | null;
    budget?: number;
    warn?: (fields: {
        reason: string;
    }) => void;
}): (message: Omit<Parameters<typeof checked>[0], "index" | "promptTitles">) => Promise<{
    event: {
        claims: Claim[];
        threshold: number | null;
    };
    claims: number;
    unsupported: number;
} | null>;
