# Multi-Agent Orchestration 最小可执行 Demo 设计

## 一、现有实现调研总结

### 核心模块
| 模块 | 职责 | 状态 |
|------|------|------|
| `task-intake.js` | 创建任务记录，生成 taskId | ✅ 可用 |
| `dynamic-orchestrator.js` | 任务分析 + 能力需求推导 + 计划生成 | ✅ 可可用 |
| `supervisor-runner.js` | Agent 分配 + Prompt 构建 | ✅ 可用 |
| `orchestrator-main.js` | 主编排器入口，串联各模块 | ✅ 可用 |
| `live-executor.js` | 输出可执行的 spawn 指令 | ✅ 可用 |
| `result-recovery.js` | 结果收集与状态恢复 | ✅ 可用 |
| `config/agent-pool.json` | Agent 角色池定义 | ✅ 可用 |
| `config/agent-mapping.json` | 角色 → 真实 agentId 映射 | ✅ 可用 |

### 执行流程
```
用户输入任务
    ↓
task-intake.js (生成 taskId, 调用 planTask)
    ↓
dynamic-orchestrator.js (特征检测、复杂度评分、能力需求、团队拆分)
    ↓
supervisor-runner.js (分配 agents，构建 prompt)
    ↓
orchestrator-main.js (输出 spawn 指令)
    ↓
main agent 调用 sessions_spawn 创建 subagents
```

### Demo 测试用例（已验证）

**用例 1: "先调研方案，然后实现 demo"**
- 复杂度: 5 (≥3，需要多 Agent)
- 执行模式: hybrid (串行)
- 分配的 Agents:
  1. `web-researcher-1` (discovery, spawning)
  2. `solution-architect-1` (design, waiting)
  3. `code-implementer-1` (delivery, waiting)

**用例 2: "同时实现用户认证和订单管理模块"**
- 复杂度: 更高 (包含 parallel 关键词)
- 执行模式: parallel
- 可触发并行实现

---

## 二、最小可执行 Demo 设计

### 目标
- 验证完整编排流程可运行
- 输出可直接执行的 `sessions_spawn` 指令
- 不依赖实际的 OpenClaw Gateway（纯本地验证）

### 设计切分

```
demo/
├── run-demo.sh          # 一键运行脚本
├── demo-task.js         # Demo 入口，模拟任务输入
├── verify-output.js     # 验证输出格式正确性
└── README.md            # 使用说明
```

### 实现细节

**1. demo-task.js**
- 输入: 预定义测试任务
- 输出: JSON 格式的 spawn 指令 (与 live-executor.js 相同格式)
- 不实际调用 sessions_spawn，只输出指令供验证

**2. run-demo.sh**
- 运行 demo-task.js
- 解析输出，验证 JSON 格式
- 打印可读的执行计划摘要

**3. verify-output.js**
- 验证 spawn 指令包含必要字段: runtime, mode, label, model, task, metadata
- 验证 taskId 格式正确
- 验证 roleId 映射正确

---

## 三、实际实现（v2.0）

### 新增文件

| 文件 | 用途 | 状态 |
|------|------|------|
| `demo-runner.js` | 整合编排系统与业务 Demo | ✅ 已实现 |
| `auth-module.js` | 用户认证模块 (注册/登录/JWT) | ✅ 已实现 |
| `order-module.js` | 订单管理模块 (CRUD/状态流转) | ✅ 已实现 |
| `combined-demo.js` | 组合演示 (Auth + Order) | ✅ 已实现 |
| `integrated-demo.js` | 完整集成演示 | ✅ 已实现 |

### 业务 Demo 功能

```javascript
// 用户认证模块
auth.register(username, password, email)  // 注册
auth.login(username, password)           // 登录 (返回 JWT)
auth.validateToken(token)                // 验证 Token
auth.getUserById(id)                     // 获取用户信息

// 订单管理模块
order.createOrder({ userId, items })     // 创建订单
order.updateOrderStatus(id, status)     // 更新状态
order.getOrdersByUserId(id)             // 查询用户订单
order.getOrderById(id)                  // 查询单个订单
order.getStats()                        // 统计报表

// 订单状态流转
PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
```

---

## 四、运行方式

### 方式 1: 编排 Demo（输出 spawn 指令）
```bash
cd ~/.openclaw/workspace/multi-agent-orchestration
node demo/demo-task.js "先调研方案，然后实现 demo"
```

### 方式 2: 整合 Demo Runner（编排 + 业务演示）
```bash
node demo-runner.js "先调研方案，然后实现 demo"
```

### 方式 3: 业务模块 Demo
```bash
node demo/combined-demo.js      # 组合演示
node demo/integrated-demo完整集成
```

---

## 五、验证结果

###.js    #  编排验证
```bash
$ node demo-runner.js "先调研方案，然后实现 demo"

✓ Task ID: task-1773587116828
✓ 模式: multi
✓ 复杂度: 5
✓ 需要多 Agent: true

[1] Web Researcher (task-1773587116828-web-researcher-1)
    Role: web-researcher
    Stage: discovery
```

### 业务 Demo 验证
```
✓ 注册用户: demo_user
✓ 用户登录: demo_user
✓ 创建订单: ORD-1773587116850-ruo0ivjex
✓ 订单状态: confirmed
```

---

## 六、扩展性说明

### 添加新的业务模块
1. 在 `demo/` 目录创建新模块（如 `payment-module.js`）
2. 在 `demo-runner.js` 添加模块检测逻辑
3. 更新 `DEMO.md` 文档

### 添加新的 Agent 角色
1. 编辑 `config/agent-pool.json` 添加角色定义
2. 编辑 `config/agent-mapping.json` 映射到真实 agentId
3. 重启编排系统使配置生效

---

## 七、已知问题

| 问题 | 影响 | 解决方案 |
|------|------|----------|
| 简单任务返回 undefined | 编排结果不完整 | 检查 dynamic-orchestrator 返回值 |
| 业务 Demo 无持久化 | 重启后数据丢失 | 可选：添加 SQLite 持久化 |

---

## 八、交付说明

### 验收标准 ✅
1. `node demo/demo-task.js` 输出有效的 JSON ✅
2. JSON 包含 `spawnInstructions` 数组，每个元素有 `label`, `roleId`, `spawnCall` ✅
3. `node demo-runner.js` 打印执行计划摘要并执行业务 Demo ✅

### 注意事项
- Demo 不调用实际的 sessions_spawn（需手动执行输出的指令）
- 使用预定义的 task 测试，不依赖外部 API
- 输出格式与 live-executor.js 保持一致
