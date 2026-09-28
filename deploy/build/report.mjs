// The week's report, run in a deployment's chat/ under the analyst's credentials: the entries of
// one ISO week, the one that ended or the one named, read from where the deployment's platform
// keeps them, one Markdown file written beside them. The week is checked before anything is
// read, and the platform before anything signs in, so a wrong name is refused on its own.
import { deployment } from "./config.mjs";
import { runReport, weekRange } from "../../lib/report.mjs";
import { questionSource } from "../../lib/platform.mjs";

const week = process.argv[3];
if (week !== undefined) weekRange(week);
const d = deployment();
const open = await questionSource(d.platform);
const source = await open(d);

await runReport({ list: source.list, put: source.put, out: (s) => console.log(`${s} in ${source.where}`), ...(week !== undefined ? { week } : {}) });
