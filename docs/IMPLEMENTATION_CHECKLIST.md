# Stability Recovery - Implementation Checklist

## For code-implementer

### Phase 1: State Recovery Enhancement (P0)

- [x] `enhancedRecovery(agent, config)` - 三层降级恢复
- [x] `validateAgentState(agent)` - 状态一致性校验  
- [x] `persistWithSnapshot(agent, reason, retention)` - 快照持久化

### Phase 2: Stage Advance Enhancement (P1)

- [x] `deterministicAdvance(config)` - 确定性阶段推进
- [x] `checkDependencyWithTimeout(agent, activeAgents, timeoutMs)` - 超时依赖检测
- [x] `triggerNextStage(taskId, currentStage)` - 阶段触发

### Phase 3: Result Recovery Enhancement (P1)

- [x] `multiStrategyParse(text)` - 多策略解析
- [x] `handleTruncatedOutput(text)` - 截断容错
- [x] `aggregateResults(taskId)` - 带置信度聚合
- [x] `calculateConfidence(agent)` - 置信度计算

### Phase 4: Health Check & Self-Healing (P2)

- [x] `healthCheck(agents)` - 健康检查
- [x] `autoHeal(issues)` - 自动修复

## For quality-auditor

- [ ] Verify unit tests for each new function
- [ ] Run integration tests
- [ ] Validate confidence algorithm
- [ ] Test edge cases (truncated output, missing dependencies)
