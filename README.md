# Codex Web Remote

A mobile-friendly web front end for `codex app-server`.

## What it does

- Starts and stops `codex app-server` from the web UI
- Groups sessions by project in a mobile-friendly sidebar
- Reads historical sessions from the local Codex session store
- Starts new chats and resumes existing ones through `turn/start`
- Streams assistant output back to the browser
- Shows connection health and recent app-server logs
- Lets the user choose:
  - reasoning effort
  - model
  - execution mode (`read-only`, `workspace-write`, `danger-full-access`)

## How it is structured

- `src/server.js`: HTTP API and SSE streaming
- `src/appServerManager.js`: app-server process lifecycle and turn protocol
- `src/sessions.js`: sidebar/history loading from the local Codex session store
- `public/`: single-page UI
- `scripts/`: Linux-first deploy and utility scripts

More detail:

- [docs/architecture.md](./docs/architecture.md)
- [docs/operations.md](./docs/operations.md)
- [AGENTS.md](./AGENTS.md)

## Quick start on Windows

```powershell
cd C:\files\projects\CodexApp\codex-web-remote
$env:CODEX_WEB_TOKEN = "change-me"
$env:CODEX_WEB_DEFAULT_CWD = "C:\files\projects\CodexApp"
npm.cmd start
```

Open `http://127.0.0.1:8787` and enter the same token.

## Linux-first run without systemd

This repo supports a plain user-space deployment flow. No `systemd` is required.

### Requirements

- Node.js 20+
- `codex` available on `PATH`, or an explicit launcher
- a valid Codex login on that Linux host

### Configure

```bash
cd /srv/codex-web-remote
cp .env.example .env
```

Edit `.env` and set at least:

```bash
CODEX_WEB_TOKEN=replace-with-a-long-secret
CODEX_WEB_DEFAULT_CWD=/srv/projects/your-default-workspace
```

### Start and operate

```bash
chmod +x scripts/linux-*.sh
./scripts/linux-start.sh
./scripts/linux-status.sh
./scripts/linux-logs.sh
./scripts/linux-stop.sh
```

Runtime files are stored under `runtime/`.

## Session source of truth

Live turns use app-server, but the sidebar and history do not depend on app-server thread listing.

The app reads the local Codex session store from `CODEX_HOME` using:

1. `state_5.sqlite`
2. Python `sqlite3` fallback if the `sqlite3` CLI is missing
3. `session_index.jsonl` fallback if SQLite is unavailable

That is what keeps old session history visible even when app-server thread enumeration is incomplete.

## Health endpoints

- `GET /healthz`: web server is alive
- `GET /readyz`: app-server is currently connected

## Environment

- `PORT`: HTTP port. Default: `8787`
- `HOST`: bind host. Default: `0.0.0.0`
- `CODEX_WEB_TOKEN`: browser API token
- `CODEX_WEB_DEFAULT_CWD`: default workspace
- `CODEX_WEB_DEFAULT_MODEL`: default model shown in UI
- `CODEX_WEB_DEFAULT_REASONING_EFFORT`: default reasoning effort shown in UI
- `CODEX_WEB_DEFAULT_EXECUTION_MODE`: default execution mode shown in UI
- `CODEX_WEB_MODEL_OPTIONS`: comma-separated models for the picker
- `CODEX_WEB_CODEX_BIN`: optional Codex binary path
- `CODEX_WEB_APP_SERVER_COMMAND`: optional full app-server launch command
- `CODEX_WEB_TERMINAL_URL`: optional SSH/web terminal link shown in the UI
- `CODEX_HOME`: optional Codex home. Default: `~/.codex`
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`: optional outbound proxy settings inherited by the app-server child

## Phone access notes

Do not expose this directly to the public internet without an outer security layer.

Recommended outer layers:

- Tailscale
- Cloudflare Tunnel
- Caddy or Nginx behind HTTPS
- your own VPN

The app token protects the API, but this service can operate Codex on the host, so treat it like a sensitive admin surface.
