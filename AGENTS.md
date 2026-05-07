# Codex Web Remote Notes

This project is a web front end for `codex app-server`.

## What matters

- The browser talks only to `src/server.js`.
- `src/appServerManager.js` owns the app-server child process and turn streaming.
- Session history and sidebar data do not come from `thread/list` or `thread/read`.
  They come from the local Codex session store through `src/sessions.js`.
- The main UI lives in `public/index.html`, `public/app.js`, and `public/styles.css`.

## Current product shape

- Connect/disconnect starts and stops `codex app-server`.
- Sidebar groups sessions by project.
- History is loaded from local rollout files under `CODEX_HOME`.
- The composer exposes:
  - reasoning effort
  - model
  - execution mode (`read-only`, `workspace-write`, `danger-full-access`)
- Connection health and recent app-server logs are visible in the UI.

## Deployment facts

- Linux-first deployment uses the shell scripts under `scripts/`.
- The current production-like host used during development is:
  - deploy dir: `/vepfs_hyh/hyh/codex-web-remote`
  - local tunnel: `http://127.0.0.1:18787`
- The remote directory now tracks `origin/main`.

## Docs map

- `README.md`: quick start and environment overview
- `docs/architecture.md`: request flow and data sources
- `docs/operations.md`: Linux deploy, restart, tunnel, and troubleshooting

## Guardrails

- Keep app-server transport behind the web server; do not expose app-server directly to the browser.
- When changing session loading, verify both SQLite and JSONL fallback behavior.
- When editing Linux scripts on Windows, remember that execute bits may need to be restored on Linux.
