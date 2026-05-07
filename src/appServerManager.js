import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import os from "node:os";

const DEFAULT_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
const DEFAULT_REASONING_OPTIONS = ["low", "medium", "high", "xhigh"];
const DEFAULT_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer"];

export class AppServerManager extends EventEmitter {
  constructor({ env = process.env } = {}) {
    super();
    this.env = env;
    this.process = null;
    this.readline = null;
    this.status = "disconnected";
    this.pending = new Map();
    this.nextId = 1;
    this.connectionPromise = null;
    this.logEntries = [];
    this.maxLogEntries = 200;
    this.lastActivityAt = null;
    this.lastErrorAt = null;
    this.lastWarningAt = null;
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === "connected",
      health: this.getHealth(),
      defaultCwd: this.env.CODEX_WEB_DEFAULT_CWD || process.cwd(),
      defaultModel: this.env.CODEX_WEB_DEFAULT_MODEL || "gpt-5.4",
      modelOptions: getModelOptions(this.env),
      defaultReasoningEffort: this.env.CODEX_WEB_DEFAULT_REASONING_EFFORT || "medium",
      reasoningEffortOptions: DEFAULT_REASONING_OPTIONS
    };
  }

  getDiagnostics() {
    return {
      ...this.getStatus(),
      processId: this.process?.pid || null,
      lastActivityAt: this.lastActivityAt,
      lastErrorAt: this.lastErrorAt,
      lastWarningAt: this.lastWarningAt,
      logs: this.logEntries.slice(-120)
    };
  }

  async connect() {
    if (this.status === "connected") return this.getStatus();
    if (this.connectionPromise) return this.connectionPromise;

    this.setStatus("connecting");
    this.connectionPromise = this.startProcess()
      .then(async () => {
        const result = await this.request("initialize", {
          clientInfo: {
            name: "codex-web-remote",
            title: "Codex Web Remote",
            version: "0.2.0"
          }
        });
        this.send({ method: "initialized", params: {} });
        this.setStatus("connected");
        return {
          ...this.getStatus(),
          initialize: result
        };
      })
      .catch((error) => {
        this.setStatus("errored");
        this.stopProcess();
        throw error;
      })
      .finally(() => {
        this.connectionPromise = null;
      });

    return this.connectionPromise;
  }

  async disconnect() {
    this.stopProcess();
    this.setStatus("disconnected");
    return this.getStatus();
  }

  async listThreads({ limit = 1000, cwd = "" } = {}) {
    await this.assertConnected();
    const result = await this.request("thread/list", {
      limit,
      sortKey: "updated_at",
      sourceKinds: DEFAULT_SOURCE_KINDS,
      ...(cwd ? { cwd } : {})
    });
    return (result?.data || []).map(normalizeThread).filter((thread) => thread.cwd);
  }

  async getSidebar({ limit = 1000 } = {}) {
    const threads = await this.listThreads({ limit });
    return buildSidebarTree(threads);
  }

  async readThreadMessages(threadId) {
    await this.assertConnected();
    const result = await this.request("thread/read", { threadId, includeTurns: true });
    return flattenThreadMessages(result?.thread);
  }

  async streamTurn({ threadId = "", cwd, model, reasoningEffort, prompt, onEvent }) {
    await this.assertConnected();

    const thread = threadId
      ? await this.request("thread/resume", buildResumeParams({ threadId, cwd, model }))
      : await this.request("thread/start", buildStartThreadParams({ cwd, model }));

    const activeThreadId = thread?.thread?.id || threadId;
    if (!activeThreadId) throw new Error("App-server did not return a thread id");

    onEvent?.({ type: "thread", thread: normalizeThread(thread.thread) });

    const notifications = [];
    let resolved = false;
    let activeTurnId = "";

    const completion = new Promise((resolve, reject) => {
      const listener = (message) => {
        try {
          const normalized = normalizeTurnNotification(message, activeThreadId, activeTurnId);
          if (!normalized) return;
          notifications.push(normalized);
          onEvent?.(normalized);
          if (normalized.type === "turn-completed") {
            resolved = true;
            this.off("notification", listener);
            resolve({ threadId: activeThreadId, turnId: activeTurnId, notifications });
          }
        } catch (error) {
          this.off("notification", listener);
          reject(error);
        }
      };

      this.on("notification", listener);
    });

    const turnResult = await this.request("turn/start", {
      threadId: activeThreadId,
      input: [{ type: "text", text: prompt }],
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      approvalPolicy: "never"
    });

    activeTurnId = turnResult?.turn?.id || "";
    onEvent?.({ type: "turn-started", threadId: activeThreadId, turnId: activeTurnId });

    const result = await completion.finally(() => {
      if (!resolved) return;
    });
    const failure = result.notifications.find(
      (entry) => entry.type === "turn-completed" && entry.status && entry.status !== "completed"
    );
    if (failure) {
      throw new Error(failure.error?.message || `Turn failed with status ${failure.status}`);
    }
    return {
      threadId: activeThreadId,
      turnId: activeTurnId,
      notifications: result.notifications
    };
  }

  async assertConnected() {
    if (this.status === "connected") return;
    throw new Error("Not connected to app-server");
  }

  async startProcess() {
    const launch = buildAppServerLaunch(this.env);
    const child = spawn(launch.command, launch.args, {
      cwd: this.env.CODEX_WEB_DEFAULT_CWD || process.cwd(),
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.process = child;
    this.readline = readline.createInterface({ input: child.stdout });

    child.on("error", (error) => {
      this.pushLog("error", `app-server process error: ${error.message}`);
      this.rejectPending(error);
      this.emit("notification", { method: "process/error", params: { message: error.message } });
      this.stopProcess();
      this.setStatus("errored");
    });

    child.stderr.on("data", (chunk) => {
      const line = chunk.toString("utf8");
      this.recordStderr(line);
      this.emit("notification", { method: "process/stderr", params: { line } });
    });

    child.on("close", () => {
      this.pushLog("info", "app-server process closed");
      this.rejectPending(new Error("App-server connection closed"));
      this.stopProcess();
      if (this.status !== "disconnected") {
        this.setStatus("disconnected");
      }
    });

    this.readline.on("line", (line) => this.handleLine(line));
  }

  stopProcess() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.process) {
      if (!this.process.killed) this.process.kill();
      this.process = null;
    }
    this.rejectPending(new Error("App-server disconnected"));
  }

  setStatus(status) {
    this.status = status;
    this.lastActivityAt = new Date().toISOString();
    this.pushLog("status", `connection status changed to ${status}`);
    this.emit("status", this.getStatus());
  }

  handleLine(line) {
    const message = JSON.parse(line);
    this.recordNotification(message);
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "App-server request failed"));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    this.emit("notification", message);
  }

  send(message) {
    if (!this.process?.stdin) throw new Error("App-server stdin is unavailable");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    if (!this.process) {
      return Promise.reject(new Error("App-server is not running"));
    }

    const id = this.nextId++;
    this.send({ method, id, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  getHealth() {
    if (this.status === "errored") {
      return { level: "error", summary: "Connection errored" };
    }
    if (this.status !== "connected") {
      return { level: "offline", summary: "App-server is offline" };
    }

    const recentError = this.lastErrorAt && Date.now() - new Date(this.lastErrorAt).getTime() < 5 * 60 * 1000;
    if (recentError) {
      return { level: "warning", summary: "Connected with recent errors" };
    }

    const recentWarning = this.lastWarningAt && Date.now() - new Date(this.lastWarningAt).getTime() < 5 * 60 * 1000;
    if (recentWarning) {
      return { level: "warning", summary: "Connected with warnings" };
    }

    return { level: "healthy", summary: "Connected and stable" };
  }

  pushLog(level, message) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message: String(message || "").trim()
    };
    if (!entry.message) return;
    this.logEntries.push(entry);
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries.splice(0, this.logEntries.length - this.maxLogEntries);
    }
    this.lastActivityAt = entry.at;
  }

  recordStderr(text) {
    const message = String(text || "").trim();
    if (!message) return;
    const lower = message.toLowerCase();
    const level = lower.includes("\"level\":\"error\"") || lower.includes("fatal")
      ? "error"
      : lower.includes("\"level\":\"warn\"")
        ? "warn"
        : "info";
    if (level === "error") this.lastErrorAt = new Date().toISOString();
    if (level === "warn") this.lastWarningAt = new Date().toISOString();
    this.pushLog(level, message);
  }

  recordNotification(message) {
    const method = message?.method || "";
    if (!method) return;
    if (method === "warning") {
      this.lastWarningAt = new Date().toISOString();
      this.pushLog("warn", `warning: ${message.params?.message || ""}`);
      return;
    }
    if (method === "remoteControl/status/changed") {
      this.pushLog("info", `remote control status: ${message.params?.status || "unknown"}`);
      return;
    }
    if (method === "mcpServer/startupStatus/updated") {
      const status = message.params?.status || "unknown";
      const name = message.params?.name || "mcp";
      const error = message.params?.error ? ` - ${message.params.error}` : "";
      if (status === "failed") {
        this.lastWarningAt = new Date().toISOString();
        this.pushLog("warn", `${name} startup ${status}${error}`);
      }
      return;
    }
    if (method === "thread/status/changed") {
      this.pushLog("info", `thread ${message.params?.threadId || ""} status: ${message.params?.status?.type || "unknown"}`);
      return;
    }
    if (method === "turn/completed") {
      const status = message.params?.turn?.status || "unknown";
      this.pushLog("info", `turn completed with status ${status}`);
    }
  }
}

export function buildAppServerLaunch(env = process.env) {
  const explicitCommand = env.CODEX_WEB_APP_SERVER_COMMAND?.trim();
  if (explicitCommand) {
    if (os.platform() === "win32") {
      return { command: "cmd.exe", args: ["/d", "/s", "/c", explicitCommand] };
    }
    return { command: "sh", args: ["-lc", explicitCommand] };
  }

  const explicitBin = env.CODEX_WEB_CODEX_BIN?.trim();
  if (explicitBin) {
    return { command: explicitBin, args: ["app-server"] };
  }

  if (os.platform() === "win32") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "codex app-server"] };
  }

  return { command: "codex", args: ["app-server"] };
}

export function normalizeThread(thread = {}) {
  const updatedAt = Number(thread.updatedAt || thread.createdAt || 0);
  return {
    id: thread.id || "",
    title: thread.name || thread.preview || thread.id || "Untitled thread",
    cwd: thread.cwd || "",
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : null,
    thread
  };
}

export function buildSidebarTree(threads) {
  const projects = new Map();

  for (const thread of threads) {
    if (!thread.cwd) continue;
    if (!projects.has(thread.cwd)) {
      projects.set(thread.cwd, {
        cwd: thread.cwd,
        name: projectName(thread.cwd),
        sessionCount: 0,
        updatedAt: thread.updatedAt || null,
        sessions: []
      });
    }

    const project = projects.get(thread.cwd);
    project.sessionCount += 1;
    project.sessions.push({
      id: thread.id,
      title: thread.title,
      cwd: thread.cwd,
      updatedAt: thread.updatedAt
    });

    if (String(thread.updatedAt || "") > String(project.updatedAt || "")) {
      project.updatedAt = thread.updatedAt;
    }
  }

  return {
    totalSessionCount: threads.length,
    projects: [...projects.values()]
      .map((project) => ({
        ...project,
        sessions: project.sessions.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      }))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
  };
}

export function flattenThreadMessages(thread = {}) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages = [];

  for (const turn of turns) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = (item.content || []).map((entry) => entry?.text || "").join("\n").trim();
        if (text) messages.push({ role: "user", text });
      }
      if (item.type === "agentMessage") {
        const text = String(item.text || "").trim();
        if (text) messages.push({ role: "assistant", text });
      }
    }
  }

  return messages;
}

export function normalizeTurnNotification(message, threadId, turnId) {
  if (message.method === "warning") {
    return {
      type: "warning",
      threadId: message.params?.threadId || threadId,
      message: message.params?.message || ""
    };
  }

  if (message.method === "process/stderr") {
    return {
      type: "stderr",
      line: message.params?.line || ""
    };
  }

  if (message.params?.threadId && message.params.threadId !== threadId) {
    return null;
  }

  if (message.method === "item/agentMessage/delta") {
    if (turnId && message.params?.turnId && message.params.turnId !== turnId) return null;
    return {
      type: "assistant-delta",
      threadId,
      turnId: message.params?.turnId || turnId,
      delta: message.params?.delta || ""
    };
  }

  if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
    if (turnId && message.params?.turnId && message.params.turnId !== turnId) return null;
    return {
      type: "assistant-complete",
      threadId,
      turnId: message.params?.turnId || turnId,
      text: message.params?.item?.text || ""
    };
  }

  if (message.method === "turn/completed") {
    if (turnId && message.params?.turn?.id && message.params.turn.id !== turnId) return null;
    return {
      type: "turn-completed",
      threadId,
      turnId: message.params?.turn?.id || turnId,
      status: message.params?.turn?.status || "completed",
      error: message.params?.turn?.error || null
    };
  }

  return null;
}

function buildStartThreadParams({ cwd, model }) {
  return {
    ...(model ? { model } : {}),
    ...(cwd ? { cwd } : {}),
    approvalPolicy: "never",
    sandbox: "workspace-write",
    serviceName: "codex-web-remote"
  };
}

function buildResumeParams({ threadId, cwd, model }) {
  return {
    threadId,
    ...(model ? { model } : {}),
    ...(cwd ? { cwd } : {}),
    serviceName: "codex-web-remote"
  };
}

function projectName(cwd) {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
}

function getModelOptions(env = process.env) {
  const raw = env.CODEX_WEB_MODEL_OPTIONS?.trim();
  if (!raw) return DEFAULT_MODEL_OPTIONS;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}
