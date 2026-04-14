# Multi-Agent Orchestration - Minimal Demo Design

## 1. 当前系统分析

### 1.1 现有方案架构
- **任务入口**: `task-intake.js` - 创建任务记录并分析复杂度
- **智能规划**: `dynamic-orchestrator.js` - 基于关键词检测 + 复杂度评分自动分配角色
- **编排器**: `orchestrator-main.js` - 完整生命周期管理 (intake → spawn → monitor → recover)
- **角色池**: `config/agent-pool.json` - 9 种角色定义 (supervisor, solution-architect, web-researcher, code-implementer, quality-auditor, test-engineer, doc-synthesizer, data-analyst, os-operator)

### 1.2 当前任务分析
输入任务: "先调研现有方案并给出一个最小可执行 demo 的设计切分，再安排后续实现、审查和交付说明"

复杂度评分: **8分** → needsMultiAgent: true

自动分配的 agent:
| 阶段 | Agent | 数量 | 协作模式 |
|------|-------|------|----------|
| discovery | Web Researcher | 2 | roundtable |
| design | Solution Architect | 1 | design-review |
| delivery | Code Implementer | 2 | swarm |
| assurance | Quality Auditor + Test Engineer | 2 | peer-review |
| delivery | Doc Synthesizer | 1 | handoff |

**总计: 8 个 agent** - 对于 demo 来说太复杂

---

## 2. 最小可执行 Demo 设计

### 2.1 设计目标
- 用 **最少的 agent** (2-3个) 验证完整流程
- 覆盖: 调研 → 设计 → 实现 → 审查 → 交付
- 演示: 任务拆分、并行执行、结果汇总

### 2.2 简化方案

**方案 A: 极简版 (2 agents)**
```
Web Researcher → Code Implementer → (Main Agent 汇总)
```
- 优点: 最少代码，快速验证
- 缺点: 缺少设计审查环节

**方案 B: 精简版 (3 agents)** ⭐ 推荐
```
Web Researcher → Solution Architect → Code Implementer
                     ↓
              Quality Auditor
```
- 优点: 有设计环节，流程完整
- 缺点: 需要配置

**方案 C: 完整版 (5 agents)**
```
Discovery: Web Researcher x2 (并行)
    ↓
Design: Solution Architect
    ↓
Delivery: Code Implementer x2 (并行)
    ↓
Assurance: Quality Auditor
    ↓
Documentation: Doc Synthesizer
```

### 2.3 推荐: 方案 B 详细设计

```
Stage 1: Discovery (Web Researcher #1)
- 任务: 调研 multi-agent orchestration 现有方案
- 输出: 方案对比表、关键参考资料

Stage 2: Design (Solution Architect)
- 依赖: Web Researcher #1
- 任务: 基于调研结果，给出最小 demo 的设计切分
- 输出: 架构图、接口定义、拆分方案

Stage 3: Delivery (Code Implementer)
- 依赖: Solution Architect
- 任务: 实现 demo 代码
- 输出: 可运行代码

Stage 4: Assurance (Quality Auditor)
- 依赖: Code Implementer
- 任务: 审查代码质量
- 输出: 审查报告
```

---

## 3. 执行步骤

### 3.1 手动执行 Demo (推荐用于首次验证)

```bash
# Step 1: 生成执行计划
cd ~/.openclaw/workspace/multi-agent-orchestration
node orchestrator-main.js "先调研现有方案并给出一个最小可执行 demo 的设计切分，再安排后续实现、审查和交付说明"

# Step 2: 获取 task ID 并查看 runtime/
# 从输出中获取 taskId，例如: task-1773585926163

# Step 3: 手动 spawn 精简版 agents
# 使用 spawnInstructions 但只选择前 3 个
```

### 3.2 集成到主会话

需要实现一个简化版 `integration-helper-mini.js`:

```javascript
const { orchestrate } = require('./orchestrator-main');

async function runMiniDemo(taskText, options = {}) {
  // 1. 只运行 orchestrate 获取计划
  const plan = await orchestrate(taskText, { verbose: false });
  
  // 2. 过滤为精简版 (最多 3 agents)
  const miniAgents = plan.spawnInstructions.slice(0, 3);
  
  // 3. 手动 spawn
  for (const agent of miniAgents) {
    await options.sessions_spawn(agent.spawnCall);
  }
  
  return { taskId: plan.taskId, agents: miniAgents };
}
```

---

## 4. 实现安排

### 4.1 第一阶段: 调研验证 (Web Researcher)
- 搜索 multi-agent orchestration 现有方案
- 对比: AutoGen, CrewAI, LangChain Agents, OpenAI Swarm
- 输出: 方案对比表

### 4.2 第二阶段: 设计 (Solution Architect)
- 基于调研结果，设计 demo 架构
- 拆分: 最小可运行的功能点
- 输出: DEMO-DESIGN.md

### 4.3 第三阶段: 实现 (Code Implementer)
- 实现核心代码
- 输出: 可运行 demo

### 4.4 第四阶段: 审查 (Quality Auditor)
- 代码审查
- 输出: REVIEW.md

---

## 5. 交付说明

### 5.1 验收标准
- [ ] 任务能自动拆分为多个阶段
- [ ] Agent 之间有正确的依赖关系
- [ ] 每个 agent 的 prompt 包含完整的上下文
- [ ] 结果能汇总到主会话

### 5.2 已知问题
1. 当前 spawn 只生成了第一个 agent，需要推进机制
2. 需要实现 `result-recovery.js` 来收集各 agent 的输出
3. 内存集成尚未完全测试

### 5.3 后续完善
- 完善状态推进机制
- 集成 memory-enhanced 插件
- 支持更复杂的并行策略

---

## 6. 文件清单

| 文件 | 用途 |
|------|------|
| `dynamic-orchestrator.js` | 任务分析 + 角色分配 |
| `orchestrator-main.js` | 完整编排流程 |
| `supervisor-runner.js` | Agent 分配逻辑 |
| `result-recovery.js` | 结果收集 |
| `config/agent-pool.json` | 角色定义 |
| `docs/INTEGRATION.md` | 集成文档 |
