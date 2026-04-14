# 多Agent系统稳定性优化设计方案

## 概述

本文档针对多agent系统的三个核心稳定性问题提供解决方案：
1. **状态恢复** - 进程崩溃/重启后的状态重建
2. **阶段推进** - 任务阶段流转和依赖触发
3. **结果回收** - 结构化输出的可靠提取与聚合

---

## 一、现状分析

### 1.1 现有机制

| 模块 | 核心功能 | 存在问题 |
|------|----------|----------|
| `result-recovery.js` | 从session文件恢复状态 | 依赖session文件存在 |
| `supervisor-runner.js` | 任务重水合、agent分配 | 恢复逻辑分散 |
| `orchestration-watchdog.js` | 定期检查+状态比对 | 被动触发 |
| `cleanup-runtime.js` | 清理过期文件 | 无恢复联动 |

### 1.2 风险点

1. **Session丢失**: 如果subagent session被意外终止，状态可能停留在 running
2. **依赖死锁**: dependsOn 的agent 状态不一致导致永远无法推进
3. **结果截断**: 结构化输出被截断导致无法解析
4. **竞态条件**: 并行agent同时完成时的状态更新冲突

---

## 二、优化方案

### 2.1 状态恢复增强

#### 2.1.1 三层恢复机制

```
┌─────────────────────────────────────────────────────────────┐
│                    恢复优先级 (高→低)                       │
├─────────────────────────────────────────────────────────────┤
│  L1: 内存状态          → active-agents.json (最新)        │
│  L2: 任务文件          → tasks/*.json (运行时状态)          │
│  L3: 会话证据          → agents/*/sessions/*.jsonl         │
└─────────────────────────────────────────────────────────────┘
```

#### 2.1.2 恢复增强函数

```javascript
// result-recovery.js 新增

/**
 * 增强的状态恢复 - 优先使用 L1，失败则降级到 L2/L3
 */
function enhancedRecovery(agent) {
  // L1: 检查 active-agents.json
  const active = readJson(ACTIVE_FILE, []);
  const current = active.find(a => a.label === agent.label);
  if (current && current.status !== 'running') {
    return { source: 'L1-active', agent: current };
  }
  
  // L2: 检查任务文件
  const taskFile = path.join(TASKS_DIR, `${agent.taskId}.json`);
  const task = readJson(taskFile);
  if (task?.summary?.agents) {
    const taskAgent = task.summary.agents.find(a => a.workerId === agent.workerId);
    if (taskAgent?.status) {
      return { source: 'L2-task', agent: taskAgent };
    }
  }
  
  // L3: 会话证据
  return recoverFromSession(agent);
}

/**
 * 状态一致性校验
 */
function validateAgentState(agent) {
  const issues = [];
  
  // 检查必需字段
  if (!agent.taskId) issues.push('missing-taskId');
  if (!agent.workerId) issues.push('missing-workerId');
  if (!agent.status) issues.push('missing-status');
  
  // 检查状态有效性
  const validStatuses = ['spawning', 'waiting', 'running', 'completed', 'failed'];
  if (!validStatuses.includes(agent.status)) {
    issues.push(`invalid-status:${agent.status}`);
  }
  
  // 检查依赖有效性
  if (agent.dependsOn) {
    const active = readJson(ACTIVE_FILE, []);
    for (const depId of agent.dependsOn) {
      const dep = active.find(a => a.workerId === depId);
      if (!dep) issues.push(`missing-dependency:${depId}`);
    }
  }
  
  return { valid: issues.length === 0, issues };
}
```

#### 2.1.3 状态持久化增强

```javascript
// 每次状态变更时创建快照
function persistWithSnapshot(agent, reason) {
  const SNAPSHOT_DIR = path.join(RUNTIME_DIR, 'snapshots');
  const snapshotFile = path.join(SNAPSHOT_DIR, `${agent.label}.json`);
  
  const snapshot = {
    agent: JSON.parse(JSON.stringify(agent)),
    reason,
    timestamp: new Date().toISOString(),
    source: 'persistWithSnapshot'
  };
  
  // 保留最近5个快照
  ensureRotation(snapshotFile, 5);
  writeJson(snapshotFile, snapshot);
  
  // 更新主状态
  updateAgentStatus(agent.label, agent.status, agent.result);
}
```

### 2.2 阶段推进优化

#### 2.2.1 确定性推进机制

```javascript
// supervisor-runner.js 增强

/**
 * 确定性阶段推进 - 确保依赖满足后一定触发
 */
function deterministicAdvance() {
  const active = readJson(ACTIVE_FILE, []);
  const tasks = loadTasks();
  
  for (const task of tasks) {
    const taskAgents = active.filter(a => a.taskId === task.id);
    
    // 按 stage 分组
    const byStage = groupBy(taskAgents, 'stage');
    
    // 检查每个阶段的完成条件
    for (const [stage, agents] of Object.entries(byStage)) {
      const completed = agents.filter(a => a.status === 'completed');
      const allDone = completed.length === agents.length;
      
      if (allDone && stage !== 'assurance') {
        // 进入下一阶段
        triggerNextStage(task.id, stage);
      }
    }
  }
}

/**
 * 依赖满足检查 - 带超时保护
 */
function checkDependencyWithTimeout(agent, activeAgents) {
  const timeout = 30 * 60 * 1000; // 30分钟超时
  const now = Date.now();
  
  for (const depId of agent.dependsOn || []) {
    const dep = activeAgents.find(a => a.workerId === depId);
    
    if (!dep) {
      return { ready: false, reason: `dependency-missing:${depId}` };
    }
    
    if (dep.status === 'failed') {
      return { ready: false, reason: `dependency-failed:${depId}` };
    }
    
    if (dep.status === 'running') {
      // 检查是否运行超时
      const updatedAt = new Date(dep.updatedAt).getTime();
      if (now - updatedAt > timeout) {
        // 标记为失败，触发恢复
        dep.status = 'failed';
        dep.result = { error: 'dependency-timeout', timeoutMs: timeout };
        return { ready: false, reason: `dependency-timeout:${depId}` };
      }
    }
    
    if (dep.status !== 'completed') {
      return { ready: false, reason: `dependency-pending:${depId}` };
    }
  }
  
  return { ready: true, reason: 'all-dependencies-met' };
}

/**
 * 阶段推进触发器
 */
function triggerNextStage(taskId, currentStage) {
  const stageOrder = ['discovery', 'design', 'delivery', 'assurance'];
  const nextStage = stageOrder[stageOrder.indexOf(currentStage) + 1];
  
  if (!nextStage) return;
  
  const active = readJson(ACTIVE_FILE, []);
  const taskAgents = active.filter(a => a.taskId === taskId);
  
  // 查找下一阶段的agent并标记为可启动
  const nextAgents = taskAgents.filter(a => a.stage === nextStage);
  for (const agent of nextAgents) {
    if (agent.status === 'waiting') {
      agent.status = 'spawning';
      agent.advanceReason = {
        from: currentStage,
        to: nextStage,
        triggeredAt: new Date().toISOString()
      };
    }
  }
  
  writeJson(ACTIVE_FILE, active);
  logStageTransition(taskId, currentStage, nextStage);
}
```

#### 2.2.2 防竞态机制

```javascript
// 使用文件锁防止并发写入
const LOCK_FILE = path.join(RUNTIME_DIR, '.advance-lock');

async function acquireLock() {
  let attempts = 0;
  while (attempts < 10) {
    if (!fs.existsSync(LOCK_FILE)) {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now()
      }));
      return true;
    }
    await sleep(100);
    attempts++;
  }
  return false;
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

// 在关键操作时使用锁
async function safeAdvance() {
  if (!await acquireLock()) {
    return { error: 'lock-timeout' };
  }
  try {
    return await deterministicAdvance();
  } finally {
    releaseLock();
  }
}
```

### 2.3 结果回收增强

#### 2.3.1 多策略解析

```javascript
// result-recovery.js 增强

const COMPLETION_STRATEGIES = [
  // 策略1: JSON代码块 (最可靠)
  {
    name: 'json-block',
    pattern: /```json\s*([\s\S]*?)```/gi,
    parser: (raw) => {
      const parsed = JSON.parse(raw);
      if (parsed?.taskId && parsed?.workerId) return parsed;
      return null;
    }
  },
  // 策略2: 行内JSON
  {
    name: 'inline-json',
    pattern: /\{[^{}]*"taskId"[^{}]*"workerId"[^{}]*\}/g,
    parser: (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  },
  // 策略3: 关键词提取 + 模板匹配
  {
    name: 'keyword-extract',
    pattern: /(?:status|状态)[:\s]*(completed|blocked|failed|完成|阻塞|失败)/gi,
    parser: (raw, text) => {
      const statusMatch = text.match(/(?:status|状态)[:\s]*(completed|blocked|failed)/i);
      return {
        status: statusMatch?.[1]?.toLowerCase() || 'unknown',
        recoveredBy: 'keyword-extract'
      };
    }
  }
];

/**
 * 多策略解析 - 逐个尝试，直到成功
 */
function multiStrategyParse(text) {
  for (const strategy of COMPLETION_STRATEGIES) {
    const matches = [...text.matchAll(strategy.pattern)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const raw = matches[i][1] || matches[i][0];
      const result = strategy.parser(raw, text);
      if (result) {
        return {
          ...result,
          _strategy: strategy.name
        };
      }
    }
  }
  return null;
}

/**
 * 截断容错 - 处理被截断的输出
 */
function handleTruncatedOutput(text) {
  // 尝试补全不完整的JSON
  const truncated = text.match(/```json\s*([\s\S]*)/);
  if (truncated) {
    let raw = truncated[1];
    // 补全缺失的括号
    const openCount = (raw.match(/\{/g) || []).length;
    const closeCount = (raw.match(/\}/g) || []).length;
    if (openCount > closeCount) {
      raw += '}'.repeat(openCount - closeCount);
    }
    try {
      return JSON.parse(raw);
    } catch {
      // 仍然失败，尝试提取部分字段
      return extractPartialFields(raw);
    }
  }
  return null;
}
```

#### 2.3.2 结果聚合增强

```javascript
/**
 * 增强的结果聚合 - 包含置信度
 */
function aggregateResults(taskId) {
  const task = loadTask(taskId);
  const active = readJson(ACTIVE_FILE, []);
  const taskAgents = active.filter(a => a.taskId === taskId);
  
  const results = taskAgents.map(agent => {
    const result = agent.result || {};
    return {
      workerId: agent.workerId,
      roleId: agent.roleId,
      status: agent.status,
      result,
      confidence: calculateConfidence(agent),
      recoveredAt: result?.recoveredAt || null
    };
  });
  
  // 计算整体完成度
  const completedCount = results.filter(r => r.status === 'completed').length;
  const totalCount = results.length;
  const completionRate = totalCount > 0 ? completedCount / totalCount : 0;
  
  // 判断任务状态
  let overallStatus = 'unknown';
  if (completionRate === 1) {
    overallStatus = 'completed';
  } else if (results.some(r => r.status === 'failed')) {
    overallStatus = 'failed';
  } else if (completionRate > 0) {
    overallStatus = 'in_progress';
  }
  
  return {
    taskId,
    status: overallStatus,
    completionRate,
    completedCount,
    totalCount,
    results,
    aggregatedAt: new Date().toISOString()
  };
}

/**
 * 计算单个agent结果的置信度
 */
function calculateConfidence(agent) {
  let score = 0;
  const result = agent.result || {};
  
  // 有结构化completion +0.4
  if (result?.structuredCompletion?.taskId) score += 0.4;
  
  // 有summary +0.3
  if (result?.summary?.length > 10) score += 0.3;
  
  // stopReason 正常 +0.2
  if (result?.stopReason === 'stop') score += 0.2;
  
  // 状态明确 +0.1
  if (['completed', 'failed'].includes(agent.status)) score += 0.1;
  
  return Math.min(score, 1.0);
}
```

### 2.4 故障检测与自愈

```javascript
// orchestration-watchdog.js 增强

/**
 * 健康检查 - 检测异常状态
 */
function healthCheck() {
  const active = readJson(ACTIVE_FILE, []);
  const issues = [];
  
  for (const agent of active) {
    // 检查1: 僵尸agent (running但无session)
    if (agent.status === 'running' && !agent.sessionId) {
      issues.push({
        type: 'zombie',
        agent: agent.label,
        suggestion: 'force-complete-or-restart'
      });
    }
    
    // 检查2: 依赖悬空
    for (const depId of agent.dependsOn || []) {
      const dep = active.find(a => a.workerId === depId);
      if (!dep) {
        issues.push({
          type: 'dangling-dependency',
          agent: agent.label,
          missingDep: depId
        });
      }
    }
    
    // 检查3: 超时running
    const timeout = (agent.runTimeoutSeconds || 600) * 1000;
    const updatedAt = new Date(agent.updatedAt || agent.createdAt).getTime();
    if (agent.status === 'running' && Date.now() - updatedAt > timeout) {
      issues.push({
        type: 'timeout',
        agent: agent.label,
        suggestion: 'mark-failed-trigger-recovery'
      });
    }
  }
  
  return {
    healthy: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString()
  };
}

/**
 * 自动修复策略
 */
function autoHeal(issues) {
  const active = readJson(ACTIVE_FILE, []);
  const fixes = [];
  
  for (const issue of issues) {
    switch (issue.type) {
      case 'zombie':
        // 尝试从session恢复
        const recovered = attemptSessionRecovery(issue.agent);
        if (recovered) {
          fixes.push({ agent: issue.agent, action: 'recovered' });
        } else {
          // 标记为failed
          const agent = active.find(a => a.label === issue.agent);
          if (agent) {
            agent.status = 'failed';
            agent.result = { error: 'zombie-no-session' };
            fixes.push({ agent: issue.agent, action: 'marked-failed' });
          }
        }
        break;
        
      case 'dangling-dependency':
        // 移除无效依赖
        const affectedAgent = active.find(a => a.label === issue.agent);
        if (affectedAgent) {
          affectedAgent.dependsOn = affectedAgent.dependsOn.filter(
            d => d !== issue.missingDep
          );
          fixes.push({ agent: issue.agent, action: 'removed-invalid-dep' });
        }
        break;
        
      case 'timeout':
        // 标记失败，触发下游恢复
        const timeoutAgent = active.find(a => a.label === issue.agent);
        if (timeoutAgent) {
          timeoutAgent.status = 'failed';
          timeoutAgent.result = { error: 'execution-timeout' };
          fixes.push({ agent: issue.agent, action: 'marked-timeout' });
        }
        break;
    }
  }
  
  if (fixes.length > 0) {
    writeJson(ACTIVE_FILE, active);
  }
  
  return fixes;
}
```

---

## 三、接口设计

### 3.1 核心API

```typescript
// 状态恢复
interface RecoveryModule {
  // 增强恢复
  enhancedRecovery(agent: AgentRecord): RecoveryResult;
  
  // 状态校验
  validateAgentState(agent: AgentRecord): ValidationResult;
  
  // 快照保存
  persistWithSnapshot(agent: AgentRecord, reason: string): void;
}

// 阶段推进
interface StageModule {
  // 确定性推进
  deterministicAdvance(): AdvanceResult;
  
  // 依赖检查(带超时)
  checkDependencyWithTimeout(agent: AgentRecord): DependencyCheck;
  
  // 阶段触发
  triggerNextStage(taskId: string, currentStage: string): void;
}

// 结果回收
interface ResultModule {
  // 多策略解析
  multiStrategyParse(text: string): ParsedCompletion | null;
  
  // 截断容错
  handleTruncatedOutput(text: string): any;
  
  // 结果聚合(带置信度)
  aggregateResults(taskId: string): AggregationResult;
}

// 健康检查
interface HealthModule {
  // 健康检查
  healthCheck(): HealthReport;
  
  // 自动修复
  autoHeal(issues: Issue[]): Fix[];
}
```

### 3.2 配置文件扩展

```json
// config/stability.json
{
  "recovery": {
    "priority": ["active", "task", "session"],
    "snapshotRetention": 5,
    "fallbackEnabled": true
  },
  "advance": {
    "dependencyTimeoutMs": 1800000,
    "lockTimeoutMs": 5000,
    "autoAdvanceEnabled": true
  },
  "result": {
    "parsingStrategies": ["json-block", "inline-json", "keyword-extract"],
    "truncationRecovery": true,
    "confidenceThreshold": 0.7
  },
  "health": {
    "checkIntervalMs": 60000,
    "autoHealEnabled": true,
    "alertOnFailure": true
  }
}
```

---

## 四、实施计划

### 阶段1: 基础增强 (1-2天)

1. [ ] 实现三层恢复机制
2. [ ] 添加状态校验函数
3. [ ] 配置稳定性参数文件

### 阶段2: 推进优化 (1-2天)

1. [ ] 实现确定性阶段推进
2. [ ] 添加依赖超时检测
3. [ ] 实现文件锁防竞态

### 阶段3: 回收增强 (1-2天)

1. [ ] 实现多策略解析
2. [ ] 添加截断容错
3. [ ] 实现置信度计算

### 阶段4: 自愈机制 (1天)

1. [ ] 实现健康检查
2. [ ] 实现自动修复
3. [ ] 添加告警集成

---

## 五、测试验证

### 5.1 单元测试

```bash
# 测试状态恢复
node -e "
const { enhancedRecovery } = require('./result-recovery');
const mock = { label: 'test', taskId: 'xxx', workerId: 'yyy' };
console.log(enhancedRecovery(mock));
"

# 测试阶段推进
node -e "
const { deterministicAdvance } = require('./supervisor-runner');
deterministicAdvance();
"
```

### 5.2 集成测试

```bash
# 模拟故障恢复
npm run recover

# 模拟阶段推进
npm run advance

# 健康检查
npm run health
```

---

## 附录：相关文件

| 文件 | 改动 |
|------|------|
| `result-recovery.js` | 增强恢复逻辑 |
| `supervisor-runner.js` | 增强推进逻辑 |
| `orchestration-watchdog.js` | 增强健康检查 |
| `config/stability.json` | 新增配置 |

---

## 任务追踪

- Task ID: task-1773587002208
- Session ID: unknown
- Role: solution-architect-1
- Stage: design
- Updated: 2026-03-16
