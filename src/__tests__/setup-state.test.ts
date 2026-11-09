import {
  SETUP_VERSION,
  cacheDir,
  isSetupComplete,
  markSetupComplete,
  setupPath,
} from "../setup-state.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

function tempEnv(extra: NodeJS.ProcessEnv = {}): {
  root: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-setup-"));
  return {
    root,
    env: { PUSHTODISPLAY_CACHE_DIR: root, ...extra },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("setup marker", () => {
  it("is incomplete until the marker is written", () => {
    const { env, cleanup } = tempEnv();
    try {
      expect(isSetupComplete(env)).toBe(false);
      const record = markSetupComplete(
        { boardId: "board-1", panel: 2, label: "release", cliVersion: "0.1.19" },
        env,
      );
      expect(record.version).toBe(SETUP_VERSION);
      expect(record.boardId).toBe("board-1");
      expect(record.panel).toBe(2);
      expect(record.label).toBe("release");
      expect(isSetupComplete(env)).toBe(true);
      const onDisk = JSON.parse(readFileSync(setupPath(env), "utf8")) as {
        completedAt: number;
      };
      expect(onDisk.completedAt).toBe(record.completedAt);
    } finally {
      cleanup();
    }
  });

  it("ignores a malformed or older marker", () => {
    const { root, env, cleanup } = tempEnv();
    try {
      writeFileSync(path.join(root, "setup.json"), "not json");
      expect(isSetupComplete(env)).toBe(false);
      writeFileSync(
        path.join(root, "setup.json"),
        JSON.stringify({ version: 0, completedAt: 1 }),
      );
      expect(isSetupComplete(env)).toBe(false);
      writeFileSync(
        path.join(root, "setup.json"),
        JSON.stringify({ version: SETUP_VERSION }),
      );
      expect(isSetupComplete(env)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("uses an OpenCode-specific namespace under the user cache", () => {
    expect(cacheDir({ HOME: "/home/ada" })).toBe(
      "/home/ada/.cache/pushtodisplay/opencode",
    );
    expect(cacheDir({ HOME: "/home/ada", XDG_CACHE_HOME: "/cache" })).toBe(
      "/cache/pushtodisplay/opencode",
    );
    expect(setupPath({ HOME: "/home/ada" })).toBe(
      "/home/ada/.cache/pushtodisplay/opencode/setup.json",
    );
  });

  it("keeps the marker isolated per host/cache namespace", () => {
    const a = tempEnv();
    const b = tempEnv();
    try {
      markSetupComplete({ panel: 1 }, a.env);
      expect(isSetupComplete(a.env)).toBe(true);
      expect(isSetupComplete(b.env)).toBe(false);
      // A marker written for another integration (for example Codex) does not
      // satisfy OpenCode's setup gate.
      const codex = path.join(a.root, "pushtodisplay", "codex");
      expect(setupPath(a.env)).not.toBe(path.join(codex, "setup.json"));
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });
});
