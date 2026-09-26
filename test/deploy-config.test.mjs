// A deployment's chat.json is checked by the deployment's own suite; the check itself is a pure
// function, held here so a typo in an id fails with the field named before any plan runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { federationProblems } from "../deploy/build/config.mjs";

const sound = { provider: "anthropic", anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC" } };

test("a chat.json without federation, or with sound federation, has no problem", () => {
  assert.deepEqual(federationProblems({ provider: "anthropic" }), []);
  assert.deepEqual(federationProblems({}), []);
  assert.deepEqual(federationProblems(sound), []);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...sound.anthropic_federation, workspace_id: "wrkspc_01AbC" } }), []);
});

test("each wrong field is named", () => {
  const f = sound.anthropic_federation;
  assert.deepEqual(federationProblems({ ...sound, provider: "vertex" }), ["anthropic_federation needs provider anthropic"]);
  assert.deepEqual(federationProblems({ provider: "anthropic", anthropic_federation: "fdrl_01AbC" }), ["anthropic_federation is an object"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, rule_id: "fdis_01AbC" } }), ["rule_id is an fdrl_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, organization_id: "org-1" } }), ["organization_id is the organization's UUID"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, service_account_id: undefined } }), ["service_account_id is an svac_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, workspace_id: "default" } }), ["workspace_id is a wrkspc_ id"]);
  assert.deepEqual(federationProblems({ ...sound, anthropic_federation: { ...f, ruleId: "fdrl_01AbC" } }), ["ruleId is not a field of anthropic_federation"]);
});
