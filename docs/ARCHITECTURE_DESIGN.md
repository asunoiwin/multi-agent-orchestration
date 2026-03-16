# 架构设计方案

## 概述

为 multi-agent-orchestration 系统设计两套可行方案：配置驱动模式（当前实现）和可视化工作流引擎。

---

## 方案A：配置驱动模式（当前实现）

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     配置层 (Config)                         │
├─────────────────────┬───────────────────────────────────────┤
│ agent-pool.json     │  角色定义池                           │
│  - roles[]          │  - id, name, purpose                  │
│  - triggerCaps      │  - skills, deny                       │
│  - memory.scope     │  - lifecycle                          │
├─────────────────────┼───────────────────────────────────────┤
│ agent-mapping.json  │  运行时映射                           │
│  - mapping{}        │  - role → agentId                    │
│  - defaults         │  - model, mode                        │
└─────────────────────┴───────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    编排层 (Orchestration)                   │
├─────────────────────────────────────────────────────────────┤
│  task-intake.js      → 任务入队 / 复杂度分析               │
│  dynamic-orchestrator.js → 角色选择 / 子任务生成          │
│  supervisor-runner.js  → 员工分配 / spawn指令生成         │
│  live-executor.js     → 执行入口                           │
│  result-recovery.js   → 结果回收 / 依赖推进                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    执行层 (Execution)                       │
├─────────────────────────────────────────────────────────────┤
│  sessions_spawn      → 创建 subagent 实例                  │
│  协作团队            → Discovery/Design/Delivery/Assurance │
│  Sync Points         → 团队同步与交接                      │
└─────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 职责 | 关键接口 |
|------|------|----------|
| `agent-pool.json` | 角色能力定义 | skills[], deny[], memory{} |
| `agent-mapping.json` | 运行时绑定 | role → agentId, model |
| `dynamic-orchestrator.js` | 任务解析+角色匹配 | parseTask() → staffingPlan |
| `supervisor-runner.js` | 员工分配 | assignWorkers() → spawn[] |
| `result-recovery.js` | 结果聚合 | recover() → summary |

### 数据流

1. **任务输入** → `task-intake.js` 生成任务文件
2. **角色选择** → `dynamic-orchestrator.js` 分析复杂度，匹配角色
3. **员工分配** → `supervisor-runner.js` 生成 spawn 指令
4. **并行执行** → subagent 按 syncPlan 协作
5. **结果回收** → `result-recovery.js` 聚合输出

### 依赖关系

```
agent-pool.json ← agent-mapping.json ← dynamic-orchestrator.js
                                               ↓
                                    supervisor-runner.js
                                               ↓
                                    live-executor.js
                                               ↓
                                    result-recovery.js
```

### 优点

- 轻量级：纯 JSON 配置，无额外依赖
- 灵活：可运行时修改映射
- 可迁移：配置即代码
- 快速启动：无可视化开销

### 限制

- 缺乏可视化监控
- 手工配置维护成本
- 任务依赖不够直观
- 调试困难

---

## 方案B：可视化工作流引擎

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    可视化层 (Visual)                        │
├─────────────────────────────────────────────────────────────┤
│  Web UI / Graph Editor    →  流程设计器                    │
│  - 节点编辑器              →  角色/任务节点                 │
│  - 连线编辑器              →  依赖关系                      │
│  - 属性面板                →  配置参数                     │
│  - 执行仪表盘              →  实时监控                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    引擎层 (Engine)                          │
├─────────────────────────────────────────────────────────────┤
│  workflow-engine.js     →  流程解析与执行                  │
│  - DAG 调度器             →  拓扑排序 / 并行/串行控制        │
│  - 状态机                 →  pending/running/completed     │
│  - 事件总线               →  节点状态变更通知              │
├─────────────────────────────────────────────────────────────┤
│  可选引擎方案              →  见下方对比                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    适配层 (Adapter)                         │
├─────────────────────────────────────────────────────────────┤
│  config-adapter.js       →  兼容现有 agent-pool.json       │
│  execution-adapter.js    →  调用 sessions_spawn            │
│  memory-adapter.js       →  记忆引擎集成                   │
└─────────────────────────────────────────────────────────────┘
```

### 可选引擎对比

| 引擎 | 特点 | 适用场景 |
|------|------|----------|
| **D3.js + 自建** | 完全可控，轻量 | 简单流程 |
| **React Flow** | React 生态，丰富组件 | 中等复杂度 |
| **rete.js** | 节点编辑器专用，强大 | 复杂可视化 |
| **X6 (AntV)** | 国产方案，文档好 | 国内团队 |
| **JointJS** | 老牌，稳定 | 企业级 |

### 核心模块

| 模块 | 职责 | 关键接口 |
|------|------|----------|
| `workflow-engine.js` | 流程解析与执行 | loadWorkflow(), execute(), pause() |
| `node-registry.js` | 节点类型注册 | registerNode(), getNode() |
| `execution-dag.js` | DAG 执行器 | topologicalSort(), runParallel() |
| `config-adapter.js` | 配置兼容 | importFromPool(), exportToPool() |
| `web-ui/` | 前端界面 | React 组件 |

### 数据流

1. **设计阶段** → Web UI 绘制流程图 → 保存为 workflow.json
2. **解析阶段** → workflow-engine 解析为 DAG
3. **执行阶段** → DAG 调度器按拓扑序执行
4. **监控阶段** → 实时更新节点状态到仪表盘
5. **完成阶段** → 结果聚合，生成报告

### 依赖关系

```
workflow.json → workflow-engine.js → execution-dag.js
                       ↓
              config-adapter.js
                       ↓
              agent-pool.json (兼容)
                       ↓
              live-executor.js (复用)
```

### 优点

- 可视化程度高，易于理解
- 流程监控直观
- 拖拽式设计降低门槛
- 支持更细粒度依赖

### 限制

- 需要引入前端依赖
- 学习曲线增加
- 需要维护 Web 服务
- 初始加载变重

---

## 方案对比矩阵

| 维度 | 方案A | 方案B |
|------|-------|-------|
| **实现复杂度** | 低 | 中-高 |
| **依赖数量** | 无 | 1-2个可视化库 |
| **可视化** | 无 | 完整 |
| **调试便利** | 低 | 高 |
| **可维护性** | 中 | 高 |
| **启动速度** | 快 | 中 |
| **学习成本** | 低 | 中 |
| **适合规模** | 小-中 | 中-大 |

---

## 实施建议

### 阶段1：方案A 优化（短期）
- 增加配置验证脚本
- 添加配置 diff 工具
- 完善文档

### 阶段2：方案B 探索（中期）
- 评估 React Flow / Rete.js
- 设计 workflow.json schema
- 实现最小可行引擎

### 阶段3：方案B 集成（长期）
- 开发 Web UI
- 集成执行监控
- 兼容现有配置

---

## 附录：任务追踪

- Task ID: task-1773574535162
- Session ID: unknown
- Role: solution-architect-1
- Stage: design
