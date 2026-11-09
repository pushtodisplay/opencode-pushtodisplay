# Maintainer notes

This document holds paths that are useful when developing the plugin but are not
part of the user-facing install. Users install the npm package and run
`/pushtodisplay-setup`; see the [README](../README.md).

## Local checkout install

For development, point an `opencode.json(c)` at the checkout instead of the
published package:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-pushtodisplay",
      "options": {
        "panel": 1,
        "label": "release"
      }
    }
  ]
}
```

The object form is also where per-project options go. One entry loads the plugin;
OpenCode discovers the server part through the package's `exports` field.

## Bundled CLI resolution

The plugin ships a pinned `pushtodisplay` CLI under
`vendor/pushtodisplay/`. Resolution is an internal implementation detail:

1. the vendored release (normal npm install),
2. a `pushtodisplay` npm dependency next to the package (development checkout
   before the vendor copy exists),
3. a `pushtodisplay` binary on PATH (advanced/manual environments).

OpenCode 2.2 runs plugins inside a Bun-compiled server, so `process.execPath` is
the OpenCode executable, not Node. In that runtime the bundled bin is spawned
directly and its `#!/usr/bin/env node` shebang selects Node. If the bin is not
executable, the plugin uses a `node` found on PATH as a fallback; on Windows it
uses `node.exe` directly because a `.js` file cannot be executed by the shell.
If none of those work, the error is surfaced as a "CLI not found" diagnostic.

### Updating the vendored CLI

The vendored release is **0.1.19**. Keep it in sync with
`PUSHTODISPLAY_CLI_VERSION` in `src/cli-adapter.ts`.

1. Download the new release:

   ```bash
   npm pack pushtodisplay@X.Y.Z
   tar -xzf pushtodisplay-X.Y.Z.tgz
   ```

2. Replace `dist/`, `package.json`, `LICENSE`, `README.md`, and
   `THIRD_PARTY_LICENSES.txt` in `vendor/pushtodisplay/`. Do **not** copy
   `npm-shrinkwrap.json`: the published shrinkwrap pulls in the CLI's development
   dependency tree and can make `npm ci` fail with `EBADPLATFORM` on some
   platforms.

3. Update `PUSHTODISPLAY_CLI_VERSION` and any vendor-version assertions.

4. Run `npm run check`, then `npm pack --dry-run`, and verify that
   `vendor/pushtodisplay/dist/cli.js` is included.

## Live smoke test

For a manual end-to-end check, point the CLI at a local mock API:

```bash
PTD_API_URL=http://127.0.0.1:45123 PTD_ACCESS_TOKEN=dummy \
  opencode serve --port 45125
```

Then create a session and prompt it through the OpenCode API. The plugin posts
`READY`, `RUN`, `OK`/`FAIL`, `NEEDS`, `DONE`, `STOP`, and `ENDED` lines to the
mock endpoint. This is how the event names and payload shapes were verified
against OpenCode 2.2.6.

## Setup marker

`src/setup-state.ts` stores the per-integration marker at:

```text
<XDG_CACHE_HOME or ~/.cache>/pushtodisplay/opencode/setup.json
```

`PUSHTODISPLAY_CACHE_DIR` overrides the root for tests and isolated runs. The
marker is written only from `/pushtodisplay-setup`, after auth is valid and the
test entry succeeds. Re-authentication never deletes it.

## Release

See [publishing.md](publishing.md) for version bumps, checks, Trusted Publishing,
and verification.
