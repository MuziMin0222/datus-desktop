# Datus Desktop

Chat-first desktop client for [Datus-agent](https://github.com/Datus-ai/Datus-agent), built with Electron, React and
TypeScript.

## 中文文档

- [部署文档](docs/部署.md) — 构建、打包、发布、自动更新、远程后端部署
- [使用文档](docs/使用.md) — 首次配置、模型与数据源、对话、报表预览、权限、排障

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
npm run vendor:artifact     # optional: vendors the report/dashboard viewer bundle
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

## Updates

Packaged builds check for updates against the GitHub release feed configured in `electron-builder.yml` (5 s after
launch, and on demand from Settings → Updates). `electron-updater` downloads in the background and offers "Restart to
install". Development builds report "Development builds do not auto-update"; set `DATUS_DESKTOP_DISABLE_UPDATES=1` to
suppress checks in a packaged build.

macOS auto-update requires the app to be signed and notarized before a release is published.

## Layout

```
src/main/       Electron main process: window, security, settings, sidecar lifecycle, IPC
src/preload/    Narrow contextBridge API
src/renderer/   React chat UI (SSE client, reducer, message/tool/interaction/artifact cards)
src/shared/     Types shared by main, preload and renderer
tests/unit/     Pure unit tests for the SSE parser and chat reducer
```

## Status

- Phase 0/1: scaffold, secure window, local sidecar bootstrap, remote connection, settings — implemented.
- Phase 2: chat streaming, sessions, history, stop/steer, interactions — implemented.
- Artifacts: `datus-artifact://` viewer with the vendored `@datus/web-artifact-render` bundle (report + dashboard).
- Updates: electron-updater wired with a Settings → Updates panel.
- Tests: unit (SSE parser, reducer, proxy executor, artifact HTML) + Playwright Electron e2e shipped in CI.