# 项目知识库

**生成时间**: 2026-04-30 Asia/Shanghai  
**分支**: `main`  
**提交**: `6b0ed81`

## 项目概览

- 这是一个 **React + Vite + TypeScript + Cloudflare Worker** 的单仓库项目。
- 前端负责登录与状态控制台；Worker 负责会话 API、WebDAV 路由和夸克网盘上游桥接。
- 当前 `README.md` 仍是 Vite 模板，真实项目信息以源码与本文件为准。

## 先看哪里

| 任务 | 首先查看 | 说明 |
|---|---|---|
| 启动/构建/部署 | `package.json` | 命令真源 |
| 前端入口 | `index.html`, `src/main.tsx`, `src/App.tsx` | 页面只在这里起步 |
| Worker 入口 | `wrangler.jsonc`, `worker/index.ts` | 部署入口与路由分发 |
| 会话 API | `worker/api/session.ts` | 二维码、Cookie、WebDAV 凭据 |
| WebDAV 行为 | `worker/webdav.ts` | DAV 方法、鉴权、下载/上传/移动 |
| 会话持久化 | `worker/session-store.ts` | isolate 内状态 + KV 持久化 |
| 夸克上游集成 | `worker/quark/*` | API 封装、路径解析、缓存 |

## 架构入口图

```text
index.html
  -> src/main.tsx
    -> src/App.tsx
      -> /api/session/*
      -> /dav

wrangler.jsonc
  -> worker/index.ts
    -> /api/session/* -> worker/api/session.ts
    -> /dav*          -> worker/webdav.ts
    -> other paths    -> 404 in worker code, SPA fallback via assets.not_found_handling
```

## 目录地图

```text
./
├─ src/                # React 控制台；当前主要逻辑集中在 App.tsx
├─ worker/             # Worker 运行时、路由、会话、WebDAV
│  ├─ api/             # 会话相关 API
│  └─ quark/           # 夸克上游 API/适配层/缓存逻辑
├─ public/             # 静态资源
├─ wrangler.jsonc      # Cloudflare Worker 配置
└─ worker-configuration.d.ts  # Wrangler 生成类型，不是业务源码
```

## 全局约束

- 这是 **单包仓库**，不是 monorepo；不要引入多包假设。
- 前端与 Worker 同仓，但运行边界明确：`src/` 不直接承担服务端逻辑，`worker/` 不承担 UI。
- 当前自动化验证基线只有：`lint`、`build`、`wrangler types`；仓库里 **没有** 测试脚本、CI workflow、Prettier 配置。
- 变更时优先保持最小 diff，遵循现有直写风格，不要顺手大拆分。
- `worker-configuration.d.ts` 是生成产物；除非明确做类型生成相关工作，否则不要手改。
- `README.md` 目前不可信；补文档时应先对齐源码，而不是反过来迁就模板文案。

## 项目特有约定

- 包管理器使用 `pnpm`。
- 构建不是只跑 Vite，而是先 `tsc -b` 再 `vite build`。
- TypeScript 使用 project references：`tsconfig.app.json`、`tsconfig.node.json`、`tsconfig.worker.json`。
- TS 配置统一采用 `moduleResolution: "bundler"`、`verbatimModuleSyntax: true`、`noEmit: true`。
- Worker 运行时依赖 `wrangler.jsonc` 中的 `DAV_CREDENTIALS` KV 绑定。
- Vite 配置同时启用了 `react()` 和 `cloudflare()` 插件，说明前端与 Worker 开发流是一体的。

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm build
pnpm preview
pnpm deploy
pnpm cf-typegen
```

## 验证基线

- 修改 TS/TSX/JS 后，至少运行：`pnpm lint`。
- 任何可能影响打包、类型、Worker 入口的改动后，运行：`pnpm build`。
- 修改 `wrangler.jsonc`、绑定、Worker 环境类型后，运行：`pnpm cf-typegen`。
- 由于仓库没有现成测试体系，不要在文档里假装存在 `test` 流程。

## 风险提示

- `src/App.tsx` 体量大、职责多，很多 UI/状态逻辑集中在一个文件；改动前先确认是否会牵动二维码登录、Cookie 兜底、本地缓存、WebDAV 凭据展示。
- `worker/session-store.ts`、`worker/webdav.ts`、`worker/quark/client.ts` 都是高复杂度核心文件，改动前先阅读相邻调用链。
- WebDAV 端点不是独立服务器，而是 Worker `fetch` 路由的一部分；排查问题不要去找 `listen()` 一类入口。
- 非 API/DAV 路径的 SPA 回退不是 `worker/index.ts` 自己返回页面，而是 `wrangler.jsonc` 里的 `assets.not_found_handling` 在起作用。

## 子目录文档边界

- 进入 Worker 运行时、路由、会话、WebDAV 细节时，继续看 `worker/AGENTS.md`。
- 进入夸克 API 封装、路径缓存、下载链接缓存、cookie 合并等上游桥接细节时，继续看 `worker/quark/AGENTS.md`。
- 子文档只补充本目录增量规则，不重复这里的全局信息。
