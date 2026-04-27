# 修复 "Agent 绑定模型已不可用" 报错 — 实施计划

**前置文档:** [audit.md](./audit.md)（排查报告） | [spec.md](./spec.md)（验收规格）

---

## 安全审查结论

| Step | 原方案 | 审查结论 | 调整 |
|------|--------|----------|------|
| 1 | onChange 修正 Agent.model | ✓ 可行，需加异常处理 | 小幅调整 |
| 2 | Settings 保存时遍历清理 Agent | ✗ 风险较高，需重新设计 | 改为更安全的方案 |
| 3 | 裸 ID 歧义优先 server | ✗ 不实施 | 当前行为是有意的防御性设计 |
| 4 | UI 显示失效模型名 | ✓ 无风险 | 保持 |

### Step 2 原方案的问题

1. **Settings.tsx 未导入 agentService** — 需新增导入，增加模块耦合
2. **Agent 列表可能未加载** — 用户可能未进入过 Agent 页面，`store.getState().agent.agents` 可能为空或不完整
3. **多次 dispatch 造成渲染抖动** — 每次 `updateAgent` 都会触发 Redux dispatch + re-render
4. **时序问题** — `setAvailableModels` 保留了 server 模型，但此时 `store.getState().model.availableModels` 已包含 server 模型，不会误清 server 模型引用。但如果 `loadServerModels()` 恰好在 Settings 保存前后被触发（如窗口 focus），可能出现竞态。

### Step 3 不实施的原因

- 现有测试 `agentModelSelection.test.ts:80-91` 明确验证"歧义裸 ID 应判定为 invalid"
- 这是**防御性设计决策**：宁可报错也不猜测用户意图
- `matchesOpenClawModelRef` 函数没有歧义处理，若修改 `resolveOpenClawModelRef` 行为会造成两个函数语义不一致
- 裸 ID 在正常流程中不应出现（`toOpenClawModelRef` 总是生成带 provider 前缀的引用）

---

## Step 1: 修复 B1 — Agent.model invalid 时，session 内选模型可修正 Agent (P0)

**文件:** `src/renderer/components/cowork/CoworkPromptInput.tsx`

**修改位置:** onChange handler (line 920-928)

**修改为:**
```typescript
onChange={coworkAgentEngine === 'openclaw'
  ? async (nextModel) => {
      if (!nextModel) return;
      const modelRef = toOpenClawModelRef(nextModel);
      if (sessionId) {
        await coworkService.patchSession(sessionId, { model: modelRef });
        // Agent.model 无效时同步修正，解除全局报错
        if (currentAgent && agentModelIsInvalid) {
          agentService.updateAgent(currentAgent.id, { model: modelRef });
        }
        return;
      }
      if (!currentAgent) return;
      agentService.updateAgent(currentAgent.id, { model: modelRef });
    }
  : undefined}
```

**设计要点:**
- `agentService.updateAgent` 不 await — 它本身已经是 fire-and-forget 模式（内部 catch error + console.error），不阻塞 UI
- 条件守卫 `agentModelIsInvalid` 确保 Agent.model 有效时不被 session 级操作覆盖
- `agentModelIsInvalid` 是 render 时从 Redux state 同步计算的，onChange 执行时值稳定
- IM 渠道不受影响：IM session 走同样的 patchSession 路径，只有 invalid 时才额外修正 Agent

**不影响的场景:**
- 多 Agent 隔离：`currentAgent` 是当前选中的 Agent，不影响其他 Agent
- Session 模型独立性：Agent.model 有效时，session 切换仍只改 modelOverride
- IM 渠道：与普通 session 走同一条代码路径，行为一致

**验证:**
1. `npx tsc --noEmit`
2. `npm test` — 现有测试不应受影响（测试不涉及 onChange 行为）
3. 手动验证：Agent invalid → session 内选模型 → 新建对话不报错
4. 手动验证：Agent valid → session 内选模型 → Agent.model 不变

---

## Step 2: 修复 B2 — Provider 禁用时清理 Agent.model (P1)

**重新设计**: 不在 Settings.tsx 中处理，改为在 **modelSlice reducer 中通过 listener/middleware** 或在 **App.tsx 的模型加载逻辑中** 处理。

### 方案 A（推荐）: 在 agentModelSelection 判定层做容错

**思路**: 不主动清理 Agent.model，而是在判定函数中增加"自动清空无效 agent model"的副作用。

**否决原因**: 判定函数是纯函数，不应有副作用。违反架构原则。

### 方案 B（推荐）: 在 App.tsx 启动时做一次性校验

**文件:** `src/renderer/App.tsx`

**位置:** 在 `dispatch(setAvailableModels(resolvedModels))` 之后（约 line 172-180）

**逻辑:**
```typescript
// 启动时校验所有 Agent 的 model，清理无效引用
const finalAvailableModels = store.getState().model.availableModels;
const loadedAgents = store.getState().agent.agents;
for (const agent of loadedAgents) {
  if (agent.model && !resolveOpenClawModelRef(agent.model, finalAvailableModels)) {
    agentService.updateAgent(agent.id, { model: '' });
  }
}
```

**前提**: 需确认 agents 在此时已加载。检查 App.tsx 中 agent 加载时机。

### 方案 C（最安全）: 在 Settings 保存后发事件，由 agentService 响应

**思路**: Settings 保存后通过 Redux action 或 event 通知系统"模型列表变更"，由订阅方（如 App 层 useEffect）负责清理。

**文件:** `src/renderer/App.tsx` 或新建 hook `useAgentModelCleanup`

```typescript
// 在 App.tsx 或 CoworkView.tsx 中
useEffect(() => {
  const agents = store.getState().agent.agents;
  for (const agent of agents) {
    if (agent.model && !resolveOpenClawModelRef(agent.model, availableModels)) {
      agentService.updateAgent(agent.id, { model: '' });
    }
  }
}, [availableModels]);
```

**风险**: useEffect 依赖 `availableModels` 可能导致首次加载时误触发（此时 server 模型可能还没到）。

### 方案 D（最简）: 仅依赖 Step 1 的修复

**思路**: 不做主动清理。Agent.model 无效时报错，但用户可以通过选模型解除（Step 1 已保证）。下次新建对话时也不报错（因为 Step 1 已修正了 Agent.model）。

**优点**: 零额外代码，零风险。报错是合理的，Step 1 已解除死循环。
**缺点**: 重启后首次进入仍会报错一次，需用户手动选模型。

---

### Step 2 结论

**推荐方案 D（仅依赖 Step 1）**，理由：
1. 报错本身合理（模型确实不可用）
2. Step 1 已解除死循环（用户可通过 UI 修复）
3. 无额外代码 = 无额外风险
4. 如果未来需要"静默修复"，可以单独迭代方案 B 或 C

如果一定要做主动清理，推荐**方案 B**（启动时校验），但需要先确认 App.tsx 中 agents 的加载时机。

---

## Step 3: 不实施

裸 ID 歧义判定为 invalid 是正确的防御性行为，且有测试覆盖。不修改。

---

## Step 4: UI 显示失效模型名称 (P2)

**文件:** `src/renderer/components/cowork/CoworkPromptInput.tsx`

**修改:** 在红字提示中附加失效的模型引用。

```typescript
{coworkAgentEngine === 'openclaw' && agentModelIsInvalid && (
  <span className="max-w-60 text-[11px] leading-4 text-red-500">
    {i18nService.t('agentModelInvalidHint')}
    {currentAgent?.model && (
      <span className="opacity-70"> ({currentAgent.model.split('/').pop()})</span>
    )}
  </span>
)}
```

**要点:**
- `split('/').pop()` 取模型 ID 部分（去掉 provider 前缀），用户友好
- `opacity-70` 降低视觉权重，主信息仍是报错文案
- `max-w-60` 已有，长模型名会自然换行
- 无性能/内存问题：纯渲染逻辑，无副作用

---

## 最终提交计划

| Step | commit message | 文件 |
|------|----------------|------|
| 1 | `fix(cowork): allow session model change to fix invalid agent model` | CoworkPromptInput.tsx |
| 4 | `fix(cowork): show invalid model name in error hint` | CoworkPromptInput.tsx, i18n.ts |

**总修改量**: ~10 行有效代码变更，集中在 1 个文件。

---

## 验证清单

| 项目 | 方法 |
|------|------|
| TypeScript 编译 | `npx tsc --noEmit` |
| 单元测试 | `npm test` |
| 生产构建 | `npm run build` |
| Agent.model invalid → session 选模型 → 修正 | 手动 |
| Agent.model valid → session 选模型 → 不动 Agent | 手动 |
| 新建对话不报错 | 手动 |
| IM 渠道对话不受影响 | 手动 |
| 多 Agent 切换不互相影响 | 手动 |
| Mac + Windows 构建 | CI |

## 不涉及的内容

- 无数据库 schema 变更（使用已有 API）
- 无新增文件
- 无新增依赖
- 无跨平台差异代码
- 无分辨率相关改动
- 老用户覆盖安装无兼容问题（Agent.model 清空后 fallback 到 globalSelectedModel 是已有行为）
