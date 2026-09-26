// A deployment's chat values, read from the directory the command runs in: the deployment's
// `chat/` folder, which holds chat.json, the Dockerfile, brand.html and own.css.
import fs from "node:fs";
import path from "node:path";
export const ROOT = process.cwd();
export const DIST = path.join(ROOT, "dist");
export const chat = () => JSON.parse(fs.readFileSync(path.join(ROOT, "chat.json"), "utf8"));
// The project's values, one directory up: a deployment's chat/ sits beside its deployment.json.
export const deployment = () => JSON.parse(fs.readFileSync(path.join(ROOT, "..", "deployment.json"), "utf8"));

// chat.json's federation, checked by form: Terraform drops a key its object type does not name
// and says nothing, so a misspelt field would deploy as a missing one.
const FEDERATION_FIELDS = {
  rule_id: [/^fdrl_\w+$/, "rule_id is an fdrl_ id"],
  organization_id: [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "organization_id is the organization's UUID"],
  service_account_id: [/^svac_\w+$/, "service_account_id is an svac_ id"],
};

export function federationProblems(c) {
  if (!("anthropic_federation" in c)) return [];
  const f = c.anthropic_federation;
  const problems = c.provider === "anthropic" ? [] : ["anthropic_federation needs provider anthropic"];
  if (!f || typeof f !== "object" || Array.isArray(f)) return [...problems, "anthropic_federation is an object"];
  for (const [k, [form, sentence]] of Object.entries(FEDERATION_FIELDS)) if (!form.test(f[k] ?? "")) problems.push(sentence);
  if ("workspace_id" in f && !/^wrkspc_\w+$/.test(f.workspace_id ?? "")) problems.push("workspace_id is a wrkspc_ id");
  for (const k of Object.keys(f)) if (!(k in FEDERATION_FIELDS) && k !== "workspace_id") problems.push(`${k} is not a field of anthropic_federation`);
  return problems;
}
