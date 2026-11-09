/**
 * opencode-pushtodisplay — package entry point.
 *
 * Resolves the bundled `pushtodisplay` CLI, then hands OpenCode the plugin
 * definition from `src/extension.ts` (see that file for what the board shows).
 *
 * This is the only file that uses `import.meta`: it keeps the setup factory
 * importable from the CommonJS unit-test transform.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Plugin } from "@opencode/plugin";

import { configureCliResolver } from "./cli-adapter.ts";
import { createSetup } from "./extension.ts";

// Prefer the pinned CLI vendored inside this package so plugin installs are
// self-contained and reproducible. A development checkout may instead have a
// `pushtodisplay` npm dependency; the adapter falls back to PATH if neither
// exists. Runs at module load, before OpenCode invokes the setup function.
const packageRequire = createRequire(import.meta.url);
const vendorPackage = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "vendor",
  "pushtodisplay",
  "package.json",
);
configureCliResolver((id) => {
  if (id === "pushtodisplay/package.json" && existsSync(vendorPackage)) {
    return vendorPackage;
  }
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
