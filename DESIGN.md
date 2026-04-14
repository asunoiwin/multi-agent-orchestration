# Multi-Agent Orchestration - 架构与最小 Demo 设计

## 现有实现调研结果

### 核心组件

| 组件 | 路径 | 功能 |
|------|------|------|
| 动态编排器 | `dynamic-orchestrator.js` | 任务分析、复杂度评分、角色分配 |
| 任务入口 | `task-intake.js` | 创建任务记录，生成 taskId |
| 主编排器 | `orchestrator-main.js` | 协调 intake → spawn → monitor 全流程 |
| 监督分配器 | `supervisor-runner.js` | 分配 agent，构建 prompt |
| 实时执行器 | `live-executor.js` | 生成 sessions_spawn 指令 |
| 结果恢复器 | `result-recovery.js` | 收集 completion state |
| E2E 验证 | `e2e-subagent.js` | 端到端测试 |

### 关键配置

- **角色池**: `config/agent-pool.json` (9 种角色)
- **Agent 映射**: `config/agent-mapping.json` (roleId → 真实 agentId)

---

## 最小可执行 Demo 设计切分

### 验证阶段 1: 静态检查
```bash
cd /Users/rico/.openclaw/workspace/multi-agent-orchestration
node --check dynamic-orchestrator.js
node --check task-intake.js
node --check orchestrator-main.js
```
**验证点**: 语法无错误，依赖完整

### 验证阶段 2: 计划生成
```bash
npm run smoke
# 等价于:
node live-executor.js "先调研方案，然后实现 demo，最后做代码审查并输出交付说明"
```
**验证点**: 
- 输出包含 `teams`, `syncPlan`, `spawnNow`, `spawnLater`
- 生成 `runtime/execution-plan.json`

### 验证阶段 3: 端到端
```bash
npm run e2e:subagent
```
**验证点**: 真实创建 subagent，校验 taskId/workerId/status

---

## 交付说明

| 阶段 | 命令 | 输出 | 成功标志 |
|------|------|------|----------|
| 静态检查 | `node --check *.js` | 无错误 | 退出码 0 |
| 计划生成 | `npm run smoke` | JSON + execution-plan.json | 含 teams/syncPlan |
| E2E | `npm run e2e:subagent` | subagent 真实执行 | taskId 匹配 |

---

## 依赖关系图

```
task-intake.js
     ↓
dynamic-orchestrator.js (planTask)
     ↓
orchestrator-main.js (orchestrate)
     ↓
supervisor-runner.js (allocateAgents)
     ↓
live-executor.js (execute) → sessions_spawn 指令
     ↓
result-recovery.js (收集结果)
```

---

## 下一步行动

1. **code-implementer** 基于此设计实现 demo 脚本
2. **quality-auditor** 验证各阶段输出符合预期
3. **doc-synthesizer** 沉淀最终文档
