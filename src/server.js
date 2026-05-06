import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isAuthorized } from "./auth.js";
import { runCodex } from "./codexRunner.js";
import { getProjectSummary, getSidebarTree, listSessions, listSessionsForProject, readSessionMessages } from "./sessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/") && !isAuthorized(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, {
        defaultCwd: process.env.CODEX_WEB_DEFAULT_CWD || process.cwd(),
        terminalUrl: process.env.CODEX_WEB_TERMINAL_URL || ""
      });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const limit = Number(url.searchParams.get("limit") || 100);
      const cwd = url.searchParams.get("cwd");
      const sessions = cwd
        ? await listSessionsForProject(cwd, { limit })
        : await listSessions({ limit });
      return sendJson(res, 200, { sessions });
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      const limit = Number(url.searchParams.get("limit") || 500);
      return sendJson(res, 200, await getProjectSummary({ limit }));
    }

    if (req.method === "GET" && url.pathname === "/api/sidebar") {
      const limit = Number(url.searchParams.get("limit") || 1000);
      return sendJson(res, 200, await getSidebarTree({ limit }));
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
  const body = await readJsonBody(req);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return sendJson(res, 400, { error: "Prompt is required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const child = runCodex({
    prompt,
    sessionId: body.sessionId ? String(body.sessionId) : "",
    cwd: body.cwd ? String(body.cwd) : process.env.CODEX_WEB_DEFAULT_CWD,
    onEvent: (event) => writeSse(res, "codex", event),
    onExit: (code) => {
      writeSse(res, "done", { code });
      res.end();
    }
  });

  req.on("close", () => {
    if (!child.killed) child.kill();
  });
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
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
