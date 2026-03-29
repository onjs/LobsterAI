# mem0 + Qdrant 本地 Docker 启动（LobsterAI 对接）

## 1. 关键结论

1. `mem0` 需要向量存储后端，但不强制只能用 `Qdrant`（也可 `pgvector` 等）。
2. 当前仓库已提供本地组合栈：`mem0 + postgres(pgvector) + neo4j + qdrant`。
3. 若要让 mem0 走 `Qdrant`，需在服务启动后执行一次 `POST /configure` 切换配置。

## 2. 启动步骤

1. 初始化本地配置文件：

```bash
npm run mem0:stack:init
```

会生成：
- `deploy/mem0-qdrant/.env`
- `deploy/mem0-qdrant/config.qdrant.json`

2. 编辑环境变量（建议）：

```bash
vi deploy/mem0-qdrant/.env
# 至少填 OPENAI_API_KEY 或 MINIMAX_API_KEY（二选一）
# 若使用 MiniMax OpenAI 兼容接口：OPENAI_BASE_URL=https://api.minimax.io/v1
```

3. 启动服务栈：

```bash
npm run mem0:stack:up
```

4. 预览并应用 qdrant 配置：

```bash
npm run mem0:configure:qdrant:dry
npm run mem0:configure:qdrant
```

5. 查看状态与健康检查：

```bash
npm run mem0:stack:ps
npm run mem0:health
```

说明：
- `mem0:configure:qdrant` 会优先读取 `deploy/mem0-qdrant/config.qdrant.json`。
- 配置 JSON 支持 `${OPENAI_API_KEY}` 这类环境变量占位符。
- 当前模板默认走 OpenAI 兼容配置（`OPENAI_API_KEY + OPENAI_BASE_URL`）。
- `MINIMAX_API_KEY / MINIMAX_API_BASE` 仅作为可选兜底别名。
- 若 mem0 API 开启了鉴权，请在 `.env` 里设置 `MEM0_API_KEY`。

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
