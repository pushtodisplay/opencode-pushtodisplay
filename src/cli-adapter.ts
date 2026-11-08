/**
 * Adapter for the `pushtodisplay` CLI (`npm i pushtodisplay`).
 *
 * The CLI implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. It stores credentials in the OS keychain
 * (macOS Keychain, Linux libsecret, Windows Credential Manager) and falls back
 * to ~/.config/pushtodisplay/credentials.json only when no keychain is
 * available, auto-refreshing the access token.
 *
 * Binary resolution, in order:
 *   1. the `pushtodisplay` npm dependency installed next to this package
 *      (self-contained installs via `plugins`),
 *   2. a global `pushtodisplay` binary on PATH (manual setups).
 *
 * OpenCode 2.2 runs plugins inside its own Bun-compiled server. In that runtime
 * `process.execPath` is the OpenCode executable, not Node, so a bundled bin is
 * spawned directly (its `#!/usr/bin/env node` shebang selects Node) instead of
 * being passed to `process.execPath` as a script. When the bin is not
 * executable, a `node` on PATH is used as a fallback; if neither is available
 * the direct spawn still gives the caller a useful ENOENT/EACCES diagnostic.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

import type { Payload } from "./payloads.ts";

const execFileAsync = promisify(execFile);

export interface CliCommand {
  /** Executable to spawn (either the bare CLI name or an absolute runtime path). */
  exe: string;
  /** Extra argv to pass before the CLI's own args. */
  prefix: string[];
  /** Where the command came from — used for diagnostics. */
  source: "npm-dep" | "path";
}

/** Resolve a bare package id to an absolute path (e.g. via `require.resolve`). */
export type ModuleResolver = (id: string) => string | undefined;

let resolver: ModuleResolver | null = null;
let cachedCommand: CliCommand | null = null;

/**
 * Point the adapter at the installed `pushtodisplay` npm dependency.
 *
 * Called once from the plugin entry (`src/index.ts`) with a `createRequire`
 * bound to the plugin file, so `require.resolve` finds the package's own
 * node_modules. Optional — when unset (or failing) the adapter falls back to
 * a `pushtodisplay` binary on PATH.
 */
export function configureCliResolver(fn: ModuleResolver | null): void {
  resolver = fn;
  cachedCommand = null;
}

function packageBinPath(): string | null {
  if (!resolver) return null;
  try {
    const pkgJsonPath = resolver("pushtodisplay/package.json");
    if (!pkgJsonPath) return null;
    const pkgRoot = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pushtodisplay;
    if (!bin) return null;
    const p = path.resolve(pkgRoot, bin);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** True when the current process is a real Node runtime (not Bun/OpenCode). */
export function isNodeRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
  release: NodeJS.ProcessRelease = process.release,
): boolean {
  return !("bun" in versions) && release?.name === "node";
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Find an executable on PATH without spawning anything. */
export function findOnPath(name: string, envPath = process.env.PATH ?? ""): string | null {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (isExecutable(candidate)) return candidate;
      const upper = path.join(dir, name + ext.toUpperCase());
      if (upper !== candidate && isExecutable(upper)) return upper;
    }
  }
  return null;
}

/**
 * How to invoke a JavaScript CLI file. Pure enough to test without pretending
 * the process is Bun.
 */
export function invocationFor(
  bin: string,
  opts: {
    nodeRuntime?: boolean;
    platform?: NodeJS.Platform;
    executable?: boolean;
    nodePath?: string | null;
    execPath?: string;
  } = {},
): { exe: string; prefix: string[] } {
  const nodeRuntime = opts.nodeRuntime ?? isNodeRuntime();
  const platform = opts.platform ?? process.platform;
  const executable = opts.executable ?? isExecutable(bin);
  const nodePath = opts.nodePath === undefined ? findOnPath("node") : opts.nodePath;
  const execPath = opts.execPath ?? process.execPath;

  // A real Node can always run the file, executable bit or not.
  if (nodeRuntime) return { exe: execPath, prefix: [bin] };

  // OpenCode's server is Bun-compiled: spawn the bin and let its shebang pick
  // Node. Windows cannot execute a .js file directly, and an npm install may
  // lose the executable bit, so prefer an explicit `node` in those cases.
  if (platform !== "win32" && executable) return { exe: bin, prefix: [] };
  if (nodePath) return { exe: nodePath, prefix: [bin] };
  return { exe: bin, prefix: [] };
}

/** Resolve how to invoke the CLI. Result is cached for the process lifetime. */
export function resolveCli(): CliCommand {
  if (cachedCommand) return cachedCommand;
  const bin = packageBinPath();
  if (bin) {
    cachedCommand = { ...invocationFor(bin), source: "npm-dep" };
  } else {
    cachedCommand = { exe: "pushtodisplay", prefix: [], source: "path" };
  }
  return cachedCommand;
}

/** Allow tests to reset the cached resolution. */
export function __resetCliCache(): void {
  cachedCommand = null;
}

async function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const { exe, prefix } = resolveCli();
  // execFile compares exit codes; a missing PATH binary raises ENOENT which
  // callers surface as a helpful "CLI not installed" diagnostic.
  const { stdout, stderr } = await execFileAsync(exe, [...prefix, ...args], {
    timeout: timeoutMs,
    encoding: "utf8",
    // Pass the current environment explicitly. Some hosts (including Jest's
    // node environment) replace the global `process.env` with a copy, and a
    // child spawned without `env` would otherwise see the parent's original
    // PATH instead of the one this process is using.
    env: process.env,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** Build the CLI argv for a board update payload. */
export function sendArgs(payload: Payload, boardId: string): string[] {
  const args = ["send"];
  if (boardId) args.push("-b", boardId);
  args.push("-p", String(payload.panelId));
  if (payload.background) args.push("--background", payload.background);
  if (payload.density) args.push("--density", payload.density);
  for (const b of payload.blocks) args.push("--block", JSON.stringify(b));
  return args;
}

/** Send a display update. Throws on failure (auth or network). */
export async function sendPayload(payload: Payload, boardId: string): Promise<void> {
  await runCli(sendArgs(payload, boardId), 15_000);
}

/**
 * Probe auth state.
 *
 * Uses `auth status --json` (exit 0 = authenticated, non-zero = not). The CLI
 * reports effective auth — an expired access token with a valid refresh token
 * still counts as authenticated since it refreshes transparently. Falls back to
 * legacy text heuristics when the installed CLI predates JSON status output.
 */
export async function authStatus(): Promise<boolean> {
  try {
    const { stdout } = await runCli(["auth", "status", "--json"], 10_000);
    try {
      const parsed = JSON.parse(stdout) as { authenticated?: boolean };
      if (typeof parsed.authenticated === "boolean") {
        return parsed.authenticated;
      }
    } catch {
      // Not JSON — likely an older CLI that ignores --json; fall through.
    }
    // Legacy heuristic (old CLI exits 0 whether logged in or not).
    const denied = /Not authenticated/i.test(stdout) || /\(expired\)/i.test(stdout);
    const confirmed = /Auth method/i.test(stdout) && /All commands available/i.test(stdout);
    return confirmed && !denied;
  } catch {
    // Non-zero exit → not authenticated (new CLI contract).
    return false;
  }
}

/** Spawn the CLI for the OAuth device-code flow, streaming stdout/stderr. */
export function spawnCli(args: string[]): ChildProcess {
  const { exe, prefix } = resolveCli();
  return spawn(exe, [...prefix, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

/** True when the failure looks like an auth problem (401/403/unauthorized). */
export function isAuthFailure(err: unknown): boolean {
  return /unauthor|401|403|forbidden/i.test((err as Error)?.message ?? "");
}

/** True when the underlying executable could not be spawned at all (ENOENT). */
export function isCliMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Human-readable install hint shown when the CLI cannot be found at all. */
export function cliNotFoundMessage(): string {
  return [
    "Push To Display CLI not found.",
    "Install it with: npm i -g pushtodisplay",
    "(When installed as a plugin dependency, the CLI is included automatically.)",
  ].join(" ");
}
