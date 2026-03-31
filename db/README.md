# 数据库表说明

主 DDL 文件：`db/lobsterai-ddl.sql`

IM Gateway 新架构 DDL 草案：`db/yd-cowork-im-gateway-ddl.sql`

IM Gateway 开发前置清单：`md/2026-03-31-yd-cowork-im-gateway-dev-checklist.md`

## 表清单（按模块）

- Core
  - `kv`
  - `cowork_sessions`
  - `cowork_messages`
  - `cowork_config`
- Memory
  - `user_memories`
  - `user_memory_sources`
  - `user_memory_vector_refs`
- Agent / MCP / IM
  - `agents`
  - `mcp_servers`
  - `im_config`
  - `im_session_mappings`
- Scheduled Task
  - `scheduled_tasks_yd_cowork`
  - `scheduled_task_runs_yd_cowork`
  - `scheduled_task_meta`（按需创建）

## 说明

- 该 DDL 以当前本地运行库 `~/Library/Application Support/LobsterAI/lobsterai.sqlite` 的 `.schema` 为主。
- `scheduled_task_meta` 由代码按需创建（OpenClaw cron 元数据映射），可能在未使用对应功能时不存在于实际库中。
- `yd-cowork-im-gateway-ddl.sql` 为“统一网关架构”前瞻性设计稿，建议通过迁移脚本按阶段落地，不直接全量替换现有表。

## IM Gateway Schema 最小必做项

开发 yd_cowork IM gateway 时，建议优先落地以下最小集合：

- 表
  - `im_session_routes`
  - `im_inbound_events`
  - `im_gateway_runs`
  - `im_outbound_deliveries`
- 约束与索引
  - 入站去重唯一键：`(platform, event_id)`
  - 路由查找索引：`(platform, conversation_id, thread_id, agent_id)`
  - 运行态索引：`(status, started_at)`、`(route_key, started_at)`
  - 出站重试索引：`(status, next_retry_at)`
- 迁移策略
  - migration 必须幂等
  - 读取顺序：`im_session_routes` 优先，`im_session_mappings` 兜底
  - 回滚后保证旧链路可读可用
