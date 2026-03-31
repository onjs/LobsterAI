# 数据库表说明

主 DDL 文件：`db/lobsterai-ddl.sql`

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
