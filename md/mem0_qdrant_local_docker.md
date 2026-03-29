# mem0 + Qdrant 本地 Docker 启动（LobsterAI 对接）

## 1. 关键结论

1. `mem0` 需要向量存储后端，但不强制只能用 `Qdrant`（也可 `pgvector` 等）。
2. 当前仓库已提供本地组合栈：`mem0 + postgres(pgvector) + neo4j + qdrant`。
3. 若要让 mem0 走 `Qdrant`，需在服务启动后执行一次 `POST /configure` 切换配置。

## 2. 启动步骤

1. 准备环境变量（建议）：

```bash
export OPENAI_API_KEY=你的key
# 可选：export ADMIN_API_KEY=你的mem0管理key
```

2. 启动服务栈：

```bash
npm run mem0:stack:up
```

3. 健康检查：

```bash
npm run mem0:health
```

4. 将 mem0 切换到 qdrant 向量后端：

```bash
QDRANT_HOST=qdrant npm run mem0:configure:qdrant
```

说明：
- `QDRANT_HOST=qdrant` 使用容器网络服务名（当 mem0 与 qdrant 在同一 compose 网络）。
- 若 mem0 API 开启了鉴权，请额外传入 `MEM0_API_KEY=...`。

## 3. LobsterAI 配置建议

在 cowork 配置中设置：
- `vectorMemoryEnabled = true`
- `vectorMemoryProvider = mem0`
- `mem0BaseUrl = http://localhost:8888`
- `mem0ApiKey = <若 mem0 设置 ADMIN_API_KEY，则填入同值>`
- `mem0UserIdStrategy = workspace`（推荐）

## 4. 关闭服务

```bash
npm run mem0:stack:down
```

## 5. 当前实现边界

- LobsterAI 当前为 `sql.js` 主写、mem0 异步副写。
- mem0 不可用时主流程不阻塞，可回落到 `sql.js`（受 `vectorFallbackToSqljs` 控制）。
