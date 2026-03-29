# yd_cowork 向量化与 mem0+Qdrant 改造方案（含 sql.js 兜底）

## 1. 目标

1. 在 `yd_cowork` 中支持可选的语义记忆能力（`mem0 + Qdrant`）。
2. 未启用、不可达或异常时，自动回退到现有 `sql.js` 逻辑，不中断会话流程。
3. 默认行为保持兼容：不改配置时，系统表现与当前版本一致。
4. `yd_cowork` 与 `openclaw` 必须可独立启动、独立运行，且运行时互不依赖。

## 2. 总体原则

1. `sql.js` 是主流程的稳定底座，`mem0` 是增强层，不是单点依赖。
2. 先改造“记忆层”，再扩展“会话语义检索层”，避免一次性大改导致回归。
3. 所有外部依赖（mem0/Qdrant）都必须有超时、熔断、降级策略。
4. 引擎边界严格隔离：配置、提示词、工作区文件、启动流程均按引擎命名空间管理。

## 3. 分阶段实施

## Phase 0（先行）: 引擎解耦与独立启动

1. 范围
- `yd_cowork` 不再依赖 OpenClaw 的启动、配置同步与工作区注入。
- `openclaw` 仅在显式启用时启动，不再作为 `yd_cowork` 的隐式前置依赖。

2. 关键改造
- 启动流程解耦：应用启动不再强制触发 OpenClaw 侧写入来影响 `yd_cowork` 工作区。
- 配置命名空间：拆分 `engine.yd_cowork.*` 与 `engine.openclaw.*`。
- Prompt/AGENTS 隔离：OpenClaw 的托管策略不写入 `yd_cowork` 工作目录。
- 生命周期隔离：两个引擎各自健康检查、各自错误恢复、各自日志标签。

3. 验收
- 关闭 OpenClaw 后，`yd_cowork` 能独立完成完整会话闭环。
- 关闭 `yd_cowork` 后，OpenClaw 能独立启动并执行其能力链路。
- 引擎切换时不出现跨引擎策略污染（例如 `web_search` 禁用提示误入 `yd_cowork`）。

## Phase 1（优先）: 记忆向量化增强

1. 覆盖范围
- 用户偏好/长期记忆（`user_memories`）的新增、更新、删除、检索。
- 先不改 `conversation_search` 的主检索链路。

2. 写入策略
- 先写本地 `sql.js`（成功后立即返回主流程）。
- 异步同步到 `mem0`（失败只记录日志，不影响对话）。

3. 读取策略
- 若启用了向量记忆且 `mem0` 健康：走 `mem0` 语义检索结果。
- 若未启用或 `mem0` 异常：走本地 `sql.js`（现有逻辑）。

## Phase 2（后续）: 会话语义检索增强

1. 覆盖范围
- `conversation_search` 引入语义召回（可与词法结果混排）。

2. 目标
- 在跨轮、跨会话信息回忆场景中提升召回准确度。

## 4. 配置设计（CoworkConfig 增量）

1. `vectorMemoryEnabled: boolean`
2. `vectorMemoryProvider: 'sqljs' | 'mem0'`
3. `mem0BaseUrl: string`
4. `mem0ApiKey: string`
5. `mem0OrgId?: string`
6. `mem0ProjectId?: string`
7. `mem0UserIdStrategy: 'global' | 'agent' | 'workspace'`
8. `mem0TimeoutMs: number`（建议默认 2500ms）
9. `mem0TopK: number`（建议默认 8）
10. `mem0MinScore: number`（建议默认 0.45）
11. `vectorFallbackToSqljs: boolean`（默认 `true`）

## 5. 代码结构改造建议

1. 新增 `src/main/libs/memoryProviders/MemoryProvider.ts`
- 统一接口：`search/add/update/delete/list/healthcheck`。

2. 新增 `src/main/libs/memoryProviders/SqljsMemoryProvider.ts`
- 封装现有 `CoworkStore` 的本地记忆读写能力。

3. 新增 `src/main/libs/memoryProviders/Mem0MemoryProvider.ts`
- 通过 HTTP 调用自部署 `mem0`。
- 内置请求超时、错误分类、重试上限。

4. 新增 `src/main/libs/memoryProviders/MemoryProviderRouter.ts`
- 根据配置路由到 `mem0` 或 `sqljs`。
- 负责熔断与自动回退。

5. 接入位置
- `src/main/coworkStore.ts`：配置读写扩展。
- `src/main/preload.ts`：新增配置透出字段。
- `src/renderer/types/cowork.ts`：类型补齐。
- `src/renderer/services/cowork.ts`：配置保存与加载透传。
- `src/main/libs/coworkRunner.ts`：memory 工具调用改走 `MemoryProviderRouter`。

## 6. 回退与稳定性机制

1. 超时回退
- `mem0` 请求超过 `mem0TimeoutMs`，本次直接回退 `sql.js`。

2. 熔断
- 连续失败达到阈值（如 3 次）后，进入冷却期（如 60 秒）只走 `sql.js`。
- 冷却后自动探测恢复。

3. 可观测性
- 所有回退事件打印结构化日志（`console.warn`），包含 `reason/latency/sessionId`。

## 7. 数据同步与迁移

1. 首次启用时执行 Backfill
- 将现有 `user_memories`（非 deleted）批量同步到 `mem0`。

2. 双写一致性
- 主写本地，副写远端；远端失败不阻塞主流程。

3. 删除语义
- 删除操作同步到 `mem0`（软删或删除 API，按服务能力选型）。

## 8. 验收标准

1. 默认关闭向量记忆时，行为与当前版本一致。
2. 开启后，记忆召回准确率可观测提升（对典型偏好问题 Top-K 命中提升）。
3. 关闭 mem0/Qdrant 服务时，任务仍完整闭环（自动回退 sql.js）。
4. 应用不因 mem0 故障进入不可用状态。
5. `yd_cowork` 与 `openclaw` 可分别单独启动并独立运行，不互相依赖。

## 9. 风险与应对

1. 风险：外部服务不稳定导致检索抖动。
- 应对：超时 + 熔断 + 本地兜底。

2. 风险：记忆双写时序不一致。
- 应对：以 `sql.js` 为真源，异步任务可重放。

3. 风险：配置错误导致全局不可用。
- 应对：保存配置时做连通性检查；失败时给出明确提示并保持旧配置生效。

## 10. 当前决议

1. 当前分支：`cowork`。
2. 先按 Phase 0 实施引擎解耦，再推进 Phase 1 与 Phase 2。
3. 任何阶段都必须满足“失败自动回退 sql.js”。
4. 引擎独立运行是硬约束，不作为可选项。

## 11. Phase 0 实施进展（2026-03-29）

1. 已完成：OpenClaw 同步门控
- 在 `main.ts` 增加门控：仅当 `agentEngine=openclaw` 或 OpenClaw 网关已存活时，才触发后台 `syncOpenClawConfig`。
- 已覆盖入口：`app_config` 更新、skills 变化、agent 增删改、token 刷新后同步、MCP bridge 刷新、启动阶段同步。

2. 已完成：工作区解耦
- 新增 `src/main/libs/openclawWorkspace.ts`。
- OpenClaw 的 AGENTS/MEMORY/默认 workspace 解析改为独立函数：
  - `openclaw` 引擎激活时可使用当前 cowork 工作目录。
  - 非 `openclaw` 引擎时固定使用 `~/.openclaw/workspace`，避免污染 `yd_cowork` 项目目录。

3. 已完成：配置变更路径解耦
- `cowork:config:set` 中，`MEMORY.md` 迁移与 `IDENTITY.md` 默认写入仅在目标引擎为 `openclaw` 时触发。
- 避免 `yd_cowork` 切目录时触发 OpenClaw workspace 文件写入。

4. 已完成：验证
- 新增单测：`src/main/libs/openclawWorkspace.test.ts`。
- 通过：`npm run test -- openclawWorkspace`。
- 通过：`npm run test -- openclawConfigSync`。
- 通过：`npm run compile:electron`。

## 12. Phase 1 骨架进展（2026-03-29）

1. 已完成：向量记忆配置模型落地
- 新增 `src/common/coworkMemory.ts`，统一常量、默认值、归一化与范围钳制。
- `CoworkConfig` / `CoworkConfigUpdate` 新增字段：
  - `vectorMemoryEnabled`
  - `vectorMemoryProvider`
  - `mem0BaseUrl` / `mem0ApiKey` / `mem0OrgId` / `mem0ProjectId`
  - `mem0UserIdStrategy`
  - `mem0TimeoutMs` / `mem0TopK` / `mem0MinScore`
  - `vectorFallbackToSqljs`

2. 已完成：主流程接入 Provider 路由
- 新增目录 `src/main/libs/memoryProviders/`：
  - `MemoryProvider.ts`
  - `SqljsMemoryProvider.ts`
  - `Mem0MemoryProvider.ts`
  - `MemoryProviderRouter.ts`
- `CoworkRunner` 的记忆读写入口已统一走 `MemoryProviderRouter`，默认仍走 sql.js，保证行为与旧版本一致。
- 新增增量同步映射表：`user_memory_vector_refs`（`memory_id + provider -> remote_id`）。
- 同步策略升级为“增量同步”：
  - `create/update/delete` 触发对应远端操作；
  - `applyTurnMemoryUpdates` 触发一次 reconcile（按映射纠偏），不做全量清空重建。

3. 已完成：前后端配置通道打通
- 已更新：
  - `src/main/main.ts`（`cowork:config:set` 归一化）
  - `src/main/preload.ts`（IPC 类型）
  - `src/renderer/types/cowork.ts`
  - `src/renderer/types/electron.d.ts`
  - `src/renderer/store/slices/coworkSlice.ts`（默认值）

4. 已完成：验证
- 通过：`npm run compile:electron`
- 通过：`npm run build`
- 通过：`npm run test -- MemoryProviderRouter openclawWorkspace openclawConfigSync`
- 通过：`npm run test -- Mem0MemoryProvider MemoryProviderRouter`

5. 已完成：语义查询读路径与回退策略
- `MemoryProviderRouter.listUserMemories()` 在携带 `query` 时优先尝试 mem0 语义搜索。
- 查询失败时遵循 `vectorFallbackToSqljs`：
  - 为 `true`：自动回退 sql.js；
  - 为 `false`：直接抛错，便于显式感知依赖故障。
- 增加失败熔断（连续失败阈值 + 冷却窗口），避免在 mem0 故障时持续压测外部服务。
- 对 mem0 查询结果做本地 ID 映射（`metadata.local_memory_id` + `user_memory_vector_refs`），确保工具链仍使用本地记忆 ID 闭环。

6. 当前边界
- 本轮已完成 mem0 OSS REST 适配、异步副写、增量同步、语义查询读路径与回退策略（`sql.js` 主写保持真源）。
- 仍待补齐：Qdrant 上线后的会话向量检索接入与配置化切换。

## 13. Phase 2 进展（2026-03-29）

1. 已完成：`conversation_search` 混排检索
- 保留现有词法召回（`LIKE`）路径。
- 新增语义候选召回：对最近会话消息应用 token/bigram 相似度评分。
- 词法分、语义分、时间新鲜度分做加权混排，按 session 聚合后返回 Top-N。

2. 已完成：检索边界保持兼容
- 保留 `before/after` 时间窗过滤。
- 输出结构不变（`sessionId/title/url/human/assistant`），调用方无需改动。

3. 已完成：验证
- 通过：`npm run compile:electron`
- 通过：`npm run build`
- 通过：`npm test`
