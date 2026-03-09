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
│   └── agent-pool.json        # 动态角色池（可迁移）
├── runtime/
│   ├── active-agents.json     # 运行态（不提交）
│   └── supervisor-state.json  # 运行态（不提交）
├── tasks/                     # 待处理任务队列（不提交）
├── docs/
├── dynamic-orchestrator.js    # 智能任务解析 + 角色选择 + 子任务生成
├── task-intake.js             # 任务入口，负责生成任务文件
├── supervisor-runner.js       # Supervisor 执行器（run once）
└── ...
```

## 架构说明

### 1. AGENTS.md / 系统规则层
- 永久规定：主会话收到任务先进行智能解析。
- 对复杂任务，交给 Supervisor；对简单任务，主会话直接处理。
- 这层是**执行机制规则**，不是运行态数据。

### 2. Hook / 触发层
推荐把 Hook 配成：
- 检测任务型消息
- 调用 `node task-intake.js "<任务>"`
- 再调用 `node supervisor-runner.js`

这样每次下发任务都会自动触发，不靠人工记忆。

### 3. Supervisor / 编排层
`supervisor-runner.js` 职责：
- 读取 tasks/ 中的 planned 任务
- 根据 `dynamic-orchestrator.js` 的计划分配角色
- 把待执行 agent 写入 `runtime/active-agents.json`
- 后续可扩展为真正创建 subagent / sessions

### 4. Agent Pool / 角色池
角色池定义在 `config/agent-pool.json`，每个角色包含：
- purpose：适用任务边界
- triggerCapabilities：触发能力标签
- skills：允许工具
- deny：禁止工具
- memory：该角色运行时需要的工作记忆
- lifecycle：生命周期

## 当前内置角色

- `supervisor`：编排/协调/回收
- `web-researcher`：搜索/验证/对比
- `code-implementer`：开发/配置/重构
- `quality-auditor`：测试/安全/验证
- `doc-synthesizer`：文档/汇总/交接
- `data-analyst`：分析/指标/比较

你可以继续新增更多专业角色，而不是被固定三角色限制。

## 安装与初始化

### 1. 克隆仓库
```bash
git clone https://github.com/asunoiwin/multi-agent-orchestration.git
cd multi-agent-orchestration
```

### 2. 初始化目录
```bash
mkdir -p runtime tasks docs config
```

### 3. 试跑一个任务
```bash
node task-intake.js "先调研一个方案，然后实现 demo，最后做质量检查"
node supervisor-runner.js
```

### 4. 查看结果
```bash
cat tasks/*.json
cat runtime/active-agents.json
```

## 与 OpenClaw 集成建议

推荐的 Hook 逻辑：
```bash
node task-intake.js "<用户任务>"
node supervisor-runner.js
```

后续可继续扩展为：
- supervisor-runner 真正调用 `sessions_spawn`
- progress-monitor 基于真实 session 状态检查
- result-recovery 自动汇总 sessions_history

## 为什么更可迁移

- **配置在仓库内**：`config/agent-pool.json`
- **运行态在仓库内**：`runtime/`、`tasks/`
- **学习与进化不混入功能配置**：`.learnings/` 仍只留给学习/错误/规则沉淀
- **别人克隆后无需依赖你的私人工作区结构**

## 下一步建议

1. 把 `supervisor-runner.js` 接到真实 `sessions_spawn`
2. 加一个 `result-recovery.js` 自动回收任务结果
3. 增加 `hook-example.md` 或安装脚本

---

版本：v2.0.0
