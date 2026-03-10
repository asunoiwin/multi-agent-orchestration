# Multi-Agent Orchestrator Hook

## 功能
在消息到达主会话前，自动判断任务复杂度并强制路由到多 Agent 系统。

## 触发条件
- 事件：`before_agent_start`
- 会话：仅 `main`
- 复杂度：score ≥ 3

## 工作流程
1. 分析任务复杂度（调用 `task-analyzer.js`）
2. 如果 score ≥ 3，修改 prompt 强制主会话调用 orchestrator
3. 如果 score < 3，放行给主会话处理

## 配置
位置：`~/.openclaw/openclaw.json`

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "multi-agent-orchestrator": {
          "enabled": true,
          "path": "/Users/rico/.openclaw/workspace/multi-agent-orchestration/hooks/multi-agent-orchestrator"
        }
      }
    }
  }
}
```

## 效果
- 主会话无法选择是否使用多 agent（移除选择权）
- 复杂任务自动路由，不会被主会话直接处理
- 简单任务正常放行

## 测试
```bash
# 重启 Gateway 后，发送复杂任务测试
# 例如："先搜索最新的 AI 框架，然后写对比报告"
# 应该看到强制路由提示
```
