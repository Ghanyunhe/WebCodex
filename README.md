# Codex Web Remote

A small mobile-friendly web wrapper around the Codex CLI.

## Run

```powershell
cd C:\files\projects\CodexApp\codex-web-remote
$env:CODEX_WEB_TOKEN = "change-me"
$env:CODEX_WEB_DEFAULT_CWD = "C:\files\projects\CodexApp"
npm.cmd start
```

Open `http://SERVER_IP:8787` on your phone and enter the same token.

## Environment

- `PORT`: HTTP port. Default: `8787`.
- `HOST`: bind host. Default: `0.0.0.0`.
- `CODEX_WEB_TOKEN`: browser API token. Default: `dev-token`; change it on a real server.
- `CODEX_WEB_DEFAULT_CWD`: default workspace passed to `codex exec --cd`.
- `CODEX_WEB_CODEX_BIN`: Codex executable. Default: `codex.cmd` on Windows, `codex` elsewhere.
- `CODEX_WEB_TERMINAL_URL`: optional SSH/web terminal link shown in the UI.
- `CODEX_HOME`: optional Codex home. Default: `~/.codex`.

## What It Does

- Lists Codex sessions from `~/.codex/session_index.jsonl`.
- Lists existing Codex projects from `~/.codex/state_5.sqlite` by grouping sessions by `cwd`.
- Filters sessions by project in the phone UI.
- Shows compact user/assistant messages from rollout JSONL files under `~/.codex/sessions`.
- Starts new turns with `codex exec --json`.
- Resumes old sessions with `codex exec resume --json --all`.
- Streams CLI output to the browser over Server-Sent Events.

## Phone Access Notes

For public or internet-facing use, put this behind HTTPS and an auth layer such as Caddy, Nginx, Tailscale Funnel, Cloudflare Tunnel, or your own VPN. The app token protects the API, but the server can operate Codex on your machine, so do not expose it casually.

For mobile SSH, run a separate web terminal such as `ttyd` or `wetty`, protect it with the same outer auth/VPN, then set `CODEX_WEB_TERMINAL_URL` to that URL.
