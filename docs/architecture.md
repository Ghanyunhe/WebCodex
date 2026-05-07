# Architecture

## Overview

Codex Web Remote is a thin web control plane for `codex app-server`.

The browser never talks to app-server directly. The path is:

`browser -> src/server.js -> AppServerManager -> codex app-server`

That split keeps auth, process control, and protocol adaptation on the server side.

## Runtime pieces

### Web server

`src/server.js` serves:

- static UI assets from `public/`
- auth-protected JSON APIs
- SSE chat streaming on `POST /api/chat`
- health endpoints:
  - `GET /healthz`
  - `GET /readyz`

### App-server process manager

`src/appServerManager.js` is responsible for:

- starting `codex app-server`
- sending JSON-RPC style requests over stdio
- tracking connection health
- exposing recent stderr / warning / status logs
- reconnecting when a resumed thread is in a poisoned in-progress state

Per-turn settings currently exposed in the UI:

- model
- reasoning effort
- execution mode

Execution mode maps to app-server sandbox policy:

- `read-only`
- `workspace-write`
- `danger-full-access`

Approval policy is still fixed to `never`.

## Session and history source of truth

Live turns go through app-server, but sidebar and history do not rely on app-server enumeration.

`src/sessions.js` reads the local Codex session store from `CODEX_HOME`:

1. Prefer `state_5.sqlite`
2. Fallback to Python `sqlite3` if the `sqlite3` CLI is missing
3. Fallback again to `session_index.jsonl` if SQLite is unavailable

Message history is reconstructed from rollout JSONL files under the local Codex home.

This split exists because app-server thread listing was not stable enough to recover the full historical session set in the deployment environment.

## Frontend structure

The UI is intentionally compact and mobile-friendly.

- `public/index.html`: shell structure
- `public/app.js`: state, API calls, SSE handling, rich text rendering
- `public/styles.css`: sidebar, cards, composer, picker menus

The sidebar is independent from the chat scroll area.

Each project row contains:

- project selector
- placeholder more-actions button
- new session button

Each project shows two recent sessions by default and can expand inline.

## Networking notes

For local and server-side proxying:

- app-server inherits standard proxy environment variables
  - `HTTP_PROXY`
  - `HTTPS_PROXY`
  - `ALL_PROXY`
- `scripts/local-connect-proxy.js` can expose a local CONNECT proxy when needed

## Current known constraints

- If Linux files are deployed from Windows working trees, execute bits on shell scripts may need to be restored with `chmod +x`.
- A connected app-server does not guarantee model quota; quota failures surface as turn errors in the UI.
