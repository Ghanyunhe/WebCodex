# Codex Web Remote

A mobile-friendly web wrapper around Codex app-server.

## What it does

- Starts and stops `codex app-server` from the web UI
- Lists projects and sessions from app-server `thread/list`
- Reads session history from app-server `thread/read`
- Starts new chats and resumes existing ones through `turn/start`
- Streams assistant output back to the browser
- Shows connection health and recent app-server logs

## Local Windows run

```powershell
cd C:\files\projects\CodexApp\codex-web-remote
$env:CODEX_WEB_TOKEN = "change-me"
$env:CODEX_WEB_DEFAULT_CWD = "C:\files\projects\CodexApp"
npm.cmd start
```

Open `http://SERVER_IP:8787` and enter the same token.

## Linux-first run without systemd

This repo now supports a plain user-space deployment flow. No `systemd` is required.

### 1. Requirements

- Node.js 20+
- `codex` available on `PATH`
- a valid Codex login on that Linux host

### 2. Configure

```bash
cd /srv/codex-web-remote
cp .env.example .env
```

Edit `.env` and set at least:

```bash
CODEX_WEB_TOKEN=replace-with-a-long-secret
CODEX_WEB_DEFAULT_CWD=/srv/projects/your-default-workspace
```

If `codex` is not on `PATH`, set one of:

```bash
CODEX_WEB_CODEX_BIN=/absolute/path/to/codex
```

or

```bash
CODEX_WEB_APP_SERVER_COMMAND=/absolute/path/to/codex app-server
```

### 3. Start

```bash
chmod +x scripts/linux-*.sh
./scripts/linux-start.sh
```

### 4. Operate

```bash
./scripts/linux-status.sh
./scripts/linux-logs.sh
./scripts/linux-stop.sh
```

Runtime files are stored under `runtime/`:

- `runtime/web.pid`
- `runtime/web.out.log`
- `runtime/web.err.log`

### 5. Health checks

These endpoints are meant for deploy checks and tunnel checks:

- `GET /healthz` -> web server is alive
- `GET /readyz` -> app-server is currently connected

## Environment

- `PORT`: HTTP port. Default: `8787`
- `HOST`: bind host. Default: `0.0.0.0`
- `CODEX_WEB_TOKEN`: browser API token
- `CODEX_WEB_DEFAULT_CWD`: default workspace
- `CODEX_WEB_DEFAULT_MODEL`: default model shown in UI
- `CODEX_WEB_DEFAULT_REASONING_EFFORT`: default reasoning effort shown in UI
- `CODEX_WEB_MODEL_OPTIONS`: comma-separated models for the picker
- `CODEX_WEB_CODEX_BIN`: optional Codex binary path
- `CODEX_WEB_APP_SERVER_COMMAND`: optional full app-server launch command
- `CODEX_WEB_TERMINAL_URL`: optional SSH/web terminal link shown in the UI
- `CODEX_HOME`: optional Codex home. Default: `~/.codex`

## Phone access notes

Do not expose this directly to the public internet without an outer security layer.

Good outer layers:

- Tailscale
- Cloudflare Tunnel
- Caddy or Nginx behind HTTPS
- your own VPN

The app token protects the API, but this service can operate Codex on the host, so treat it like a sensitive admin surface.
