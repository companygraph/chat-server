// The deployment tests are registered by a deployment, not here; what this suite holds is that
// the module loads and exports the one function, so a broken import fails here and not in the
// first deployment that takes the release.
import { test } from "node:test";
import assert from "node:assert/strict";

test("the deployment tests export one registration function", async () => {
  const m = await import("../deploy/test/index.mjs");
  assert.equal(typeof m.registerDeploymentTests, "function");
});
