#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getPaths() {
  const root = process.env.OPENCLAW_MULTI_AGENT_ROOT || __dirname;
  const tasksDir = path.join(root, 'tasks');
  const runtimeDir = path.join(root, 'runtime');
  const activeFile = path.join(runtimeDir, 'active-agents.json');
  return {
    ROOT: root,
    TASKS_DIR: tasksDir,
    TASK_ARCHIVE_DIR: path.join(tasksDir, 'archive'),
    RUNTIME_DIR: runtimeDir,
    RECOVERED_RESULTS_DIR: path.join(runtimeDir, 'recovered-results'),
    ACTIVE_FILE: activeFile,
    ACTIVE_ARCHIVE_DIR: path.join(runtimeDir, 'archive'),
    ACTIVE_LOCK: `${activeFile}.lock`
  };
}

// P0 Fix: file locking to prevent concurrent write races
function sleepMsAsync(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function acquireLockAsync(lockFile, maxWaitMs = 5000) {
  const start = Date.now();
  while (fs.existsSync(lockFile)) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error(`Failed to acquire lock on ${lockFile} after ${maxWaitMs}ms`);
    }
    try { fs.utimesSync(lockFile, new Date(), new Date()); } catch {}
    await sleepMsAsync(25);
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8');
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // OS-level sleep via busy-wait; other threads can run
  }
}

function acquireLock(lockFile, maxWaitMs = 5000) {
  const start = Date.now();
  while (fs.existsSync(lockFile)) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error(`Failed to acquire lock on ${lockFile} after ${maxWaitMs}ms`);
    }
    try { fs.utimesSync(lockFile, new Date(), new Date()); } catch {}
    sleepMs(25);
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8');
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile); } catch {}
}

function writeActiveAgentsSafe(data) {
  const { ACTIVE_FILE, ACTIVE_LOCK } = getPaths();
  acquireLock(ACTIVE_LOCK);
  try {
    writeJson(ACTIVE_FILE, data);
  } finally {
    releaseLock(ACTIVE_LOCK);
  }
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function parseDate(value) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function ageMinutes(value, nowMs) {
  const ts = parseDate(value);
  if (!ts) return Infinity;
  return Math.max(0, Math.floor((nowMs - ts) / 60000));
}

function inferLegacyIntent(task) {
  const text = String(task?.data?.task || task?.data?.plan?.task || '');
  const sessionId = String(task?.data?.context?.sessionId || '');
  const validationPattern = /demo|smoke|e2e|verify|validation|验证|测试|演练|试跑|压测/i;
  if (validationPattern.test(text) || validationPattern.test(sessionId)) {
    return 'validation';
  }
  return 'production';
}

function isLegacyIncompleteTask(task) {
  const text = String(task?.data?.task || '').trim();
  const planTask = String(task?.data?.plan?.task || '').trim();
  return text.length === 0 && planTask.length > 0;
}

function isRecoverableProductionTask(task) {
  const summary = task?.data?.summary;
  if (!summary || typeof summary !== 'object') return false;
  const total = Number(summary.totalCount || 0);
  const completed = Number(summary.completedCount || 0);
  const summaryStatus = String(summary.status || '');
  return total > 0 && completed < total && ['in_progress', 'waiting'].includes(summaryStatus);
}

function loadTaskFiles() {
  const { TASKS_DIR } = getPaths();
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(TASKS_DIR, file);
      return {
        file: fullPath,
        data: readJson(fullPath, {})
      };
    });
}

function shouldArchiveTask(task, agents, nowMs, options) {
  const status = task.data.status || 'unknown';
  const taskAge = ageMinutes(task.data.updatedAt || task.data.createdAt, nowMs);
  const createdAge = ageMinutes(task.data.createdAt || task.data.updatedAt, nowMs);
  const intent = task.data.intent || inferLegacyIntent(task);
  const activeStatuses = new Set(['spawning', 'waiting', 'running', 'allocated', 'planned', 'in_progress']);
  const terminalStatuses = new Set(['completed', 'failed', 'stalled', 'cancelled', 'single']);
  const validationStaleMinutes = options.validationStaleMinutes ?? Math.min(options.staleMinutes, 30);
  const validationArchiveMinutes = options.validationArchiveCompletedMinutes ?? Math.min(options.archiveCompletedMinutes, 15);
  const staleMinutes = intent === 'validation' ? validationStaleMinutes : options.staleMinutes;
  const archiveCompletedMinutes = intent === 'validation' ? validationArchiveMinutes : options.archiveCompletedMinutes;
  const productionArchiveGraceMinutes = options.productionArchiveGraceMinutes ?? Math.max(options.staleMinutes * 3, 240);

  if (isLegacyIncompleteTask(task) && taskAge >= validationArchiveMinutes) {
    task.data.status = terminalStatuses.has(status) ? status : 'stalled';
    task.data.updatedAt = new Date(nowMs).toISOString();
    task.data.cleanup = {
      archivedAt: new Date(nowMs).toISOString(),
      reason: 'task_legacy_incomplete_payload',
      inferredIntent: intent
    };
    return { archive: true, reason: 'task_legacy_incomplete_payload' };
  }

  if (intent === 'validation' && createdAge >= validationArchiveMinutes) {
    const sessionId = String(task?.data?.context?.sessionId || '');
    const validationSession = /demo|verify|validation|smoke|e2e/i.test(sessionId);
    if (validationSession) {
      task.data.status = terminalStatuses.has(status) ? status : 'stalled';
      task.data.updatedAt = new Date(nowMs).toISOString();
      task.data.cleanup = {
        archivedAt: new Date(nowMs).toISOString(),
        reason: 'task_validation_backlog_aged',
        inferredIntent: intent,
        sessionId
      };
      return { archive: true, reason: 'task_validation_backlog_aged' };
    }
  }

  if (agents.length === 0) {
    if (intent === 'production' && isRecoverableProductionTask(task) && taskAge < productionArchiveGraceMinutes) {
      return { archive: false };
    }
    if (terminalStatuses.has(status) && taskAge >= archiveCompletedMinutes) {
      return { archive: true, reason: `task_${status}_aged` };
    }
    if (activeStatuses.has(status) && taskAge >= staleMinutes) {
      task.data.status = 'stalled';
      task.data.updatedAt = new Date(nowMs).toISOString();
      task.data.cleanup = {
        archivedAt: new Date(nowMs).toISOString(),
        reason: 'task_missing_runtime_agents',
        inferredIntent: intent
      };
      return { archive: true, reason: 'task_missing_runtime_agents' };
    }
    return { archive: false };
  }

  const staleAgents = agents.filter((agent) => {
    const agentAge = ageMinutes(agent.updatedAt || agent.createdAt, nowMs);
    return ['spawning', 'waiting', 'running'].includes(agent.status) && agentAge >= staleMinutes;
  });
  const nonTerminalAgents = agents.filter((agent) => !terminalStatuses.has(agent.status));
  const orphanAgents = agents.filter((agent) => {
    const agentAge = ageMinutes(agent.updatedAt || agent.createdAt, nowMs);
    const hasSession = Boolean(agent.lastSessionFile || agent.sessionId || agent.result?.sessionFile);
    return ['spawning', 'waiting'].includes(agent.status) && !hasSession && agentAge >= options.orphanAllocationMinutes;
  });
  const allTerminal = agents.every((agent) => terminalStatuses.has(agent.status));

  if (allTerminal && taskAge >= archiveCompletedMinutes) {
    return { archive: true, reason: 'task_terminal_agents_aged' };
  }

  if (nonTerminalAgents.length > 0 && orphanAgents.length === nonTerminalAgents.length) {
    if (intent === 'production' && taskAge < productionArchiveGraceMinutes) {
      return { archive: false };
    }
    task.data.status = 'stalled';
    task.data.updatedAt = new Date(nowMs).toISOString();
    task.data.cleanup = {
      archivedAt: new Date(nowMs).toISOString(),
      reason: 'task_orphaned_allocations',
      inferredIntent: intent,
      orphanAgents: orphanAgents.map((agent) => agent.label || agent.workerId || agent.roleId)
    };
    return { archive: true, reason: 'task_orphaned_allocations' };
  }

  if (nonTerminalAgents.length > 0 && staleAgents.length === nonTerminalAgents.length) {
    if (intent === 'production' && taskAge < productionArchiveGraceMinutes) {
      return { archive: false };
    }
    task.data.status = 'stalled';
    task.data.updatedAt = new Date(nowMs).toISOString();
    task.data.cleanup = {
      archivedAt: new Date(nowMs).toISOString(),
      reason: 'task_non_terminal_agents_stale',
      inferredIntent: intent,
      staleAgents: staleAgents.map((agent) => agent.label || agent.workerId || agent.roleId)
    };
    return { archive: true, reason: 'task_non_terminal_agents_stale' };
  }

  return { archive: false };
}

function archiveTaskFile(task, reason, nowIso) {
  const { TASK_ARCHIVE_DIR } = getPaths();
  fs.mkdirSync(TASK_ARCHIVE_DIR, { recursive: true });
  const archivedName = path.basename(task.file).replace(/\.json$/, `.${nowIso.replace(/[:.]/g, '-')}.json`);
  const dest = path.join(TASK_ARCHIVE_DIR, archivedName);
  task.data.archivedAt = nowIso;
  task.data.archiveReason = reason;
  writeJson(dest, task.data);
  fs.unlinkSync(task.file);
  return dest;
}

function archiveActiveAgents(agents, taskId, nowIso) {
  const { ACTIVE_ARCHIVE_DIR } = getPaths();
  fs.mkdirSync(ACTIVE_ARCHIVE_DIR, { recursive: true });
  const dest = path.join(ACTIVE_ARCHIVE_DIR, `${taskId}.${nowIso.replace(/[:.]/g, '-')}.json`);
  writeJson(dest, agents);
  return dest;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function collectReferencedRecoveredArtifacts(activeAgents) {
  const referenced = new Set();
  for (const agent of activeAgents || []) {
    const refPath = agent?.result?.evidenceRef?.path;
    if (typeof refPath === 'string' && refPath.trim()) {
      referenced.add(path.resolve(refPath));
    }
  }
  return referenced;
}

function cleanupRecoveredResults(activeAgents, nowMs, settings) {
  const { RECOVERED_RESULTS_DIR } = getPaths();
  const referenced = collectReferencedRecoveredArtifacts(activeAgents);
  const files = walkFiles(RECOVERED_RESULTS_DIR);
  const removedFiles = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    if (referenced.has(resolved)) continue;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const ageMin = Math.max(0, Math.floor((nowMs - stat.mtimeMs) / 60000));
    if (ageMin < settings.recoveredResultsGraceMinutes) continue;
    try {
      fs.unlinkSync(file);
      removedFiles.push({ file, ageMinutes: ageMin });
    } catch {}
  }
  return {
    referencedCount: referenced.size,
    removedCount: removedFiles.length,
    removedFiles
  };
}

function cleanupRuntime(options = {}) {
  const { ACTIVE_FILE } = getPaths();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const settings = {
    staleMinutes: options.staleMinutes ?? 90,
    archiveCompletedMinutes: options.archiveCompletedMinutes ?? 30,
    orphanAllocationMinutes: options.orphanAllocationMinutes ?? 10,
    validationStaleMinutes: options.validationStaleMinutes ?? 30,
    validationArchiveCompletedMinutes: options.validationArchiveCompletedMinutes ?? 15,
    productionArchiveGraceMinutes: options.productionArchiveGraceMinutes ?? 240,
    recoveredResultsGraceMinutes: options.recoveredResultsGraceMinutes ?? (7 * 24 * 60)
  };

  const active = readJson(ACTIVE_FILE, []);
  const tasks = loadTaskFiles();
  const archiveTaskIds = new Set();
  const archivedTasks = [];
  const orphanRuntimeAgents = [];

  for (const task of tasks) {
    const taskId = task.data.id || path.basename(task.file, '.json');
    const agents = active.filter((agent) => agent.taskId === taskId);
    const decision = shouldArchiveTask(task, agents, nowMs, settings);
    if (!decision.archive) continue;
    const taskArchiveFile = archiveTaskFile(task, decision.reason, nowIso);
    const archivedAgents = agents.length > 0 ? archiveActiveAgents(agents, taskId, nowIso) : null;
    archivedTasks.push({
      taskId,
      reason: decision.reason,
      taskArchiveFile,
      activeArchiveFile: archivedAgents,
      agentCount: agents.length
    });
    archiveTaskIds.add(taskId);
  }

  const prunedAgents = [];
  const keptAgents = active.filter((agent) => {
    const missingTaskId = !agent.taskId;
    const agentAge = ageMinutes(agent.updatedAt || agent.createdAt, nowMs);
    const staleTasklessAgent = missingTaskId && agentAge >= settings.validationArchiveCompletedMinutes;
    if (staleTasklessAgent) {
      orphanRuntimeAgents.push({
        label: agent.label || agent.workerId || agent.roleId || 'unknown',
        reason: 'agent_missing_task_id',
        ageMinutes: agentAge
      });
      prunedAgents.push(agent.label || agent.workerId || agent.roleId || 'unknown');
      return false;
    }
    const remove = archiveTaskIds.has(agent.taskId);
    if (remove) {
      prunedAgents.push(agent.label || agent.workerId || agent.roleId || agent.taskId);
    }
    return !remove;
  });

  if (prunedAgents.length > 0 || keptAgents.length !== active.length) {
    writeActiveAgentsSafe( keptAgents);
  }

  const recoveredResults = cleanupRecoveredResults(keptAgents, nowMs, settings);

  return {
    cleanedAt: nowIso,
    staleMinutes: settings.staleMinutes,
    archiveCompletedMinutes: settings.archiveCompletedMinutes,
    orphanAllocationMinutes: settings.orphanAllocationMinutes,
    validationStaleMinutes: settings.validationStaleMinutes,
    validationArchiveCompletedMinutes: settings.validationArchiveCompletedMinutes,
    productionArchiveGraceMinutes: settings.productionArchiveGraceMinutes,
    recoveredResultsGraceMinutes: settings.recoveredResultsGraceMinutes,
    archivedTasks,
    orphanRuntimeAgents,
    recoveredResults,
    prunedAgentCount: prunedAgents.length,
    remainingAgents: keptAgents.length
  };
}

if (require.main === module) {
  console.log(JSON.stringify(cleanupRuntime(), null, 2));
}

module.exports = {
  cleanupRuntime,
  cleanupRecoveredResults,
  collectReferencedRecoveredArtifacts,
  getPaths
};
