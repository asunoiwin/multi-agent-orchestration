# 架构设计文档

## 任务背景
调研两个可行方案并产出架构设计，然后安排并行实现，再做安全与质量审查，最后整理交付说明

## 方案对比分析

### 方案A：配置驱动模式（当前实现）
基于JSON配置文件定义角色池和映射关系

**核心组件：**
- `agent-pool.json` - 定义9种角色（supervisor, solution-architect, web-researcher, code-implementer, quality-auditor, test-engineer, doc-synthesizer, data-analyst, os-operator）
- `agent-mapping.json` - 角色→真实agentId映射

**优点：**
- 轻量级，无需额外依赖
- 配置灵活，易于修改
- 快速迭代，无可视化开销

**限制：**
- 手工配置，维护成本随角色增加
- 缺乏运行时可视化
- 依赖文档和人工理解

### 方案B：可视化工作流引擎
集成现有编排系统，支持更细粒度的任务依赖和可视化监控

**核心组件：**
- 工作流状态机引擎
- 实时任务看板/监控面板
- 细粒度依赖图谱
- 可插拔的编排策略

**优点：**
- 可视化程度高，实时监控任务状态
- 支持复杂依赖关系和条件分支
- 便于调试和问题定位

**限制：**
- 需要引入额外依赖
- 学习曲线较陡
- 维护复杂度提升

## 架构设计决策

### 推荐采用：渐进式增强方案
保留方案A的配置驱动核心，逐步叠加可视化能力

**阶段一（当前）：** 纯配置驱动
- 优化agent-pool.json结构
- 增加配置验证

**阶段二：** 轻量级监控
- 添加运行时状态导出
- 集成到现有dashboard

**阶段三（可选）：** 可视化引擎
- 按需引入工作流引擎
- 支持复杂编排场景

## 工作拆分与并行策略

### Discovery阶段（已并行完成）
- web-researcher-1: 调研配置驱动方案
- web-researcher-2: 调研可视化方案

### Design阶段（当前）
- supervisor-1: 协调架构设计，产出最终决策
- solution-architect-1: 细化架构边界和接口

### Delivery阶段（待并行）
- code-implementer-1: 实现核心配置层增强
- code-implementer-2: 实现监控/导出能力

### Assurance阶段（待审计）
- quality-auditor-1: 安全与风险审查
- test-engineer-1: 接口与边界测试

### Documentation阶段
- doc-synthesizer-1: 交付文档整理

## 跨团队接口

| 阶段 | 输入 | 输出 | 依赖 |
|------|------|------|------|
| Discovery | 原始需求 | 方案对比报告 | - |
| Design | 方案报告 | 架构设计文档 | Discovery完成 |
| Delivery | 设计文档 | 可运行代码 | Design完成 |
| Assurance | 代码+设计 | 审计报告 | Delivery完成 |
| Handoff | 全部 | 交付说明 | Assurance完成 |

## 风险与约束
1. supervisor角色无exec权限，无法直接执行验证
2. 配置变更需要重启生效
3. 可视化方案需评估依赖引入成本
