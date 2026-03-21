#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TASKS_DIR = path.join(ROOT, 'tasks');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');
const AGENTS_ROOT = path.join(process.env.HOME || '', '.openclaw', 'agents');
const MAPPING_FILE = path.join(ROOT, 'config', 'agent-mapping.json');
const { buildAgentPrompt } = require('./supervisor-runner');
const { scoreRole, getRoleProfile, getResourceBudget } = require('./modules/reputation-engine');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getRoleMapping() {
  return readJson(MAPPING_FILE, { mapping: {}, defaults: {} });
}

function resolveAgentConfig(roleId) {
  const mapping = getRoleMapping();
  return {
    ...mapping.defaults,
    ...(mapping.mapping?.[roleId] || {})
  };
}

function normalizeTaskSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return { subtasks: [], changed: false };
  let changed = false;
  const deliveryWorkers = subtasks
    .filter((subtask) => subtask?.stage === 'delivery' && subtask?.capability !== 'documentation')
    .map((subtask) => subtask.workerId);
  const assuranceWorkers = subtasks
    .filter((subtask) => subtask?.stage === 'assurance')
    .map((subtask) => subtask.workerId);

  const normalized = subtasks.map((subtask) => {
    if (!subtask || !Array.isArray(subtask.dependsOn)) return subtask;
    let nextDependsOn = subtask.dependsOn.slice();

    if (subtask.stage === 'assurance') {
      const filtered = nextDependsOn.filter((workerId) => {
        const dep = subtasks.find((item) => item.workerId === workerId);
        return dep?.capability !== 'documentation';
      });
      if (filtered.length !== nextDependsOn.length) {
        nextDependsOn = filtered;
      }
      for (const workerId of deliveryWorkers) {
        if (!nextDependsOn.includes(workerId)) {
          nextDependsOn.push(workerId);
        }
      }
    }

    if (subtask.capability === 'documentation') {
      nextDependsOn = [
        ...subtasks.filter((item) => item.stage === 'design').map((item) => item.workerId),
        ...deliveryWorkers,
        ...assuranceWorkers
      ].filter((workerId) => workerId !== subtask.workerId);
    }

    if (JSON.stringify(nextDependsOn) !== JSON.stringify(subtask.dependsOn)) {
      changed = true;
      return { ...subtask, dependsOn: nextDependsOn };
    }
    return subtask;
  });

  return { subtasks: normalized, changed };
}

function normalizeTaskData(taskData) {
  if (!taskData?.plan) return { data: taskData, changed: false };
  const subtasks = taskData.plan.subtasks || taskData.subtasks;
  if (!Array.isArray(subtasks)) return { data: taskData, changed: false };
  const normalized = normalizeTaskSubtasks(subtasks);
  if (!normalized.changed) return { data: taskData, changed: false };

  const next = {
    ...taskData,
    updatedAt: new Date().toISOString(),
    plan: {
      ...taskData.plan,
      subtasks: normalized.subtasks
    }
  };
  if (Array.isArray(taskData.subtasks)) {
    next.subtasks = normalized.subtasks;
  }
  return { data: next, changed: true };
}

function walkSessionFiles() {
  if (!fs.existsSync(AGENTS_ROOT)) return [];
  const files = [];
  for (const agentId of fs.readdirSync(AGENTS_ROOT)) {
    const sessionsDir = path.join(AGENTS_ROOT, agentId, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;
    for (const file of fs.readdirSync(sessionsDir)) {
      // Include deleted sessions as recovery evidence. Completed subagent runs are
      // often renamed to `.deleted.*` immediately after exit.
      if (file.endsWith('.jsonl') || file.includes('.jsonl.deleted.')) {
        files.push(path.join(sessionsDir, file));
      }
    }
  }
  return files;
}

function parseJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function parseTaskContext(text) {
  if (!text) return null;
  const taskId = text.match(/Task ID:\s*([^\n]+)/i)?.[1]?.trim();
  const workerId = text.match(/Worker ID:\s*([^\n]+)/i)?.[1]?.trim();
  const roleId = text.match(/Your Role:\s*([^\n]+)/i)?.[1]?.trim();
  const sessionId = text.match(/Session ID:\s*([^\n]+)/i)?.[1]?.trim();
  if (!taskId || !workerId) return null;
  return {
    taskId,
    workerId,
    roleId: roleId || null,
    sessionId: sessionId || null
  };
}

function extractAssistantSummary(entries) {
  const assistantMessages = entries.filter((entry) => entry?.type === 'message' && entry.message?.role === 'assistant');
  for (let idx = assistantMessages.length - 1; idx >= 0; idx -= 1) {
    const text = extractText(assistantMessages[idx]?.message?.content).trim();
    if (text) {
      return {
        rawText: text,
        text: text.slice(0, 4000),
        timestamp: assistantMessages[idx].timestamp || null,
        stopReason: assistantMessages[idx].message?.stopReason || null
      };
    }
  }
  return null;
}

function extractStructuredCompletion(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (let idx = matches.length - 1; idx >= 0; idx -= 1) {
    const raw = matches[idx][1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.taskId && parsed.workerId) {
        return parsed;
      }
    } catch {
      // Ignore malformed blocks and keep scanning older ones.
    }
  }
  return null;
}

function getEvidenceScore(summary, completion) {
  let score = 0;
  if (summary?.text) score += 10;
  if (completion) score += 100;
  if (/<final>|任务总结|交付|完成|verified|done/i.test(summary?.text || '')) {
    score += 20;
  }
  return score;
}

function collectSessionEvidence() {
  const best = new Map();
  const latest = new Map();
  for (const file of walkSessionFiles()) {
    const entries = parseJsonl(file);
    if (entries.length === 0) continue;
    const userMessage = entries.find((entry) => entry?.type === 'message' && entry.message?.role === 'user');
    const text = extractText(userMessage?.message?.content);
    const context = parseTaskContext(text);
    if (!context) continue;

    const summary = extractAssistantSummary(entries);
    const updatedAt = summary?.timestamp || entries[entries.length - 1]?.timestamp || null;
    const key = `${context.taskId}::${context.workerId}`;
    const completion = extractStructuredCompletion(summary?.rawText || summary?.text || '');
    const candidate = {
      ...context,
      file,
      updatedAt,
      summary,
      completion
    };

    const latestCurrent = latest.get(key);
    if (!latestCurrent || (updatedAt && (!latestCurrent.updatedAt || updatedAt > latestCurrent.updatedAt))) {
      latest.set(key, candidate);
    }

    const current = best.get(key);
    const nextScore = getEvidenceScore(summary, completion);
    const currentScore = current ? getEvidenceScore(current.summary, current.completion) : -1;
    const shouldReplace = !current ||
      nextScore > currentScore ||
      (nextScore === currentScore && updatedAt && (!current.updatedAt || updatedAt > current.updatedAt));
    if (shouldReplace) {
      best.set(key, candidate);
    }
  }
  return { best, latest };
}

function findSessionEvidence() {
  return collectSessionEvidence().best;
}

function syncActiveAgentsFromSessions() {
  const normalized = normalizeActiveAgents(getActiveAgents());
  const active = normalized.active;
  const evidence = collectSessionEvidence();
  let changed = normalized.changed ? 1 : 0;

  for (const agent of active) {
    const key = `${agent.taskId}::${agent.workerId || agent.roleId}`;
    const match = evidence.best.get(key);
    const latestMatch = evidence.latest.get(key);
    if (!match) continue;

    const activeMatch = agent.status === 'completed' ? match : (latestMatch || match);
    const nextSessionId = agent.sessionId || activeMatch.sessionId || match.sessionId || null;
    if (agent.sessionId !== nextSessionId) {
      agent.sessionId = nextSessionId;
      changed += 1;
    }
    if (agent.lastSessionFile !== activeMatch.file) {
      agent.lastSessionFile = activeMatch.file;
      changed += 1;
    }
    const nextUpdatedAt = activeMatch.updatedAt || match.updatedAt || new Date().toISOString();
    if (agent.updatedAt !== nextUpdatedAt) {
      agent.updatedAt = nextUpdatedAt;
      changed += 1;
    }

    const summarySource = agent.status === 'completed' ? match : (activeMatch.summary?.text ? activeMatch : match);

    if (summarySource.summary?.text) {
      const summaryText = summarySource.summary.text;
      const previousStatus = agent.status;
      const structuredStatus = typeof match.completion?.status === 'string'
        ? match.completion.status.trim().toLowerCase()
        : null;
      const clarificationSignal = /need clarification|need more information|需要更多信息|需要澄清|无法确定|无法执行|任务描述.*模糊|what specific topic|what.*should i research/i.test(summaryText);
      let nextStatus = 'running';
      if (structuredStatus === 'completed') {
        nextStatus = 'completed';
      } else if (['blocked', 'failed', 'error'].includes(structuredStatus)) {
        nextStatus = 'failed';
      } else if (clarificationSignal) {
        nextStatus = 'failed';
      } else if (/<final>|任务总结|交付|完成|verified|done/i.test(summaryText)) {
        nextStatus = 'completed';
      }
      if (agent.status !== nextStatus) {
        agent.status = nextStatus;
        changed += 1;
      }
      if (['completed', 'failed'].includes(nextStatus) && agent.roleId) {
        const alreadyScored = agent?.reputationState?.scoredStatus === nextStatus;
        if (!alreadyScored || previousStatus !== nextStatus) {
          const scoreEvent = nextStatus === 'completed' ? 'completed' : 'failed';
          const scoreReceipt = scoreRole(agent.roleId, scoreEvent, {
            reason: structuredStatus || nextStatus
          });
          agent.reputationState = {
            ...(agent.reputationState || {}),
            scoredStatus: nextStatus,
            scoredAt: new Date().toISOString(),
            receipt: scoreReceipt
          };
          changed += 1;
        }
      }
      agent.result = {
        ...(agent.result || {}),
        sessionFile: activeMatch.file,
        recoveredAt: new Date().toISOString(),
        summary: summaryText,
        stopReason: summarySource.summary.stopReason || null,
        structuredCompletion: match.completion || null,
        reputation: agent.reputationState?.receipt || agent.result?.reputation || null
      };
    } else if (['spawning', 'waiting'].includes(agent.status)) {
      agent.status = 'running';
      changed += 1;
    }
  }

  if (changed > 0) {
    writeJson(ACTIVE_FILE, active);
  }

  return { changed, active };
}

function loadTask(taskId) {
  const file = path.join(TASKS_DIR, `${taskId}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  const normalized = normalizeTaskData(raw);
  if (normalized.changed) {
    writeJson(file, normalized.data);
  }
  return { file, data: normalized.data };
}

function getAgentAgeMinutes(agent) {
  const ts = Date.parse(agent?.updatedAt || agent?.createdAt || '');
  if (!Number.isFinite(ts)) return Infinity;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

function hasExecutionEvidence(agent) {
  return Boolean(agent?.lastSessionFile || agent?.sessionId || agent?.result?.sessionFile);
}

function isSubstantiveSummary(summary, stopReason = null) {
  if (typeof summary !== 'string') return false;
  const text = summary.trim();
  if (!text) return false;
  const normalizedStopReason = String(stopReason || '').trim();
  if (normalizedStopReason === 'toolUse') {
    return false;
  }
  if (text.length >= 200) return true;
  if (/```json|<final>|任务总结|handoff|nextStep|artifacts|blockers/i.test(text)) return true;
  if (/(完成|已完成|交付|验证|修复|实现|新增|更新|review|verified|completed|delivered|implemented|patched)/i.test(text)) {
    return true;
  }
  // A short summary can still be meaningful if the run actually stopped cleanly.
  if (text.length >= 80 && ['stop', 'maxTokens', 'endTurn'].includes(normalizedStopReason)) {
    return true;
  }
  return false;
}

function hasMeaningfulResult(agent) {
  if (!agent?.result) return false;
  if (agent.result.structuredCompletion) return true;
  if (isSubstantiveSummary(agent.result.summary, agent.result.stopReason)) return true;
  return false;
}

function getTaskIntent(taskId) {
  const task = loadTask(taskId);
  if (!task?.data) return 'production';
  const explicit = task.data.intent;
  if (explicit) return explicit;
  const sessionId = String(task.data?.context?.sessionId || '');
  const taskText = String(task.data?.task || task.data?.plan?.task || '');
  if (/demo|verify|validation|smoke|e2e|验证|测试|演练|试跑|压测/i.test(sessionId) ||
      /demo|verify|validation|smoke|e2e|验证|测试|演练|试跑|压测/i.test(taskText)) {
    return 'validation';
  }
  return 'production';
}

function getActiveAgents() {
  return readJson(ACTIVE_FILE, []);
}

function normalizeActiveAgents(active) {
  let changed = false;
  const taskCache = new Map();

  function getSubtask(taskId, workerId) {
    if (!taskCache.has(taskId)) {
      const task = loadTask(taskId);
      taskCache.set(taskId, {
        task: task?.data || null,
        subtasks: task?.data?.plan?.subtasks || task?.data?.subtasks || []
      });
    }
    return taskCache.get(taskId);
  }

  const normalized = active.map((agent) => {
    let next = agent;
    const taskEntry = getSubtask(agent.taskId, agent.workerId);
    const subtask = taskEntry?.subtasks?.find((item) => item.workerId === agent.workerId) || null;
    const taskContext = taskEntry?.task || null;

    if (subtask) {
      for (const field of ['stage', 'teamId', 'capability', 'collaborationMode', 'dependsOn', 'skills', 'deny', 'memory', 'coworkers', 'title']) {
        if (JSON.stringify(next[field]) !== JSON.stringify(subtask[field])) {
          next = next === agent ? { ...agent } : next;
          next[field] = subtask[field];
          changed = true;
        }
      }
      if (next.task !== subtask.description) {
        next = next === agent ? { ...agent } : next;
        next.task = subtask.description;
        changed = true;
      }
      if (JSON.stringify(next.reputation || null) !== JSON.stringify(subtask.reputation || null)) {
        next = next === agent ? { ...agent } : next;
        next.reputation = subtask.reputation || null;
        changed = true;
      }
      if (JSON.stringify(next.resourceBudget || null) !== JSON.stringify(subtask.resourceBudget || null)) {
        next = next === agent ? { ...agent } : next;
        next.resourceBudget = subtask.resourceBudget || null;
        changed = true;
      }
      if (taskContext) {
        const latestPrompt = buildAgentPrompt(subtask, taskContext);
        if (next.prompt !== latestPrompt) {
          next = next === agent ? { ...agent } : next;
          next.prompt = latestPrompt;
          changed = true;
        }
        const latestLabel = `${taskContext.id}-${subtask.workerId}`;
        if (next.label !== latestLabel) {
          next = next === agent ? { ...agent } : next;
          next.label = latestLabel;
          changed = true;
        }
        const nextSpawnConfig = {
          ...(next.spawnConfig || {}),
          runtime: 'subagent',
          mode: next.mode || 'run',
          agentId: next.agentId || 'main',
          task: latestPrompt,
          label: latestLabel,
          model: next.model || 'minimax',
          cleanup: next.cleanup || 'delete',
          timeoutSeconds: next.runTimeoutSeconds || 600,
          runTimeoutSeconds: next.runTimeoutSeconds || 600
        };
        if (JSON.stringify(next.spawnConfig) !== JSON.stringify(nextSpawnConfig)) {
          next = next === agent ? { ...agent } : next;
          next.spawnConfig = nextSpawnConfig;
          changed = true;
        }
      }
    }

    if (!next.lastSessionFile && ['waiting', 'spawning'].includes(next.status)) {
      const resolved = resolveAgentConfig(next.roleId);
      const expected = {
        agentId: resolved.agentId || 'main',
        model: resolved.model || next.model || 'minimax',
        mode: resolved.mode || 'run',
        cleanup: resolved.cleanup || 'delete',
        runTimeoutSeconds: resolved.runTimeoutSeconds || 600
      };
      for (const [key, value] of Object.entries(expected)) {
        if (next[key] !== value) {
          next = next === agent ? { ...agent } : next;
          next[key] = value;
          changed = true;
        }
      }
      if (next.spawnConfig) {
        next = next === agent ? { ...agent } : next;
        next.spawnConfig = {
          ...next.spawnConfig,
          ...expected
        };
      }
    }

    return next;
  });

  if (changed) {
    writeJson(ACTIVE_FILE, normalized);
  }

  return { active: normalized, changed };
}

function updateAgentStatus(label, status, result = null) {
  const active = getActiveAgents();
  const agent = active.find(a => a.label === label);
  
  if (!agent) {
    throw new Error(`Agent not found: ${label}`);
  }

  agent.status = status;
  agent.updatedAt = new Date().toISOString();
  
  if (result) {
    agent.result = result;
  }

  writeJson(ACTIVE_FILE, active);
  return agent;
}

function checkDependencies(agent, active) {
  if (!agent.dependsOn || agent.dependsOn.length === 0) {
    return { ready: true, blocking: [] };
  }

  const blocking = [];
  for (const dependencyId of agent.dependsOn) {
    const dep = active.find(a =>
      a.taskId === agent.taskId &&
      (a.workerId === dependencyId || a.roleId === dependencyId || a.label === dependencyId)
    );
    if (!dep || dep.status !== 'completed') {
      blocking.push(dependencyId);
    }
  }

  return { ready: blocking.length === 0, blocking };
}

function getNextAgents() {
  syncActiveAgentsFromSessions();
  const active = getActiveAgents();
  const waiting = active.filter(a => a.status === 'waiting');
  const ready = [];

  for (const agent of waiting) {
    const { ready: isReady, blocking } = checkDependencies(agent, active);
    if (isReady) {
      ready.push(agent);
    }
  }

  return ready;
}

function getLaunchableAgents() {
  syncActiveAgentsFromSessions();
  const active = getActiveAgents();
  const initial = active.filter((agent) => agent.status === 'spawning');
  const waitingReady = [];
  const phantomRunning = [];

  for (const agent of active.filter((item) => item.status === 'waiting')) {
    const { ready } = checkDependencies(agent, active);
    if (ready) waitingReady.push(agent);
  }

  for (const agent of active.filter((item) => item.status === 'running')) {
    const ageMinutes = getAgentAgeMinutes(agent);
    const missingEvidence = !hasExecutionEvidence(agent) && ageMinutes >= 2;
    const stalledWithoutProgress = hasExecutionEvidence(agent) && !hasMeaningfulResult(agent) && ageMinutes >= 10;
    if (missingEvidence || stalledWithoutProgress) {
      phantomRunning.push({
        ...agent,
        status: 'spawning',
        recoveryReason: missingEvidence
          ? 'phantom_running_without_session'
          : 'stalled_running_without_progress'
      });
    }
  }

  const deduped = new Map();
  for (const agent of initial.concat(waitingReady, phantomRunning)) {
    deduped.set(agent.label || `${agent.taskId}:${agent.workerId || agent.roleId}`, agent);
  }
  const launchable = Array.from(deduped.values()).map((agent) => ({
    ...agent,
    intent: getTaskIntent(agent.taskId)
  }));
  const production = launchable.filter((agent) => agent.intent !== 'validation');
  if (production.length > 0) {
    return production;
  }
  return launchable;
}

function recoverResults(taskId) {
  syncActiveAgentsFromSessions();
  const task = loadTask(taskId);
  if (!task) {
    return { error: 'Task not found', taskId };
  }

  const active = getActiveAgents();
  const taskAgents = active.filter(a => a.taskId === taskId);
  
  const summary = {
    taskId,
    task: task.data.plan.task,
    status: 'unknown',
    agents: taskAgents.map(a => ({
      workerId: a.workerId || null,
      roleId: a.roleId,
      title: a.title,
      teamId: a.teamId || null,
      stage: a.stage || null,
      status: a.status,
      label: a.label,
      result: a.result || null
    })),
    completedCount: taskAgents.filter(a => a.status === 'completed').length,
    totalCount: taskAgents.length,
    recoveredAt: new Date().toISOString()
  };

  // 判断整体状态
  if (summary.completedCount === summary.totalCount) {
    summary.status = 'completed';
  } else if (taskAgents.some(a => a.status === 'failed')) {
    summary.status = 'failed';
  } else if (taskAgents.some(a => ['running', 'spawning'].includes(a.status))) {
    summary.status = 'in_progress';
  } else {
    summary.status = 'waiting';
  }

  // 更新任务文件。对于已经 completed 且摘要未变化的任务，保留 updatedAt，
  // 这样 cleanup 才能按时间窗口归档，不会被每次巡检无限续命。
  const previousSummary = task.data.summary || null;
  const previousStatus = task.data.status || null;
  const stableCompleted = previousStatus === 'completed' && summary.status === 'completed';
  const summarySignature = JSON.stringify({
    status: summary.status,
    completedCount: summary.completedCount,
    totalCount: summary.totalCount,
    agents: summary.agents.map((agent) => ({
      workerId: agent.workerId,
      status: agent.status,
      label: agent.label
    }))
  });
  const previousSignature = previousSummary ? JSON.stringify({
    status: previousSummary.status,
    completedCount: previousSummary.completedCount,
    totalCount: previousSummary.totalCount,
    agents: (previousSummary.agents || []).map((agent) => ({
      workerId: agent.workerId,
      status: agent.status,
      label: agent.label
    }))
  }) : null;

  task.data.status = summary.status;
  task.data.summary = summary;
  if (!(stableCompleted && previousSignature === summarySignature)) {
    task.data.updatedAt = new Date().toISOString();
  }
  writeJson(task.file, task.data);

  return summary;
}

function recoverAll() {
  syncActiveAgentsFromSessions();
  const active = getActiveAgents();
  const taskIds = [...new Set(active.map(a => a.taskId))];
  
  return taskIds.map(taskId => recoverResults(taskId));
}

/**
 * Enhanced three-tier state recovery with fallback
 * @param {Object} agent - Agent record
 * @param {Object} config - Stability config (optional, defaults to config/stability.json)
 * @returns {Object} { source: 'L1-active'|'L2-task'|'L3-session', agent: AgentRecord, success: boolean }
 */
function enhancedRecovery(agent, config = null) {
  const stabilityConfig = config || readJson(path.join(ROOT, 'config', 'stability.json'), {
    recovery: { priority: ['active', 'task', 'session'] }
  });
  
  const priority = stabilityConfig.recovery?.priority || ['active', 'task', 'session'];
  
  // L1: Try active-agents.json first
  if (priority.includes('active')) {
    const active = getActiveAgents();
    const found = active.find(a => a.label === agent.label || a.workerId === agent.workerId);
    if (found && found.status) {
      return { source: 'L1-active', agent: found, success: true };
    }
  }
  
  // L2: Try tasks/*.json
  if (priority.includes('task')) {
    const task = loadTask(agent.taskId);
    if (task?.data) {
      const subtasks = task.data.plan?.subtasks || task.data.subtasks || [];
      const found = subtasks.find(st => st.workerId === agent.workerId);
      if (found) {
        return { source: 'L2-task', agent: { ...agent, ...found, taskId: agent.taskId }, success: true };
      }
    }
  }
  
  // L3: Try session evidence (agents/*/sessions/*.jsonl)
  if (priority.includes('session')) {
    const evidence = findSessionEvidence();
    const key = `${agent.taskId}::${agent.workerId}`;
    const found = evidence.get(key);
    if (found) {
      return { 
        source: 'L3-session', 
        agent: { 
          ...agent, 
          sessionId: found.sessionId,
          lastSessionFile: found.file,
          result: { summary: found.summary, structuredCompletion: found.completion }
        }, 
        success: true 
      };
    }
  }
  
  return { source: null, agent, success: false };
}

/**
 * Validate agent state consistency
 * @param {Object} agent - Agent record
 * @returns {Object} { valid: boolean, issues: string[] }
 */
function validateAgentState(agent) {
  const issues = [];
  
  if (!agent.taskId) issues.push('missing taskId');
  if (!agent.workerId && !agent.roleId) issues.push('missing workerId/roleId');
  if (!agent.status) issues.push('missing status');
  
  const validStatuses = ['waiting', 'spawning', 'running', 'completed', 'failed'];
  if (agent.status && !validStatuses.includes(agent.status)) {
    issues.push(`invalid status: ${agent.status}`);
  }
  
  // Check dependency validity
  if (agent.dependsOn && Array.isArray(agent.dependsOn)) {
    const active = getActiveAgents();
    const taskAgents = active.filter(a => a.taskId === agent.taskId);
    for (const dep of agent.dependsOn) {
      const depExists = taskAgents.some(a => 
        a.workerId === dep || a.roleId === dep || a.label === dep
      );
      if (!depExists) {
        issues.push(`broken dependency: ${dep}`);
      }
    }
  }
  
  // Check for zombie state (running but no session)
  if (agent.status === 'running' && !agent.sessionId && !agent.lastSessionFile) {
    issues.push('zombie: running without session evidence');
  }
  
  return { valid: issues.length === 0, issues };
}

/**
 * Snapshot agent state with rotation
 * @param {Object} agent - Agent record
 * @param {string} reason - Change reason
 * @param {number} retention - Retention count (default 5)
 */
function persistWithSnapshot(agent, reason, retention = 5) {
  const SNAPSHOT_DIR = path.join(RUNTIME_DIR, 'snapshots');
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  
  const snapshotFile = path.join(SNAPSHOT_DIR, `${agent.label || agent.workerId}.snapshots.json`);
  const snapshots = readJson(snapshotFile, []);
  
  const newSnapshot = {
    timestamp: new Date().toISOString(),
    reason,
    status: agent.status,
    sessionId: agent.sessionId,
    lastSessionFile: agent.lastSessionFile,
    result: agent.result || null
  };
  
  snapshots.unshift(newSnapshot);
  
  // Rotate: keep only the latest `retention` snapshots
  while (snapshots.length > retention) {
    snapshots.pop();
  }
  
  writeJson(snapshotFile, snapshots);
  
  // Also update active-agents.json
  const active = getActiveAgents();
  const idx = active.findIndex(a => a.label === agent.label);
  if (idx >= 0) {
    active[idx] = { ...active[idx], ...agent, updatedAt: new Date().toISOString() };
    writeJson(ACTIVE_FILE, active);
  }
  
  return { snapshotCount: snapshots.length, retained: Math.min(snapshots.length, retention) };
}

if (require.main === module) {
  const action = process.argv[2] || 'all';
  
  if (action === 'all') {
    const results = recoverAll();
    console.log(JSON.stringify(results, null, 2));
  } else if (action === 'next') {
    const next = getNextAgents();
    console.log(JSON.stringify(next, null, 2));
  } else {
    // 假设是 taskId
    const result = recoverResults(action);
    console.log(JSON.stringify(result, null, 2));
  }
}

module.exports = {
  recoverResults,
  recoverAll,
  updateAgentStatus,
  getNextAgents,
  getLaunchableAgents,
  checkDependencies,
  syncActiveAgentsFromSessions,
  findSessionEvidence,
  extractStructuredCompletion,
  // Phase 1 P0: State Recovery Enhancement
  enhancedRecovery,
  validateAgentState,
  persistWithSnapshot,
  // Phase 3 P1: Result Recovery Enhancement
  multiStrategyParse,
  handleTruncatedOutput,
  aggregateResults,
  calculateConfidence
};

/**
 * Multi-strategy parsing - try each strategy until one succeeds
 * @param {string} text - Text to parse
 * @returns {Object|null} Parsed result or null
 */
function multiStrategyParse(text) {
  if (!text) return null;
  
  const stabilityConfig = readJson(path.join(ROOT, 'config', 'stability.json'), {
    result: { parsingStrategies: ['json-block', 'inline-json', 'keyword-extract'] }
  });
  
  const strategies = stabilityConfig.result?.parsingStrategies || ['json-block', 'inline-json', 'keyword-extract'];
  
  for (const strategy of strategies) {
    let result = null;
    
    if (strategy === 'json-block') {
      // Try JSON code block: ```json ... ```
      const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
      for (let i = matches.length - 1; i >= 0; i--) {
        const raw = matches[i][1]?.trim();
        if (!raw) continue;
        try {
          result = JSON.parse(raw);
          if (result && typeof result === 'object') {
            return { ...result, _strategy: 'json-block' };
          }
        } catch { /* continue */ }
      }
    } else if (strategy === 'inline-json') {
      // Try inline JSON: {"key": "value"}
      const match = text.match(/{[\s\S]*?"taskId"[\s\S]*?}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
          if (result && typeof result === 'object') {
            return { ...result, _strategy: 'inline-json' };
          }
        } catch { /* continue */ }
      }
    } else if (strategy === 'keyword-extract') {
      // Try conservative keyword extraction from nearly-JSON / key-value text.
      // Avoid free-form phrases such as "status is completed", which are too noisy.
      const statusMatch = text.match(/(?:^|[{\s,])["']?status["']?\s*[:=]\s*["']?([a-zA-Z_-]+)/i);
      const taskIdMatch = text.match(/(?:^|[{\s,])["']?taskId["']?\s*[:=]\s*["']?([^\s"',}]+)/i);
      const workerIdMatch = text.match(/(?:^|[{\s,])["']?workerId["']?\s*[:=]\s*["']?([^\s"',}]+)/i);
      
      if (statusMatch || taskIdMatch) {
        return {
          status: statusMatch ? statusMatch[1].toLowerCase() : 'unknown',
          taskId: taskIdMatch ? taskIdMatch[1] : null,
          workerId: workerIdMatch ? workerIdMatch[1] : null,
          _strategy: 'keyword-extract'
        };
      }
    }
  }
  
  return null;
}

/**
 * Handle truncated output recovery
 * @param {string} text - Potentially truncated text
 * @returns {Object|null} Recovered result or null
 */
function handleTruncatedOutput(text) {
  if (!text) return null;
  
  // Try to find a partial JSON structure
  const openBraces = (text.match(/{/g) || []).length;
  const closeBraces = (text.match(/}/g) || []).length;
  
  // If unbalanced, try to fix
  if (openBraces > closeBraces) {
    // Try multiStrategyParse first
    const parsed = multiStrategyParse(text);
    if (parsed) return parsed;
    
    // Try to close braces
    let fixed = text;
    while ((fixed.match(/{/g) || []).length > (fixed.match(/}/g) || []).length) {
      fixed += '}';
    }
    
    try {
      const result = JSON.parse(fixed);
      return { ...result, _strategy: 'brace-recovery' };
    } catch { /* continue */ }
  }
  
  // Try multiStrategyParse
  return multiStrategyParse(text);
}

/**
 * Aggregate results with confidence
 * @param {string} taskId - Task ID
 * @returns {Object} { taskId, status, completionRate, results[], aggregatedAt }
 */
function aggregateResults(taskId) {
  const task = loadTask(taskId);
  if (!task) {
    return { taskId, error: 'task_not_found', status: 'unknown' };
  }
  
  const active = getActiveAgents();
  const taskAgents = active.filter(a => a.taskId === taskId);
  
  const results = taskAgents.map(agent => ({
    workerId: agent.workerId,
    roleId: agent.roleId,
    status: agent.status,
    confidence: calculateConfidence(agent),
    result: agent.result || null
  }));
  
  const completedCount = results.filter(r => r.status === 'completed').length;
  const totalCount = results.length;
  
  let status = 'unknown';
  if (completedCount === totalCount && totalCount > 0) {
    status = 'completed';
  } else if (results.some(r => r.status === 'failed')) {
    status = 'failed';
  } else if (results.some(r => ['running', 'spawning'].includes(r.status))) {
    status = 'in_progress';
  } else if (completedCount > 0) {
    status = 'partially_completed';
  }
  
  const avgConfidence = results.length > 0
    ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
    : 0;
  
  return {
    taskId,
    status,
    completionRate: totalCount > 0 ? completedCount / totalCount : 0,
    averageConfidence: avgConfidence,
    results,
    aggregatedAt: new Date().toISOString()
  };
}

/**
 * Calculate confidence score (0-1) for agent result
 * @param {Object} agent - Agent record
 * @returns {number} Confidence score
 */
function calculateConfidence(agent) {
  if (!agent) return 0;
  
  let score = 0;
  const maxScore = 100;
  
  // Base score from status
  if (agent.status === 'completed') {
    score += 40;
  } else if (agent.status === 'failed') {
    score += 10;
  } else if (agent.status === 'running') {
    score += 20;
  }
  
  // Evidence presence
  if (agent.lastSessionFile || agent.sessionId) {
    score += 15;
  }
  
  // Result quality
  if (agent.result) {
    if (agent.result.structuredCompletion) {
      score += 25;
    }
    if (agent.result.summary) {
      const summaryLen = agent.result.summary.length;
      if (summaryLen >= 200) score += 10;
      else if (summaryLen >= 100) score += 5;
      
      // Check for completion markers
      if (/```json|<final>|任务总结|handoff|nextStep|artifacts/i.test(agent.result.summary)) {
        score += 10;
      }
    }
  }
  
  return Math.min(score / maxScore, 1);
}
