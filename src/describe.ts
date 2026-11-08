/**
 * Human-readable, present-tense one-liners describing a tool call.
 *
 * The board is read from a distance by a person who does not know what a
 * "tool call" is, so everything here aims at plain language:
 *
 *   bash   "npm test | head"                 -> "running npm test"
 *   read   "/Users/me/proj/src/a.ts"         -> "reading src/a.ts"
 *   edit   {filePath, oldString, newString}  -> "editing src/a.ts (+8 −3)"
 *   task   {description: "Review auth"}      -> "delegating: Review auth"
 *
 * Paths are shortened against the session cwd (then $HOME) because absolute
 * paths crowd out the part of the string that identifies the file.
 *
 * OpenCode's built-in tools use lowercase names (`bash`, `read`, `edit`,
 * `write`, `grep`, `glob`, `webfetch`, `task`, `todowrite`, ...), and their
 * argument keys differ slightly from pi's (`filePath`, `oldString`,
 * `newString`). Both spellings are accepted so the same description works for
 * built-ins, MCP tools and older names.
 */
import * as path from "node:path";

import { truncate } from "./config.ts";

/**
 * Longest tool description, in characters.
 *
 * A step line is `session description STATUS time`, which at `medium` runs
 * to ~35 characters per row — so a 48-character description keeps the whole
 * entry around two rows. Only tool descriptions are capped here; prompts and
 * results use the prose budget in `messages.ts`.
 */
export const MAX_DESC = 48;

export interface DescribeOpts {
  /** Session cwd — absolute paths inside it become relative. */
  cwd?: string;
  /** Home directory override (defaults to $HOME). */
  home?: string;
  /** Character budget for the description (defaults to MAX_DESC). */
  max?: number;
}

type Args = Record<string, unknown>;

const toArgs = (args: unknown): Args =>
  args && typeof args === "object" ? (args as Args) : {};

/** First non-empty string among `keys`. */
function str(a: Args, keys: string[]): string {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/** Shorten a path against the cwd, then $HOME. */
export function shortenPath(p: string, opts: DescribeOpts = {}): string {
  if (!p) return "";
  let out = p;
  const cwd = opts.cwd;
  if (cwd && path.isAbsolute(out)) {
    const rel = path.relative(cwd, out);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) out = rel;
  }
  const home = opts.home ?? process.env.HOME ?? "";
  if (home && path.isAbsolute(out) && (out === home || out.startsWith(home + path.sep))) {
    out = "~" + out.slice(home.length);
  }
  // Still absolute (a temp dir, another volume): the leading directories are
  // pure noise on a 48-character line, so keep only what names the file.
  if (path.isAbsolute(out) && out !== "~") out = "…/" + path.basename(out);
  return out;
}

/**
 * Shorten any absolute paths inside free text.
 *
 * Prompts are pasted, not written: a user drops a temp-file path in, and 60
 * characters of UUID then occupy the whole panel. Only path-looking words are
 * touched, so prose and URLs survive.
 */
export function tidyText(text: string, opts: DescribeOpts = {}): string {
  return text
    .split(/(\s+)/)
    .map((part) => (part.startsWith("/") ? shortenPath(part, opts) : part))
    .join("");
}

/**
 * Reduce a shell command to the interesting part: drop the leading `cd` guard,
 * env assignments, redirections, and the boilerplate `| head`/`| tail` tail.
 */
export function cleanCommand(command: string): string {
  const line = command.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  let c = line;
  c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  c = c.replace(/\s*\|\s*(?:head|tail)(?:\s+-n?\s*\d+)?\s*$/, "");
  c = c.replace(/\s+2>&1\s*$/, "");
  c = c.replace(/\s+>+\s*\S+\s*$/, "");
  return c.replace(/\s+/g, " ").trim();
}

/**
 * A command too long to read keeps the program and its bare subcommand
 * (`git push`, `npm test`) and drops the arguments — at this width the arguments
 * are the part nobody reads.
 */
function summariseCommand(command: string, max = MAX_DESC): string {
  if (command.length <= max - 8) return command;
  const words = command.split(" ").filter(Boolean);
  const program = words[0] ?? "";
  const sub = words[1] ?? "";
  // A subcommand is a short bare word: `test`, `push`, `run`. A long token is an
  // argument (a pattern, a hash) and would only be truncated later anyway.
  const bare = /^[A-Za-z][A-Za-z0-9:._-]*$/.test(sub) && sub.length <= 12;
  return bare ? `${program} ${sub}` : program;
}

/**
 * Fit a file name into a budget without losing its extension —
 * `pasted-image-2026110….png` still says what the file was.
 */
function fitName(name: string, budget: number): string {
  if (name.length <= budget) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const room = Math.max(1, budget - 1 - ext.length);
  return name.slice(0, room) + "…" + ext;
}

const lineCount = (v: unknown): number =>
  typeof v === "string" && v.length ? v.split("\n").length : 0;

/** "+N −M" for an edit, based on the replacement text it carries. */
function diffStat(a: Args): string {
  const added = lineCount(a.newString ?? a.newText ?? a.new_string ?? a.content);
  const removed = lineCount(a.oldString ?? a.oldText ?? a.old_string);
  if (!added && !removed) return "";
  return ` (+${added} −${removed})`;
}

const PATH_VERBS: Record<string, string> = {
  read: "reading",
  write: "writing",
  edit: "editing",
  multiedit: "editing",
  create: "creating",
  delete: "deleting",
  move: "moving",
};

const PATH_KEYS = ["filePath", "file_path", "path", "file", "target"];

/** Build the display string for a tool call. Never empty. */
export function describeTool(toolName: string, args: unknown, opts: DescribeOpts = {}): string {
  const max = opts.max ?? MAX_DESC;
  const a = toArgs(args);
  const rel = (p: string) => shortenPath(p, opts);
  const verb = PATH_VERBS[toolName];
  const p = str(a, PATH_KEYS);

  if (verb && p) {
    const stat = toolName === "edit" || toolName === "multiedit" ? diffStat(a) : "";
    const shown = rel(p);
    const slash = shown.lastIndexOf("/");
    const dir = slash >= 0 ? shown.slice(0, slash + 1) : "";
    const base = shown.slice(slash + 1);
    // Give up detail in a fixed order — the diff stat first, then the directory,
    // and only then abbreviate the file name, which keeps its extension.
    for (const candidate of [
      `${verb} ${shown}${stat}`,
      `${verb} ${shown}`,
      `${verb} ${base}${stat}`,
      `${verb} ${base}`,
    ]) {
      if (candidate.length <= max) return candidate;
    }
    const room = Math.max(4, max - verb.length - 1 - dir.length - stat.length);
    return `${verb} ${dir}${fitName(base, room)}${stat}`;
  }

  switch (toolName) {
    case "bash":
    case "shell": {
      const cmd = str(a, ["command", "cmd", "script"]);
      if (cmd) return truncate(`running ${summariseCommand(cleanCommand(cmd), max)}`, max);
      break;
    }
    case "grep":
    case "search": {
      const pattern = str(a, ["pattern", "query", "regex"]);
      const where = str(a, ["path", "glob", "include"]);
      if (pattern) {
        return truncate(`searching for ${pattern}${where ? ` in ${rel(where)}` : ""}`, max);
      }
      break;
    }
    case "glob":
    case "find": {
      const pattern = str(a, ["pattern", "glob", "query"]);
      if (pattern) return truncate(`finding ${pattern}`, max);
      break;
    }
    case "list":
    case "ls":
      return truncate(`listing ${rel(str(a, ["path", "dir", "directory"])) || "."}`, max);
    case "websearch":
    case "web_search":
    case "search_web": {
      const q = str(a, ["query", "q", "search"]);
      if (q) return truncate(`searching the web for ${q}`, max);
      break;
    }
    case "webfetch":
    case "web_fetch":
    case "fetch":
    case "curl": {
      const url = str(a, ["url", "uri", "href"]);
      if (url) return truncate(`fetching ${url.replace(/^https?:\/\//, "")}`, max);
      break;
    }
    case "todowrite":
    case "todoread":
    case "todo_write":
    case "todo_read":
    case "todo":
      return "updating the plan";
    case "task":
    case "agent": {
      const d = str(a, ["description", "prompt", "task"]);
      return truncate(`delegating${d ? `: ${d}` : " to a subagent"}`, max);
    }
    case "patch":
    case "apply_patch":
      return "applying a patch";
    case "skill":
      return "loading a skill";
    case "question":
      return "asking you a question";
  }

  // Generic fallback: keep the tool name visible, show what it was given.
  const keys = Object.keys(a).slice(0, 3);
  if (!keys.length) return toolName;
  const parts = keys.map((k) => `${k}: ${truncate(String(a[k]), 24)}`).join(", ");
  return truncate(`${toolName}(${parts})`, max);
}
