// The one call a deployment's chat/test file makes.
import { registerPinTests } from "./pin.mjs";
import { registerConfigTests } from "./config.mjs";
import { registerPageTests } from "./page.mjs";

export function registerDeploymentTests() {
  registerPinTests();
  registerConfigTests();
  registerPageTests();
}
