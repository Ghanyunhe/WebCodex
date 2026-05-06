import { spawn } from "node:child_process";
import os from "node:os";

export function buildCodexArgs({ prompt, sessionId, cwd }) {
  if (sessionId) {
    return ["exec", "resume", "--json", "--all", sessionId, prompt];
  }

  const args = ["exec", "--json", "--skip-git-repo-check"];
  if (cwd) args.push("--cd", cwd);
  args.push(prompt);
  return args;
}

export function runCodex({ prompt, sessionId, cwd, env = process.env, onEvent, onExit }) {
  const command = env.CODEX_WEB_CODEX_BIN || (os.platform() === "win32" ? "codex.cmd" : "codex");
  const args = buildCodexArgs({ prompt, sessionId, cwd });
  const child = spawn(command, args, {
    cwd: cwd || process.cwd(),
    env,
    windowsHide: true
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onEvent?.({ stream: "stdout", line });
    }
  });

  child.stderr.on("data", (chunk) => {
    onEvent?.({ stream: "stderr", line: chunk.toString("utf8") });
  });

  child.on("error", (error) => {
    onEvent?.({ stream: "error", line: error.message });
  });

  child.on("close", (code) => {
    if (stdout.trim()) onEvent?.({ stream: "stdout", line: stdout.trim() });
    onExit?.(code);
  });

  return child;
}
