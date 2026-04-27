# 修复 "Agent 绑定模型已不可用" 报错 — 验收规格

## Overview

修复 Agent 模型绑定失效后的系列问题：报错无法通过 UI 解除（死循环）、禁用 provider 后大面积 session 报错、重启不恢复。

## 设计原则

1. **报错本身合理** — 模型确实不可用时，阻止发送并提示用户是正确行为
2. **session.modelOverride 必须保持** — 每个对话的模型选定后要保持住（多 agent、IM 渠道依赖此机制）
3. **修复"不可达"问题** — 确保用户总能通过合理的 UI 操作解除报错状态
4. **不引入新的副作用** — 不能因为修复而破坏多 Agent 隔离或 session 模型独立性

---

## 终态要求

### B1 (P0): 用户在 session 中选模型时应能修正 Agent.model

**问题**: 有 sessionId 时 onChange 只 patch session，Agent.model 永远不被修正。

**修复行为**:
- 当 Agent.model 处于 invalid 状态，用户在任何 session 中选择新模型时，**除了 patch session，还应修正 Agent.model**
- 当 Agent.model 有效时，session 中切换模型仅 patch session（保持 session 级模型独立性）

**验证方法**:
1. Agent 绑定 deepseek-v4 → 禁用 deepseek → 进入对话 → 选 qwen → 确认 Agent.model 被更新为 qwen
2. Agent 绑定 qwen（有效）→ 进入对话 → 切到 kimi → 确认 Agent.model 不变（仍为 qwen），仅 session.modelOverride 变为 kimi
3. 修正后新建对话 → 不报错

### B2 (P1): provider 禁用时校验/清理受影响的 Agent.model

**问题**: Settings 中禁用 provider 后，引用该 provider 模型的 Agent.model 变成脏数据，无清理机制。

**修复行为**:
- Settings 保存触发 `setAvailableModels()` 后，检查所有 Agent 的 model 字段
- 若 Agent.model 在新的 availableModels 中不可解析，**自动清空该 Agent 的 model**（让其 fallback 到 globalSelectedModel）
- 可选：通知用户"Agent X 的模型已被重置"

**验证方法**:
1. Agent 绑定 deepseek → Settings 禁用 deepseek provider → 保存 → Agent.model 被自动清空
2. 回到对话 → 不报错，使用 global fallback 模型
3. 多 Agent: Agent A 绑定 deepseek，Agent B 绑定 qwen → 禁用 deepseek → Agent A model 被清空，Agent B 不受影响

### B3 (P2): 裸 ID 歧义优化

**问题**: 裸 ID 匹配到多个模型时判定为无效。

**修复行为**:
- 歧义时优先选择 server 模型，而非返回 null

**验证方法**:
1. 同时存在 server/kimi-k2.6 和 custom/kimi-k2.6 → 裸 ID `kimi-k2.6` → 解析到 server 模型

### B4 (P2): UI 状态优化

**问题**: invalid 时 ModelSelector 显示的是 fallback 模型名（而非失效模型名），用户困惑。

**修复行为**:
- 红字提示中包含失效的模型名称，帮助用户理解是哪个模型出了问题
- 或：ModelSelector 在 invalid 时显示一个"模型已失效"的占位状态

---

## 构建验证

| 验收项 | 命令 |
|--------|------|
| TypeScript 编译通过 | `npx tsc --noEmit` |
| 测试通过 | `npm test` |
| 现有测试更新 | `agentModelSelection.test.ts` 覆盖新行为 |
| 生产构建成功 | `npm run build` |

## 功能验证

| 验收项 | 验证方法 |
|--------|----------|
| 正常模型绑定 | Agent 绑定有效模型 → 对话正常 → 新建对话正常 |
| Provider 禁用后自动清理 | 禁用 provider → Agent.model 被清空 → 使用 fallback → 不报错 |
| Session 模型独立性 | 在 session A 切到 kimi → session B 仍用 Agent 默认模型 |
| 多 Agent 隔离 | Agent A 被清理 → Agent B 不受影响 |
| 重启一致性 | 任何操作后重启 → 无报错（脏数据已被清理） |

## 不在范围内

- 运行时 LLM 调用错误的 UI 展示改进（网络错误、auth 错误等）
- 模型列表服务端接口的可靠性
- Provider 配置 UI 的重构
- session.modelOverride 的自动清理（session 级失效模型暂保留报错行为，用户可手动切换解除）
