#!/usr/bin/env node
const assert = require('assert');

const resultRecovery = require('../result-recovery.js');
const supervisorRunner = require('../supervisor-runner.js');
const watchdog = require('../orchestration-watchdog.js');
const { planTask } = require('../dynamic-orchestrator.js');
const { shouldUseMeeting } = require('../modules/deliberation-engine.js');
const { getRoleProfile, getResourceBudget } = require('../modules/reputation-engine.js');

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
  assert.ok(prompt.includes('## Reputation And Budget'), 'prompt should include budget section');
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
  console.log('stability regression tests passed');
}

run();
