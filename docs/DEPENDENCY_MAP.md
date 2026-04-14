# 依赖关系映射

## 核心依赖链

```
用户任务
    │
    ├─→ task-intake.js
    │       │
    │       ├─→ [生成] tasks/*.json
    │       └─→ [调用] task-analyzer.cjs
    │
    ├─→ dynamic-orchestrator.js
    │       │
    │       ├─→ [读取] config/agent-pool.json
    │       ├─→ [读取] config/agent-mapping.json
    │       ├─→ [调用] task-analyzer.cjs
    │       └─→ [生成] staffingPlan, teams, syncPlan
    │
    ├─→ supervisor-runner.js
    │       │
    │       ├─→ [读取] config/agent-pool.json
    │       ├─→ [读取] config/agent-mapping.json
    │       ├─→ [读取] runtime/*-staffing.json
    │       └─→ [生成] spawn 指令
    │
    ├─→ live-executor.js
    │       │
    │       ├─→ [调用] sessions_spawn (通过 gateway)
    │       └─→ [管理] runtime/execution-*.json
    │
    ├─→ result-recovery.js
    │       │
    │       ├─→ [读取] runtime/execution-*.json
    │       ├─→ [读取] tasks/*.json
    │       └─→ [生成] 汇总结果
    │
    └─→ orchestration-watchdog.js
            │
            ├─→ [调用] supervisor-runner.rehydrateActiveTasks
            ├─→ [调用] result-recovery.syncActiveAgentsFromSessions
            ├─→ [调用] cleanup-runtime.cleanupRuntime
            └─→ [生成] 监控报告 + 可启动agent列表
```

## 稳定性增强依赖链

```
┌─────────────────────────────────────────────────────────────────┐
│                    稳定性模块 (新增)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  config/stability.json  ──→  稳定性参数配置                    │
│         │                                                       │
│         ├─→ result-recovery.js                                 │
│         │       ├─→ enhancedRecovery() 三层恢复                │
│         │       ├─→ validateAgentState() 状态校验              │
│         │       ├─→ multiStrategyParse() 多策略解析            │
│         │       └─→ aggregateResults() 带置信度聚合            │
│         │                                                       │
│         ├─→ supervisor-runner.js                                │
│         │       ├─→ deterministicAdvance() 确定性推进          │
│         │       ├─→ checkDependencyWithTimeout() 超时检测       │
│         │       └─→ triggerNextStage() 阶段触发               │
│         │                                                       │
│         └─→ orchestration-watchdog.js                          │
│                 ├─→ healthCheck() 健康检查                     │
│                 └─→ autoHeal() 自动修复                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 模块间接口

### task-intake.js → dynamic-orchestrator.js

**输入**: 任务描述字符串
**输出**: 任务JSON文件路径
**接口**:
```javascript
// task-intake.js
function createTask(taskDescription) {
  return taskFilePath; // "tasks/task-xxx.json"
}
```

### dynamic-orchestrator.js → supervisor-runner.js

**输入**: staffingPlan + teams + syncPlan
**输出**: 员工分配计划
**接口**:
```javascript
// dynamic-orchestrator.js
function generateStaffingPlan(taskFile) {
  return {
    staffingPlan: { ... },
    teams: [ ... ],
    syncPlan: [ ... ],
    spawnNow: [ ... ],
    spawnLater: [ ... ]
  };
}
```

### supervisor-runner.js → live-executor.js

**输入**: 员工分配 + spawn指令
**输出**: 执行结果
**接口**:
```javascript
// supervisor-runner.js
function assignWorkers(staffingPlan) {
  return {
    assignments: [ ... ],
    spawnInstructions: [ ... ]
  };
}
```

### result-recovery.js → supervisor-runner.js (稳定性)

**输入**: agent状态查询
**输出**: 恢复结果
**接口**:
```javascript
// result-recovery.js
function enhancedRecovery(agent) {
  return {
    source: 'L1-active' | 'L2-task' | 'L3-session',
    agent: AgentRecord
  };
}

function validateAgentState(agent) {
  return {
    valid: boolean,
    issues: string[]
  };
}
```

### orchestration-watchdog.js → 各模块 (编排)

**输入**: 定期触发
**输出**: 健康报告 + 修复动作
**接口**:
```javascript
// orchestration-watchdog.js
function runWatchdog() {
  return {
    rehydration: { ... },
    cleanup: { ... },
    syncChanged: number,
    nextAgents: AgentRecord[],
    shouldNotify: boolean
  };
}
```

## 外部依赖

### OpenClaw Gateway

| 接口 | 用途 |
|------|------|
| `sessions_spawn` | 创建子agent |
| `sessions_list` | 列出活跃会话 |
| `sessions_history` | 获取历史消息 |
| `sessions_send` | 发送消息 |

### 文件系统

| 文件 | 读写 |
|------|------|
| `config/*.json` | 读取 |
| `tasks/*.json` | 读写 |
| `runtime/*.json` | 读写 |
| `runtime/snapshots/*.json` | 读写 (新增) |

---

## 跨团队接口

### Design Planning Team

- **输入**: 原始任务描述
- **输出**: 架构设计文档
- **依赖**: web-researcher 的调研结果
- **传递给**: code-implementer
- **稳定性接口**: 需要稳定的状态恢复机制确保设计文档不丢失

### Discovery Team

- **输入**: 任务分析需求
- **输出**: 调研报告/选项对比
- **传递给**: solution-architect

### Delivery Team

- **输入**: 架构设计 + 实现需求
- **输出**: 可运行的代码/配置
- **依赖**: 架构设计
- **由**: quality-auditor 审查

### Assurance Team

- **输入**: 代码实现
- **输出**: 审查报告/风险评估
- **依赖**: delivery 完成

---

## 稳定性增强总结

### 1. 状态恢复增强

- **三层恢复**: L1(active-agents) → L2(tasks) → L3(sessions)
- **快照机制**: 每次状态变更保留最近5个快照
- **状态校验**: 必需字段、状态有效性、依赖有效性

### 2. 阶段推进增强

- **确定性推进**: 依赖满足后一定触发
- **超时保护**: 30分钟超时自动标记失败
- **文件锁**: 防止并发写入竞态

### 3. 结果回收增强

- **多策略解析**: json-block → inline-json → keyword-extract
- **截断容错**: 自动补全不完整的JSON
- **置信度计算**: 0-1分数评估结果可靠性

### 4. 健康检查与自愈

- **僵尸检测**: running但无session的agent
- **依赖悬空**: 引用不存在的依赖
- **超时检测**: 运行超时的agent
- **自动修复**: 标记失败、移除无效依赖、触发恢复

---

## Task Metadata

- Task ID: task-1773587002208
- Session ID: unknown
- Role: solution-architect-1
- Stage: design
- Updated: 2026-03-16
