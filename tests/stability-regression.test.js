#!/usr/bin/env node
const assert = require('assert');

const resultRecovery = require('../result-recovery.js');
const supervisorRunner = require('../supervisor-runner.js');
const watchdog = require('../orchestration-watchdog.js');

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
  assert.deepStrictEqual(keys, ['autoHeal', 'buildSpawnPayload', 'healthCheck', 'main']);
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

function run() {
  testMultiStrategyParse();
  testHandleTruncatedOutput();
  testDeterministicAdvanceNoCrash();
  testWatchdogExports();
  testConfidenceDistribution();
  console.log('stability regression tests passed');
}

run();
