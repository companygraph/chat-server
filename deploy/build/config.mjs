// A deployment's chat values, read from the directory the command runs in: the deployment's
// `chat/` folder, which holds chat.json, the Dockerfile, brand.html and own.css.
import fs from "node:fs";
import path from "node:path";

/**
 * chat.json and deployment.json are the deployment's own files, read as they are and checked
 * below by form, so a value is read where it is used.
 * @typedef {Record<string, any>} DeploymentFile
 */
/**
 * @typedef {"google" | "azure"} Platform
 */

export const ROOT = process.cwd();
export const DIST = path.join(ROOT, "dist");
/** @returns {DeploymentFile} */
export const chat = () => JSON.parse(fs.readFileSync(path.join(ROOT, "chat.json"), "utf8"));
// The project's values, one directory up: a deployment's chat/ sits beside its deployment.json.
/** @returns {DeploymentFile} */
export const deployment = () => JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));

// chat.json's federation, checked by form: Terraform drops a key its object type does not name
// and says nothing, so a misspelt field would deploy as a missing one.
/** @type {Record<string, [RegExp, string]>} */
const FEDERATION_FIELDS = {
  rule_id: [/^fdrl_\w+$/, "rule_id is an fdrl_ id"],
  organization_id: [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "organization_id is the organization's UUID"],
  service_account_id: [/^svac_\w+$/, "service_account_id is an svac_ id"],
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PLATFORMS = /** @type {const} */ (["google", "azure"]);

// A deployment that names no platform is on Google, as every deployment before the field was.
/**
 * @param {DeploymentFile} d
 * @returns {Platform}
 */
export function platformOf(d) {
  const p = d.platform ?? "google";
  if (!PLATFORMS.includes(/** @type {Platform} */ (p))) throw new Error(`deployment.json names platform ${p}, which is not one of ${PLATFORMS.join(" ")}`);
  return /** @type {Platform} */ (p);
}

// On Azure the federation also names the audience its token is asked for: the client id of the
// tenant's app registration standing for the Claude API. Google's token names its own audience.
/**
 * @param {DeploymentFile} c
 * @param {Platform} [platform]
 * @returns {string[]}
 */
export function federationProblems(c, platform = "google") {
  if (!("anthropic_federation" in c)) return [];
  const f = c.anthropic_federation;
  const problems = c.provider === "anthropic" ? [] : ["anthropic_federation needs provider anthropic"];
  if (!f || typeof f !== "object" || Array.isArray(f)) return [...problems, "anthropic_federation is an object"];
  for (const [k, [form, sentence]] of Object.entries(FEDERATION_FIELDS)) if (!form.test(f[k] ?? "")) problems.push(sentence);
  if ("workspace_id" in f && !/^wrkspc_\w+$/.test(f.workspace_id ?? "")) problems.push("workspace_id is a wrkspc_ id");
  if (platform === "azure" && !GUID.test(f.audience ?? "")) problems.push("audience is the client id of the app registration standing for the Claude API");
  const known = new Set([...Object.keys(FEDERATION_FIELDS), "workspace_id", ...(platform === "azure" ? ["audience"] : [])]);
  for (const k of Object.keys(f)) if (!known.has(k)) problems.push(`${k} is not a field of anthropic_federation`);
  return problems;
}

// The answer check runs on Google alone in this release: the Azure module holds no secret by
// design, so TypeSafe's key has nowhere to come from there.
const GOOGLE_ONLY = ["site_id", "run_host", "verdict", "verdict_threshold"];
const AZURE_ONLY = ["storage_account", "app_host", "dns_ready", "questions_workspace_id", "analyst_client_id"];

// chat.json as its platform needs it: the fields every chat names, the platform's own, and none of
// the other platform's, since a field Terraform does not read would deploy as a missing one.
/**
 * @param {DeploymentFile} c
 * @param {Platform} platform
 * @returns {string[]}
 */
export function chatProblems(c, platform) {
  const problems = [];
  for (const k of ["domain", "mcp_url", "origins", "month_tokens"]) if (!(k in c)) problems.push(`chat.json has no ${k}`);
  if (platform === "google") {
    if (!("site_id" in c)) problems.push("chat.json has no site_id, the Hosting site Google serves the chat from");
    for (const k of AZURE_ONLY) if (k in c) problems.push(`${k} is for a chat on Azure`);
    if ("provider" in c && !["vertex", "anthropic"].includes(c.provider)) problems.push("provider is vertex or anthropic");
    if ("verdict" in c && typeof c.verdict !== "boolean") problems.push("verdict is true or false");
    if ("verdict_threshold" in c && !(typeof c.verdict_threshold === "number" && c.verdict_threshold >= 0 && c.verdict_threshold <= 1)) problems.push("verdict_threshold is a probability between 0 and 1");
  } else {
    for (const k of GOOGLE_ONLY) if (k in c) problems.push(`${k} is for a chat on Google`);
    if (!/^[a-z0-9]{3,24}$/.test(c.storage_account ?? "")) problems.push("storage_account is 3 to 24 lowercase letters and digits");
    if ("dns_ready" in c && typeof c.dns_ready !== "boolean") problems.push("dns_ready is true or false");
    if ("questions_workspace_id" in c && !GUID.test(c.questions_workspace_id)) problems.push("questions_workspace_id is the workspace's GUID");
    if ("analyst_client_id" in c && !GUID.test(c.analyst_client_id)) problems.push("analyst_client_id is the analyst identity's client id");
    if (c.provider !== "anthropic") problems.push("a chat on Azure has provider anthropic");
    if (!("anthropic_federation" in c)) problems.push("a chat on Azure names anthropic_federation");
  }
  return [...problems, ...federationProblems(c, platform)];
}
