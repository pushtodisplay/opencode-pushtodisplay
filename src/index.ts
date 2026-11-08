/**
 * opencode-pushtodisplay — package entry point.
 *
 * Resolves the bundled `pushtodisplay` CLI, then hands OpenCode the plugin
 * definition from `src/extension.ts` (see that file for what the board shows).
 *
 * This is the only file that uses `import.meta`: it keeps the setup factory
 * importable from the CommonJS unit-test transform.
 */
import { createRequire } from "node:module";

import { Plugin } from "@opencode/plugin";

import { configureCliResolver } from "./cli-adapter.ts";
import { createSetup } from "./extension.ts";

// Resolve the bundled `pushtodisplay` npm dependency relative to this package
// so plugin installs are self-contained (no global CLI required). Resolved
// lazily by the adapter; falls back to a PATH binary if absent. Runs at module
// load, i.e. before OpenCode invokes the setup function.
const packageRequire = createRequire(import.meta.url);
configureCliResolver((id) => {
  try {
    return packageRequire.resolve(id);
  } catch {
    return undefined;
  }
});

export default Plugin.define({
  id: "pushtodisplay",
  setup: createSetup(),
});
