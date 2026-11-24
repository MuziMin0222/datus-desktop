<p align="center">
  <strong>Datus Desktop · 开源数据工程 Agent 桌面客户端</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white" alt="Electron 38">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=20232A" alt="React 19">
  <img src="https://img.shields.io/badge/version-0.4.5-informational" alt="Version 0.4.5">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows%20(remote)-informational" alt="Platforms">
  <a href="https://join.slack.com/t/datus-ai/shared_invite/zt-3g6h4fsdg-iOl5uNoz6A4GOc4xKKWUYg"><img src="https://img.shields.io/badge/Slack-join%20chat-4A154B?logo=slack&logoColor=white" alt="Slack"></a>
</p>

<p align="center">
  <a href="docs/使用.md">使用文档</a> ·
  <a href="docs/部署.md">部署文档</a> ·
  <a href="https://github.com/MuziMin0222/datus-desktop/releases">发布日志</a>
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

---

基于 [Datus-agent](https://github.com/Datus-ai/Datus-agent) 的对话式桌面客户端，使用 Electron、React 与
TypeScript 构建。你可以直接在桌面窗口里问数、生成并校验 SQL、构建语义模型，以及预览 Agent 产出的报表和看板。

## 连接方式

桌面端不重复实现 Agent 引擎，而是驱动现有的 `datus-api` REST + SSE 服务：

- **本地模式**（macOS Apple Silicon、Linux x64/arm64）：首次启动由内置 `uv` 安装 Python 3.12 与固定版本的
  `datus-agent` 到应用私有环境，随后在 `127.0.0.1:<随机端口>` 拉起 `datus-api`，应用退出时一并终止。
- **远程模式**（全平台，Windows 必须使用）：连接运维部署的 `datus-api`，通过 `DATUS_API_TOKEN` 鉴权。
  `dosi-engine` 目前没有 Windows wheel，因此 Windows 不提供本地后端。

渲染进程通过 `fetch`（POST + `text/event-stream`）访问后端；主进程只为配置的后端地址注入 Bearer Token 与
`X-Datus-User-Id` 请求头。Token 通过 Electron `safeStorage` 保存在系统安全存储中。

## 功能

- **对话**：流式 Markdown、思考过程、工具调用卡片、交互确认、停止/纠偏、Token 用量。
- **子 Agent**：Chat、Gen SQL、Ask Metrics、Semantic Modeling、Visual Report、Visual Dashboard、Gen Table、Gen Job。
- **会话**：按子 Agent 查看历史、恢复、删除。
- **设置**：模型、数据源、权限档位、工作区、连接、日志。
- **产物预览**：通过 `datus-artifact://` 协议与内置的 `@datus/web-artifact-render` 预览报表和看板。
- **自动更新**：基于 `electron-updater`，设置页提供更新检查与安装入口。

## 后端要求

远程模式要求服务端 Datus-agent 包含以下能力：

- `GET /health/live`：轻量就绪探针（启动轮询用）。
- `DATUS_API_TOKEN` Bearer 鉴权：除健康检查外均需携带 Token。
- `source: "desktop"` 会话语义：bash 在严格沙箱内执行，文件系统工具始终在服务端执行、不代理给客户端。

启动示例（请置于 TLS 之后）：

```bash
export DATUS_API_TOKEN="$(openssl rand -hex 32)"
datus-api --host 0.0.0.0 --port 8000 --datasource demo
```

## 开发与构建

```bash
npm install
npm run fetch:uv            # 仅在需要验证本地首次安装时执行
npm run vendor:artifact     # 下载报表/看板预览所需的 UMD
DATUS_DESKTOP_DEV=1 npm run dev
```

开发模式默认使用同级目录 `../Datus-agent` 的 `.venv` Python（可用 `DATUS_REPO`、`DATUS_DEV_PYTHON` 覆盖），
并跳过 uv 引导。

```bash
npm run typecheck
npm run test:unit
npm run test:e2e        # 先构建，再用 Playwright 驱动真实 Electron 连接本地 mock 后端
npm run build
npm run dist:mac|dist:win|dist:linux
```

## 目录结构

```
src/main/       Electron 主进程：窗口、安全、设置、sidecar、IPC、产物、更新
src/preload/    窄化的 contextBridge API
src/renderer/   React 聊天界面（SSE 客户端、reducer、消息/工具/交互/产物卡片）
src/shared/     主进程、preload 与渲染进程共享的类型
tests/unit/     SSE 解析、聊天 reducer、代理执行器、artifact HTML 的单测
tests/e2e/      Playwright Electron 端到端测试
```

## 状态

- 本地后端引导、远程连接、安全窗口与设置：已实现
- 流式对话、会话、历史、停止/纠偏、交互确认：已实现
- 报表/看板产物预览：已实现并验证
- 自动更新与 Playwright Electron e2e：已实现

## 文档

- [使用文档](docs/使用.md)：首次配置、模型与数据源、对话、产物预览、权限与排障
- [部署文档](docs/部署.md)：构建、打包、发布、自动更新、远程后端部署

## License

[Apache 2.0](LICENSE)