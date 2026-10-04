// A deployment's chat.json is checked by the deployment's own suite; the check itself is a pure
// function, held here so a typo in an id fails with the field named before any plan runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { federationProblems, chatProblems, platformOf } from "../deploy/build/config.mjs";

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

// A Google chat.json exactly as the three live deployments have one.
const googleChat = {
  domain: "chat.guestgraph.io", site_id: "chat-guestgraph-io", mcp_url: "https://mcp.guestgraph.io/mcp", origins: ["https://guestgraph.io"],
  month_tokens: 18500000, run_host: "chat-pmjo63xwja-oa.a.run.app", provider: "anthropic",
  anthropic_federation: { rule_id: "fdrl_01EvNBuqC4jtGGJiLpN7pqdT", organization_id: "f48c0dfd-3bf9-4c7b-837c-254f7ba27923", service_account_id: "svac_017XvZZdGsnGV2yQmJABgxyY", workspace_id: "wrkspc_01A9iwwm2pEGTgsNAWHsu4ni" },
};
const azureChat = {
  domain: "chat.azure.companygraph.io", mcp_url: "https://mcp.azure.companygraph.io/mcp", origins: ["https://companygraph.io"], month_tokens: 18500000,
  provider: "anthropic", storage_account: "cgazurechat",
  anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC", audience: "66666666-7777-8888-9999-000000000000" },
};

test("the platform is google when deployment.json names none, and any other name is refused", () => {
  assert.equal(platformOf({}), "google");
  assert.equal(platformOf({ platform: "azure" }), "azure");
  assert.throws(() => platformOf({ platform: "aws" }), /^Error: deployment.json names platform aws, which is not one of google azure$/);
});

test("a live Google chat.json and a sound Azure one have no problem", () => {
  assert.deepEqual(chatProblems(googleChat, "google"), []);
  assert.deepEqual(chatProblems(azureChat, "azure"), []);
  assert.deepEqual(chatProblems({ ...azureChat, app_host: "chat.x.azurecontainerapps.io", dns_ready: true, questions_workspace_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", analyst_client_id: "11111111-2222-3333-4444-555555555555" }, "azure"), []);
});

test("each platform refuses the other's fields and names what it lacks", () => {
  assert.deepEqual(chatProblems({ ...googleChat, storage_account: "x" }, "google"), ["storage_account is for a chat on Azure"]);
  const { site_id, ...noSite } = googleChat;
  assert.deepEqual(chatProblems(noSite, "google"), ["chat.json has no site_id, the Hosting site Google serves the chat from"]);
  assert.deepEqual(chatProblems({ ...azureChat, site_id: "x", run_host: "y" }, "azure"), ["site_id is for a chat on Google", "run_host is for a chat on Google"]);
  assert.deepEqual(chatProblems({ ...azureChat, storage_account: "Chat_Acct" }, "azure"), ["storage_account is 3 to 24 lowercase letters and digits"]);
  assert.deepEqual(chatProblems({ ...azureChat, dns_ready: "yes", questions_workspace_id: "w" }, "azure"), ["dns_ready is true or false", "questions_workspace_id is the workspace's GUID"]);
  const { anthropic_federation, ...noFed } = azureChat;
  assert.deepEqual(chatProblems({ ...noFed, provider: "vertex" }, "azure"), ["a chat on Azure has provider anthropic", "a chat on Azure names anthropic_federation"]);
  const { mcp_url, ...noUrl } = azureChat;
  assert.deepEqual(chatProblems(noUrl, "azure"), ["chat.json has no mcp_url"]);
});

test("federation names its audience on Azure and never on Google", () => {
  const f = azureChat.anthropic_federation;
  assert.deepEqual(federationProblems(azureChat, "azure"), []);
  const { audience, ...noAudience } = f;
  assert.deepEqual(federationProblems({ ...azureChat, anthropic_federation: noAudience }, "azure"), ["audience is the client id of the app registration standing for the Claude API"]);
  assert.deepEqual(federationProblems({ ...googleChat, anthropic_federation: { ...googleChat.anthropic_federation, audience: f.audience } }, "google"), ["audience is not a field of anthropic_federation"]);
});

test("the answer check is a Google chat's switch, true or false, with a threshold between 0 and 1", () => {
  const google = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, site_id: "chat-example" };
  assert.deepEqual(chatProblems({ ...google, verdict: true, verdict_threshold: 0.8 }, "google"), []);
  assert.deepEqual(chatProblems({ ...google, verdict: "yes" }, "google"), ["verdict is true or false"]);
  assert.deepEqual(chatProblems({ ...google, verdict_threshold: 2 }, "google"), ["verdict_threshold is a probability between 0 and 1"]);
  const azure = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, storage_account: "chatexample", provider: "anthropic", anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC", audience: "00000000-0000-4000-8000-000000000001" } };
  assert.deepEqual(chatProblems({ ...azure, verdict: true }, "azure"), ["verdict is for a chat on Google"]);
});

test("the inference region is global or us, on either platform, and only for the Anthropic API", () => {
  const google = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, site_id: "chat-example", provider: "anthropic" };
  assert.deepEqual(chatProblems({ ...google, inference_geo: "us" }, "google"), []);
  assert.deepEqual(chatProblems({ ...google, inference_geo: "eu" }, "google"), ["inference_geo is global or us"]);
  assert.deepEqual(chatProblems({ ...google, provider: "vertex", inference_geo: "us" }, "google"), ["inference_geo is for provider anthropic; on Vertex the region is the deployment's"]);
  const { provider, ...noProvider } = google;
  assert.deepEqual(chatProblems({ ...noProvider, inference_geo: "us" }, "google"), ["inference_geo is for provider anthropic; on Vertex the region is the deployment's"]);
  const azure = { domain: "chat.example.test", mcp_url: "https://mcp.example.test/mcp", origins: ["https://example.test"], month_tokens: 1, storage_account: "chatexample", provider: "anthropic", anthropic_federation: { rule_id: "fdrl_01AbC", organization_id: "00000000-0000-4000-8000-000000000000", service_account_id: "svac_01AbC", audience: "00000000-0000-4000-8000-000000000001" } };
  assert.deepEqual(chatProblems({ ...azure, inference_geo: "us" }, "azure"), []);
  assert.deepEqual(chatProblems({ ...azure, inference_geo: "US" }, "azure"), ["inference_geo is global or us"]);
});
