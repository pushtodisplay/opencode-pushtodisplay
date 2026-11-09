/**
 * Per-OpenCode setup state.
 *
 * A valid `pushtodisplay` credential is shared by every integration on the
 * machine (OpenCode, Codex, pi, Claude, ...). Credential presence therefore
 * must not be treated as "this OpenCode integration is set up". This marker is
 * written only after the OpenCode setup flow has verified auth and sent a test
 * entry, so a fresh install reusing an existing login stays silent until the
 * user explicitly runs setup.
 *
 * The marker lives under this integration's own cache namespace:
 *
 *   <XDG_CACHE_HOME or ~/.cache>/pushtodisplay/opencode/setup.json
 */
import * as fs from "node:fs";
import * as path from "node:path";

export const SETUP_VERSION = 1;

/**
 * Absolute path to this plugin's per-user cache root. `PUSHTODISPLAY_CACHE_DIR`
 * is an internal/testing override; it is deliberately not a user-facing knob.
 */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PUSHTODISPLAY_CACHE_DIR) return env.PUSHTODISPLAY_CACHE_DIR;
  const xdg = env.XDG_CACHE_HOME;
  if (xdg) return path.join(xdg.replace(/[\\/]+$/, ""), "pushtodisplay", "opencode");
  return path.join(env.HOME ?? "", ".cache", "pushtodisplay", "opencode");
}

/** Path of the setup marker for this integration. */
export function setupPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "setup.json");
}

/** True only when a valid, completed setup marker exists. */
export function isSetupComplete(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(setupPath(env), "utf8")) as {
      version?: unknown;
      completedAt?: unknown;
    } | null;
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        parsed.version === SETUP_VERSION &&
        Number(parsed.completedAt) > 0,
    );
  } catch {
    return false;
  }
}

export interface SetupDetails {
  boardId?: string;
  panel?: number;
  label?: string;
  cliVersion?: string;
}

export interface SetupRecord {
  version: number;
  completedAt: number;
  boardId: string;
  panel: number;
  label: string;
  cliVersion: string;
}

/**
 * Record a completed setup for this OpenCode integration. Atomic write; the
 * marker is per-user/per-integration cache, not per-session.
 */
export function markSetupComplete(
  details: SetupDetails = {},
  env: NodeJS.ProcessEnv = process.env,
): SetupRecord {
  const dir = cacheDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = setupPath(env);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const record: SetupRecord = {
    version: SETUP_VERSION,
    completedAt: Date.now(),
    boardId: details.boardId ?? "",
    panel: details.panel ?? 1,
    label: details.label ?? "",
    cliVersion: details.cliVersion ?? "",
  };
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, target);
  return record;
}
