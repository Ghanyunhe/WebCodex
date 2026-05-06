import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectSummary,
  buildSidebarTree,
  groupProjects,
  parseSessionIndex,
  parseRolloutMessages,
  parseThreadsJson
} from "../src/sessions.js";

test("parseSessionIndex keeps newest sessions first and ignores invalid JSONL", () => {
  const input = [
    '{"id":"old","thread_name":"Old thread","updated_at":"2026-01-01T00:00:00Z"}',
    "not json",
    '{"id":"new","thread_name":"New thread","updated_at":"2026-01-02T00:00:00Z"}'
  ].join("\n");

  assert.deepEqual(parseSessionIndex(input), [
    { id: "new", title: "New thread", updatedAt: "2026-01-02T00:00:00Z" },
    { id: "old", title: "Old thread", updatedAt: "2026-01-01T00:00:00Z" }
  ]);
});

test("parseRolloutMessages extracts compact user and assistant messages", () => {
  const input = [
    '{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"hidden"}]}}',
    '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for C:\\\\repo\\n<environment_context>"}]}}',
    '{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hello"}]}}',
    '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}',
    '{"type":"event_msg","payload":{"type":"token_count","total":123}}'
  ].join("\n");

  assert.deepEqual(parseRolloutMessages(input), [
    { role: "user", text: "hello" },
    { role: "assistant", text: "hi" }
  ]);
});

test("parseThreadsJson maps Codex sqlite rows to sessions with cwd", () => {
  const input = JSON.stringify([
    {
      id: "one",
      title: "First",
      cwd: "\\\\?\\C:\\work\\alpha",
      updated_at_ms: 1000,
      rollout_path: "C:\\rollouts\\one.jsonl",
      archived: 0
    }
  ]);

  assert.deepEqual(parseThreadsJson(input), [
    {
      id: "one",
      title: "First",
      cwd: "C:\\work\\alpha",
      updatedAt: "1970-01-01T00:00:01.000Z",
      rolloutPath: "C:\\rollouts\\one.jsonl"
    }
  ]);
});

test("groupProjects groups sessions by cwd and sorts by newest update", () => {
  const sessions = [
    { id: "old", title: "Old", cwd: "C:\\work\\alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", title: "New", cwd: "C:\\work\\beta", updatedAt: "2026-01-03T00:00:00.000Z" },
    { id: "mid", title: "Mid", cwd: "C:\\work\\alpha", updatedAt: "2026-01-02T00:00:00.000Z" }
  ];

  assert.deepEqual(groupProjects(sessions), [
    { cwd: "C:\\work\\beta", name: "beta", sessionCount: 1, updatedAt: "2026-01-03T00:00:00.000Z" },
    { cwd: "C:\\work\\alpha", name: "alpha", sessionCount: 2, updatedAt: "2026-01-02T00:00:00.000Z" }
  ]);
});

test("buildProjectSummary keeps all-session count separate from grouped projects", () => {
  const sessions = [
    { id: "one", cwd: "C:\\work\\alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "two", cwd: "", updatedAt: "2026-01-02T00:00:00.000Z" }
  ];

  assert.deepEqual(buildProjectSummary(sessions), {
    totalSessionCount: 2,
    projects: [
      { cwd: "C:\\work\\alpha", name: "alpha", sessionCount: 1, updatedAt: "2026-01-01T00:00:00.000Z" }
    ]
  });
});

test("buildSidebarTree nests sessions under projects and keeps newest projects first", () => {
  const sessions = [
    { id: "old", title: "Old", cwd: "C:\\work\\alpha", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "new", title: "New", cwd: "C:\\work\\beta", updatedAt: "2026-01-03T00:00:00.000Z" },
    { id: "mid", title: "Mid", cwd: "C:\\work\\alpha", updatedAt: "2026-01-02T00:00:00.000Z" },
    { id: "skip", title: "Skip", cwd: "", updatedAt: "2026-01-04T00:00:00.000Z" }
  ];

  assert.deepEqual(buildSidebarTree(sessions), {
    totalSessionCount: 4,
    projects: [
      {
        cwd: "C:\\work\\beta",
        name: "beta",
        sessionCount: 1,
        updatedAt: "2026-01-03T00:00:00.000Z",
        sessions: [
          { id: "new", title: "New", cwd: "C:\\work\\beta", updatedAt: "2026-01-03T00:00:00.000Z" }
        ]
      },
      {
        cwd: "C:\\work\\alpha",
        name: "alpha",
        sessionCount: 2,
        updatedAt: "2026-01-02T00:00:00.000Z",
        sessions: [
          { id: "mid", title: "Mid", cwd: "C:\\work\\alpha", updatedAt: "2026-01-02T00:00:00.000Z" },
          { id: "old", title: "Old", cwd: "C:\\work\\alpha", updatedAt: "2026-01-01T00:00:00.000Z" }
        ]
      }
    ]
  });
});
