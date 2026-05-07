import assert from "node:assert/strict";
import test from "node:test";

import { buildCodexArgs } from "../src/codexRunner.js";

test("buildCodexArgs starts a new JSON Codex exec in the requested cwd", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "hello", cwd: "C:/work/app" }), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    "C:/work/app",
    "hello"
  ]);
});

test("buildCodexArgs includes model for a new session", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "hello", cwd: "C:/work/app", model: "gpt-5" }), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--model",
    "gpt-5",
    "--cd",
    "C:/work/app",
    "hello"
  ]);
});

test("buildCodexArgs includes reasoning effort for a new session", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "hello", cwd: "C:/work/app", reasoningEffort: "high" }), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--config",
    "model_reasoning_effort=\"high\"",
    "--cd",
    "C:/work/app",
    "hello"
  ]);
});

test("buildCodexArgs resumes an existing session", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "continue", sessionId: "abc" }), [
    "exec",
    "resume",
    "--json",
    "--all",
    "abc",
    "continue"
  ]);
});

test("buildCodexArgs includes model when resuming a session", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "continue", sessionId: "abc", model: "gpt-5.5" }), [
    "exec",
    "resume",
    "--json",
    "--all",
    "--model",
    "gpt-5.5",
    "abc",
    "continue"
  ]);
});

test("buildCodexArgs includes reasoning effort when resuming a session", () => {
  assert.deepEqual(buildCodexArgs({ prompt: "continue", sessionId: "abc", reasoningEffort: "xhigh" }), [
    "exec",
    "resume",
    "--json",
    "--all",
    "--config",
    "model_reasoning_effort=\"xhigh\"",
    "abc",
    "continue"
  ]);
});
