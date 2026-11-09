# Changelog

All notable changes to **opencode-pushtodisplay** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-11-09

### Added

- Per-integration setup marker at
  `<cache>/pushtodisplay/opencode/setup.json`. Updates are sent only when the
  marker exists and auth is valid, so a fresh install that reuses another
  integration's shared credential stays silent until this OpenCode install is
  set up.
- `/pushtodisplay-setup`, which logs in if needed, sends a test entry, and writes
  the marker only after both auth and the test send succeed.
- Tests for setup gating, the setup flow, re-authentication, and cache isolation.

### Changed

- `/pushtodisplay-status` now reports both auth and setup state.
- `/pushtodisplay-login` is the re-authentication path and no longer implies that
  setup is complete; it does not clear an existing marker.
- User documentation now documents one install path and one setup action. Local
  checkout, bundled CLI resolution, and live smoke-test notes moved to
  `docs/maintainers.md`.

### Fixed

- The plugin now ships the pinned `pushtodisplay` CLI 0.1.19 under
  `vendor/pushtodisplay` instead of depending on a caret range. This removes the
  upstream shrinkwrap from `npm ci` and makes plugin installs reproducible.

## [0.1.7] - 2026-11-09

### Changed

- The login dialog shows a clean verification URL without the device code in
  the query string, with the code on its own line. This makes the URL safe to
  copy; the browser still opens the complete link with the code prefilled.

## [0.1.6] - 2026-11-09

### Fixed

- Login success and failure now replace the login dialog, so approval in the
  browser produces visible feedback even if the original dialog is still open.
- `/pushtodisplay-test` shows the underlying CLI error instead of only
  “Test update failed — see log”.

### Documentation

- Documented the OpenCode server log path and how to include plugin stderr with
  `--print-logs`.

## [0.1.5] - 2026-11-09

### Fixed

- Login now shows the verification URL and device code together in a
  persistent TUI dialog. Status, test, and clear feedback remain toasts because
  they are transient; login needs the link to stay readable.

## [0.1.4] - 2026-11-09

### Fixed

- The TUI toast listener now watches `session.inbox.enqueued`, which is the
  event OpenCode 2.2.6 emits when a synthetic message is admitted. Command
  output appears immediately without starting a model turn.

## [0.1.3] - 2026-11-09

### Added

- A `./tui` part mirrors Push To Display command feedback into TUI toasts.
  The server continues to write synthetic messages with `resume: false`, so
  command output does not start an assistant turn.

## [0.1.2] - 2026-11-09

### Fixed

- `/pushtodisplay-*` command output no longer resumes the session and prompts
  the model. The plugin now passes `resume: false` to `ctx.session.synthetic`,
  so command status and login output stay in the transcript without starting an
  assistant turn.

## [0.1.1] - 2026-11-09

Maintenance release published from GitHub Actions with npm provenance.

### Changed

- Release through the Trusted Publishing workflow. No runtime changes from
  `0.1.0`.

## [0.1.0] - 2026-11-09

First public release.

### Added

- OpenCode V2.2+ server plugin that mirrors agent activity onto a Push To Display
  board as one shared, human-readable log.
- One-line entries for session open/rename/close, prompts, finished tool steps,
  blocking permission requests, provider errors, interrupts, and the agent's
  closing text.
- Closed status vocabulary (`READY`, `RUN`, `OK`, `FAIL`, `NEEDS`, `DONE`,
  `STOP`, `ENDED`) and structural shortening for tool descriptions, prompts, and
  results.
- Ordered, deduplicated, rate-limited sender with a bounded step backlog.
- OAuth device-code login through the bundled `pushtodisplay` CLI, with auth
  gating and automatic re-probing.
- Commands: `/pushtodisplay-login`, `/pushtodisplay-status`,
  `/pushtodisplay-test`, and `/pushtodisplay-clear`.
- Environment-variable and plugin-option configuration for board, panel, label,
  step entries, and disabling the plugin.

### Packaging

- npm package with a TypeScript entry point loaded directly by OpenCode (no
  build step).
- `@opencode/plugin` is a runtime dependency, matching the OpenCode V2 plugin
  packaging model.
- Published tarball includes only runtime source, README, CHANGELOG, and
  LICENSE.
