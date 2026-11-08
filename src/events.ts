/**
 * OpenCode event shapes and the payload each one becomes.
 *
 * Keeping the mapping here (instead of inline in `extension.ts`) makes the
 * visible vocabulary testable without a running OpenCode server: a test feeds
 * the same event object the server emits and asserts the four runs that reach
 * the board.
 *
 * Only the fields the plugin reads are typed. OpenCode's event schemas are
 * wider; treating them structurally keeps this package independent of the
 * server's internal schema package.
 */
import {
  doneMessage,
  errorDetail,
  errorMessage,
  permissionMessage,
  renamedMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stoppedMessage,
} from "./messages.ts";
import type { Payload } from "./payloads.ts";

export interface LineOpts {
  panelId: number;
  agent: string;
  wall: string;
  cwd?: string;
}

export interface SessionCreatedEvent {
  type: "session.created";
  data: {
    sessionID: string;
    title?: string;
    parentID?: string;
    location?: { directory?: string };
  };
}

export interface SessionRenamedEvent {
  type: "session.renamed";
  data: { sessionID: string; title: string };
}

export interface SessionDeletedEvent {
  type: "session.deleted";
  data: { sessionID: string };
}

export interface SessionFailedEvent {
  type: "session.execution.failed";
  data: {
    sessionID: string;
    error: {
      message?: string;
      type?: string;
      status?: number;
      response?: { body?: string };
    };
  };
}

export interface SessionInterruptedEvent {
  type: "session.execution.interrupted";
  data: { sessionID: string; reason: "user" | "shutdown" | "superseded" | "inactivity" };
}

export interface SessionIdleEvent {
  type: "session.idle";
  data: { sessionID: string };
}

export interface SessionSucceededEvent {
  type: "session.execution.succeeded";
  data: { sessionID: string };
}

export interface SessionTextEndedEvent {
  type: "session.text.ended";
  data: { sessionID: string; assistantMessageID?: string; ordinal?: number; text: string };
}

export interface PermissionAskedEvent {
  type: "permission.asked";
  data: {
    id: string;
    sessionID: string;
    action: string;
    resources: string[];
    message?: string;
    metadata?: Record<string, unknown>;
    source?: { type: "tool"; messageID: string; id: string };
  };
}

/** A permission request is blocking: show it. */
export function permissionPayload(event: PermissionAskedEvent, opts: LineOpts): Payload {
  return permissionMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    action: event.data.action,
    resources: event.data.resources ?? [],
    message: event.data.message,
    cwd: opts.cwd,
  });
}

export function sessionOpenedPayload(event: SessionCreatedEvent, opts: LineOpts): Payload {
  return sessionOpenedMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
  });
}

export function sessionRenamedPayload(event: SessionRenamedEvent, opts: LineOpts): Payload {
  return renamedMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
  });
}

export function sessionDeletedPayload(event: SessionDeletedEvent, opts: LineOpts): Payload {
  return sessionClosedMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
  });
}

export function executionFailedPayload(event: SessionFailedEvent, opts: LineOpts): Payload {
  return errorMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    detail: errorDetail(event.data.error),
  });
}

/** Only a user interrupt is STOP; shutdown is handled by the ENDED line. */
export function executionInterruptedPayload(
  event: SessionInterruptedEvent,
  opts: LineOpts,
): Payload | null {
  if (event.data.reason !== "user") return null;
  return stoppedMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
  });
}

export function idlePayload(
  event: SessionIdleEvent,
  opts: LineOpts & { text: string },
): Payload {
  return doneMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    text: opts.text,
  });
}

/**
 * OpenCode 2.2 emits `session.execution.succeeded` when a run settles. Some
 * versions also emit `session.idle`; both map to the same DONE line.
 */
export function executionSucceededPayload(
  event: SessionSucceededEvent,
  opts: LineOpts & { text: string },
): Payload {
  return doneMessage({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    text: opts.text,
  });
}
