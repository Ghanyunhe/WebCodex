import { spawn } from "node:child_process";
import os from "node:os";

export function buildCodexArgs({ prompt, sessionId, cwd, model, reasoningEffort }) {
  if (sessionId) {
    const args = ["exec", "resume", "--json", "--all"];
    if (model) args.push("--model", model);
    if (reasoningEffort) args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
    args.push(sessionId, prompt);
    return args;
  }

  const args = ["exec", "--json", "--skip-git-repo-check"];
  if (model) args.push("--model", model);
  if (reasoningEffort) args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
  if (cwd) args.push("--cd", cwd);
  args.push(prompt);
  return args;
}

export function runCodex({ prompt, sessionId, cwd, model, reasoningEffort, env = process.env, onEvent, onExit }) {
  const command = env.CODEX_WEB_CODEX_BIN || (os.platform() === "win32" ? "codex.exe" : "codex");
  const args = buildCodexArgs({ prompt, sessionId, cwd, model, reasoningEffort });
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
