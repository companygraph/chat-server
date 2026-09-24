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
