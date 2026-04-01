# yd_cowork IM Gateway 开发前置清单（OpenClaw 只读边界）

日期：2026-03-31  
状态：Ready

## 进度更新（2026-03-31）

- Phase 0 provider 决策已固化：
  - `IM_GATEWAY_PROVIDER` / `LOBSTERAI_IM_GATEWAY_PROVIDER`
  - `COWORK_AGENT_ENGINE` / `LOBSTERAI_COWORK_AGENT_ENGINE`
  - cowork config `agentEngine`
  - 默认 `yd_cowork`
- `yd_local -> yd_cowork` 与 `auto`（延迟决策）均已支持并有单测覆盖。
- `yd-only/openclaw-only/full` 构建开关占位已落地（`IM_GATEWAY_BUILD_PROFILE`）。
- Phase 2 启动恢复顺序已接入：
  - 应用启动先回收未完成 run（`queued/running -> failed`）
  - 再恢复 outbound 重试队列
  - 最后从 `im_session_mappings` 修复 `im_session_routes`
- 新增 `IMStore` 单测覆盖 route 修复与 recoverable run 查询。
- 前端 schema IPC 已去 `openclaw` 耦合：新增 `im:config:schema`，旧通道保留兼容。
- `yd-only` 档位下主进程配置读写已一致化：`cowork:config:get`、`cowork:config:set`、`cowork:session:remoteManaged` 均按有效引擎判定。
- `yd-only` 档位下配对与微信扫码回调已加 OpenClaw 门禁，避免触发无效 OpenClaw 重启/配对流程。
- Renderer 侧 `cowork` 配置保存后改为回读主进程配置，避免 build profile 下前端状态与实际生效值不一致。

## 1. 边界冻结（必须先完成）

- 明确约束：不改 OpenClaw 源码，不改 OpenClaw runtime 行为，不在 OpenClaw 仓库内打补丁。
- 只在 LobsterAI 自有代码推进 IM gateway。
- 保留 OpenClaw 升级路径：升级时仅替换版本，不需要迁移业务逻辑。

验收：
- `openclaw` 目录无改动。
- 所有 IM 新逻辑均在 `src/main/im/**`、`src/main/main.ts`、`src/renderer/**`。

## 2. 配置与路由（Phase 0）

- 固化 provider 决策顺序：`IM_GATEWAY_PROVIDER` > `agentEngine` > 默认值。
- 支持 `yd_cowork | openclaw | auto`。
- `yd-only/openclaw-only/full` 三种构建开关保留占位。

验收：
- 同一配置下 provider 选择稳定可预测。
- 切换 `agentEngine` 后无需重装即可切换 IM 运行链路。

## 3. Table Schema（必须）

最小必需表（已存在/已草案）：
- `im_session_routes`
- `im_inbound_events`
- `im_gateway_runs`
- `im_outbound_deliveries`

最小必需约束与索引：
- 入站去重唯一键：`(platform, event_id)`。
- route 查找索引：`(platform, conversation_id, thread_id, agent_id)`。
- run 查询索引：`(status, started_at)`、`(route_key, started_at)`。
- outbound 重试索引：`(status, next_retry_at)`。

迁移要求：
- migration 幂等执行（可重复跑，不报错）。
- 旧表兼容读取顺序：`im_session_routes` 优先，`im_session_mappings` 兜底。
- 回滚策略明确（不丢数据，不阻塞老路径）。

## 4. yd_cowork 闭环能力（Phase 1）

- 入站总线：标准化事件 + 幂等去重。
- 会话路由：`platform + conversation + thread + agent` 唯一路由。
- 执行链路：触发 `cowork start/continue`，支持 stop/timeout/error。
- 出站总线：发送、重试、dead-letter、恢复补发。

验收：
- 不启动 OpenClaw 时，yd_cowork IM 可完整收发。
- 手动停止/超时/失败状态一致，不误报。

## 5. 恢复与可观测（Phase 2）

- 启动恢复顺序：未完成 run -> 待发送 outbound -> 路由修复。
- 日志统一字段：`provider/platform/routeKey/runId/eventId/sessionId`。
- 指标最小集：入站速率、执行耗时、发送失败率、重试次数。

验收：
- 应用重启后，任务可继续执行或正确失败并可追踪。

## 6. 前端与体验（Phase 3）

- 前端只消费统一 IPC，不感知 provider 细节。
- `yd_cowork` 下 IM 会话可编辑；`openclaw` 下可保持远程托管只读策略。
- 会话分组清晰：频道任务、定时任务、会话任务互不混淆。

验收：
- 用户侧能清晰区分三类会话入口。
- 切 provider 不出现会话混流或“不可编辑误判”。

## 7. 测试门禁（Phase 4）

- 单测：router/bus/store/provider 关键分支。
- 集成：入站 -> 执行 -> 出站全链路。
- 回归：切回 `openclaw` 时功能不退化。

验收：
- 关键测试集全绿后再进入 push。

## 8. 交付顺序建议

1. Phase 0：边界冻结 + 配置路由 + schema/migration 固化。  
2. Phase 1：yd_cowork 入站/路由/执行/出站闭环。  
3. Phase 2：恢复与重试补偿。  
4. Phase 3：前端策略与体验收敛。  
5. Phase 4：测试回归 + 打包开关验证。  

## 9. Done Definition

- `yd_cowork` IM gateway 可独立运行，不依赖 OpenClaw 进程。
- OpenClaw 逻辑未被侵入修改，升级路径不受影响。
- 两套引擎可切换，流程闭环，日志可追踪，故障可恢复。
