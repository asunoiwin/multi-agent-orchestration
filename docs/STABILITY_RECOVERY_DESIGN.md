# 多Agent系统稳定性优化 - 架构设计方案

## 概述

本文档是针对多agent系统状态恢复、阶段推进和结果回收稳定性的架构设计完成报告。包含现状分析、设计方案和待实现接口定义。

**任务追踪**:
- Task ID: task-1773587002208
- Session ID: unknown
- Role: solution-architect-1
- Stage: design

---

## 一、现状分析

### 1.1 已实现功能

| 模块 | 核心功能 | 状态 |
|------|----------|------|
| `result-recovery.js` | 会话证据提取、结构化completion解析、状态同步 | ✅ 已实现 |
| `supervisor-runner.js` | 任务重水合、agent分配、prompt构建 | ✅ 已实现 |
| `orchestration-watchdog.js` | 定期巡检、状态比对、nextAgent计算 | ✅ 已实现 |
| `cleanup-runtime.js` | 过期文件清理、任务归档 | ✅ 已实现 |
| `config/stability.json` | 稳定性参数配置 | ✅ 已实现 |

### 1.2 实际导出函数

**result-recovery.js**:
- `recoverResults(taskId)` - 恢复单个任务结果
- `recoverAll()` - 恢复所有任务
- `updateAgentStatus(label, status, result)` - 更新agent状态
- `getNextAgents()` - 获取可启动的agent
- `getLaunchableAgents()` - 获取可launch的agent
- `checkDependencies(agent, active)` - 检查依赖
- `syncActiveAgentsFromSessions()` - 同步会话状态
- `findSessionEvidence()` - 查找会话证据
- `extractStructuredCompletion(text)` - 提取结构化completion

**supervisor-runner.js**:
- `rehydrateActiveTasks()` - 重新水合活跃任务
- `allocateAgents(staffingPlan)` - 分配agent
- `buildAgentPrompt(subtask, taskContext)` - 构建prompt
- `spawnAgent(agent)` - 启动agent
- `supervisorRunOnce()` - 单次运行

### 1.3 已验证工作

```
$ node orchestration-watchdog.js
{
  "counts": {
    "activeTasks": 1,
    "completedTasks": 4,
    "nextAgents": 0
  },
  "rehydration": { "restoredCount": 0 },
  "cleanup": { "prunedAgentCount": 0, "remainingAgents": 22 }
}
```

---

## 二、设计方案

### 2.1 稳定性增强架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    稳定性模块架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │  状态恢复增强    │    │  阶段推进增强    │                  │
│  ├─────────────────┤    ├─────────────────┤                  │
│  │ enhancedRecovery│    │ deterministicAdvance            │
│  │ validateAgent   │    │ checkDependencyWithTimeout       │
│  │ persistSnapshot │    │ triggerNextStage                 │
│  └────────┬────────┘    └────────┬────────┘                  │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │  结果回收增强    │    │  健康检查与自愈  │                  │
│  ├─────────────────┤    ├─────────────────┤                  │
│  │ multiStrategy   │    │ healthCheck     │                  │
│  │ handleTruncated│    │ autoHeal        │                  │
│  │ aggregateResult│    │                 │                  │
│  │ calculateConf  │    │                 │                  │
│  └─────────────────┘    └─────────────────┘                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三层恢复机制

```
恢复优先级 (高→低):
  L1: active-agents.json (最新内存状态)
      ↓ 失败时
  L2: tasks/*.json (任务文件中的运行时状态)
      ↓ 失败时  
  L3: agents/*/sessions/*.jsonl (会话证据)
```

### 2.3 多策略解析

| 策略 | 模式 | 可靠性 |
|------|------|--------|
| JSON代码块 | ```json ...``` | 高 |
| 行内JSON | {"taskId":...} | 中 |
| 关键词提取 | status: completed | 低 |

### 2.4 健康检查类型

| 类型 | 检测条件 | 修复策略 |
|------|----------|----------|
| 僵尸agent | running但无session | 尝试恢复或标记failed |
| 依赖悬空 | 引用不存在的dep | 移除无效依赖 |
| 超时running | 运行超过阈值 | 标记failed触发下游恢复 |

---

## 三、待实现接口定义

### 3.1 状态恢复模块 (result-recovery.js 新增)

```javascript
/**
 * 增强的三层状态恢复
 * @param {Object} agent - Agent记录
 * @param {Object} config - 稳定性配置 (可选，默认读取config/stability.json)
 * @returns {Object} { source: 'L1-active'|'L2-task'|'L3-session', agent: AgentRecord }
 */
function enhancedRecovery(agent, config = null) { }

/**
 * 状态一致性校验
 * @param {Object} agent - Agent记录
 * @returns {Object} { valid: boolean, issues: string[] }
 */
function validateAgentState(agent) { }

/**
 * 快照保存 (带轮转)
 * @param {Object} agent - Agent记录
 * @param {string} reason - 变更原因
 * @param {number} retention - 保留数量 (默认5)
 */
function persistWithSnapshot(agent, reason, retention = 5) { }
```

### 3.2 阶段推进模块 (supervisor-runner.js 新增)

```javascript
/**
 * 确定性阶段推进 - 确保依赖满足后一定触发
 * @param {Object} config - 稳定性配置
 * @returns {Object} { advanced: number, triggered: string[] }
 */
function deterministicAdvance(config = null) { }

/**
 * 依赖检查 (带超时保护)
 * @param {Object} agent - Agent记录
 * @param {Array} activeAgents - 活跃agent列表
 * @param {number} timeoutMs - 超时毫秒数
 * @returns {Object} { ready: boolean, reason: string }
 */
function checkDependencyWithTimeout(agent, activeAgents, timeoutMs = 1800000) { }

/**
 * 阶段推进触发器
 * @param {string} taskId - 任务ID
 * @param {string} currentStage - 当前阶段
 */
function triggerNextStage(taskId, currentStage) { }
```

### 3.3 结果回收模块 (result-recovery.js 新增)

```javascript
/**
 * 多策略解析 - 逐个尝试直到成功
 * @param {string} text - 待解析文本
 * @returns {Object|null} 解析结果或null
 */
function multiStrategyParse(text) { }

/**
 * 截断容错 - 处理被截断的输出
 * @param {string} text - 待处理文本
 * @returns {Object|null} 恢复结果或null
 */
function handleTruncatedOutput(text) { }

/**
 * 带置信度的结果聚合
 * @param {string} taskId - 任务ID
 * @returns {Object} { taskId, status, completionRate, results[], aggregatedAt }
 */
function aggregateResults(taskId) { }

/**
 * 计算单个agent结果的置信度 (0-1)
 * @param {Object} agent - Agent记录
 * @returns {number} 置信度分数
 */
function calculateConfidence(agent) { }
```

### 3.4 健康检查模块 (orchestration-watchdog.js 新增)

```javascript
/**
 * 健康检查 - 检测异常状态
 * @param {Array} agents - Agent列表 (默认读取active-agents.json)
 * @returns {Object} { healthy: boolean, issues: Issue[], checkedAt }
 */
function healthCheck(agents = null) { }

/**
 * 自动修复策略
 * @param {Array} issues - 健康检查发现的问题
 * @returns {Array} [{ agent, action, success }]
 */
function autoHeal(issues) { }
```

### 3.5 配置文件 (config/stability.json)

当前配置已就绪:

```json
{
  "recovery": {
    "priority": ["active", "task", "session"],
    "snapshotRetention": 5,
    "fallbackEnabled": true,
    "maxRecoveryAttempts": 3
  },
  "advance": {
    "dependencyTimeoutMs": 1800000,
    "lockTimeoutMs": 5000,
    "autoAdvanceEnabled": true,
    "stageOrder": ["discovery", "design", "delivery", "assurance"]
  },
  "result": {
    "parsingStrategies": ["json-block", "inline-json", "keyword-extract"],
    "truncationRecovery": true,
    "confidenceThreshold": 0.7,
    "summaryMaxLength": 4000
  },
  "health": {
    "checkIntervalMs": 60000,
    "autoHealEnabled": true,
    "alertOnFailure": true,
    "zombieTimeoutMs": 300000,
    "maxRunningTimeMs": 3600000
  }
}
```

---

## 四、实施建议

### 4.1 实施顺序

| 阶段 | 功能 | 优先级 |
|------|------|--------|
| 1 | 状态校验 + 快照持久化 | P0 |
| 2 | 三层恢复降级 | P0 |
| 3 | 依赖超时检测 | P1 |
| 4 | 多策略解析 | P1 |
| 5 | 置信度计算 | P2 |
| 6 | 健康检查 + 自动修复 | P2 |

### 4.2 风险与约束

1. **并发安全**: 阶段推进需使用文件锁防止竞态
2. **性能**: 快照机制需控制文件数量，避免存储膨胀
3. **兼容性**: 新函数需向后兼容现有导出

### 4.3 验收标准

1. 所有新函数语法检查通过 (`node --check`)
2. 单元测试覆盖核心逻辑
3. 与现有模块集成测试通过
4. 文档更新

---

## 五、交付物

| 文件 | 状态 | 说明 |
|------|------|------|
| `config/stability.json` | ✅ 完成 | 稳定性参数配置 |
| `docs/STABILITY_OPTIMIZATION.md` | ✅ 完成 | 详细设计方案 |
| `docs/DEPENDENCY_MAP.md` | ✅ 完成 | 依赖关系与接口 |
| `result-recovery.js` | 🔄 需增强 | 新增3个恢复函数 |
| `supervisor-runner.js` | 🔄 需增强 | 新增3个推进函数 |
| `orchestration-watchdog.js` | 🔄 需增强 | 新增2个健康函数 |

---

## 六、后续工作

**handoff 给 code-implementer**:

1. 按第4.1节顺序实现新增函数
2. 确保向后兼容现有导出
3. 添加单元测试覆盖
4. 更新 README.md 中的使用示例

**handoff 给 quality-auditor**:

1. 验证新增函数的单元测试
2. 执行集成测试验证稳定性
3. 评估置信度算法的合理性

---

## 附录: 相关文件路径

- Task Root: `/Users/rico/.openclaw/workspace/multi-agent-orchestration`
- 核心模块: `result-recovery.js`, `supervisor-runner.js`, `orchestration-watchdog.js`
- 配置文件: `config/stability.json`
- 设计文档: `docs/STABILITY_OPTIMIZATION.md`, `docs/DEPENDENCY_MAP.md`
- 任务文件: `tasks/task-*.json`
- 运行状态: `runtime/active-agents.json`

---

*Generated by Solution Architect - task-1773587002208*
