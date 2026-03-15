# 主会话集成指南

本文档说明如何在主会话（Jarvis）中集成多 Agent 编排系统。

## 快速开始

### 方式 1：使用 integration-helper（推荐）

```javascript
const orchestrator = require('~/.openclaw/workspace/multi-agent-orchestration/integration-helper');

// 执行任务
const result = await orchestrator.run("先调研方案，然后实现 demo", {
  sessions_spawn: sessions_spawn  // 传入真实工具
});

// 查看结果
console.log(result);
// {
//   taskId: "task-xxx",
//   mode: "multi",
//   spawned: ["task-xxx-web-researcher"],
//   waiting: ["code-implementer", "quality-auditor"],
//   message: "Agents spawned..."
// }

// 推进下一个 agent（当前一个完成后）
await orchestrator.progress({ sessions_spawn });

// 获取最终结果
const summary = orchestrator.getSummary(result.taskId);
```

### 方式 2：使用 auto-executor

```javascript
const { autoExecute } = require('~/.openclaw/workspace/multi-agent-orchestration/auto-executor');

const result = await autoExecute("搜索并对比最新 AI 框架", {
  sessions_spawn: sessions_spawn,
  verbose: true
});
```

### 方式 3：CLI 模式（测试用）

```bash
# 生成执行计划（不真实 spawn）
npm run smoke

# 推进下一个
node result-recovery.js next

# 获取结果
node result-recovery.js <taskId>
```

## 完整工作流

### 1. 任务入口

主会话收到任务后，先判断复杂度：

```javascript
// 方式 A：直接用 integration-helper
const result = await orchestrator.run(userTask, { sessions_spawn });

if (result.mode === 'single') {
  // 简单任务，主会话直接处理
  return handleDirectly(userTask);
}

// 复杂任务，已自动 spawn 第一批 agent
console.log(`Spawned: ${result.spawned.join(', ')}`);
```

### 2. 监控完成

当 agent 完成后（通过 `subagents` 工具或 `sessions_list` 检测）：

```javascript
// 标记完成
const { updateAgentStatus } = require('./result-recovery');
updateAgentStatus(agentLabel, 'completed', { result: agentOutput });

// 推进下一个
await orchestrator.progress({ sessions_spawn });
```

### 3. 结果汇总

所有 agent 完成后：

```javascript
const summary = orchestrator.getSummary(taskId);

console.log(summary);
// {
//   taskId: "task-xxx",
//   status: "completed",
//   agents: [
//     { roleId: "web-researcher", status: "completed", result: {...} },
//     { roleId: "code-implementer", status: "completed", result: {...} },
//     { roleId: "quality-auditor", status: "completed", result: {...} }
//   ],
//   completedCount: 3,
//   totalCount: 3
// }

// 汇总交付给用户
return synthesizeResults(summary);
```

## Hook 自动触发

如果已安装 `multi-agent-orchestrator` Hook，主会话启动时会自动注入编排规则。

你只需在收到任务时调用：

```javascript
const orchestrator = require('~/.openclaw/workspace/multi-agent-orchestration/integration-helper');
const result = await orchestrator.quickRun(userTask, { sessions_spawn });
```

## 错误处理

```javascript
try {
  const result = await orchestrator.run(userTask, { sessions_spawn });
  
  if (result.mode === 'multi') {
    // 定期检查状态
    const summary = orchestrator.getSummary(result.taskId);
    
    if (summary.status === 'failed') {
      // 处理失败
      const failedAgents = summary.agents.filter(a => a.status === 'failed');
      console.error('Failed agents:', failedAgents);
    }
  }
} catch (err) {
  console.error('Orchestration error:', err.message);
}
```

## 调试

```bash
# 查看运行态
cat runtime/active-agents.json
cat runtime/execution-plan.json

# 查看任务队列
ls tasks/

# 查看某个任务
cat tasks/task-xxx.json
```

## 最佳实践

1. **简单任务直接处理**：不要为单步任务启动编排
2. **及时更新状态**：agent 完成后立即调用 `updateAgentStatus`
3. **定期检查 next**：串行模式下，每个 agent 完成后检查 `getNextAgents()`
4. **保存结果**：agent 输出要写入 `updateAgentStatus` 的 result 字段
5. **清理运行态**：任务完成后可选择清理 `runtime/` 和 `tasks/`
6. **传递 sessionId**：如果你希望主会话和记忆系统共享上下文，运行前设置 `OPENCLAW_SESSION_ID`

---

版本：v2.1.0
