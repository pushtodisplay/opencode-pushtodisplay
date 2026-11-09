import {
  PUSHTODISPLAY_CLI_VERSION,
  sendArgs,
  sendPayload,
  isAuthFailure,
  isCliMissing,
  resolveCli,
  configureCliResolver,
  invocationFor,
  isNodeRuntime,
  authStatus,
  __resetCliCache,
} from "../cli-adapter.ts";
import type { Payload } from "../payloads.ts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.env.PTD_RECORD) {
  fs.appendFileSync(process.env.PTD_RECORD, JSON.stringify(process.argv.slice(2)) + "\\n");
}
const mode = process.env.PTD_MODE || "send";
if (mode === "auth") {
  process.stdout.write(process.env.PTD_AUTH_OUT || "");
  process.exit(Number(process.env.PTD_AUTH_EXIT || "0"));
}
process.stdout.write("Message sent (fake)\\n");
`;

let tempDir = "";
let oldPath: string | undefined;

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-cli-"));
  const bin = path.join(dir, "pushtodisplay");
  writeFileSync(bin, FAKE_CLI);
  chmodSync(bin, 0o755);
  return dir;
}

function fakePkg(opts: { bin?: string } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-pkg-"));
  if (opts.bin) {
    const p = path.join(dir, opts.bin);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "#!/usr/bin/env node\n");
  }
  const manifest: Record<string, unknown> = { name: "pushtodisplay", version: "0.0.0" };
  if (opts.bin) manifest.bin = { pushtodisplay: opts.bin };
  const pkgJson = path.join(dir, "package.json");
  writeFileSync(pkgJson, JSON.stringify(manifest));
  return pkgJson;
}

function resolveFrom(pkgJsonPath: string) {
  configureCliResolver((id) =>
    id === "pushtodisplay/package.json" ? pkgJsonPath : undefined,
  );
}

function auth(out: string, exitCode = 0): void {
  process.env.PTD_MODE = "auth";
  process.env.PTD_AUTH_OUT = out;
  process.env.PTD_AUTH_EXIT = String(exitCode);
}

beforeEach(() => {
  tempDir = makeTempDir();
  oldPath = process.env.PATH;
  process.env.PATH = `${tempDir}${path.delimiter}${oldPath ?? ""}`;
  configureCliResolver(null);
  __resetCliCache();
});

afterEach(() => {
  process.env.PATH = oldPath;
  delete process.env.PTD_MODE;
  delete process.env.PTD_AUTH_OUT;
  delete process.env.PTD_AUTH_EXIT;
  delete process.env.PTD_RECORD;
  configureCliResolver(null);
  __resetCliCache();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("sendArgs", () => {
  const payload: Payload = {
    panelId: 2,
    background: "#1a5276",
    density: "compact",
    blocks: [{ text: "hi", color: "#ffffff" }],
  };

  it("maps a payload to CLI argv", () => {
    expect(sendArgs(payload, "board-1")).toEqual([
      "send",
      "-b",
      "board-1",
      "-p",
      "2",
      "--background",
      "#1a5276",
      "--density",
      "compact",
      "--block",
      '{"text":"hi","color":"#ffffff"}',
    ]);
  });

  it("omits -b when no board is configured", () => {
    expect(sendArgs({ panelId: 1, blocks: [{ text: "x" }] }, "")).toEqual([
      "send",
      "-p",
      "1",
      "--block",
      '{"text":"x"}',
    ]);
  });

  it("supports multiple blocks", () => {
    const args = sendArgs({ panelId: 1, blocks: [{ text: "a" }, { text: "b" }] }, "");
    expect(args.filter((a) => a === "--block")).toHaveLength(2);
  });

  it("omits optional flags that are not set", () => {
    const args = sendArgs({ panelId: 3, blocks: [{ text: "x" }] }, "");
    expect(args).toEqual(["send", "-p", "3", "--block", '{"text":"x"}']);
  });
});

describe("resolveCli", () => {
  it("uses the bundled package when a resolver resolves it", () => {
    const pkgJson = fakePkg({ bin: "./dist/cli.js" });
    try {
      resolveFrom(pkgJson);
      const cmd = resolveCli();
      expect(cmd.source).toBe("bundled");
      expect(cmd.exe).toBe(process.execPath);
      expect(cmd.prefix).toEqual([path.join(path.dirname(pkgJson), "dist", "cli.js")]);
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("falls back to PATH when the dependency is missing", () => {
    configureCliResolver(() => undefined);
    const cmd = resolveCli();
    expect(cmd.source).toBe("path");
    expect(cmd.exe).toBe("pushtodisplay");
    expect(cmd.prefix).toEqual([]);
  });

  it("falls back to PATH when the package manifest has no bin", () => {
    const pkgJson = fakePkg();
    try {
      resolveFrom(pkgJson);
      expect(resolveCli().source).toBe("path");
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("falls back to PATH when the bin target file does not exist", () => {
    const pkgJson = fakePkg();
    try {
      writeFileSync(
        pkgJson,
        JSON.stringify({ name: "pushtodisplay", bin: { pushtodisplay: "./missing.js" } }),
      );
      resolveFrom(pkgJson);
      expect(resolveCli().source).toBe("path");
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("caches the resolved command", () => {
    configureCliResolver(() => undefined);
    const a = resolveCli();
    const b = resolveCli();
    expect(a).toBe(b);
  });
});

describe("vendored CLI", () => {
  it("keeps the vendored release pinned to the adapter constant", () => {
    const root = path.join(process.cwd(), "vendor", "pushtodisplay");
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
      bin: { pushtodisplay: string };
    };
    expect(manifest.version).toBe(PUSHTODISPLAY_CLI_VERSION);
    expect(existsSync(path.join(root, manifest.bin.pushtodisplay))).toBe(true);
  });
});

describe("invocationFor", () => {
  it("uses process.execPath when the runtime is Node", () => {
    expect(
      invocationFor("/pkg/cli.js", {
        nodeRuntime: true,
        execPath: "/usr/bin/node",
      }),
    ).toEqual({ exe: "/usr/bin/node", prefix: ["/pkg/cli.js"] });
  });

  it("spawns an executable bin directly when the runtime is Bun/OpenCode", () => {
    expect(
      invocationFor("/pkg/cli.js", {
        nodeRuntime: false,
        platform: "linux",
        executable: true,
        nodePath: "/usr/bin/node",
      }),
    ).toEqual({ exe: "/pkg/cli.js", prefix: [] });
  });

  it("falls back to node when the bin is not executable", () => {
    expect(
      invocationFor("/pkg/cli.js", {
        nodeRuntime: false,
        platform: "linux",
        executable: false,
        nodePath: "/usr/bin/node",
      }),
    ).toEqual({ exe: "/usr/bin/node", prefix: ["/pkg/cli.js"] });
  });

  it("uses node on Windows instead of trying to execute a .js file", () => {
    expect(
      invocationFor("C:\\\\pkg\\\\cli.js", {
        nodeRuntime: false,
        platform: "win32",
        executable: true,
        nodePath: "C:\\\\node.exe",
      }),
    ).toEqual({ exe: "C:\\\\node.exe", prefix: ["C:\\\\pkg\\\\cli.js"] });
  });
});

describe("isNodeRuntime", () => {
  it("distinguishes Node from Bun", () => {
    expect(isNodeRuntime({} as NodeJS.ProcessVersions, { name: "node" } as NodeJS.ProcessRelease)).toBe(
      true,
    );
    expect(
      isNodeRuntime(
        { bun: "1.2.0" } as unknown as NodeJS.ProcessVersions,
        { name: "node" } as NodeJS.ProcessRelease,
      ),
    ).toBe(false);
  });
});

describe("sendPayload", () => {
  it("spawns the CLI and records the exact argv", async () => {
    expect(process.env.PATH?.split(path.delimiter)[0]).toBe(tempDir);
    expect(resolveCli()).toEqual({ exe: "pushtodisplay", prefix: [], source: "path" });
    const record = path.join(tempDir, "record.jsonl");
    process.env.PTD_RECORD = record;
    await sendPayload(
      {
        panelId: 2,
        background: "#1a5276",
        density: "compact",
        blocks: [{ text: "hi", color: "#ffffff" }],
      },
      "board-1",
    );
    const argv = JSON.parse(readFileSync(record, "utf8").trim()) as string[];
    expect(argv).toEqual([
      "send",
      "-b",
      "board-1",
      "-p",
      "2",
      "--background",
      "#1a5276",
      "--density",
      "compact",
      "--block",
      '{"text":"hi","color":"#ffffff"}',
    ]);
  });
});

describe("authStatus", () => {
  const jsonAuthed =
    JSON.stringify({
      authenticated: true,
      method: "oauth",
      accessTokenExpired: false,
      canRefresh: true,
    }) + "\n";
  const jsonRefreshable =
    JSON.stringify({
      authenticated: true,
      method: "oauth",
      accessTokenExpired: true,
      canRefresh: true,
    }) + "\n";
  const jsonUnauthed =
    JSON.stringify({
      authenticated: false,
      method: null,
      accessTokenExpired: false,
      canRefresh: false,
    }) + "\n";
  const legacyOk =
    "Auth method: OAuth (JWT)\nAll commands available (send, boards, devices).\n";
  const legacyDenied =
    "Not authenticated. Run `pushtodisplay auth login` to log in.\n";
  const legacyExpired =
    "Auth method: OAuth (JWT)\nAccess token expires: 2026-01-01T00:00:00.000Z (expired)\nAll commands available (send, boards, devices).\n";

  it("returns true for a valid JSON-authed status", async () => {
    auth(jsonAuthed);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("returns true when only the access token is expired but refresh is alive", async () => {
    auth(jsonRefreshable);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("returns false for a JSON status that is not authenticated", async () => {
    auth(jsonUnauthed);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("returns false when the CLI exits non-zero (not authenticated)", async () => {
    auth("", 1);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("falls back to legacy heuristics for older CLIs (authenticated)", async () => {
    auth(legacyOk);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("falls back to legacy heuristics for older CLIs (not authenticated)", async () => {
    auth(legacyDenied);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("treats a legacy expired access token as denied", async () => {
    auth(legacyExpired);
    await expect(authStatus()).resolves.toBe(false);
  });
});

describe("error classification", () => {
  it("detects auth failures", () => {
    expect(isAuthFailure(new Error("401 Unauthorized"))).toBe(true);
    expect(isAuthFailure(new Error("403 Forbidden"))).toBe(true);
    expect(isAuthFailure(new Error("403"))).toBe(true);
    expect(isAuthFailure(new Error("unauthorized"))).toBe(true);
    expect(isAuthFailure(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("detects a missing CLI binary via ENOENT", () => {
    expect(isCliMissing(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))).toBe(true);
    expect(isCliMissing(new Error("spawn ENOENT"))).toBe(false);
  });
});
