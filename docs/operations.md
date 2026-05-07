# Operations

## Local Windows development

```powershell
cd C:\files\projects\CodexApp\codex-web-remote
$env:CODEX_WEB_TOKEN = "change-me"
$env:CODEX_WEB_DEFAULT_CWD = "C:\files\projects\CodexApp"
npm.cmd start
```

Open `http://127.0.0.1:8787`.

## Linux-first deployment without systemd

### Requirements

- Node.js 20+
- `codex` on `PATH`, or an explicit launcher
- a valid Codex login on the host

### Configure

```bash
cp .env.example .env
```

Set at least:

```bash
CODEX_WEB_TOKEN=replace-with-a-long-secret
CODEX_WEB_DEFAULT_CWD=/srv/projects/your-default-workspace
```

Optional launch controls:

```bash
CODEX_WEB_CODEX_BIN=/absolute/path/to/codex
CODEX_WEB_APP_SERVER_COMMAND="codex app-server"
```

### Start and stop

```bash
chmod +x scripts/linux-*.sh
./scripts/linux-start.sh
./scripts/linux-status.sh
./scripts/linux-logs.sh
./scripts/linux-stop.sh
```

Runtime files live in `runtime/`.

## Current remote development host

The project has already been exercised on:

- host: `115.190.90.101`
- SSH port: `20`
- deploy dir: `/vepfs_hyh/hyh/codex-web-remote`

The directory now tracks `origin/main`.

## Local tunnel workflow

The current development tunnel shape is:

`127.0.0.1:18787 -> ssh -L -> 127.0.0.1:8787 on the Linux host`

That lets the browser use:

- `http://127.0.0.1:18787`

without exposing the web server on a public bind address.

## Health checks

- `GET /healthz`
  - web server process is alive
- `GET /readyz`
  - app-server connection is active right now

The UI also exposes:

- connection health
- process status
- recent app-server logs

## Proxying

If the host needs an outbound proxy for Codex traffic, set standard environment variables before starting the server:

```bash
HTTP_PROXY=http://127.0.0.1:18888
HTTPS_PROXY=http://127.0.0.1:18888
ALL_PROXY=http://127.0.0.1:18888
```

For local experiments, `scripts/local-connect-proxy.js` can provide a simple CONNECT proxy.

## Troubleshooting

### The web page opens but history is incomplete

Check that `CODEX_HOME` points at the correct Codex session store.

This app expects:

- `state_5.sqlite`, or
- `session_index.jsonl` plus rollout JSONL files

### The web page opens but sending a message hangs

Check the in-app diagnostics panel first.

Past failures were caused by resumed threads containing stale `inProgress` turns. The server now reconnects app-server before resuming those threads.

### `linux-status.sh` says the service is down after a Windows-driven deploy

Restore execute bits:

```bash
chmod +x scripts/linux-start.sh scripts/linux-stop.sh scripts/linux-status.sh scripts/linux-logs.sh
```
