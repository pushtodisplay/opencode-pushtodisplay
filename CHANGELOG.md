# Changelog

All notable changes to **opencode-pushtodisplay** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
