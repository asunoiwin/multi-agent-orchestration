# Multi-Agent Orchestration System

自主多 Agent 协作系统，用于 OpenClaw 环境的复杂任务自动拆解、并行执行与质量监督。

## 功能特性

### 🎯 自动任务分析
- **智能复杂度评估**：自动识别任务关键词、领域、阶段
- **动态角色建议**：根据任务特征推荐最佳 Agent 组合
- **执行模式判断**：自动选择并行/串行/混合执行模式

### 🤖 多 Agent 协作
- **Supervisor（监督员）**：常驻 Agent，负责任务分析、Agent 创建/回收、进度监控、质量评估
- **Researcher（研究员）**：按需创建，负责信息收集、技术调研、方案分析
- **Builder（构建者）**：按需创建，负责代码编写、文件修改、功能实现
- **Auditor（审计员）**：按需创建，负责代码审查、安全检查、质量验证

### 🔒 权限边界管理
- **工具白名单**：每个角色只能使用预定义的工具集
- **禁止列表**：自动阻止 Agent 访问敏感操作（gateway、cron、plugins 等）
- **最小权限原则**：临时 Agent 默认只读权限

### 📊 监督与评估
- **实时进度监控**：检测 Agent 阻塞与超时
- **质量评估**：完成度、代码质量、效率三维评分
- **记忆提取**：从临时 Agent 提取有价值的经验与模板

## 系统架构

```
用户任务
    ↓
task-analyzer.js (任务分析引擎)
    ↓
    ├─ 简单任务 → 主 Agent 直接处理
    └─ 复杂任务 → 启用多 Agent
         ↓
    orchestrator.js (编排器)
         ↓
    ├─ 创建 Agent (agent-manager.js)
    ├─ 监控进度 (progress-monitor.js)
    ├─ 质量评估 (quality-evaluator.js)
    └─ 记忆提取 (memory-extractor.js)
         ↓
    [Agent 池]
    ├─ Supervisor (常驻)
    ├─ Researcher (按需)
    ├─ Builder (按需)
    └─ Auditor (按需)
```

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/asunoiwin/multi-agent-orchestration.git
cd multi-agent-orchestration

# 初始化系统
node agent-manager.js init
```

### 使用示例

#### 1. 分析任务复杂度

```bash
node task-analyzer.js "研究并实现用户认证系统，包括 OAuth 登录和权限控制"
```

输出：
```json
{
  "needsMultiAgent": true,
  "score": 8,
  "suggestedRoles": ["researcher", "builder", "auditor"],
  "executionMode": "parallel"
}
```

#### 2. 生成执行计划

```bash
node orchestrator.js "优化系统性能并进行安全审计"
```

输出：
```
=== Execution Plan ===
Mode: multi
Execution Mode: parallel

Agents:
  - researcher (minimax-portal/MiniMax-M2.5)
    Tools: read, web_search, web_fetch
  - builder (minimax-portal/MiniMax-M2.5)
    Tools: read, write, edit, exec
  - auditor (minimax-portal/MiniMax-M2.5)
    Tools: read, exec

Workflow:
  Step 1 (parallel):
    - researcher
    - builder
    - auditor
```

#### 3. 监控进度

```bash
node progress-monitor.js
```

#### 4. 质量评估

```bash
node quality-evaluator.js <task-id>
```

## 核心组件

### task-analyzer.js
任务分析引擎，自动判断任务复杂度并建议执行策略。

**评分规则**：
- 多个动词（研究、实现、测试）：+3 分
- 多个领域（前端、后端、数据库）：+3 分
- 明确阶段（先、然后、最后）：+2 分
- 高复杂度（涉及 3+ 文件/系统）：+2 分
- 并行信号（同时、分别）：+2 分

**阈值**：≥5 分启用多 Agent

### agent-manager.js
Agent 管理器，负责角色配置、权限边界、模板生成。

**配置文件**：`~/.openclaw/workspace/.learnings/agents/orchestration-config.json`

**角色定义**：
- `supervisor`：监督员（常驻）
- `researcher`：研究员（半常驻）
- `builder`：构建者（半常驻）
- `auditor`：审计员（临时）

### orchestrator.js
系统编排器，负责任务分发、工作流生成、执行计划保存。

**执行模式**：
- `parallel`：多个 Agent 同时执行
- `serial`：按顺序执行
- `hybrid`：先串行后并行

### progress-monitor.js
进度监控器，实时监控 Agent 状态，检测阻塞与超时。

**监控指标**：
- Agent 状态（running/blocked/completed）
- 执行时长
- 阻塞原因

### quality-evaluator.js
质量评估器，评估任务完成质量与效率。

**评估维度**：
- **完成度**（40%）：是否满足需求
- **质量**（40%）：代码质量、安全性、可维护性
- **效率**（20%）：实际耗时 vs 预期耗时

**评级**：A（≥90%）、B（≥80%）、C（≥70%）、D（<70%）

### memory-extractor.js
记忆提取器，从临时 Agent 提取有价值的经验与模板。

**保存条件**：
- 任务复杂度 ≥ 3
- 执行时长 > 1 小时
- 有明确学习价值
- 可复用

**提取内容**：
- 任务模式（patterns.json）
- 解决方案（solutions.json）
- 错误教训（lessons.json）
- 可复用模板（templates/）

## 配置

### 角色配置

编辑 `~/.openclaw/workspace/.learnings/agents/orchestration-config.json`：

```json
{
  "enabled": true,
  "threshold": {
    "complexity": 5,
    "subtasks": 2,
    "domains": 2
  },
  "roles": {
    "supervisor": {
      "model": "minimax-portal/MiniMax-M2.5",
      "lifecycle": "persistent",
      "tools": ["sessions_list", "sessions_history", "subagents", "sessions_send", "read", "write"],
      "maxConcurrent": 1
    },
    "researcher": {
      "model": "minimax-portal/MiniMax-M2.5",
      "lifecycle": "semi-persistent",
      "tools": ["read", "web_search", "web_fetch"],
      "maxConcurrent": 2
    }
  }
}
```

### 权限管理

每个角色的权限边界：

| 角色 | 允许工具 | 禁止工具 |
|------|---------|---------|
| Supervisor | sessions_list, sessions_history, subagents, sessions_send, read, write | exec, gateway.*, cron.*, plugins.* |
| Researcher | read, web_search, web_fetch | write, edit, exec, sessions_spawn, gateway.*, cron.*, plugins.* |
| Builder | read, write, edit, exec | sessions_spawn, gateway.*, cron.*, plugins.* |
| Auditor | read, exec | write, edit, sessions_spawn, gateway.*, cron.*, plugins.* |

## 工作流程

### 1. 任务接收
用户提交任务描述（可以是一句话）

### 2. 任务分析
`task-analyzer.js` 自动分析：
- 关键词检测（动词、并行信号）
- 复杂度评估（长度、步骤、文件数）
- 领域识别（research/development/testing/security）
- 阶段检测（先/然后/最后）

### 3. 执行计划生成
`orchestrator.js` 生成执行计划：
- 选择执行模式（parallel/serial/hybrid）
- 分配角色（researcher/builder/auditor）
- 生成工作流（步骤、依赖关系）

### 4. Agent 创建与执行
`agent-manager.js` 创建 Agent：
- 加载角色配置
- 设置权限边界
- 启动 Agent 会话

### 5. 进度监控
`progress-monitor.js` 实时监控：
- 检查 Agent 状态
- 检测阻塞与超时
- 生成监控报告

### 6. 质量评估
`quality-evaluator.js` 评估结果：
- 完成度检查
- 代码质量评估
- 效率分析
- 生成改进建议

### 7. 记忆提取
`memory-extractor.js` 提取经验：
- 判断是否值得保存
- 提取任务模式
- 提取解决方案
- 提取错误教训
- 保存可复用模板

## 目录结构

```
multi-agent-orchestration/
├── README.md                    # 本文档
├── task-analyzer.js             # 任务分析引擎
├── agent-manager.js             # Agent 管理器
├── orchestrator.js              # 系统编排器
├── progress-monitor.js          # 进度监控器
├── quality-evaluator.js         # 质量评估器
├── memory-extractor.js          # 记忆提取器
└── agents/                      # Agent 配置与数据
    ├── orchestration-config.json  # 系统配置
    ├── roster.json                # 角色花名册
    ├── supervisor.md              # Supervisor 文档
    ├── researcher.md              # Researcher 文档
    ├── builder.md                 # Builder 文档
    ├── auditor.md                 # Auditor 文档
    ├── current-plan.json          # 当前执行计划
    ├── active-agents.json         # 活跃 Agent 列表
    ├── progress-report.json       # 进度报告
    ├── tasks/                     # 任务数据
    ├── evaluations/               # 评估报告
    └── memories/                  # 提取的记忆
        ├── patterns.json          # 任务模式库
        ├── solutions.json         # 解决方案库
        ├── lessons.json           # 错误教训库
        └── templates/             # 可复用模板
```

## 使用场景

### 场景 1：复杂项目开发
```bash
node orchestrator.js "开发一个用户认证系统，包括 OAuth 登录、JWT token 管理、权限控制、安全审计"
```

系统会：
1. Researcher 调研认证方案（OAuth/JWT/Session）
2. Builder 实现选定方案
3. Auditor 进行安全审计
4. Supervisor 监控进度并评估质量

### 场景 2：系统优化
```bash
node orchestrator.js "优化系统性能，包括数据库查询优化、缓存策略、并发处理"
```

系统会：
1. Researcher 分析性能瓶颈
2. Builder 实施优化方案
3. Auditor 验证优化效果
4. Supervisor 生成优化报告

### 场景 3：技术调研
```bash
node orchestrator.js "调研并对比 React、Vue、Angular 三个框架的优缺点"
```

系统会：
1. Researcher 收集框架信息
2. Researcher 对比分析
3. Supervisor 生成调研报告

## 最佳实践

### 1. 任务描述
- **明确目标**：说清楚要做什么
- **包含关键词**：研究、实现、测试、审计等
- **指明阶段**：先、然后、最后（如果有顺序要求）
- **标注并行**：同时、分别（如果可以并行）

### 2. 权限管理
- **最小权限原则**：只给 Agent 必要的工具
- **定期审查**：检查 Agent 权限配置
- **禁止列表**：确保敏感操作被阻止

### 3. 监控与评估
- **实时监控**：定期运行 `progress-monitor.js`
- **质量评估**：任务完成后运行 `quality-evaluator.js`
- **记忆提取**：保存有价值的经验

### 4. 持续优化
- **学习模式**：记录成功的任务模式
- **优化阈值**：根据实际情况调整复杂度阈值
- **改进流程**：根据评估结果优化工作流

## 故障排查

### Agent 创建失败
- 检查 `orchestration-config.json` 配置
- 确认模型可用性
- 检查权限设置

### Agent 阻塞
- 运行 `progress-monitor.js` 查看状态
- 检查 Agent 日志
- 手动终止阻塞的 Agent

### 质量评估失败
- 确认任务数据文件存在
- 检查交付物路径
- 验证评估标准

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 作者

Jarvis - OpenClaw 个人工作助理

## 相关项目

- [OpenClaw](https://github.com/openclaw/openclaw) - AI Agent 运行时环境
- [openclaw-memory-enhanced](https://github.com/asunoiwin/openclaw-memory-enhanced) - 增强记忆系统

---

**版本**：v1.0.0  
**更新时间**：2026-03-06
