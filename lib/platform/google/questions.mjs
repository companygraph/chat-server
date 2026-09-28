// Kept questions on Google: the log view the sink fills, read through the Logging API a page at
// a time, and the week's file written to the project's reports bucket through the Storage API.
// The library is the auth alone; each call is one request.
import { GoogleAuth } from "google-auth-library";

export async function listEntries(request, view, { from, to }) {
  const out = [];
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

export async function googleQuestions({ project, region }) {
  const view = `projects/${project}/locations/${region}/buckets/chat-questions/views/questions`;
  const bucket = `chat-reports-${project}`;
  const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
  return {
    where: `gs://${bucket}`,
    list: (range) => listEntries(async (body) => (await client.request({ url: "https://logging.googleapis.com/v2/entries:list", method: "POST", data: body })).data, view, range),
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
