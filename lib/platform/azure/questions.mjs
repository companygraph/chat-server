// Kept questions on Azure: the chat's workspace, which a transformation lets hold nothing but the
// chat's question lines, read through the Log Analytics query API for one interval, and the week's
// file written to the reports container. The run signs in as the analyst through the Azure CLI
// login the workflow made. A console line lands whole in the Log column, so each is parsed here,
// and a line that is not JSON or not a question, a stack trace say, is passed over.
import { AzureCliCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

/** @import { KeptQuestion, QuestionSource } from "../../report.mjs" */

/**
 * The Log Analytics query API's answer, as far as this reads it.
 * @typedef {{ error?: { message?: string; code?: string }; tables?: { columns: { name: string }[]; rows: string[][] }[] }} LogsAnswer
 */

export const QUERY = "ContainerAppConsoleLogs | where ContainerAppName == 'chat' | project TimeGenerated, Log | order by TimeGenerated asc";
const LOGS_API = "https://api.loganalytics.azure.com";
const LOGS_SCOPE = "https://api.loganalytics.io/.default";

/**
 * @param {(body: { query: string; timespan: string }) => Promise<LogsAnswer>} request
 * @param {{ from: Date; to: Date }} range
 */
export async function listRows(request, { from, to }) {
  const data = await request({ query: QUERY, timespan: `${from.toISOString()}/${to.toISOString()}` });
  // A partial answer is a 200 with an error beside the tables; counting it would report a week short.
  if (data.error) throw new Error(`Log Analytics answered only in part: ${data.error.message ?? data.error.code}`);
  const t = data.tables?.[0];
  if (!t) return [];
  const time = t.columns.findIndex((c) => c.name === "TimeGenerated");
  const log = t.columns.findIndex((c) => c.name === "Log");
  /** @type {KeptQuestion[]} */
  const out = [];
  for (const r of t.rows) {
    /** @type {KeptQuestion | undefined} */
    let line;
    try {
      line = JSON.parse(r[log]);
    } catch {
      continue;
    }
    if (line?.kind === "question") out.push({ ...line, timestamp: r[time] });
  }
  return out;
}

/**
 * @param {Record<string, unknown>} deployment
 * @param {{ questions_workspace_id?: string; storage_account?: string }} chat
 * @param {{ credential?: import("@azure/identity").TokenCredential; fetchFn?: typeof globalThis.fetch; container?: import("@azure/storage-blob").ContainerClient }} [options]
 * @returns {Promise<QuestionSource>}
 */
export async function azureQuestions(deployment, chat, { credential, fetchFn = fetch, container } = {}) {
  if (!chat?.questions_workspace_id) throw new Error("chat.json names no questions_workspace_id; write the chat apply's questions_workspace_id output into it");
  if (!chat?.storage_account) throw new Error("chat.json names no storage_account");
  const cred = credential ?? new AzureCliCredential();
  const account = `https://${chat.storage_account}.blob.core.windows.net`;
  const reports = container ?? new BlobServiceClient(account, cred).getContainerClient("reports");
  /** @param {{ query: string; timespan: string }} body */
  const request = async (body) => {
    const { token } = /** @type {{ token: string }} */ (await cred.getToken(LOGS_SCOPE));
    const res = await fetchFn(`${LOGS_API}/v1/workspaces/${chat.questions_workspace_id}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Log Analytics answered ${res.status}`);
    return /** @type {Promise<LogsAnswer>} */ (res.json());
  };
  return {
    where: `${account}/reports`,
    list: (range) => listRows(request, range),
    put: async (name, text) => {
      await reports.getBlockBlobClient(name).upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "text/markdown; charset=utf-8" } });
    },
  };
}
