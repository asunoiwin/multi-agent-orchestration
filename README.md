# OpenClaw Multi-Agent Plugin v3

作为 OpenClaw 扩展主动加载的多 Agent 编排插件，支持动态角色池、自动恢复、阶段推进、结果回收与稳定性回归测试。

## 设计目标

1. **持续执行机制**：通过任务分析、运行态恢复、watchdog 与 cron 组合推进，不依赖单次会话记忆。
2. **动态角色池**：不是固定 researcher/builder/auditor，而是根据任务特征选择预配置角色，并支持同岗多人。
3. **公司化协作**：支持 discovery / design / delivery / assurance 多阶段协作、同组讨论、同步点和交付接力。
4. **边界明确**：每个角色有独立的任务边界、能力边界、禁止项、记忆需求。
5. **可迁移**：仓库内自带配置与运行目录，别人克隆后即可初始化。
6. **上下文可追踪**：任务文件、spawn 指令、记忆写入统一携带 `taskId` / `sessionId` / `workerId` / `teamId`。
7. **可恢复**：丢失 runtime、已删除 session、假 running、stalled 任务都能重新纳入恢复链。
8. **可验证**：仓库内置 smoke、e2e 与稳定性回归测试。

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
├── task-analyzer.cjs          # 任务复杂度分析引擎
├── task-dispatcher.js         # 旧版任务分发器（兼容）
└── ...
```

## 架构

```text
用户任务
    ↓
OpenClaw 插件加载器
    ↓
openclaw-multi-agent.before_agent_start
    ↓
任务分析器判断复杂度
    ↓
    ├─ 简单任务 → 直接处理
    └─ 复杂任务 → live-executor.js
         ↓
    task-intake.js → 生成任务文件
         ↓
    supervisor-runner.js → 分配员工实例 + 生成 spawn 指令
         ↓
    sessions_spawn → 创建真实 subagent
         ↓
    [协作团队]
    ├─ Discovery Team   → 多名 research / data 成员 roundtable
    ├─ Design Team      → supervisor + architect 做 design review
    ├─ Delivery Team    → 多名 implementer / operator 并行 swarm
    ├─ Assurance Team   → auditor + test engineer 做 peer review
    └─ Handoff Team     → doc synthesize 汇总交付
         ↓
    result-recovery.js → 回收结果 + 依赖推进 + 下一波员工解锁
         ↓
    orchestration-watchdog.js → 健康检查 / 自愈 / 重试 / runtime 收口
         ↓
    主会话汇总交付
```

## 安装

### 1. 克隆仓库
```bash
git clone https://github.com/asunoiwin/multi-agent-orchestration.git
cd multi-agent-orchestration
npm install
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

### 4. 推荐接入方式
当前推荐把它作为 OpenClaw 扩展插件接入，而不是继续依赖旧 hook loader。项目已经兼容：

- 主会话任务分析
- `memory-enhanced` 的复杂任务路由注入
- cron 巡检 / 回收 / 推进

### 5. 验证
```bash
# 分析一个复杂任务
npm run smoke

# 应输出包含 teams / syncPlan / spawnNow / spawnLater 的 JSON
```

如果你需要把主会话的 `sessionId` 传进编排链，可在运行前设置：

```bash
OPENCLAW_SESSION_ID=session-main-123 npm run smoke
```

## 使用

### 完整编排（推荐）
```bash
npm run plan -- "先搜索最新的 AI 框架，然后写一个对比报告"
```

输出包含：
- `teams`: 协作团队与成员实例
- `syncPlan`: 团队同步点与交接目标
- `spawnNow`: 立即需要创建的 agent（含 agentId、prompt、model）
- `spawnLater`: 等待依赖完成后创建的 agent
- `executionMode`: single / hybrid / parallel

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

内置角色池包括：
- `supervisor`
- `solution-architect`
- `web-researcher`
- `code-implementer`
- `quality-auditor`
- `test-engineer`
- `doc-synthesizer`
- `data-analyst`
- `os-operator`

可随时在 `agent-pool.json` 中新增角色，并在 `agent-mapping.json` 中映射到真实 agentId。

## 新版协作模型

- 一个任务会先被拆成 `staffingPlan`，再生成 `teams`、`syncPlan` 和 `subtasks`。
- `workerId` 代表真实员工实例，不再把整个岗位压成一个角色。
- 同组员工会在 prompt 里看到 `Coworkers`、`Collaboration Mode` 和相关 `Sync Points`。
- 依赖推进基于 `workerId`，所以可以支持同岗多人、跨组协作和分阶段解锁。

## 复杂度评分

| 信号 | 分值 |
|------|------|
| 任务长度 > 40 字 | +1 |
| 任务长度 > 100 字 | +1 |
| 每个匹配的领域 | +1 |
| 并行关键词 | +2 |
| 串行关键词 | +2 |

阈值：≥3 分启用多 Agent。

## 稳定性特性

- 支持 `.deleted.*` 子会话的结果回收
- 支持 `running` 但无 session / 无进展 worker 的重试
- 支持 runtime 丢失后的 rehydrate
- 支持 stalled 生产任务重新进入恢复路径
- 支持按任务意图筛掉 demo/verify backlog，避免污染生产队列

## 测试

```bash
# 生成复杂任务编排计划
npm run smoke

# 查看恢复汇总
npm run recover

# 真实 OpenClaw 子 agent 端到端验证
npm run e2e:subagent

# 稳定性回归测试
npm test
```

`e2e:subagent` 会实际调用 `openclaw agent` 触发一次 `sessions_spawn`，等待 researcher 子 agent 产出结构化完成块，并校验 `taskId/workerId/status`。这条命令适合在发布前做回归验真。

---

版本：v3.0.0
