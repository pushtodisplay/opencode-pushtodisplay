import {
  executionFailedPayload,
  executionInterruptedPayload,
  executionSucceededPayload,
  idlePayload,
  permissionPayload,
  sessionDeletedPayload,
  sessionOpenedPayload,
  sessionRenamedPayload,
  type PermissionAskedEvent,
  type SessionCreatedEvent,
  type SessionDeletedEvent,
  type SessionFailedEvent,
  type SessionIdleEvent,
  type SessionInterruptedEvent,
  type SessionRenamedEvent,
} from "../events.ts";
import type { Payload } from "../payloads.ts";

const WALL = "11:04:22";
const OPTS = { panelId: 2, agent: "release", wall: WALL, cwd: "/repo" };
const text = (p: Payload) => p.blocks.map((b) => b.text).join("");

describe("session events", () => {
  it("maps session.created to a READY line", () => {
    const event: SessionCreatedEvent = {
      type: "session.created",
      data: { sessionID: "s1", title: "release" },
    };
    expect(text(sessionOpenedPayload(event, OPTS))).toBe(
      "release session opened READY 11:04",
    );
  });

  it("maps session.renamed to a READY line with the new name", () => {
    const event: SessionRenamedEvent = {
      type: "session.renamed",
      data: { sessionID: "s1", title: "qa" },
    };
    expect(text(sessionRenamedPayload(event, { ...OPTS, agent: "qa" }))).toBe(
      "qa session renamed READY 11:04",
    );
  });

  it("maps session.deleted to an ENDED line", () => {
    const event: SessionDeletedEvent = {
      type: "session.deleted",
      data: { sessionID: "s1" },
    };
    expect(text(sessionDeletedPayload(event, OPTS))).toBe(
      "release session closed ENDED 11:04",
    );
  });
});

describe("execution events", () => {
  it("maps a structured failure to FAIL with the provider message", () => {
    const event: SessionFailedEvent = {
      type: "session.execution.failed",
      data: {
        sessionID: "s1",
        error: { type: "provider.error", message: "upstream timed out", status: 500 },
      },
    };
    expect(text(executionFailedPayload(event, OPTS))).toBe(
      "release HTTP 500 upstream timed out FAIL 11:04",
    );
  });

  it("maps a user interrupt to STOP", () => {
    const event: SessionInterruptedEvent = {
      type: "session.execution.interrupted",
      data: { sessionID: "s1", reason: "user" },
    };
    expect(text(executionInterruptedPayload(event, OPTS)!)).toBe(
      "release interrupted before it finished STOP 11:04",
    );
  });

  it("does not report a shutdown interrupt as STOP", () => {
    const event: SessionInterruptedEvent = {
      type: "session.execution.interrupted",
      data: { sessionID: "s1", reason: "shutdown" },
    };
    expect(executionInterruptedPayload(event, OPTS)).toBeNull();
  });

  it("maps session.idle to DONE quoting the last assistant text", () => {
    const event: SessionIdleEvent = { type: "session.idle", data: { sessionID: "s1" } };
    expect(text(idlePayload(event, { ...OPTS, text: "All tests pass." }))).toBe(
      "release All tests pass. DONE 11:04",
    );
    expect(text(idlePayload(event, { ...OPTS, text: "  " }))).toBe(
      "release no summary DONE 11:04",
    );
  });

  it("maps session.execution.succeeded to the same DONE line", () => {
    const event = {
      type: "session.execution.succeeded" as const,
      data: { sessionID: "s1" },
    };
    expect(text(executionSucceededPayload(event, { ...OPTS, text: "All tests pass." }))).toBe(
      "release All tests pass. DONE 11:04",
    );
  });
});

describe("permission events", () => {
  it("maps action and resource to a NEEDS line", () => {
    const event: PermissionAskedEvent = {
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "s1",
        action: "bash",
        resources: ["git push --force-with-lease"],
      },
    };
    expect(text(permissionPayload(event, OPTS))).toBe(
      "release Allow bash: git push --force-with-lease NEEDS 11:04",
    );
  });

  it("maps OpenCode's shell action to the familiar bash name", () => {
    const event: PermissionAskedEvent = {
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "s1",
        action: "shell",
        resources: ["git push --force-with-lease"],
      },
    };
    expect(text(permissionPayload(event, OPTS))).toBe(
      "release Allow bash: git push --force-with-lease NEEDS 11:04",
    );
  });

  it("shortens a path resource against the session cwd", () => {
    const event: PermissionAskedEvent = {
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "s1",
        action: "edit",
        resources: ["/repo/src/auth.ts"],
      },
    };
    expect(text(permissionPayload(event, OPTS))).toBe(
      "release Allow edit: src/auth.ts NEEDS 11:04",
    );
  });

  it("uses the server message when it is more specific", () => {
    const event: PermissionAskedEvent = {
      type: "permission.asked",
      data: {
        id: "p1",
        sessionID: "s1",
        action: "bash",
        resources: ["rm -rf build"],
        message: "Allow bash: rm -rf build?",
      },
    };
    expect(text(permissionPayload(event, OPTS))).toBe(
      "release Allow bash: rm -rf build? NEEDS 11:04",
    );
  });
});
