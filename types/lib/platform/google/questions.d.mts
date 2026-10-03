import type { KeptQuestion, QuestionSource } from "../../report.mjs";
export type LogsPage = {
    entries?: {
        jsonPayload?: KeptQuestion;
        timestamp: string;
    }[];
    nextPageToken?: string;
};
/** @import { KeptQuestion, QuestionSource } from "../../report.mjs" */
/**
 * One page of the Logging API's answer, as far as this reads it.
 * @typedef {{ entries?: { jsonPayload?: KeptQuestion; timestamp: string }[]; nextPageToken?: string }} LogsPage
 */
/**
 * @param {(body: object) => Promise<LogsPage>} request
 * @param {string} view
 * @param {{ from: Date; to: Date }} range
 */
export declare function listEntries(request: (body: object) => Promise<LogsPage>, view: string, { from, to }: {
    from: Date;
    to: Date;
}): Promise<KeptQuestion[]>;
/**
 * @param {{ project: string; region: string }} where
 * @returns {Promise<QuestionSource>}
 */
export declare function googleQuestions({ project, region }: {
    project: string;
    region: string;
}): Promise<QuestionSource>;
