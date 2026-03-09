# Multi-Agent Orchestration System v2

可迁移、可配置、动态角色池驱动的多 Agent 编排系统。

## 设计目标

1. **永久执行机制**：通过 Hook + Supervisor 触发，不依赖临时记忆。
2. **动态角色池**：不是固定 researcher/builder/auditor，而是根据任务特征选择预配置角色。
3. **边界明确**：每个角色有独立的任务边界、能力边界、禁止项、记忆需求。
4. **可迁移**：仓库内自带配置与运行目录，别人克隆后即可初始化。

## 核心目录

```text
multi-agent-orchestration/
├── config/
│   ├── agent-pool.json        # 动态角色池定义
│   └── agent-mapping.json     # 角色 → 真实 OpenClaw agentId 映射
├── runtime/                   # 运行态（不提交）
├── tasks/                     # 任务队列（不提交）
├── dynamic-orchestrator.js    # 智能任务解析 + 角色选择 + 子任务生成
├── task-intake.js             # 任务入口
├── supervisor-runner.js       # Supervisor 分配器
├── live-executor.js           # 真实执行入口（生成 sessions_spawn 指令）
├── orchestrator-main.js       # 主编排器（串联全流程）
├── result-recovery.js         # 结果回收 + 依赖检查 + 状态汇总
├── task-analyzer.js           # 任务复杂度分析引擎
├── task-dispatcher.js         # 旧版任务分发器（兼容）
└── ...
```

## 架构

```text
用户任务
    ↓
[Hook: multi-agent-orchestrator]  ← agent:bootstrap 时注入编排规则
    ↓
主会话（Jarvis）判断复杂度
    ↓
    ├─ 简单任务 → 直接处理
    └─ 复杂任务 → live-executor.js
         ↓
    task-intake.js → 生成任务文件
         ↓
    supervisor-runner.js → 分配角色 + 生成 spawn 指令
         ↓
    sessions_spawn → 创建真实 subagent
         ↓
    [Agent 池]
    ├─ web-researcher   → agentId: researcher
    ├─ code-implementer → agentId: builder
    ├─ quality-auditor  → agentId: auditor
    ├─ doc-synthesizer  → agentId: researcher
    └─ data-analyst     → agentId: researcher
         ↓
    result-recovery.js → 回收结果 + 依赖推进
         ↓
    主会话汇总交付
```

## 安装

### 1. 克隆仓库
```bash
git clone https://github.com/asunoiwin/multi-agent-orchestration.git
cd multi-agent-orchestration
```

### 2. 初始化运行目录
```bash
mkdir -p runtime tasks
```

### 3. 配置 agent 映射
编辑 `config/agent-mapping.json`，把角色映射到你的 OpenClaw agent ID：
```json
{
  "mapping": {
    "web-researcher":   { "agentId": "researcher", "model": "minimax" },
    "code-implementer": { "agentId": "builder",    "model": "minimax" },
    "quality-auditor":  { "agentId": "auditor",    "model": "minimax" }
  }
}
```

### 4. 安装 Hook（可选但推荐）
```bash
# 复制 hook 到 OpenClaw hooks 目录
cp -r hooks/multi-agent-orchestrator ~/.openclaw/hooks/

# 在 ~/.openclaw/openclaw.json 的 hooks.internal.entries 中添加：
# "multi-agent-orchestrator": {
#   "enabled": true,
#   "path": "~/.openclaw/hooks/multi-agent-orchestrator"
# }
```

### 5. 验证
```bash
# 分析一个复杂任务
node live-executor.js "先调研方案，然后实现 demo，最后做代码审查"

# 应输出包含 spawnNow / spawnLater 的 JSON
```

## 使用

### 完整编排（推荐）
```bash
node live-executor.js "先搜索最新的 AI 框架，然后写一个对比报告"
```

输出包含：
- `spawnNow`: 立即需要创建的 agent（含 agentId、prompt、model）
- `spawnLater`: 等待依赖完成后创建的 agent
- `executionMode`: serial / parallel

### 单步使用
```bash
# 仅分析任务
node dynamic-orchestrator.js "研究并实现用户认证系统"

# 仅入队
node task-intake.js "优化系统性能"

# 仅分配
node supervisor-runner.js

# 回收结果
node result-recovery.js all
node result-recovery.js next        # 查看下一个可启动的 agent
node result-recovery.js <taskId>    # 按任务回收
```

## 角色池

定义在 `config/agent-pool.json`，每个角色包含：

| 字段 | 说明 |
|------|------|
| purpose | 任务边界 |
| triggerCapabilities | 触发能力标签 |
| skills | 允许的工具白名单 |
| deny | 禁止的工具黑名单 |
| memory | 工作记忆需求 |
| lifecycle | persistent / ephemeral |

内置 6 个角色：supervisor、web-researcher、code-implementer、quality-auditor、doc-synthesizer、data-analyst。

可随时在 `agent-pool.json` 中新增角色，并在 `agent-mapping.json` 中映射到真实 agentId。

## 复杂度评分

| 信号 | 分值 |
|------|------|
| 任务长度 > 40 字 | +1 |
| 任务长度 > 100 字 | +1 |
| 每个匹配的领域 | +1 |
| 并行关键词 | +2 |
| 串行关键词 | +2 |

阈值：≥3 分启用多 Agent。

---

版本：v2.1.0
