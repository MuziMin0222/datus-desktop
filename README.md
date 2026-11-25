<p align="center">
  <strong>Datus Desktop · Open-Source Data Engineering Agent for the Desktop</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white" alt="Electron 38">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=20232A" alt="React 19">
  <img src="https://img.shields.io/badge/version-0.4.7-informational" alt="Version 0.4.7">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows%20(remote)-informational" alt="Platforms">
  <a href="https://join.slack.com/t/datus-ai/shared_invite/zt-3g6h4fsdg-iOl5uNoz6A4GOc4xKKWUYg"><img src="https://img.shields.io/badge/Slack-join%20chat-4A154B?logo=slack&logoColor=white" alt="Slack"></a>
</p>

<p align="center">
  <a href="docs/使用.md">Usage</a> ·
  <a href="docs/部署.md">Deployment</a> ·
  <a href="https://github.com/MuziMin0222/datus-desktop/releases">Release Notes</a>
</p>

<p align="center">
  English | <a href="README.zh.md">简体中文</a>
</p>

---

Chat-first desktop client for [Datus-agent](https://github.com/Datus-ai/Datus-agent), built with Electron, React and
TypeScript. Ask questions about your data, generate and validate SQL, build semantic models, and preview reports and
dashboards produced by the agent — with the same context engine and tools as the CLI.

## How it connects

The desktop app never re-implements the agent engine. It drives the existing `datus-api` REST + SSE service:

- **Local mode** (macOS Apple Silicon, Linux x64/arm64): a bundled `uv` installs Python 3.12 and a pinned
  `datus-agent` into an app-private virtualenv on first launch, then the app spawns `datus-api` on
  `127.0.0.1:<random port>` and terminates it on quit.
- **Remote mode** (all platforms, required on Windows): connect to a `datus-api` started by an operator, protected by
  `DATUS_API_TOKEN`. Windows has no native wheels for `dosi-engine`, so there is no local backend there.

The renderer talks to the backend with `fetch` (POST + `text/event-stream`); the main process injects the bearer token
and `X-Datus-User-Id` header for the configured backend origin only. Tokens live in the OS keychain via Electron
`safeStorage`.

## Features

- **Chat**: streaming markdown, thinking blocks, tool-call cards, interactive confirmations, stop/steer, token usage.
- **Sub-agents**: Chat, Gen SQL, Ask Metrics, Semantic Modeling, Visual Report, Visual Dashboard, Gen Table, Gen Job.
- **Sessions**: per-agent history, restore, delete.
- **Settings**: model providers, datasources, permission profiles, workspace, connection, logs.
- **Artifacts**: in-app report and dashboard preview through the `datus-artifact://` protocol and the vendored
  `@datus/web-artifact-render` bundle.
- **Updates**: `electron-updater` with a Settings → Updates panel.

## Backend requirements

The remote server must run a Datus-agent build that includes:

- `GET /health/live` — lightweight readiness probe (used for startup polling).
- `DATUS_API_TOKEN` bearer-token middleware — every request except health probes requires the token.
- `source: "desktop"` chat semantics — full server-side bash under the strict sandbox, filesystem tools never proxied.

Start it behind TLS:

```bash
export DATUS_API_TOKEN="$(openssl rand -hex 32)"
datus-api --host 0.0.0.0 --port 8000 --datasource demo
```

## Development

```bash
npm install
npm run fetch:uv            # only needed to exercise the first-run local install
npm run vendor:artifact     # vendors the report/dashboard viewer bundle
DATUS_DESKTOP_DEV=1 npm run dev
```

Dev mode expects a synced Datus-agent checkout at `../Datus-agent` (override with `DATUS_REPO`) and uses its
`.venv` Python (override with `DATUS_DEV_PYTHON`); it skips the uv bootstrap.

```bash
npm run typecheck
npm run test:unit
npm run test:e2e        # builds the app, then drives it with Playwright against a local mock backend
npm run build
npm run dist:mac|dist:win|dist:linux
```

## Layout

```
src/main/       Electron main process: window, security, settings, sidecar lifecycle, IPC, artifacts, updates
src/preload/    Narrow contextBridge API
src/renderer/   React chat UI (SSE client, reducer, message/tool/interaction/artifact cards)
src/shared/     Types shared by main, preload and renderer
tests/unit/     Unit tests for the SSE parser, chat reducer, proxy executor and artifact HTML
tests/e2e/      Playwright Electron end-to-end tests
```

## Status

- Local backend bootstrap, remote connection, secure window and settings — implemented.
- Streaming chat, sessions, history, stop/steer and interactions — implemented.
- Report/dashboard artifact viewer — implemented and verified.
- Auto-update wiring and Playwright Electron e2e — implemented.

## License

[Apache 2.0](LICENSE)