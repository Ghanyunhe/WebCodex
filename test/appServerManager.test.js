import assert from "node:assert/strict";
import test from "node:test";

import {
  AppServerManager,
  buildAppServerLaunch,
  buildSidebarTree,
  flattenThreadMessages,
  normalizeThread,
  normalizeTurnNotification,
  threadHasPendingTurn
} from "../src/appServerManager.js";

test("buildAppServerLaunch prefers a direct codex binary when configured", () => {
  const launch = buildAppServerLaunch({ CODEX_WEB_CODEX_BIN: "/usr/local/bin/codex" });
  assert.deepEqual(launch, {
    command: "/usr/local/bin/codex",
    args: ["app-server"]
  });
});

test("normalizeThread keeps title cwd and updated timestamp", () => {
  const thread = normalizeThread({
    id: "thr_123",
    name: "Repo cleanup",
    cwd: "/workspace/repo",
    updatedAt: 1778119886
  });

  assert.equal(thread.id, "thr_123");
  assert.equal(thread.title, "Repo cleanup");
  assert.equal(thread.cwd, "/workspace/repo");
  assert.equal(thread.updatedAt, "2026-05-07T02:11:26.000Z");
});

test("buildSidebarTree groups threads by cwd", () => {
  const sidebar = buildSidebarTree([
    {
      id: "a",
      title: "Newest",
      cwd: "/workspace/repo",
      updatedAt: "2026-05-07T02:11:26.000Z"
    },
    {
      id: "b",
      title: "Older",
      cwd: "/workspace/repo",
      updatedAt: "2026-05-06T02:11:26.000Z"
    },
    {
      id: "c",
      title: "Elsewhere",
      cwd: "/workspace/other",
      updatedAt: "2026-05-05T02:11:26.000Z"
    }
  ]);

  assert.equal(sidebar.totalSessionCount, 3);
  assert.equal(sidebar.projects.length, 2);
  assert.equal(sidebar.projects[0].sessions[0].id, "a");
});

test("flattenThreadMessages keeps user and assistant content in order", () => {
  const messages = flattenThreadMessages({
    turns: [
      {
        items: [
          {
            type: "userMessage",
            content: [{ type: "text", text: "hello" }]
          },
          {
            type: "agentMessage",
            text: "hi"
          }
        ]
      }
    ]
  });

  assert.deepEqual(messages, [
    { role: "user", text: "hello" },
    { role: "assistant", text: "hi" }
  ]);
});

test("normalizeTurnNotification maps app-server deltas to assistant updates", () => {
  const notification = normalizeTurnNotification({
    method: "item/agentMessage/delta",
    params: {
      threadId: "thr_1",
      turnId: "turn_1",
      delta: "hello"
    }
  }, "thr_1", "turn_1");

  assert.deepEqual(notification, {
    type: "assistant-delta",
    threadId: "thr_1",
    turnId: "turn_1",
    delta: "hello"
  });
});

test("manager diagnostics expose offline health by default", () => {
  const manager = new AppServerManager({ env: {} });
  const diagnostics = manager.getDiagnostics();
  assert.equal(diagnostics.health.level, "offline");
  assert.equal(diagnostics.logs.length, 0);
});

test("manager records warnings and stderr logs in diagnostics", () => {
  const manager = new AppServerManager({ env: {} });
  manager.recordNotification({
    method: "warning",
    params: { message: "Heads up" }
  });
  manager.recordStderr("{\"level\":\"WARN\",\"message\":\"something happened\"}");
  const diagnostics = manager.getDiagnostics();
  assert.equal(diagnostics.logs.length, 2);
  assert.equal(diagnostics.logs[0].level, "warn");
  assert.equal(diagnostics.logs[1].level, "warn");
});

test("streamTurn rejects when the turn completes with a failure", async () => {
  const manager = new AppServerManager({ env: {} });
  manager.status = "connected";

  let requestCount = 0;
  manager.request = async (method) => {
    requestCount += 1;
    if (method === "thread/start") {
      return { thread: { id: "thr_1", cwd: "/workspace", createdAt: 1778119886 } };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        manager.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thr_1",
            turn: {
              id: "turn_1",
              status: "failed",
              error: { message: "usage limit exceeded" }
            }
          }
        });
      });
      return { turn: { id: "turn_1" } };
    }
    throw new Error(`unexpected method: ${method}`);
  };

  await assert.rejects(
    () => manager.streamTurn({ cwd: "/workspace", prompt: "hello" }),
    /usage limit exceeded/
  );
  assert.equal(requestCount, 2);
});

test("threadHasPendingTurn detects active or in-progress turns", () => {
  assert.equal(threadHasPendingTurn({ status: { type: "active" } }), true);
  assert.equal(threadHasPendingTurn({ turns: [{ status: "inProgress" }] }), true);
  assert.equal(threadHasPendingTurn({ status: { type: "idle" }, turns: [{ status: "completed" }] }), false);
});

test("streamTurn reconnects before resuming a thread with a pending turn", async () => {
  const manager = new AppServerManager({ env: {} });
  manager.status = "connected";

  const calls = [];
  let resumeCount = 0;

  manager.connect = async () => {
    calls.push("connect");
    manager.status = "connected";
    return manager.getStatus();
  };

  manager.stopProcess = () => {
    calls.push("stopProcess");
    manager.status = "disconnected";
  };

  manager.request = async (method) => {
    calls.push(method);
    if (method === "thread/resume") {
      resumeCount += 1;
      return {
        thread: {
          id: "thr_1",
          cwd: "/workspace",
          updatedAt: 1778119886,
          status: { type: resumeCount === 1 ? "active" : "idle" },
          turns: resumeCount === 1 ? [{ id: "turn_old", status: "inProgress" }] : []
        }
      };
    }
    if (method === "turn/start") {
      queueMicrotask(() => {
        manager.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: "thr_1",
            turn: { id: "turn_1", status: "completed" }
          }
        });
      });
      return { turn: { id: "turn_1" } };
    }
    throw new Error(`unexpected method: ${method}`);
  };

  const result = await manager.streamTurn({
    threadId: "thr_1",
    cwd: "/workspace",
    prompt: "hello"
  });

  assert.equal(result.threadId, "thr_1");
  assert.deepEqual(calls, [
    "thread/resume",
    "stopProcess",
    "connect",
    "thread/resume",
    "turn/start"
  ]);
});
