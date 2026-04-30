# Quark 集成指南

## 作用域

- 本文件覆盖 `worker/quark/` 下的上游夸克网盘集成代码。
- 重点文件：`client.ts`、`adapter.ts`、`types.ts`。
- 这里处理的是外部 API 协议、路径解析、缓存与 cookie 更新，不负责 Worker 路由分发。

## 模块分工

- `client.ts`：直接请求夸克 API，负责 envelope 解析、错误转译、上传/下载/二维码登录等上游交互。
- `adapter.ts`：把 WebDAV 所需的“路径 -> 文件/目录行为”映射到 QuarkClient；负责缓存、路径解析、下载链接缓存。
- `types.ts`：共享类型与 `QuarkApiError`。

## 上游响应处理规则

- `client.ts` 对多个不同 envelope 做了显式判定，不能假设所有接口都只看 HTTP status。
- 上游很多接口需要同时检查 `response.ok`、`payload.status`、`payload.code`、`payload.message`。
- 新增 API 调用时，沿用现有错误包装方式，优先抛 `QuarkApiError`，不要抛裸字符串。

## Cookie 与会话约束

- `QuarkClient` 支持通过 `onCookiesUpdated` 向上回传 set-cookie 更新；不要删掉这条链路。
- 下载、二维码登录、账号信息读取都可能更新 cookie；改动这些请求时要保留 cookie capture。
- cookie 更新最终会影响 Worker 当前会话和持久化状态，因此这里的回调不是“可有可无”的副作用。

## 路径与缓存不变量

- `adapter.ts` 以 `/` 映射 Quark 根目录 `ROOT_FID = '0'`；不要改变这个根假设，除非整条路径语义重写。
- 目录缓存、路径缓存、下载链接缓存都有独立 TTL；改 TTL 时要明确是为一致性还是性能服务。
- `NEGATIVE_PATH_CACHE_TTL_MS` 存在是为了减少不存在路径的重复探测，不要顺手删掉。
- 路径缓存 key 带 cookie 指纹，避免不同登录态之间互串缓存；这是关键隔离措施。

## 明确受限行为

- 目录没有可下载内容。
- 不能创建根目录、不能上传到根路径、不能删除根路径、不能移动根路径。
- 不能用文件内容覆盖目录。
- 小文件上传存在 Worker MVP 限制；改上传逻辑时，先检查 `client.ts` 与 `webdav.ts` 两端限制是否一致。

## 高风险修改清单

- 改 `resolvePath()`、`listDirectoryCached()`、`invalidatePathCaches()` 时，优先防止缓存失效错误，而不是追求“更优雅”。
- 改下载链接刷新逻辑时，必须保留过期重试路径，否则 GET/HEAD 容易出现临时性 5xx/502。
- 改二维码登录相关 client 调用时，要同时检查 `api/session.ts` 的状态机分支是否仍匹配。
- 改 `QuarkApiError` 字段或构造方式时，注意上层是否依赖 `status/code`。

## 修改前检查

1. 这是上游协议变化，还是本地路径/缓存逻辑变化？
2. 需要同时修改 `client.ts` 和 `adapter.ts` 吗？
3. 会不会破坏 cookie 更新向上冒泡？
4. 会不会让不同账号共享缓存？
5. 会不会改变 root path 的禁止行为？
