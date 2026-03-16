#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rehydrateActiveTasks } = require('./supervisor-runner');
const {
  recoverAll,
  getLaunchableAgents,
  syncActiveAgentsFromSessions
} = require('./result-recovery');
const { cleanupRuntime } = require('./cleanup-runtime');
const ROOT = __dirname;
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'orchestration-watchdog-state.json');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function buildSpawnPayload(agent) {
  return {
    runtime: 'subagent',
    agentId: agent.agentId || 'main',
    model: agent.model || 'minimax',
    mode: agent.mode || 'run',
    label: agent.label,
    task: agent.prompt || agent.task,
    cleanup: agent.cleanup || 'delete',
    runTimeoutSeconds: agent.runTimeoutSeconds || 600,
    metadata: {
      taskId: agent.taskId || null,
      sessionId: agent.sessionId || null,
      workerId: agent.workerId || null,
      roleId: agent.roleId || null,
      teamId: agent.teamId || null,
      stage: agent.stage || null
    }
  };
}

function main() {
  const rehydration = rehydrateActiveTasks();
  const cleanup = cleanupRuntime();
  const sync = syncActiveAgentsFromSessions();
  const summaries = recoverAll();
  const nextAgents = getLaunchableAgents();
  const activeTasks = summaries.filter((task) => ['in_progress', 'waiting'].includes(task.status));
  const completedTasks = summaries.filter((task) => task.status === 'completed');
  const fingerprint = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      activeTasks: activeTasks.map((task) => [task.taskId, task.status, task.completedCount]),
      completedTasks: completedTasks.map((task) => [task.taskId, task.completedCount, task.totalCount]),
      nextAgents: nextAgents.map((agent) => [agent.taskId, agent.workerId, agent.label]),
    }))
    .digest('hex');
  const previous = readJson(STATE_FILE, {});
  const changed = previous.fingerprint !== fingerprint;

  writeJson(STATE_FILE, {
    fingerprint,
    updatedAt: new Date().toISOString()
  });

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    rehydration,
    cleanup,
    syncChanged: sync.changed,
    fingerprint,
    changed,
    counts: {
      activeTasks: activeTasks.length,
      completedTasks: completedTasks.length,
      nextAgents: nextAgents.length
    },
    nextAgents: nextAgents.map((agent) => ({
      label: agent.label,
      workerId: agent.workerId || null,
      roleId: agent.roleId || null,
      taskId: agent.taskId || null,
      stage: agent.stage || null,
      teamId: agent.teamId || null,
      spawnPayload: buildSpawnPayload(agent)
    })),
    completedTasks: completedTasks.map((task) => ({
      taskId: task.taskId,
      totalCount: task.totalCount,
      completedCount: task.completedCount
    })),
    shouldNotify: nextAgents.length > 0 || (changed && (sync.changed > 0 || completedTasks.length > 0))
  }, null, 2));
}

if (require.main === module) {
  main();
}

/**
 * Health check - detect abnormal states
 * @param {Array} agents - Agent list (optional, defaults to active-agents.json)
 * @returns {Object} { healthy: boolean, issues: Issue[], checkedAt }
 */
function healthCheck(agents = null) {
  const stabilityConfig = readJson(path.join(ROOT, 'config', 'stability.json'), {
    health: { 
      zombieTimeoutMs: 300000, 
      maxRunningTimeMs: 3600000,
      checkIntervalMs: 60000
    }
  });
  
  const active = agents || readJson(ACTIVE_FILE, []);
  const issues = [];
  
  const zombieTimeout = stabilityConfig.health?.zombieTimeoutMs || 300000;
  const maxRunningTime = stabilityConfig.health?.maxRunningTimeMs || 3600000;
  
  for (const agent of active) {
    // Check for zombie agents (running but no session)
    if (agent.status === 'running') {
      const hasSession = agent.sessionId || agent.lastSessionFile;
      if (!hasSession) {
        issues.push({
          type: 'zombie',
          agent: agent.label,
          workerId: agent.workerId,
          taskId: agent.taskId,
          message: 'Agent marked running but has no session evidence',
          severity: 'high'
        });
      }
      
      // Check for timeout
      const ageMs = Date.now() - Date.parse(agent.updatedAt || agent.createdAt || 0);
      if (ageMs > maxRunningTime) {
        issues.push({
          type: 'timeout',
          agent: agent.label,
          workerId: agent.workerId,
          taskId: agent.taskId,
          message: `Agent running for ${Math.round(ageMs/60000)}min exceeds max ${Math.round(maxRunningTime/60000)}min`,
          severity: 'high'
        });
      }
    }
    
    // Check for broken dependencies
    if (agent.dependsOn && Array.isArray(agent.dependsOn)) {
      for (const depId of agent.dependsOn) {
        const depExists = active.some(a => 
          a.taskId === agent.taskId &&
          (a.workerId === depId || a.roleId === depId || a.label === depId)
        );
        if (!depExists) {
          issues.push({
            type: 'broken_dependency',
            agent: agent.label,
            workerId: agent.workerId,
            taskId: agent.taskId,
            missingDependency: depId,
            message: `Missing dependency: ${depId}`,
            severity: 'medium'
          });
        }
      }
    }
  }
  
  return {
    healthy: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString()
  };
}

/**
 * Auto-heal - fix detected issues
 * @param {Array} issues - Issues from healthCheck
 * @returns {Array} [{ agent, action, success }]
 */
function autoHeal(issues) {
  const stabilityConfig = readJson(path.join(ROOT, 'config', 'stability.json'), {
    health: { autoHealEnabled: true, alertOnFailure: true }
  });
  
  if (!stabilityConfig.health?.autoHealEnabled) {
    return [];
  }
  
  const active = readJson(ACTIVE_FILE, []);
  const results = [];
  
  for (const issue of issues) {
    const agent = active.find(a => a.label === issue.agent);
    if (!agent) continue;
    
    let action = null;
    let success = false;
    
    if (issue.type === 'zombie') {
      // Try to recover from session evidence
      const { findSessionEvidence } = require('./result-recovery');
      const evidence = findSessionEvidence();
      const key = `${agent.taskId}::${agent.workerId}`;
      const found = evidence.get(key);
      
      if (found) {
        agent.sessionId = found.sessionId;
        agent.lastSessionFile = found.file;
        agent.status = found.summary ? 'completed' : 'spawning';
        agent.updatedAt = new Date().toISOString();
        action = 'recovered_from_evidence';
        success = true;
      } else {
        // Mark as failed
        agent.status = 'failed';
        agent.result = { ...agent.result, healReason: 'zombie_timeout' };
        agent.updatedAt = new Date().toISOString();
        action = 'marked_failed';
        success = true;
      }
    } else if (issue.type === 'timeout') {
      // Mark as failed to unblock dependents
      agent.status = 'failed';
      agent.result = { ...agent.result, healReason: 'running_timeout' };
      agent.updatedAt = new Date().toISOString();
      action = 'marked_failed';
      success = true;
    } else if (issue.type === 'broken_dependency') {
      // Remove invalid dependency
      if (agent.dependsOn) {
        agent.dependsOn = agent.dependsOn.filter(d => d !== issue.missingDependency);
        agent.updatedAt = new Date().toISOString();
        action = 'removed_broken_dependency';
        success = true;
      }
    }
    
    if (action) {
      results.push({ agent: agent.label, action, success });
    }
  }
  
  if (results.length > 0) {
    writeJson(ACTIVE_FILE, active);
  }
  
  return results;
}

module.exports = {
  main,
  buildSpawnPayload,
  healthCheck,
  autoHeal
};
