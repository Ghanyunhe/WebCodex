import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppServerManager } from "./appServerManager.js";
import { isAuthorized } from "./auth.js";
import {
  getProjectSummary,
  getSidebarTree as getStoredSidebarTree,
  listSessions,
  readSessionMessages
} from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const appServer = new AppServerManager();

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/") && !isAuthorized(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        defaultCwd: process.env.CODEX_WEB_DEFAULT_CWD || process.cwd(),
        defaultModel: process.env.CODEX_WEB_DEFAULT_MODEL || "gpt-5.4",
        modelOptions: getModelOptions(),
        defaultReasoningEffort: process.env.CODEX_WEB_DEFAULT_REASONING_EFFORT || "medium",
        reasoningEffortOptions: getReasoningEffortOptions(),
        terminalUrl: process.env.CODEX_WEB_TERMINAL_URL || "",
        transportMode: "app-server"
      });
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true,
        service: "codex-web-remote",
        transportMode: "app-server",
        appServerStatus: appServer.getStatus().status
      });
    }

    if (req.method === "GET" && url.pathname === "/readyz") {
      const status = appServer.getStatus();
      return sendJson(res, status.connected ? 200 : 503, {
        ok: status.connected,
        service: "codex-web-remote",
        appServerStatus: status.status
      });
    }

    if (req.method === "GET" && url.pathname === "/api/connection/status") {
      return sendJson(res, 200, appServer.getStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/connection/diagnostics") {
      return sendJson(res, 200, appServer.getDiagnostics());
    }

    if (req.method === "POST" && url.pathname === "/api/connection/connect") {
      return sendJson(res, 200, await appServer.connect());
    }

    if (req.method === "POST" && url.pathname === "/api/connection/disconnect") {
      return sendJson(res, 200, await appServer.disconnect());
    }

    if (req.method === "GET" && url.pathname === "/api/sidebar") {
      const limit = Number(url.searchParams.get("limit") || 1000);
      return sendJson(res, 200, await getStoredSidebarTree({ limit }));
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const limit = Number(url.searchParams.get("limit") || 100);
      const cwd = url.searchParams.get("cwd") || "";
      const sessions = (await listSessions({ limit: Math.max(limit, 1000) }))
        .filter((session) => !cwd || session.cwd === cwd)
        .slice(0, limit);
      return sendJson(res, 200, { sessions });
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      const limit = Number(url.searchParams.get("limit") || 500);
      return sendJson(res, 200, await getProjectSummary({ limit }));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const sessionId = decodeURIComponent(url.pathname.split("/").at(-1));
      return sendJson(res, 200, { messages: await readSessionMessages(sessionId) });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return streamChat(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log(`Codex Web Remote listening on http://${host}:${port}`);
  });
}

async function streamChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message });
  }
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return sendJson(res, 400, { error: "Prompt is required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  try {
    const result = await appServer.streamTurn({
      prompt,
      threadId: body.sessionId ? String(body.sessionId) : "",
      cwd: body.cwd ? String(body.cwd) : process.env.CODEX_WEB_DEFAULT_CWD,
      model: body.model ? String(body.model).trim() : "",
      reasoningEffort: body.reasoningEffort ? String(body.reasoningEffort).trim() : "",
      onEvent: (event) => {
        if (event.type === "thread") return writeSse(res, "thread", event.thread);
        if (event.type === "assistant-delta") return writeSse(res, "delta", { delta: event.delta });
        if (event.type === "assistant-complete") return writeSse(res, "message", { text: event.text });
      }
    });
    const failure = result.notifications?.find(
      (entry) => entry.type === "turn-completed" && entry.status && entry.status !== "completed"
    );
    if (failure) {
      writeSse(res, "error", {
        message: failure.error?.message || `Turn failed with status ${failure.status}`
      });
      return;
    }
    writeSse(res, "done", result);
  } catch (error) {
    writeSse(res, "error", { message: error.message });
  } finally {
    res.end();
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

async function serveStatic(urlPath, res) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(publicDir, path.normalize(safePath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: "Forbidden" });

  const data = await readFile(filePath).catch(() => null);
  if (!data) return sendJson(res, 404, { error: "Not found" });

  const type = contentType(filePath);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

function getModelOptions() {
  const raw = process.env.CODEX_WEB_MODEL_OPTIONS?.trim();
  if (!raw) return ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function getReasoningEffortOptions() {
  return ["low", "medium", "high", "xhigh"];
}
