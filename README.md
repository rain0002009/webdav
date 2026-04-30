# Quark WebDAV on Cloudflare Workers

一个运行在 **Cloudflare Workers** 上的夸克网盘 WebDAV 桥接项目，前端提供登录与状态控制台，Worker 负责会话 API、WebDAV 路由和夸克上游请求转发。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rain0002009/webdav)

## 项目概览

这个仓库不是通用的 Vite 模板，而是一个单仓库项目，包含两部分：

- `src/`：React + Vite + TypeScript 控制台页面，用来查看会话状态、发起二维码登录、手动保存 Cookie、管理 WebDAV 用户名和密码。
- `worker/`：Cloudflare Worker 运行时代码，负责 `/api/session/*` 接口、`/dav` WebDAV 入口，以及夸克网盘上游桥接。

当前主要目标是：

- 把夸克登录态托管到 Worker 侧
- 为对应夸克账户生成并持久化一组 WebDAV 用户名/密码
- 通过 `/dav` 暴露给 WebDAV 客户端访问

## 功能特性

- 控制台查看当前 Worker 会话状态
- 二维码登录流程与扫码状态轮询
- 手动粘贴 Cookie 作为登录兜底
- 为当前夸克账户生成或更新 WebDAV 用户名/密码
- 通过 WebDAV Basic Auth 访问夸克文件
- WebDAV 与会话状态共享同一套账号凭据校验

## 架构与路由

Worker 入口在 `worker/index.ts`，当前路由分发如下：

- `/api/session/*` → `worker/api/session.ts`
- `/dav` 与 `/dav/*` → `worker/webdav.ts`
- 其他 `/api/*` → JSON 404
- 其他路径 → 由 Wrangler 的 SPA 资源回退处理

核心接口与行为：

- `GET /api/session/status`：读取当前状态，需要 WebDAV 用户名/密码鉴权
- `POST /api/session/qr/start`：启动二维码登录
- `GET /api/session/qr/status`：轮询二维码状态
- `POST /api/session/cookie`：手动保存 Cookie
- `POST /api/session/webdav-credentials`：更新 WebDAV 用户名和密码
- `POST /api/session/logout`：清理当前 Worker 会话
- `/dav*`：WebDAV 请求入口，使用 Basic Auth 验证

## 目录结构

```text
.
├─ src/                    # React 控制台
├─ worker/                 # Cloudflare Worker 运行时代码
│  ├─ api/                 # 会话 API
│  └─ quark/               # 夸克上游 API 与适配逻辑
├─ public/                 # 静态资源
├─ wrangler.jsonc          # Worker 配置
└─ worker-configuration.d.ts
```

建议优先阅读这些文件：

- `package.json`：脚本命令真源
- `src/App.tsx`：前端控制台主逻辑
- `worker/index.ts`：Worker 路由入口
- `worker/api/session.ts`：会话 API
- `worker/webdav.ts`：WebDAV 行为与上游桥接
- `worker/session-store.ts`：会话与 WebDAV 凭据持久化

## 技术栈

- React 19
- Vite 8
- TypeScript
- Cloudflare Workers
- Wrangler 4
- pnpm

## 本地开发

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发环境

```bash
pnpm dev
```

### 3. 常用命令

```bash
pnpm dev
pnpm lint
pnpm build
pnpm preview
pnpm deploy
pnpm cf-typegen
```

说明：

- `pnpm build` 实际执行的是 `tsc -b && vite build`
- `pnpm deploy` 会先构建，再执行 `wrangler deploy`
- `pnpm cf-typegen` 会基于当前 Wrangler 配置生成 Worker 环境类型

## 部署到 Cloudflare

### 一键部署

如果仓库保持公开，可以直接点击上面的 **Deploy to Cloudflare** 按钮。

按钮使用的是 Cloudflare Workers 官方部署入口：

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/rain0002009/webdav
```

### 手动部署

1. 安装依赖
2. 登录 Cloudflare
3. 准备 KV 命名空间
4. 更新 `wrangler.jsonc` 中的绑定配置
5. 执行部署

```bash
pnpm install
pnpm build
pnpm deploy
```

### 部署前必须确认的配置

本项目依赖 `DAV_CREDENTIALS` KV 绑定来保存：

- WebDAV 用户名/密码索引
- 账号对应的持久化 Quark 会话

当前 `wrangler.jsonc` 中已经声明了：

```jsonc
"kv_namespaces": [
  {
    "binding": "DAV_CREDENTIALS",
    "id": "2a0cefc77bf94af49fc978263edd79a1",
    "remote": true
  }
]
```

如果你要部署到自己的 Cloudflare 账号，需要把这里的 KV namespace ID 改成你自己的资源。

## 使用流程

1. 打开控制台页面
2. 先通过二维码登录，或手动粘贴夸克 Cookie
3. 登录成功后查看或修改 WebDAV 用户名/密码
4. 使用该用户名/密码连接 `https://<your-worker-domain>/dav`
5. 通过 WebDAV 客户端访问夸克文件

## 当前实现边界

这是一个可用的 Worker WebDAV 桥接层，但还不是完整的 RFC 级 WebDAV 服务器。当前需要特别注意：

- 已实现方法：`OPTIONS`、`PROPFIND`、`GET`、`HEAD`、`MKCOL`、`PUT`、`DELETE`、`MOVE`
- 显式禁用：`LOCK`、`UNLOCK`、`PROPPATCH`、`COPY`、`PATCH`
- `OPTIONS` 的 `Allow` 头当前只声明 `OPTIONS, PROPFIND, GET, HEAD`，与已实现的写方法并不完全一致
- 上传存在 MVP 限制：**大于 10 MB 会被拒绝**
- 目录 `GET` 返回的是文本 listing，不是标准目录下载流

## 常见问题

### 为什么状态接口不能直接打开？

`/api/session/status` 现在会复用 WebDAV 的用户名/密码鉴权，不再对未认证请求公开返回状态。

### 为什么 WebDAV 凭据正确，但仍然访问失败？

因为除了用户名/密码匹配之外，还要求该 WebDAV 账户绑定了可用的 Quark 持久化会话。只有凭据正确但没有可用上游会话时，仍然会返回 401。

### 为什么某些 WebDAV 客户端写操作表现异常？

当前实现仍是 MVP，方法支持和 `Allow` 头暴露并不完全一致，不同客户端可能会有兼容性差异。

## 验证基线

仓库当前可用的基础验证命令是：

- `pnpm lint`
- `pnpm build`
- `pnpm cf-typegen`

注意：仓库里 **没有现成的测试脚本或 CI workflow**，README 不应假设存在额外测试流程。
