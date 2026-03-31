# yd_cowork IM Gateway 开发任务清单（统一网关架构）

日期：2026-03-31  
状态：In Progress（Phase 1 完成，Phase 2 已接入主链路）

## 0. 目标与范围

- 基于 `COWORK_AGENT_ENGINE`（或 `cowork_config.agentEngine`）动态选择 IM Gateway Provider：
  - `openclaw` -> `OpenClawGatewayProvider`（保持当前行为）
  - `yd_cowork` -> `YdCoworkGatewayProvider`（新增）
- 收敛为统一网关架构：Channel Adapter + Inbound/Outbound Bus + Session Router + Engine Adapter。
- 新增 IM 平台时，仅新增 channel adapter + schema 注册，不修改核心流程。

非目标（本阶段）：
- 不改动现有飞书/企微/微信扫码 UI。
- 不移除 OpenClaw（先兼容并存）。

## 1. 架构拆分任务（Phase 1）

当前进度（2026-03-31）：
- 已新增 `GatewayProviderRouter`（`env > cowork_config > default`）并支持 `yd_local -> yd_cowork` 别名。
- 已新增 provider 抽象层（OpenClaw provider + yd_cowork 兼容 provider）。
- 已将 `IMGatewayManager` 的 `startGateway/stopGateway/startAllEnabled` 切换到 provider 分发路径。
- 已补路由单测：`imGatewayProviderRouter.test.ts`。
- 已新增 `gateway/` 模块（`inboundBus` / `outboundBus` / `sessionRouter`）。
- 已将总线接入 `IMGatewayManager` 入站消息处理链路，并新增 run state 事件。
- 已将 `sessionRouter` 接入 `IMCoworkHandler` 会话绑定流程，路由表与 legacy mapping 双向同步。
- 已完成 `im_session_routes` CRUD，并将默认迁移阶段从 `phase2` 推进到 `phase3`。
- 已完成出站去重与重试队列接入：`im_outbound_deliveries`（按 `run_id + chunk_seq(当前=0)` 去重），失败重试后进入 dead-letter。
- 已将默认迁移阶段提升为 `phase3`，确保出站队列表可用。

### 1.1 Provider Router（引擎路由）
- 新增 `GatewayProviderRouter`：
  - 读取优先级：`process.env.COWORK_AGENT_ENGINE` > DB `agentEngine` > `yd_cowork`。
  - 返回 `IGatewayProvider` 实例。
- 为 OpenClaw 增加兼容 provider 封装层（不改原行为）。

验收：
- `agentEngine=openclaw` 下 IM 功能回归通过。
- `agentEngine=yd_cowork` 下可进入新 provider 分支，不崩溃。

### 1.2 统一接口定义
- `IChannelAdapter`：`start/stop/send/health/capabilities/auth`。
- `IEngineAdapter`：`startSession/continueSession/stopSession/streamEvents`。
- `IGatewayProvider`：`executeTurn/resumeTurn/cancelTurn/syncConfig`。

验收：
- TypeScript 接口编译通过。
- `main.ts` 不再直接按平台 if-else 调引擎执行。

### 1.3 事件模型统一
- 定义 `InboundEvent`、`OutboundEvent`、`RunStateEvent` 常量与类型（禁止裸字符串）。
- 增加事件版本号字段（`schemaVersion`）。

验收：
- 事件结构在 OpenClaw/yd_cowork 路径均一致。

## 2. 总线与路由任务（Phase 2）

### 2.1 Inbound/Outbound Bus
- `InboundBus`：标准化入站事件队列。
- `OutboundBus`：标准化回传事件队列（支持重试）。
- 处理器从 “平台驱动” 改为 “事件驱动”。

验收：
- 消息从 channel -> bus -> router -> engine -> bus -> channel 全链路打通。

### 2.2 Session Router
- 路由键：`platform + conversationId + threadId(optional) + agentId`。
- 统一会话创建与续写策略（支持 thread 级会话）。

验收：
- 同一会话多轮消息保持连续。
- thread 会话不会串到主会话。

### 2.3 幂等与去重
- 入站事件按 `(platform, event_id)` 去重。
- 出站消息按 `run_id + chunk_seq` 去重发送。

验收：
- 重复 webhook/ws 重放不会重复触发执行。

## 3. yd_cowork Provider 落地（Phase 3）

### 3.1 执行闭环
- `YdCoworkGatewayProvider` 调用 `coworkEngineRouter`（yd_cowork 分支）。
- 处理 streaming、stop、timeout、error 分类。

验收：
- IM 触发后可正常收到最终答复。
- 手动停止不显示错误（状态一致）。

### 3.2 渠道接入优先级
- 优先：`feishu`、`wecom`、`weixin`。
- 复用现有扫码配置数据，不改前端交互。

验收：
- 三个平台至少各完成 1 条消息收发链路。

## 4. 配置与可观测（Phase 4）

### 4.1 配置层
- channel schema 插件化：每个 channel 自带 `schema + uiHints + capabilities`。
- settings 页按 schema 渲染（复用现有 `SchemaForm`）。

### 4.2 观测与告警
- 统一日志字段：`platform/session_key/run_id/event_id/provider`。
- 关键指标：入站速率、执行耗时、失败率、重试次数。

验收：
- 可按 run_id 快速追踪端到端链路。

## 5. 数据库与迁移（Phase 5）

配套 DDL 见：`db/yd-cowork-im-gateway-ddl.sql`

任务：
- 新表 migration（幂等执行）。
- 旧数据兼容：
  - `im_session_mappings` 保留，逐步迁移到新路由表。
  - 不破坏现有 OpenClaw 路径。

验收：
- 新旧表共存期间功能可用。
- 回滚不会导致数据不可读。

## 6. 测试任务（Phase 6）

### 6.1 单元测试
- Provider router 选择逻辑。
- Session router 路由键与续写策略。
- 去重与重试逻辑。

### 6.2 集成测试
- `openclaw` provider 回归。
- `yd_cowork` provider 基本收发。
- 飞书/企微/微信三平台 smoke 测试。

### 6.3 人工回归
- 扫码流程（飞书/企微/微信）。
- 切换引擎后 IM 启停与收发。
- 错误态提示与恢复。

## 7. 里程碑与交付

- M1：统一接口 + Provider Router 完成。
- M2：Bus + Session Router + 幂等完成。
- M3：yd_cowork provider 首批渠道上线（feishu/wecom/weixin）。
- M4：观测补齐 + 文档 + 回归收尾。

## 8. 风险与缓解

- 风险：OpenClaw 回归风险。
  - 缓解：先“套壳兼容”不改原行为，新增路径灰度开关。
- 风险：多源事件重复触发。
  - 缓解：入站 event_id 去重 + TTL。
- 风险：长会话状态错乱。
  - 缓解：run_id 级状态机，显式 `running/idle/error/stopped`。

## 9. 完成定义（DoD）

- `COWORK_AGENT_ENGINE` 切换后 IM 均可用（至少 feishu/wecom/weixin）。
- OpenClaw 路径无行为退化。
- 新增 channel 不改核心网关代码（只加 adapter + schema + registry）。
- 关键链路有日志、可追踪、可恢复，形成流程闭环。
