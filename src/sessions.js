import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function getCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function parseSessionIndex(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const item = JSON.parse(line);
        if (!item.id) return [];
        return [{
          id: item.id,
          title: item.thread_name || item.id,
          updatedAt: item.updated_at || null
        }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function listSessions({ codexHome = getCodexHome(), limit = 100 } = {}) {
  const sqliteSessions = await listSessionsFromSqlite({ codexHome, limit }).catch(() => []);
  if (sqliteSessions.length) return sqliteSessions;

  const indexPath = path.join(codexHome, "session_index.jsonl");
  const text = await readFile(indexPath, "utf8").catch(() => "");
  return parseSessionIndex(text).slice(0, limit);
}

export async function listProjects({ codexHome = getCodexHome(), limit = 500 } = {}) {
  return buildProjectSummary(await listSessions({ codexHome, limit })).projects;
}

export async function getProjectSummary({ codexHome = getCodexHome(), limit = 1000 } = {}) {
  return buildProjectSummary(await listSessions({ codexHome, limit }));
}

export async function getSidebarTree({ codexHome = getCodexHome(), limit = 1000 } = {}) {
  return buildSidebarTree(await listSessions({ codexHome, limit }));
}

export async function listSessionsForProject(cwd, { codexHome = getCodexHome(), limit = 200 } = {}) {
  const sessions = await listSessions({ codexHome, limit: 1000 });
  return sessions.filter((session) => session.cwd === cwd).slice(0, limit);
}

export function parseThreadsJson(text) {
  const rows = JSON.parse(text || "[]");
  return rows
    .filter((row) => row?.id && !row.archived)
    .map((row) => ({
      id: row.id,
      title: row.title || row.first_user_message || row.id,
      cwd: normalizeCwd(row.cwd || ""),
      updatedAt: new Date(Number(row.updated_at_ms || row.updated_at || 0)).toISOString(),
      rolloutPath: row.rollout_path || ""
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function groupProjects(sessions) {
  const projects = new Map();
  for (const session of sessions) {
    const cwd = session.cwd || "";
    if (!cwd) continue;
    const current = projects.get(cwd);
    if (!current) {
      projects.set(cwd, {
        cwd,
        name: projectName(cwd),
        sessionCount: 1,
        updatedAt: session.updatedAt || null
      });
    } else {
      current.sessionCount += 1;
      if (String(session.updatedAt || "") > String(current.updatedAt || "")) {
        current.updatedAt = session.updatedAt;
      }
    }
  }
  return [...projects.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function buildProjectSummary(sessions) {
  return {
    totalSessionCount: sessions.length,
    projects: groupProjects(sessions)
  };
}

export function buildSidebarTree(sessions) {
  const projects = new Map();
  for (const session of sessions) {
    const cwd = session.cwd || "";
    if (!cwd) continue;
    const current = projects.get(cwd);
    if (!current) {
      projects.set(cwd, {
        cwd,
        name: projectName(cwd),
        sessionCount: 0,
        updatedAt: session.updatedAt || null,
        sessions: []
      });
    }
    const project = projects.get(cwd);
    project.sessionCount += 1;
    project.sessions.push(session);
    if (String(session.updatedAt || "") > String(project.updatedAt || "")) {
      project.updatedAt = session.updatedAt;
    }
  }

  const sortedProjects = [...projects.values()]
    .map((project) => ({
      ...project,
      sessions: project.sessions.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  return {
    totalSessionCount: sessions.length,
    projects: sortedProjects
  };
}

function projectName(cwd) {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
}

function normalizeCwd(cwd) {
  if (cwd.startsWith("\\\\?\\UNC\\")) return `\\\\${cwd.slice(8)}`;
  if (cwd.startsWith("\\\\?\\")) return cwd.slice(4);
  return cwd;
}

export function parseRolloutMessages(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        const payload = event.payload;
        if (event.type !== "response_item" || payload?.type !== "message") return [];
        if (!["user", "assistant"].includes(payload.role)) return [];
        const text = extractContentText(payload.content);
        if (!text) return [];
        if (payload.role === "user" && isBootstrapContext(text)) return [];
        return [{ role: payload.role || "unknown", text }];
      } catch {
        return [];
      }
    });
}

function isBootstrapContext(text) {
  return text.startsWith("# AGENTS.md instructions for ") && text.includes("<environment_context>");
}

export async function readSessionMessages(sessionId, { codexHome = getCodexHome() } = {}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error("Invalid session id");
  }

  const session = (await listSessions({ codexHome, limit: 1000 })).find((item) => item.id === sessionId);
  const file = session?.rolloutPath || await findRolloutFile(path.join(codexHome, "sessions"), sessionId);
  if (!file) return [];
  return parseRolloutMessages(await readFile(file, "utf8"));
}

async function listSessionsFromSqlite({ codexHome, limit }) {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  const sql = [
    "select id,title,cwd,updated_at_ms,updated_at,rollout_path,archived,first_user_message",
    "from threads",
    "where archived = 0",
    "order by coalesce(updated_at_ms, updated_at * 1000) desc",
    `limit ${Number(limit) || 100}`
  ].join(" ");
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], { windowsHide: true });
  return parseThreadsJson(stdout);
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part?.text || part?.input_text || part?.output_text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function findRolloutFile(dir, sessionId) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findRolloutFile(fullPath, sessionId);
      if (found) return found;
    } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
      const info = await stat(fullPath);
      if (info.isFile()) return fullPath;
    }
  }
  return null;
}
