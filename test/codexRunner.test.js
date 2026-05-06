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
