import type { KeptQuestion, QuestionSource } from "../../report.mjs";
export type LogsAnswer = {
    error?: {
        message?: string;
        code?: string;
    };
    tables?: {
        columns: {
            name: string;
        }[];
        rows: string[][];
    }[];
};
/** @import { KeptQuestion, QuestionSource } from "../../report.mjs" */
/**
 * The Log Analytics query API's answer, as far as this reads it.
 * @typedef {{ error?: { message?: string; code?: string }; tables?: { columns: { name: string }[]; rows: string[][] }[] }} LogsAnswer
 */
export declare const QUERY = "ContainerAppConsoleLogs | where ContainerAppName == 'chat' | project TimeGenerated, Log | order by TimeGenerated asc";
/**
 * @param {(body: { query: string; timespan: string }) => Promise<LogsAnswer>} request
 * @param {{ from: Date; to: Date }} range
 */
export declare function listRows(request: (body: {
    query: string;
    timespan: string;
}) => Promise<LogsAnswer>, { from, to }: {
    from: Date;
    to: Date;
}): Promise<KeptQuestion[]>;
/**
 * @param {Record<string, unknown>} deployment
 * @param {{ questions_workspace_id?: string; storage_account?: string }} chat
 * @param {{ credential?: import("@azure/identity").TokenCredential; fetchFn?: typeof globalThis.fetch; container?: import("@azure/storage-blob").ContainerClient }} [options]
 * @returns {Promise<QuestionSource>}
 */
export declare function azureQuestions(deployment: Record<string, unknown>, chat: {
    questions_workspace_id?: string;
    storage_account?: string;
}, { credential, fetchFn, container }?: {
    credential?: import("@azure/identity").TokenCredential;
    fetchFn?: typeof globalThis.fetch;
    container?: import("@azure/storage-blob").ContainerClient;
}): Promise<QuestionSource>;
