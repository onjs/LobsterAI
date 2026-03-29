# mem0 + Qdrant 本地 Docker 启动（LobsterAI 对接）

## 1. 启动方式（使用 mem0 官方示例）

```bash
git clone https://github.com/mem0ai/mem0.git
cd mem0/examples/docker-compose
docker compose up -d
```

说明：
- 该方式来自 mem0 OSS 文档推荐路径（`examples/docker-compose`）。
- 启动后通常可通过 `http://localhost:8888`（或 compose 中配置端口）访问 API。

## 2. 验证 API

```bash
curl -X POST http://localhost:8888/memories \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "I like concise responses."}],
    "user_id": "lobster-test"
  }'

curl -X POST http://localhost:8888/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "concise",
    "user_id": "lobster-test"
  }'
```

## 3. LobsterAI 配置建议

在 cowork 配置中设置：
- `vectorMemoryEnabled = true`
- `vectorMemoryProvider = mem0`
- `mem0BaseUrl = http://localhost:8888`
- `mem0ApiKey = <若 ADMIN_API_KEY 开启则填入>`
- `mem0UserIdStrategy = workspace`（推荐）

## 4. 当前实现边界

- LobsterAI 当前是 `sql.js` 主写；mem0 为异步同步目标。
- mem0 不可用时不会中断主流程，会回落到本地 sql.js。
