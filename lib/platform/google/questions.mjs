// Kept questions on Google: the log view the sink fills, read through the Logging API a page at
// a time, and the week's file written to the project's reports bucket through the Storage API.
// The library is the auth alone; each call is one request.
import { GoogleAuth } from "google-auth-library";

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
export async function listEntries(request, view, { from, to }) {
  /** @type {KeptQuestion[]} */
  const out = [];
  /** @type {string | undefined} */
  let pageToken;
  do {
    const body = {
      resourceNames: [view],
      filter: `timestamp >= "${from.toISOString()}" AND timestamp < "${to.toISOString()}"`,
      orderBy: "timestamp asc",
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    };
    const data = await request(body);
    for (const e of data.entries ?? []) if (e.jsonPayload?.kind === "question") out.push({ ...e.jsonPayload, timestamp: e.timestamp });
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * @param {{ project: string; region: string }} where
 * @returns {Promise<QuestionSource>}
 */
export async function googleQuestions({ project, region }) {
  const view = `projects/${project}/locations/${region}/buckets/chat-questions/views/questions`;
  const bucket = `chat-reports-${project}`;
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
  return {
    where: `gs://${bucket}`,
    list: (range) => listEntries(async (body) => /** @type {LogsPage} */ ((await client.request({ url: "https://logging.googleapis.com/v2/entries:list", method: "POST", data: body })).data), view, range),
    put: async (name, text) => {
      await client.request({
        url: `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
        method: "POST",
        headers: { "content-type": "text/markdown; charset=utf-8" },
        body: text,
      });
    },
  };
}
