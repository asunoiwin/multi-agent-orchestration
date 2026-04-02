#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const resultRecovery = require('../result-recovery.js');
const supervisorRunner = require('../supervisor-runner.js');
const watchdog = require('../orchestration-watchdog.js');
const cleanupRuntimeModule = require('../cleanup-runtime.js');
const { planTask } = require('../dynamic-orchestrator.js');
const taskIntake = require('../task-intake.js');
const { shouldUseMeeting } = require('../modules/deliberation-engine.js');
const { getRoleProfile, getResourceBudget } = require('../modules/reputation-engine.js');
const { buildIntelligencePlan, hasSocialIntent } = require('../modules/social-intel-engine.js');

function testMultiStrategyParse() {
  const inline = resultRecovery.multiStrategyParse('prefix {"taskId":"inline-test","status":"completed"} suffix');
  assert.ok(inline, 'inline JSON should parse');
  assert.strictEqual(inline.taskId, 'inline-test');
  assert.strictEqual(inline.status, 'completed');

  const noisy = resultRecovery.multiStrategyParse('The status is completed and taskId is keyword-test');
  assert.strictEqual(noisy, null, 'free-form prose should not be parsed as structured result');
}

function testHandleTruncatedOutput() {
  const recovered = resultRecovery.handleTruncatedOutput('{"taskId":"test","status":"completed"');
  assert.ok(recovered, 'truncated payload should recover');
  assert.strictEqual(recovered.taskId, 'test');
  assert.strictEqual(recovered.status, 'completed');
}

function testDeterministicAdvanceNoCrash() {
  const result = supervisorRunner.deterministicAdvance({
    advance: {
      autoAdvanceEnabled: true,
      dependencyTimeoutMs: 1
    }
  });
  assert.ok(result && typeof result === 'object', 'deterministicAdvance should return an object');
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'advanced'));
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'triggered'));
}

function testWatchdogExports() {
  const keys = Object.keys(watchdog).sort();
  ['autoHeal', 'buildSpawnPayload', 'healthCheck', 'main'].forEach((key) => {
    assert.ok(keys.includes(key), `watchdog exports should include ${key}`);
  });
}

function testConfidenceDistribution() {
  const high = resultRecovery.calculateConfidence({
    status: 'completed',
    lastSessionFile: '/tmp/session.jsonl',
    result: {
      structuredCompletion: { taskId: 't', status: 'completed' },
      summary: 'A'.repeat(240)
    }
  });
  const low = resultRecovery.calculateConfidence({ status: 'running' });
  const failed = resultRecovery.calculateConfidence({ status: 'failed' });

  assert.ok(high >= 0.7, `expected high confidence >= 0.7, got ${high}`);
  assert.ok(low <= 0.3, `expected low confidence <= 0.3, got ${low}`);
  assert.ok(failed <= 0.2, `expected failed confidence <= 0.2, got ${failed}`);
}

function testMeetingPlanGeneration() {
  const plan = planTask('请先组织多角色讨论比较稳定性、成本和维护性，再制定方案并安排实现与审查。');
  assert.ok(plan.meetingPlan, 'meeting plan should exist');
  assert.strictEqual(plan.meetingPlan.enabled, true, 'meeting plan should be enabled for deliberative task');
  assert.ok(Array.isArray(plan.meetingPlan.participants) && plan.meetingPlan.participants.length >= 3);
}

function testMeetingTriggerHeuristic() {
  const analysis = {
    score: 9,
    uncertainty: 2,
    risk: 2,
    domains: 2,
    structure: 2
  };
  assert.strictEqual(shouldUseMeeting(analysis, { needsMultiAgent: true }), true);
  assert.strictEqual(shouldUseMeeting({ score: 3 }, { needsMultiAgent: false }), false);
  assert.strictEqual(
    shouldUseMeeting({ score: 4, uncertainty: 0, risk: 0, domains: 1, structure: 1 }, { needsMultiAgent: true }, undefined, '请先讨论约束、候选方案、风险与推荐方案'),
    true
  );
}

function testReputationBudget() {
  const profile = getRoleProfile('solution-architect', { lifecycle: 'ephemeral' });
  const budget = getResourceBudget('solution-architect', 'planning', { lifecycle: 'ephemeral' });
  assert.ok(profile.score >= 0 && profile.score <= 100, 'profile score should be normalized');
  assert.ok(['trusted', 'standard', 'guarded', 'cooldown'].includes(profile.tier), `unexpected tier ${profile.tier}`);
  assert.ok(budget.promptTokens > 0, 'prompt budget should be positive');
}

function testPromptContainsMeetingAndBudget() {
  const taskContext = {
    id: 'task-meeting',
    task: '为复杂系统制定方案并执行',
    context: {
      sessionId: 'session-meeting',
      taskRoot: '/tmp'
    },
    plan: {
      task: '为复杂系统制定方案并执行',
      executionMode: 'hybrid',
      collaborationModel: 'company',
      selectedRoles: [],
      staffingPlan: [],
      teams: [],
      syncPlan: [],
      intelligencePlan: {
        enabled: true,
        mode: 'multi-source-social-intel',
        platforms: ['weibo', 'douyin', 'xiaohongshu'],
        routes: [
          { platform: 'weibo', preferredMode: 'api', fallbackMode: 'browser' },
          { platform: 'douyin', preferredMode: 'browser', fallbackMode: 'browser' }
        ],
        outputs: ['source_inventory', 'meeting_brief'],
        rationale: '需要补充社媒情报'
      },
      meetingPlan: {
        enabled: true,
        mode: 'structured_panel',
        rounds: 2,
        participants: [
          { seat: 'moderator', roleId: 'solution-architect', workerId: 'solution-architect-1' },
          { seat: 'challenger', roleId: 'quality-auditor', workerId: 'quality-auditor-1' },
          { seat: 'executor', roleId: 'code-implementer', workerId: 'code-implementer-1' }
        ],
        agenda: ['定义问题', '比较方案'],
        outputs: ['recommendation'],
        stopConditions: ['达到最大轮次'],
        consensus: { method: 'weighted-consensus' }
      }
    },
    summary: { agents: [] }
  };
  const subtask = {
    workerId: 'solution-architect-1',
    roleId: 'solution-architect',
    title: 'Solution Architect',
    teamId: 'design-planning-team',
    stage: 'design',
    capability: 'planning',
    description: '沉淀方案',
    skills: ['analysis'],
    deny: [],
    memory: { scope: 'task', items: ['decisions'] },
    coworkers: [],
    collaborationMode: 'design-review',
    reputation: { score: 86, tier: 'trusted', priorityWeight: 1.2 },
    resourceBudget: { promptTokens: 3200, contextItems: 8, maxRounds: 3, persistAcrossStages: true }
  };
  const prompt = supervisorRunner.buildAgentPrompt(subtask, taskContext);
  assert.ok(prompt.includes('## Deliberation'), 'prompt should include deliberation section');
  assert.ok(prompt.includes('Meeting Mode: structured_panel'), 'prompt should include meeting mode');
  assert.ok(prompt.includes('## Intelligence'), 'prompt should include intelligence section');
  assert.ok(prompt.includes('Platforms: weibo, douyin, xiaohongshu'), 'prompt should include platform routes');
  assert.ok(prompt.includes('## Reputation And Budget'), 'prompt should include budget section');
}

function testSocialIntelRouting() {
  assert.strictEqual(hasSocialIntent('请先分析微博、抖音和小红书关于 OpenClaw 的讨论热度'), true);
  const plan = buildIntelligencePlan(
    '请汇总微博、抖音和小红书关于 OpenClaw 的讨论热度与评论趋势',
    { socialIntel: true },
    { domains: 3 }
  );
  assert.strictEqual(plan.enabled, true, 'intelligence plan should be enabled');
  assert.ok(plan.platforms.includes('weibo'), 'weibo should be included');
  assert.ok(plan.routes.some((route) => route.platform === 'weibo' && route.preferredMode === 'api'));
  assert.ok(plan.routes.some((route) => route.platform === 'douyin' && route.preferredMode === 'browser'));
  assert.ok(Array.isArray(plan.collectionPlan) && plan.collectionPlan.length >= 3, 'collection plan should be present');
  assert.ok(Array.isArray(plan.evidenceSchema) && plan.evidenceSchema.includes('url'), 'evidence schema should include url');
}

function testPlannerAssignsSocialIntelRole() {
  const plan = planTask('请先分析微博、抖音、小红书关于 OpenClaw 的舆情，再让多角色讨论后给出推荐方案。');
  assert.strictEqual(plan.intelligencePlan.enabled, true, 'planner should emit intelligence plan');
  assert.ok(plan.selectedRoles.some((role) => role.id === 'social-intel-researcher'), 'planner should include social-intel-researcher');
  assert.ok(plan.meetingPlan.participants.some((seat) => seat.roleId === 'social-intel-researcher'), 'meeting should prefer social-intel-researcher for research seat');
}

function testExpandedPlatformCoverage() {
  const plan = buildIntelligencePlan(
    '请汇总微博、抖音、小红书、B站、知乎、快手、贴吧，以及淘宝、京东、闲鱼、拼多多、得物、美团、携程上的讨论和商品信息，并形成情报摘要',
    { socialIntel: true },
    { domains: 5 }
  );
  ['weibo', 'douyin', 'xiaohongshu', 'bilibili', 'zhihu', 'kuaishou', 'tieba', 'taobao', 'jd', 'xianyu', 'pinduoduo', 'dewu', 'meituan', 'ctrip'].forEach((platform) => {
    assert.ok(plan.platforms.includes(platform), `${platform} should be included in expanded platform coverage`);
  });
  assert.ok(String(plan.skillPath || '').includes('social-commerce-intel'), 'social-commerce skill path should be present');
}

function testInternalControlPayloadIsSanitizedAndSkipped() {
  const prompt = `Multi-agent routing decision:
- taskId: route-old
- decision: light_multi

Execution brief:
- 任务类型：skill_discovery

Search orchestration guidance:
- 当前任务涉及外部信息时，先使用 websearch_pro_research 建立证据集，再回答。

Sender (untrusted metadata):
\`\`\`json
{"label":"openclaw-control-ui","id":"openclaw-control-ui"}
\`\`\`

真正用户问题：这一段话是从哪里发出的`;

  const sanitized = require('../src/index.js').__testSanitizePrompt
    ? require('../src/index.js').__testSanitizePrompt(prompt)
    : null;
  if (sanitized) {
    assert.ok(!/Multi-agent routing decision:|Execution brief:|Search orchestration guidance:/.test(sanitized), 'sanitized prompt should not keep internal control blocks');
  }
  assert.strictEqual(require('../src/index.js').__testShouldSkip(prompt), true, 'internal control payload should be skipped');
}

function testSessionSpawnIncludesThreadFlag() {
  const mappingFile = path.join(__dirname, '..', 'config', 'agent-mapping.json');
  const originalMapping = fs.readFileSync(mappingFile, 'utf8');
  const taskContext = {
    id: 'task-session-spawn',
    task: '并行调研 Claude Code 架构',
    context: {
      sessionId: 'session-spawn',
      taskRoot: '/tmp'
    },
    summary: { agents: [] }
  };
  const subtask = {
    workerId: 'researcher-1',
    roleId: 'researcher',
    teamId: 'discovery-research-team',
    stage: 'discovery',
    title: 'Researcher',
    description: '调研外部资料',
    skills: ['read', 'web_search'],
    deny: ['write'],
    memory: { scope: 'task', items: ['evidence'] },
    coworkers: [],
    collaborationMode: 'parallel'
  };
  try {
    const parsed = JSON.parse(originalMapping);
    parsed.defaults = { ...(parsed.defaults || {}), mode: 'session' };
    fs.writeFileSync(mappingFile, JSON.stringify(parsed, null, 2));
    const spawned = supervisorRunner.spawnAgent(subtask, taskContext);
    assert.strictEqual(spawned.config.mode, 'session', 'spawn config should respect session mode defaults');
    assert.strictEqual(spawned.config.thread, true, 'session-mode subagents must set thread=true');
  } finally {
    fs.writeFileSync(mappingFile, originalMapping);
  }
}

function testTaskIntakeRejectsInternalControlPayload() {
  const controlTask = `System: [2026-04-02 16:04:28 GMT+8] Gateway restart restart ok (gateway.restart)
Read HEARTBEAT.md if it exists`;
  assert.strictEqual(taskIntake.isInternalControlTask(controlTask, {}), true, 'control payload should be classified as internal');
  assert.strictEqual(taskIntake.enqueue(controlTask, 'manual', {}), null, 'control payload should not create a task');
}

function testMalformedFencedJsonStopsFallbackParsing() {
  const malformed = [
    '任务结果如下：',
    '```json',
    '{"taskId":"task-1","workerId":"worker-1","status":"completed"',
    '```',
    '另外普通文本里还出现了 status=completed taskId=task-1 workerId=worker-1'
  ].join('\n');
  const completion = resultRecovery.extractStructuredCompletion(malformed);
  assert.ok(completion, 'malformed fenced json should still produce a protocol result');
  assert.strictEqual(completion._protocolViolation, 'malformed-json-block');
  assert.strictEqual(completion.status, 'protocol_violation');
  assert.strictEqual(completion.taskId, null, 'protocol violation must not fall through to keyword extraction');
  const confidence = resultRecovery.calculateConfidence({
    status: 'completed',
    result: { structuredCompletion: completion, summary: malformed },
  });
  assert.ok(confidence <= 0.2, `protocol violations should remain low confidence, got ${confidence}`);
  const recovered = resultRecovery.buildRecoveredResult({
    taskId: 'task-1',
    workerId: 'worker-1',
    roleId: 'researcher',
    result: null
  }, {
    taskId: 'task-1',
    workerId: 'worker-1',
    roleId: 'researcher',
    file: '/tmp/session-protocol.jsonl',
    updatedAt: '2026-04-02T00:00:00.000Z',
    summary: {
      text: malformed,
      rawText: malformed,
      stopReason: 'stop',
      timestamp: '2026-04-02T00:00:00.000Z'
    },
    completion
  });
  assert.strictEqual(recovered.structuredCompletion._protocolViolation, 'malformed-json-block', 'normalized completion must retain protocol violation markers');
}

function testRuntimeStatusReadsLatestTaskBrief() {
  const plugin = require('../src/index.js');
  const runtimeDir = path.join(process.env.HOME, '.openclaw', 'workspace', '.openclaw');
  const briefDir = path.join(path.dirname(__dirname), 'runtime', 'task-briefs');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(briefDir, { recursive: true });
  const routingBackup = fs.existsSync(path.join(runtimeDir, 'multi-agent-routing.json'))
    ? fs.readFileSync(path.join(runtimeDir, 'multi-agent-routing.json'), 'utf8')
    : null;
  const briefPath = path.join(briefDir, 'task-brief-test.json');
  const briefPayload = {
    taskId: 'task-brief-test',
    task: '生成多 agent 任务摘要',
    executionMode: 'hybrid',
    collaborationModel: 'company',
    selectedRoles: [{ id: 'solution-architect' }],
    teams: [{ id: 'team-1' }]
  };
  try {
    fs.writeFileSync(path.join(runtimeDir, 'multi-agent-routing.json'), JSON.stringify({ taskId: 'task-brief-test', artifactRefs: [] }, null, 2));
    fs.writeFileSync(briefPath, JSON.stringify(briefPayload, null, 2));
    const status = plugin.getCurrentRuntimeStatus();
    assert.strictEqual(status.taskId, 'task-brief-test');
    assert.strictEqual(status.brief.task, '生成多 agent 任务摘要');
    assert.strictEqual(status.briefPath, briefPath);
  } finally {
    if (routingBackup == null) {
      try { fs.unlinkSync(path.join(runtimeDir, 'multi-agent-routing.json')); } catch {}
    } else {
      fs.writeFileSync(path.join(runtimeDir, 'multi-agent-routing.json'), routingBackup);
    }
    try { fs.unlinkSync(briefPath); } catch {}
  }
}

function testRecoveredResultsUseArtifactReferences() {
  const longSummary = `任务总结\n${'A'.repeat(2200)}`;
  const agent = {
    taskId: 'task-artifact-ref',
    workerId: 'worker-artifact-ref',
    roleId: 'researcher',
    result: null
  };
  const artifactPath = resultRecovery.getRecoveredArtifactPath(agent.taskId, agent.workerId);
  try { fs.unlinkSync(artifactPath); } catch {}
  const recovered = resultRecovery.buildRecoveredResult(agent, {
    taskId: agent.taskId,
    workerId: agent.workerId,
    roleId: agent.roleId,
    file: '/tmp/session-artifact.jsonl',
    updatedAt: '2026-04-01T00:00:00.000Z',
    summary: {
      text: longSummary,
      rawText: longSummary,
      stopReason: 'stop',
      timestamp: '2026-04-01T00:00:00.000Z'
    },
    completion: {
      taskId: agent.taskId,
      workerId: agent.workerId,
      status: 'completed',
      summary: '完成恢复',
      artifacts: [{ path: '/tmp/report.md', type: 'report' }],
      handoff: { nextOwner: 'reviewer' }
    }
  });

  assert.ok(recovered.evidenceRef && recovered.evidenceRef.path === artifactPath, 'result should point at artifact file');
  assert.ok(fs.existsSync(artifactPath), 'artifact file should be written');
  assert.ok(recovered.summary.length < longSummary.length, 'active result summary should stay lightweight');
  assert.ok(Array.isArray(recovered.artifacts) && recovered.artifacts.length === 1, 'normalized artifacts should be retained');

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.strictEqual(artifact.summary.rawText, longSummary, 'artifact should preserve full raw summary');
  assert.strictEqual(artifact.normalized.handoff.nextOwner, 'reviewer', 'artifact should preserve handoff payload');
} 

function testCleanupRuntimePrunesUnreferencedRecoveredArtifacts() {
  const tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'openclaw-cleanup-'));
  process.env.OPENCLAW_MULTI_AGENT_ROOT = tempRoot;
  try {
    const runtimeDir = path.join(tempRoot, 'runtime');
    const recoveredDir = path.join(runtimeDir, 'recovered-results', 'task-cleanup');
    fs.mkdirSync(recoveredDir, { recursive: true });
    const kept = path.join(recoveredDir, 'kept.json');
    const stale = path.join(recoveredDir, 'stale.json');
    fs.writeFileSync(kept, JSON.stringify({ kept: true }));
    fs.writeFileSync(stale, JSON.stringify({ stale: true }));
    const old = new Date(Date.now() - (9 * 24 * 60 * 60 * 1000));
    fs.utimesSync(stale, old, old);
    fs.writeFileSync(path.join(runtimeDir, 'active-agents.json'), JSON.stringify([
      {
        taskId: 'task-cleanup',
        result: {
          evidenceRef: { path: kept }
        }
      }
    ], null, 2));
    fs.mkdirSync(path.join(tempRoot, 'tasks'), { recursive: true });
    const result = cleanupRuntimeModule.cleanupRuntime({ recoveredResultsGraceMinutes: 7 * 24 * 60 });
    assert.ok(fs.existsSync(kept), 'referenced recovered artifact should be kept');
    assert.ok(!fs.existsSync(stale), 'unreferenced stale recovered artifact should be removed');
    assert.strictEqual(result.recoveredResults.removedCount, 1);
  } finally {
    delete process.env.OPENCLAW_MULTI_AGENT_ROOT;
  }
}

function run() {
  testMultiStrategyParse();
  testHandleTruncatedOutput();
  testDeterministicAdvanceNoCrash();
  testWatchdogExports();
  testConfidenceDistribution();
  testMeetingPlanGeneration();
  testMeetingTriggerHeuristic();
  testReputationBudget();
  testPromptContainsMeetingAndBudget();
  testSocialIntelRouting();
testPlannerAssignsSocialIntelRole();
testExpandedPlatformCoverage();
testInternalControlPayloadIsSanitizedAndSkipped();
testSessionSpawnIncludesThreadFlag();
testTaskIntakeRejectsInternalControlPayload();
  testMalformedFencedJsonStopsFallbackParsing();
  testRuntimeStatusReadsLatestTaskBrief();
  testRecoveredResultsUseArtifactReferences();
  testCleanupRuntimePrunesUnreferencedRecoveredArtifacts();
  console.log('stability regression tests passed');
}

run();
