export type KeptQuestion = {
    kind?: string;
    question: string;
    lang?: string | null;
    cited?: string[];
    calls?: number;
    empty?: number;
    rounds?: number;
    refused?: string | null;
    claims?: number;
    unsupported?: number;
    timestamp?: string;
};
export type QuestionSource = {
    where: string;
    list: (range: {
        from: Date;
        to: Date;
    }) => Promise<KeptQuestion[]>;
    put: (name: string, text: string) => Promise<void>;
};
/**
 * A question the chat kept, as the log line holds it; `timestamp` is where the platform's own
 * source read it from. The fields after `question` are what the loop saw, and a line written
 * before one existed lacks it.
 * @typedef {{ kind?: string; question: string; lang?: string | null; cited?: string[]; calls?: number; empty?: number; rounds?: number; refused?: string | null; claims?: number; unsupported?: number; timestamp?: string }} KeptQuestion
 */
/**
 * Where a platform keeps the questions: what to say of the place, the entries of a range read from
 * it, and a named file written to it.
 * @typedef {{ where: string; list: (range: { from: Date; to: Date }) => Promise<KeptQuestion[]>; put: (name: string, text: string) => Promise<void> }} QuestionSource
 */
/** @param {Date} date */
export declare function weekOf(date: Date): string;
/** @param {unknown} week */
export declare function weekRange(week: unknown): {
    from: Date;
    to: Date;
};
/** @param {KeptQuestion} e */
export declare const answered: (e: KeptQuestion) => boolean;
/**
 * @param {KeptQuestion[]} entries
 * @param {{ week: string; from: Date; to: Date }} range
 */
export declare function renderReport(entries: KeptQuestion[], { week, from, to }: {
    week: string;
    from: Date;
    to: Date;
}): string;
/**
 * @param {{ list: QuestionSource["list"]; put: QuestionSource["put"]; now?: Date; out?: (line: string) => void; week?: string }} run
 */
export declare function runReport({ list, put, now, out, week }: {
    list: QuestionSource["list"];
    put: QuestionSource["put"];
    now?: Date;
    out?: (line: string) => void;
    week?: string;
}): Promise<{
    week: string;
    total: number;
    answered: number;
}>;
