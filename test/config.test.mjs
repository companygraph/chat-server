import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv } from "../lib/config.mjs";

const full = {
  CHAT_MCP_URL: "https://mcp.example.test/mcp",
  CHAT_ORIGINS: "https://example.test, https://www.example.test",
  CHAT_HOSTS: "chat.example.test,chat-abc-oa.a.run.app",
  CHAT_MONTH_TOKENS: "18500000",
  CHAT_PROJECT: "example-project",
  CHAT_REGION: "eu",
};

test("the environment is read once into one object", () => {
  const c = configFromEnv(full);
  assert.equal(c.mcpUrl, "https://mcp.example.test/mcp");
  assert.deepEqual(c.origins, ["https://example.test", "https://www.example.test"]);
  assert.deepEqual(c.hosts, ["chat.example.test", "chat-abc-oa.a.run.app"]);
  assert.equal(c.monthTokens, 18500000);
  assert.equal(c.project, "example-project");
  assert.equal(c.region, "eu");
  assert.equal(c.proxyHops, 1);
  assert.equal(c.port, 8080);
  assert.equal(c.meter, "firestore");
});

test("a missing variable is named, and a non-number is refused", () => {
  assert.throws(() => configFromEnv({ ...full, CHAT_MCP_URL: "" }), /CHAT_MCP_URL/);
  assert.throws(() => configFromEnv({ ...full, CHAT_ORIGINS: undefined }), /CHAT_ORIGINS/);
  assert.throws(() => configFromEnv({ ...full, CHAT_MONTH_TOKENS: "many" }), /CHAT_MONTH_TOKENS/);
});

test("hosts unset means any, and the meter and hops can be set", () => {
  const c = configFromEnv({ ...full, CHAT_HOSTS: undefined, CHAT_METER: "memory", CHAT_PROXY_HOPS: "2", PORT: "9090" });
  assert.equal(c.hosts, null);
  assert.equal(c.meter, "memory");
  assert.equal(c.proxyHops, 2);
  assert.equal(c.port, 9090);
});

test("the question index cap defaults to 4000, can be set, and a bad value is refused", () => {
  assert.equal(configFromEnv(full).questionIndexChars, 4000);
  assert.equal(configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "2000" }).questionIndexChars, 2000);
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "0" }), /CHAT_QUESTION_INDEX_CHARS/);
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "-5" }), /CHAT_QUESTION_INDEX_CHARS/);
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "many" }), /CHAT_QUESTION_INDEX_CHARS/);
});

test("a value below the minimum says so by name, apart from a value that is not a number at all", () => {
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "0" }), /CHAT_QUESTION_INDEX_CHARS must be at least 1: 0/);
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "-5" }), /CHAT_QUESTION_INDEX_CHARS must be at least 1: -5/);
  assert.throws(() => configFromEnv({ ...full, CHAT_QUESTION_INDEX_CHARS: "many" }), /CHAT_QUESTION_INDEX_CHARS is not a whole number: many/);
  assert.throws(() => configFromEnv({ ...full, CHAT_PROXY_HOPS: "-1" }), /CHAT_PROXY_HOPS must be at least 0: -1/);
});

test("a key names the provider; none means Vertex", () => {
  assert.equal(configFromEnv(full).provider, "vertex");
  assert.equal(configFromEnv(full).anthropicKey, null);
  const c = configFromEnv({ ...full, ANTHROPIC_API_KEY: " sk-ant-test " });
  assert.equal(c.anthropicKey, "sk-ant-test");
  assert.equal(c.provider, "anthropic");
  assert.equal(configFromEnv({ ...full, ANTHROPIC_API_KEY: "  " }).provider, "vertex", "a blank key is no key");
});

const ids = {
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_01test",
  ANTHROPIC_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000000",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_01test",
};

test("three federation ids name the Anthropic provider without a key, and the workspace is optional", () => {
  const c = configFromEnv({ ...full, ...ids });
  assert.equal(c.provider, "anthropic");
  assert.equal(c.credential, "federation");
  assert.equal(c.anthropicKey, null);
  assert.deepEqual(c.anthropicFederation, { ruleId: "fdrl_01test", organizationId: "00000000-0000-4000-8000-000000000000", serviceAccountId: "svac_01test", workspaceId: null });
  assert.equal(configFromEnv({ ...full, ...ids, ANTHROPIC_WORKSPACE_ID: " wrkspc_01test " }).anthropicFederation.workspaceId, "wrkspc_01test");
});

test("the credential is named on every path", () => {
  assert.equal(configFromEnv(full).credential, "google");
  assert.equal(configFromEnv(full).anthropicFederation, null);
  assert.equal(configFromEnv({ ...full, ANTHROPIC_API_KEY: "sk-ant-test" }).credential, "key");
});

test("a key beside the federation ids is refused, since the key would win without a word", () => {
  assert.throws(() => configFromEnv({ ...full, ...ids, ANTHROPIC_API_KEY: "sk-ant-test" }), /ANTHROPIC_API_KEY and ANTHROPIC_FEDERATION_RULE_ID are both set/);
});

test("a partial set of federation ids names each one missing, and a workspace alone is refused", () => {
  assert.throws(() => configFromEnv({ ...full, ANTHROPIC_FEDERATION_RULE_ID: "fdrl_01test" }), /ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID are not set/);
  assert.throws(() => configFromEnv({ ...full, ...ids, ANTHROPIC_SERVICE_ACCOUNT_ID: "  " }), /ANTHROPIC_SERVICE_ACCOUNT_ID is not set/);
  assert.throws(() => configFromEnv({ ...full, ANTHROPIC_WORKSPACE_ID: "wrkspc_01test" }), /ANTHROPIC_WORKSPACE_ID is set without/);
});
