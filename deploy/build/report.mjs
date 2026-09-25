// The week's report, run in a deployment's chat/ under the analyst's credentials: the view's
// entries of the past seven days, read through the Logging API, one Markdown file into the
// project's reports bucket through the Storage API. The library is the auth alone; each call
// is one request, and the paging and the rendering are the package's own and tested.
import { GoogleAuth } from "google-auth-library";
import { deployment } from "./config.mjs";
import { listEntries, runReport } from "../../lib/report.mjs";

const d = deployment();
const view = `projects/${d.project}/locations/${d.region}/buckets/chat-questions/views/questions`;
const bucket = `chat-reports-${d.project}`;
const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();

const list = (range) => listEntries(async (body) => (await client.request({ url: "https://logging.googleapis.com/v2/entries:list", method: "POST", data: body })).data, view, range);
const put = async (name, text) => {
  await client.request({
    url: `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
    method: "POST",
    headers: { "content-type": "text/markdown; charset=utf-8" },
    body: text,
  });
};

await runReport({ list, put, out: (s) => console.log(`${s} in gs://${bucket}`) });
