# Worker 目录指南

## 作用域

- 本文件覆盖 `worker/` 下的 Worker 运行时代码。
- 重点文件：`index.ts`、`api/session.ts`、`webdav.ts`、`session-store.ts`、`http.ts`。
- 上游夸克 API 封装细节移步 `worker/quark/AGENTS.md`。

## 入口与分发

- Worker 入口：`worker/index.ts`。
- 路由分发规则固定如下：
  - `/api/session/*` -> `handleSessionApiRequest`
  - `/dav` 与 `/dav/*` -> `handleWebDavRequest`
  - 其他 `/api/*` -> JSON 404
  - 其他路径交给静态资源 / SPA 回退
- 新增 API 时，先判断是否应放进现有 `/api/session/*` 语义下；不要无序扩散新前缀。

## 会话与状态不变量

- `session-store.ts` 维护当前 isolate 内状态，同时负责从 KV 恢复持久化会话。
- `endpoint` 逻辑统一由 `createDavEndpoint(origin)` 一侧推导，避免前后端各自拼接不同 `/dav` 地址。
- `cookie`、`accountKey`、`webdavCredentials` 三者存在绑定关系；调整任一字段时必须检查其余两个是否仍一致。
- `mergeUpstreamCookies()` 只合并白名单 cookie key；不要随意放宽，否则可能污染当前会话。
- `clearSession()` 不只是退出标记，还会清空 WebDAV 凭据和二维码请求状态。

## API 约定

- `api/session.ts` 统一返回 JSON envelope，成功/失败都经由 `http.ts` 的辅助函数输出。
- 输入校验失败时返回明确 4xx，不吞错误。
- 当前 API 职责包含：状态读取、二维码登录开始/轮询、手动 Cookie 保存、WebDAV 用户名密码更新、登出。
- 新增接口时优先复用现有 envelope 风格，不要混入另一套响应格式。

## WebDAV 行为边界

- `webdav.ts` 当前不是完整 DAV 服务器，而是带明显边界的 Worker 桥接层。
- 当前实现明确处理：`OPTIONS`、`PROPFIND`、`GET`、`HEAD`、`MKCOL`、`PUT`、`DELETE`、`MOVE`。
- `LOCK`、`UNLOCK`、`PROPPATCH`、`COPY`、`PATCH` 是当前实现里显式禁用的方法；这里不要简单概括成“完全只读”。
- 注意：`OPTIONS` 的 `Allow` 头目前只声明 `OPTIONS, PROPFIND, GET, HEAD`；这与已实现的写方法并不完全一致，排查客户端兼容问题时要先看这里。
- 上传有 MVP 限制：大于 `10 MB` 会直接拒绝。
- 目录 GET 返回的是可读文本 listing，不是标准目录下载流；改这里前要确认客户端兼容性预期。

## 高风险修改点

- 改 `webdav.ts` 鉴权流程时，同时检查 Basic Auth、KV 查凭据、持久化 Quark session 三段链路。
- 改 `session-store.ts` 持久化键或 accountKey 算法时，必须检查历史 KV 数据兼容性。
- 改 `http.ts` envelope 结构时，要同步检查 `src/App.tsx` 的 `fetchJson()` 兼容性。
- 改 `/api/session/status` 或 WebDAV endpoint 输出时，前端状态页显示会立刻受影响。

## 排查顺序

1. 先看 `worker/index.ts` 路由是否命中。
2. 再看 `api/session.ts` 或 `webdav.ts` 的具体分支。
3. 涉及登录态/凭据时看 `session-store.ts`。
4. 涉及夸克上游失败时再进入 `worker/quark/*`。

## 禁止事项

- 不要手动改 `worker-configuration.d.ts` 来“修”类型。
- 不要在 `webdav.ts` 里绕过 `session-store.ts` 自行维护另一份会话状态。
- 不要新增与现有 JSON envelope 不兼容的 API 返回格式。
