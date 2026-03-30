# LobsterAI 开发计划（yd_cowork Cron 与引擎解耦）

## 1. 背景与目标

当前定时任务能力主要绑定 OpenClaw。目标是让 `yd_cowork` 与 `openclaw` 两套引擎可以**独立运行**，并为 `yd_cowork` 提供闭环的本地定时任务能力。

本计划聚焦三件事：

1. `yd_local` 命名统一替换为 `yd_cowork`。
2. 定时任务在 `yd_cowork` 下可完整运行（创建、调度、执行、历史、重试、停止）。
3. `cron` 后端选择支持跟随 `agentEngine`，并为后续“可选不打包 OpenClaw”做好解耦。

---

## 2. 范围与非范围

### 2.1 本次范围

1. `scheduledTask` 双后端路由：`openclaw` / `yd_cowork` / `auto`。
2. `yd_cowork` 本地 cron 调度与执行闭环。
3. Renderer 定时任务 UI 命名与交互统一（参考目标截图：不重复/间隔/每小时/每天/每周/每月）。
4. `cron` 工具在 `yd_cowork` 场景可用。
5. 日志、i18n、配置迁移、回滚策略完善。

### 2.2 非范围（后续）

1. IM 全量并入 `yd_cowork`（仅预留接口，不在本轮一次做完）。
2. 多引擎并行执行同一任务（本轮只做单后端执行）。
3. 云端任务协同调度。

---

## 3. 架构原则

1. **引擎独立**：`yd_cowork` 能在无 OpenClaw 运行时工作。
2. **契约稳定**：Renderer 仍走现有 `scheduledTask:*` IPC，不感知后端细节。
3. **可回退**：`scheduledTaskBackend=openclaw` 时行为与现网一致。
4. **最小侵入**：优先新增 router/backends，不大改现有业务层。

---

## 4. 配置设计

新增配置项（主进程配置层 + UI 设置页）：

- `scheduledTaskBackend`: `openclaw | yd_cowork | auto`

解析优先级：

1. 显式配置优先（`openclaw` 或 `yd_cowork`）。
2. `auto` 时跟随 `agentEngine`：
   - `agentEngine=openclaw` -> `openclaw`
   - `agentEngine=yd_cowork` -> `yd_cowork`

补充：默认值建议 `auto`，确保“引擎切换后 cron 自动跟随”。

---

## 5. 里程碑拆分

## M0：命名与配置基线（0.5 天）

### 目标

统一 `yd_local` -> `yd_cowork`，并引入 `scheduledTaskBackend`。

### 交付

1. 常量与类型改造（禁止裸字符串）。
2. 配置读写链路打通（数据库 + `window.electron` IPC）。
3. i18n 文案同步中英文。

### 验收

1. 设置页可看到 `yd_cowork`，无 `yd_local` 残留。
2. 不改业务代码时，默认行为不变。

---

## M1：双后端路由（1 天）

### 目标

建立 `ScheduledTaskBackendRouter`，将 OpenClaw 逻辑与本地逻辑隔离。

### 交付

1. `IScheduledTaskBackend` 接口定义（`list/get/create/update/delete/run/runs...`）。
2. `OpenClawTaskBackend` 适配现有 `CronJobService`。
3. `YdCoworkTaskBackend` 空实现骨架（先返回占位结果 + 错误码）。

### 验收

1. `openclaw` 模式回归通过。
2. `yd_cowork` 模式下接口不崩溃，具备明确可观测错误。

---

## M2：yd_cowork 本地调度闭环（2 天）

### 目标

`yd_cowork` 下完成“任务可执行”闭环。

### 交付

1. 本地任务表与 run 表（或兼容迁移方案）。
2. `YdScheduler`：支持一次性 / 间隔 / 每小时 / 每天 / 每周 / 每月。
3. `YdTaskExecutor`：触发后调用 `coworkRunner` 执行任务并写回 run 状态。
4. 启动恢复：应用重启后可恢复定时器与下一次执行时间。
5. 防重入锁 + 失败重试策略。

### 验收

1. 新建任务后可按时触发并产生日志与 run 记录。
2. 手动执行、停止、删除任务行为正确。
3. 应用重启后任务不丢失、下次触发时间正确。

---

## M3：UI 与交互对齐（1 天）

### 目标

定时任务 UI 与期望交互一致，并体现后端来源。

### 交付

1. 计划时间下拉：不重复/间隔/每小时/每天/每周/每月。
2. 时间输入与条件输入联动。
3. 后端展示：`openclaw` / `yd_cowork` / `auto`。
4. 列表/详情展示任务来源与执行状态。

### 验收

1. UI 交互与设计截图一致。
2. 切换引擎后在 `auto` 下后端能自动变化。
3. 无 `Translation missing` 告警。

---

## M4：工具能力接入与稳定性（1 天）

### 目标

`yd_cowork` 下支持 `cron.*` 工具并修复状态一致性问题。

### 交付

1. `cron.add/list/update/remove/run/runs` 路由到 backend router。
2. 工具执行态与会话态一致（避免上次工具状态泄漏到下轮）。
3. 关键日志升级为可诊断英文句式（遵循 AGENTS 规范）。

### 验收

1. Agent 在 `yd_cowork` 可直接创建和查询定时任务。
2. 手动中断后不再出现错误状态误报或旧工具执行条残留。

---

## M5：OpenClaw 可选打包预备（0.5~1 天）

### 目标

为后续“仅 yd_cowork 打包”准备构建开关（不强制本轮上线）。

### 交付

1. 识别并抽离 OpenClaw 强依赖点：
   - `package.json` 预构建脚本
   - `electron-builder.json` `extraResources`
   - `scripts/electron-builder-hooks.cjs`
2. 增加构建开关（例如 `LOBSTER_BUILD_WITH_OPENCLAW=0/1`）。
3. 在 `0` 模式下验证应用可启动、`yd_cowork` 功能可用。

### 验收

1. 双构建模式都可成功产物。
2. `yd_cowork-only` 模式不再依赖 OpenClaw runtime。

---

## 6. 风险与应对

1. 调度精度与时区问题。
   - 应对：统一使用本地时区 + 时间归一化，补充边界测试（整点、跨天、夏令时）。
2. 会话执行重入导致并发冲突。
   - 应对：任务级锁 + runId 追踪 + 过期清理。
3. 旧任务数据兼容。
   - 应对：提供迁移脚本与回滚脚本，保留旧表只读兜底。

---

## 7. 测试计划

1. 单测：
   - 路由选择逻辑（`scheduledTaskBackend` + `agentEngine`）。
   - schedule 计算函数（每种类型）。
   - run 状态机（running/success/error/stopped）。
2. 集成：
   - `scheduledTask:*` IPC 全链路。
   - `yd_cowork` 创建->触发->执行->记录。
3. 手工回归：
   - 切换引擎与 `auto` 跟随。
   - 中断执行后 UI 状态恢复。

---

## 8. 完成定义（DoD）

满足以下条件视为本期完成：

1. `agentEngine=yd_cowork` 时，定时任务可完整闭环运行。
2. `scheduledTaskBackend=auto` 能正确跟随引擎。
3. OpenClaw 模式零回归（现有 cron 功能保持可用）。
4. 无 i18n 缺失、无关键错误日志、构建与启动通过。

---

## 9. 建议执行顺序

1. 先做 M0 + M1（不动用户行为，先把架构立起来）。
2. 再做 M2（拿到可运行闭环）。
3. 接着做 M3 + M4（完善体验与稳定性）。
4. 最后评估 M5（是否立即做可选打包）。

