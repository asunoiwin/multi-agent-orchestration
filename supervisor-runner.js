#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { collectKeyPaths, createTaskBriefPayload } = require('./task-intake');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config', 'agent-pool.json');
const MAPPING_FILE = path.join(ROOT, 'config', 'agent-mapping.json');
const TASKS_DIR = path.join(ROOT, 'tasks');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');
const STATE_FILE = path.join(RUNTIME_DIR, 'supervisor-state.json');
const BRIEF_DIR = path.join(RUNTIME_DIR, 'task-briefs');

// Import alert manager
const { sendAlertSync, alertCircuitBreaker } = require('./modules/alert-manager');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function extractDependencyHandoffs(taskContext, subtask) {
  const summaryAgents = Array.isArray(taskContext?.summary?.agents) ? taskContext.summary.agents : [];
  const dependsOn = Array.isArray(subtask?.dependsOn) ? subtask.dependsOn : [];
  if (dependsOn.length === 0) return [];

  return dependsOn
    .map((workerId) => summaryAgents.find((agent) => agent?.workerId === workerId))
    .filter(Boolean)
    .map((agent) => {
      const completion = agent?.result?.structuredCompletion || null;
      const artifacts = Array.isArray(completion?.artifacts)
        ? completion.artifacts.filter((item) => typeof item === 'string' && item.trim())
        : [];
      const handoff = Array.isArray(completion?.handoff)
        ? completion.handoff.filter((item) => typeof item === 'string' && item.trim())
        : [];
      return {
        workerId: agent.workerId,
        roleId: agent.roleId,
        summary: completion?.summary || agent?.result?.summary || '',
        artifacts,
        handoff,
        nextStep: typeof completion?.nextStep === 'string' ? completion.nextStep : ''
      };
    });
}

function resolveAgent(roleId) {
  const mapping = readJson(MAPPING_FILE, { mapping: {}, defaults: {} });
  const mapped = mapping.mapping?.[roleId];
  return { ...(mapping.defaults || {}), ...(mapped || {}) };
}

function ensureTaskBrief(taskContext) {
  fs.mkdirSync(BRIEF_DIR, { recursive: true });
  const briefPath = path.join(BRIEF_DIR, `${taskContext.id}.json`);
  const existing = readJson(briefPath, {});
  const taskRoot = taskContext?.context?.taskRoot || taskContext?.taskRoot || ROOT;
  const basePayload = createTaskBriefPayload({
    id: taskContext.id,
    task: taskContext?.task || taskContext?.plan?.task || existing.task || 'unknown',
    context: {
      taskRoot
    },
    plan: {
      executionMode: taskContext?.executionMode || taskContext?.plan?.executionMode || existing.executionMode || 'hybrid',
      collaborationModel: taskContext?.plan?.collaborationModel || existing.collaborationModel || 'company',
      selectedRoles: Array.isArray(taskContext?.plan?.selectedRoles) && taskContext.plan.selectedRoles.length > 0
        ? taskContext.plan.selectedRoles
        : Array.isArray(existing.selectedRoles) ? existing.selectedRoles : [],
      staffingPlan: Array.isArray(taskContext?.plan?.staffingPlan) && taskContext.plan.staffingPlan.length > 0
        ? taskContext.plan.staffingPlan
        : Array.isArray(existing.staffingPlan) ? existing.staffingPlan : [],
      teams: Array.isArray(taskContext?.plan?.teams) && taskContext.plan.teams.length > 0
        ? taskContext.plan.teams
        : Array.isArray(existing.teams) ? existing.teams : [],
      syncPlan: Array.isArray(taskContext?.plan?.syncPlan) && taskContext.plan.syncPlan.length > 0
        ? taskContext.plan.syncPlan
        : Array.isArray(existing.syncPlan) ? existing.syncPlan : []
    }
  }, {
    taskRoot,
    keyPaths: collectKeyPaths(taskRoot),
    hasReadme: fs.existsSync(path.join(taskRoot, 'README.md')),
    hasPackageJson: fs.existsSync(path.join(taskRoot, 'package.json')),
    hasSourceTree: fs.existsSync(path.join(taskRoot, 'src')),
    hasRuntimeState: fs.existsSync(path.join(taskRoot, 'runtime'))
  });
  const payload = {
    ...basePayload,
    teams: basePayload.teams.length > 0 ? basePayload.teams : Array.isArray(existing.teams) ? existing.teams : [],
    syncPlan: basePayload.syncPlan.length > 0 ? basePayload.syncPlan : Array.isArray(existing.syncPlan) ? existing.syncPlan : [],
    selectedRoles: basePayload.selectedRoles.length > 0 ? basePayload.selectedRoles : Array.isArray(existing.selectedRoles) ? existing.selectedRoles : [],
    staffingPlan: basePayload.staffingPlan.length > 0 ? basePayload.staffingPlan : Array.isArray(existing.staffingPlan) ? existing.staffingPlan : []
  };
  writeJson(briefPath, payload);
  return briefPath;
}

function loadTasks() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map((f) => {
      const file = path.join(TASKS_DIR, f);
      const data = readJson(file, null);
      if (!data || typeof data !== 'object') {
        return null;
      }
      return { file, data };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.data.createdAt) - new Date(b.data.createdAt));
}

function buildAgentPrompt(subtask, taskContext) {
  const sessionId = taskContext?.context?.sessionId || taskContext?.sessionId || 'unknown';
  const originalTask = taskContext?.task || taskContext?.plan?.task || 'unknown';
  const executionMode = taskContext?.executionMode || taskContext?.plan?.executionMode || 'hybrid';
  const taskRoot = taskContext?.context?.taskRoot || taskContext?.taskRoot || ROOT;
  const briefPath = ensureTaskBrief(taskContext);
  const syncPlan = Array.isArray(taskContext?.syncPlan)
    ? taskContext.syncPlan
    : Array.isArray(taskContext?.plan?.syncPlan)
      ? taskContext.plan.syncPlan
      : [];
  const coworkers = Array.isArray(subtask.coworkers) ? subtask.coworkers : [];
  const relevantSyncs = syncPlan.filter(point => (point.participants || []).includes(subtask.workerId));
  const dependencyHandoffs = extractDependencyHandoffs(taskContext, subtask);
  const lines = [
    `# Role: ${subtask.title}`,
    ``,
    `## Purpose`,
    subtask.description,
    ``,
    `## Task Context`,
    `- Task ID: ${taskContext.id}`,
    `- Session ID: ${sessionId}`,
    `- Original Task: ${originalTask}`,
    `- Your Role: ${subtask.roleId}`,
    `- Worker ID: ${subtask.workerId}`,
    `- Team ID: ${subtask.teamId}`,
    `- Stage: ${subtask.stage}`,
    `- Execution Mode: ${executionMode}`,
    `- Task Root: ${taskRoot}`,
    `- Task Brief: ${briefPath}`,
    ``,
    `## Your Capabilities`,
    `Allowed tools: ${subtask.skills.join(', ')}`,
    ``,
    `## Constraints`,
    `Denied tools: ${subtask.deny.join(', ')}`,
    ``,
    `## Working Memory`,
    `Scope: ${subtask.memory.scope}`,
    `Track: ${subtask.memory.items.join(', ')}`,
    ``,
    `## Team Collaboration`,
    coworkers.length > 0
      ? `Coworkers: ${coworkers.map(worker => `${worker.title}(${worker.workerId})`).join(', ')}`
      : `Coworkers: none`,
    `Collaboration Mode: ${subtask.collaborationMode}`,
    relevantSyncs.length > 0
      ? `Sync Points: ${relevantSyncs.map(point => `${point.id}:${point.kind}`).join(', ')}`
      : `Sync Points: none`,
    ``,
    `## Upstream Handoff`,
    dependencyHandoffs.length > 0
      ? `Completed dependencies: ${dependencyHandoffs.map((entry) => `${entry.workerId}(${entry.roleId})`).join(', ')}`
      : `Completed dependencies: none`,
    ...(dependencyHandoffs.length > 0
      ? dependencyHandoffs.flatMap((entry, idx) => [
          `Dependency ${idx + 1}: ${entry.workerId} (${entry.roleId})`,
          entry.summary ? `- Summary: ${entry.summary}` : `- Summary: none`,
          entry.artifacts.length > 0
            ? `- Artifacts: ${entry.artifacts.join(', ')}`
            : `- Artifacts: none`,
          entry.handoff.length > 0
            ? `- Handoff: ${entry.handoff.join(' | ')}`
            : `- Handoff: none`,
          entry.nextStep ? `- Recommended next step: ${entry.nextStep}` : `- Recommended next step: none`
        ])
      : []),
    `- Prefer the exact artifact paths above over guessed filenames from older memory.`,
    `- If a referenced file is missing, fall back to the listed existing artifact paths in the handoff instead of inventing alternates.`,
    ``,
    `## Instructions`,
    `1. Focus only on your role's responsibility`,
    `2. Use only allowed tools`,
    `3. Track required memory items and keep task/session metadata attached to notes`,
    `4. When storing progress, include taskId=${taskContext.id} and sessionId=${sessionId}`,
    `5. Share assumptions, blockers, and interface decisions with your team in your output`,
    `6. If there are coworkers in the same team, explicitly state what you are owning vs. what they should own`,
    `7. Report results clearly when done`,
    `8. If blocked, explain why and what you need`,
    `9. Do not broaden the task scope beyond your current stage and role`,
    `10. Do not spend time exploring identity/bootstrap/persona files unless the task explicitly asks for them`,
    `11. If the original task is broad or underspecified, make the smallest reasonable stage-scoped assumption and finish with a best-effort deliverable`,
    `12. If you truly cannot proceed, return a structured completion with "status": "blocked" instead of asking open-ended questions`,
    `13. Default assumption: the target system is the current repository/workspace unless the task explicitly points elsewhere`,
    `14. Your stage objective is: ${subtask.description}`,
    `15. Treat ${taskRoot} as the source-of-truth repository for this task; prefer reading and operating there instead of your role workspace`,
    `16. If you need to inspect files, start from ${taskRoot} and reference absolute paths in your output`,
    `17. Read ${briefPath} first when you need the authoritative task snapshot, team plan, or sync points`,
    ``,
    `## Deliverable`,
    `Provide a clear summary of what you accomplished, any artifacts created, handoff notes for teammates, and next-step suggestions.`,
    ``,
    `## Structured Completion`,
    `At the end of your response, include exactly one fenced \`json\` block with this shape:`,
    `\`\`\`json`,
    `{`,
    `  "taskId": "${taskContext.id}",`,
    `  "sessionId": "${sessionId}",`,
    `  "workerId": "${subtask.workerId}",`,
    `  "roleId": "${subtask.roleId}",`,
    `  "status": "completed",`,
    `  "summary": "One concise paragraph of your finished result",`,
    `  "artifacts": ["paths, links, or outputs"],`,
    `  "blockers": [],`,
    `  "handoff": ["what teammates should do next"],`,
    `  "nextStep": "single best next step"`,
    `}`,
    `\`\`\``,
    `Use "status": "blocked" only when you cannot finish. Always keep the JSON valid and make it the last thing in your answer.`
  ];
  return lines.join('\n');
}

function spawnAgent(subtask, taskContext) {
  const prompt = buildAgentPrompt(subtask, taskContext);
  const resolved = resolveAgent(subtask.roleId);
  
  // 构造 sessions_spawn 调用参数
  const spawnConfig = {
    runtime: 'subagent',
    mode: resolved.mode || 'run',
    agentId: resolved.agentId || 'main',
    task: prompt,
    label: `${taskContext.id}-${subtask.workerId}`,
    model: resolved.model || 'minimax',
    cleanup: resolved.cleanup || 'keep',
    timeoutSeconds: resolved.runTimeoutSeconds || 1800 // 30分钟超时
  };
  
  return {
    config: spawnConfig,
    label: spawnConfig.label,
    subtask,
    taskId: taskContext.id,
    sessionId: taskContext?.context?.sessionId || null
  };
}

function buildAgentRecord(subtask, taskContext, statusOverride = null, extras = {}) {
  const spawnInfo = spawnAgent(subtask, taskContext);
  const defaultStatus = statusOverride || 'waiting';
  return {
    taskId: taskContext.id,
    sessionId: taskContext.context?.sessionId || null,
    workerId: subtask.workerId,
    roleId: subtask.roleId,
    title: subtask.title,
    stage: subtask.stage,
    teamId: subtask.teamId,
    capability: subtask.capability,
    collaborationMode: subtask.collaborationMode,
    status: defaultStatus,
    dependsOn: subtask.dependsOn,
    skills: subtask.skills,
    deny: subtask.deny,
    memory: subtask.memory,
    coworkers: subtask.coworkers,
    agentId: spawnInfo.config.agentId || 'main',
    model: spawnInfo.config.model,
    mode: spawnInfo.config.mode,
    cleanup: spawnInfo.config.cleanup,
    runTimeoutSeconds: spawnInfo.config.timeoutSeconds || 1800,
    prompt: spawnInfo.config.task,
    label: spawnInfo.config.label,
    spawnConfig: spawnInfo.config,
    createdAt: new Date().toISOString(),
    task: subtask.description,
    ...extras
  };
}

function allocateAgents(task) {
  const plan = task.plan;
  if (!plan.needsMultiAgent) {
    task.status = 'single';
    task.updatedAt = new Date().toISOString();
    return { allocated: [], spawned: [], task };
  }

  const active = readJson(ACTIVE_FILE, []);
  const spawned = [];
  
  // 只启动 ready 状态的 agent（串行模式下只有第一个或并行模式下所有）
  const readySubtasks = plan.subtasks.filter((st, idx) => {
    if (plan.executionMode === 'parallel') return true;
    return idx === 0; // 串行模式只启动第一个
  });

  const allocated = plan.subtasks.map((subtask, idx) => {
    const isReady = readySubtasks.includes(subtask);
    const spawnInfo = spawnAgent(subtask, task);
    const agentRecord = buildAgentRecord(subtask, task, isReady ? 'spawning' : 'waiting');

    if (isReady) {
      spawned.push(spawnInfo);
    }

    return agentRecord;
  });

  writeJson(ACTIVE_FILE, active.concat(allocated));
  task.status = 'allocated';
  task.updatedAt = new Date().toISOString();
  
  return { allocated, spawned, task };
}

function supervisorRunOnce() {
  const tasks = loadTasks();
  const pending = tasks.filter(t => ['planned'].includes(t.data.status));
  const results = [];

  for (const item of pending) {
    const { allocated, spawned, task } = allocateAgents(item.data);
    writeJson(item.file, task);
    
    results.push({
      taskId: task.id,
      allocated: allocated.map(a => ({
        roleId: a.roleId,
        status: a.status,
        label: a.label || null
      })),
      spawned: spawned.map(s => ({
        label: s.config.label,
        roleId: s.subtask.roleId,
        command: `sessions_spawn with label="${s.config.label}"`
      }))
    });
  }

  const state = {
    checkedAt: new Date().toISOString(),
    pendingCount: pending.length,
    handled: results,
    nextAction: results.length > 0 
      ? 'Call sessions_spawn for each spawned agent'
      : 'No pending tasks'
  };

  writeJson(STATE_FILE, state);
  return state;
}

function rehydrateActiveTasks() {
  const tasks = loadTasks();
  const active = readJson(ACTIVE_FILE, []);
  const handled = [];
  let changed = false;

  for (const item of tasks) {
    const task = item.data;
    if (!task?.plan?.needsMultiAgent) continue;
    const recoverableFromSummary = task.status === 'stalled'
      && task.summary
      && Number(task.summary.totalCount || 0) > Number(task.summary.completedCount || 0)
      && ['in_progress', 'waiting'].includes(String(task.summary.status || ''));
    if (!['planned', 'allocated', 'in_progress', 'waiting'].includes(task.status) && !recoverableFromSummary) continue;
    if (recoverableFromSummary) {
      task.status = String(task.summary.status || 'waiting');
    }

    const taskAgents = active.filter((agent) => agent.taskId === task.id);
    const subtasks = task.plan?.subtasks || [];
    const summaryAgents = Array.isArray(task.summary?.agents) ? task.summary.agents : [];
    const existingWorkers = new Set(taskAgents.map((agent) => agent.workerId));

    if (taskAgents.length > 0) {
      const missingSubtasks = subtasks.filter((subtask) => !existingWorkers.has(subtask.workerId));
      if (missingSubtasks.length === 0) continue;

      const restored = [];
      for (const subtask of missingSubtasks) {
        const summaryAgent = summaryAgents.find((agent) => agent.workerId === subtask.workerId) || null;
        const restoredStatus = summaryAgent?.status || (subtask.dependsOn?.length ? 'waiting' : 'spawning');
        const extras = {};
        if (summaryAgent?.result) {
          extras.result = summaryAgent.result;
        }
        if (summaryAgent?.status === 'completed') {
          extras.updatedAt = new Date().toISOString();
        }
        const record = buildAgentRecord(subtask, task, restoredStatus, extras);
        active.push(record);
        restored.push(record);
        changed = true;
      }

      task.updatedAt = new Date().toISOString();
      writeJson(item.file, task);
      handled.push({
        taskId: task.id,
        restoredAgents: restored.length,
        spawningAgents: restored.filter((agent) => agent.status === 'spawning').map((agent) => agent.workerId),
        mode: 'partial'
      });
      continue;
    }

    const { allocated, spawned, task: updatedTask } = allocateAgents(task);
    active.push(...allocated);
    writeJson(item.file, updatedTask);
    changed = true;
    handled.push({
      taskId: updatedTask.id,
      restoredAgents: allocated.length,
      spawningAgents: spawned.map((spawn) => spawn.subtask.workerId),
      mode: 'full'
    });
  }

  if (changed) {
    writeJson(ACTIVE_FILE, active);
  }

  return {
    restoredAt: new Date().toISOString(),
    restoredCount: handled.length,
    handled
  };
}

/**
 * Deterministic stage advancement - ensures triggering after dependencies are met
 * @param {Object} config - Stability config (optional)
 * @returns {Object} { advanced: number, triggered: string[] }
 */
function deterministicAdvance(config = null) {
  const stabilityConfig = config || readJson(path.join(ROOT, 'config', 'stability.json'), {
    advance: { dependencyTimeoutMs: 1800000, autoAdvanceEnabled: true }
  });
  
  if (!stabilityConfig.advance?.autoAdvanceEnabled) {
    return { advanced: 0, triggered: [] };
  }
  
  const { syncActiveAgentsFromSessions } = require('./result-recovery');
  syncActiveAgentsFromSessions();
  
  const active = readJson(ACTIVE_FILE, []);
  const waiting = active.filter(a => a.status === 'waiting');
  const triggered = [];
  let advanced = 0;
  
  for (const agent of waiting) {
    const { ready, blocking } = checkDependencies(agent, active);
    if (ready) {
      advanced += 1;
    } else {
      const timeout = stabilityConfig.advance?.dependencyTimeoutMs || 1800000;
      for (const blockId of blocking) {
        const dep = active.find(a => 
          a.workerId === blockId || a.roleId === blockId || a.label === blockId
        );
        if (dep) {
          const ageMs = Date.now() - Date.parse(dep.updatedAt || dep.createdAt || 0);
          if (ageMs > timeout) {
            dep.status = 'failed';
            dep.result = { 
              ...dep.result, 
              autoHealed: true, 
              healReason: 'dependency_timeout',
              blockedAgent: agent.label 
            };
            dep.updatedAt = new Date().toISOString();
            triggered.push(agent.label);
          }
        }
      }
    }
  }
  
  if (triggered.length > 0) {
    writeJson(ACTIVE_FILE, active);
  }
  
  return { advanced, triggered };
}

/**
 * Dependency check with timeout protection
 * @param {Object} agent - Agent record
 * @param {Array} activeAgents - Active agent list
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Object} { ready: boolean, reason: string }
 */
function checkDependencyWithTimeout(agent, activeAgents, timeoutMs = 1800000) {
  if (!agent.dependsOn || agent.dependsOn.length === 0) {
    return { ready: true, reason: 'no_dependencies' };
  }
  
  const blocking = [];
  for (const depId of agent.dependsOn) {
    const dep = activeAgents.find(a => 
      a.taskId === agent.taskId &&
      (a.workerId === depId || a.roleId === depId || a.label === depId)
    );
    
    if (!dep) {
      blocking.push({ id: depId, reason: 'not_found' });
      continue;
    }
    
    if (dep.status !== 'completed') {
      const ageMs = Date.now() - Date.parse(dep.updatedAt || dep.createdAt || 0);
      if (ageMs > timeoutMs) {
        blocking.push({ id: depId, reason: 'timeout', ageMs });
      } else if (dep.status === 'failed') {
        blocking.push({ id: depId, reason: 'failed' });
      } else {
        blocking.push({ id: depId, reason: `status_${dep.status}` });
      }
    }
  }
  
  return { 
    ready: blocking.length === 0, 
    reason: blocking.length === 0 ? 'dependencies_met' : blocking.map(b => b.reason).join(',')
  };
}

/**
 * Stage trigger - advances task to next stage
 * @param {string} taskId - Task ID
 * @param {string} currentStage - Current stage
 * @returns {Object} { triggered: boolean, nextStage: string|null }
 */
function triggerNextStage(taskId, currentStage) {
  const task = loadTasks().find(t => t.data.id === taskId)?.data;
  if (!task) return { triggered: false, nextStage: null, error: 'task_not_found' };
  
  const stabilityConfig = readJson(path.join(ROOT, 'config', 'stability.json'), {
    advance: { stageOrder: ['discovery', 'design', 'delivery', 'assurance'] }
  });
  
  const stageOrder = stabilityConfig.advance?.stageOrder || ['discovery', 'design', 'delivery', 'assurance'];
  const currentIdx = stageOrder.indexOf(currentStage);
  
  if (currentIdx < 0 || currentIdx >= stageOrder.length - 1) {
    return { triggered: false, nextStage: null, error: 'no_next_stage' };
  }
  
  const nextStage = stageOrder[currentIdx + 1];
  
  task.stage = nextStage;
  task.updatedAt = new Date().toISOString();
  
  const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
  writeJson(taskFile, task);
  
  return { triggered: true, nextStage, taskId };
}

/**
 * Circuit Breaker - tracks consecutive failures and triggers circuit break
 * @param {Object} config - Stability config (optional)
 * @returns {Object} { tripped: string[], checked: number }
 */
function checkCircuitBreaker(config = null) {
  const stabilityConfig = config || readJson(path.join(ROOT, 'config', 'stability.json'), {
    circuitBreaker: { enabled: true, failureThreshold: 3, resetTimeoutMs: 300000 }
  });
  
  if (!stabilityConfig.circuitBreaker?.enabled) {
    return { tripped: [], checked: 0, reason: 'disabled' };
  }
  
  const threshold = stabilityConfig.circuitBreaker?.failureThreshold || 3;
  const active = readJson(ACTIVE_FILE, []);
  const tripped = [];
  
  for (const agent of active) {
    // Skip already broken/completed agents
    if (agent.status === 'completed' || agent.status === 'broken') continue;
    
    // Check consecutive failures
    const failures = agent.failureCount || 0;
    if (failures >= threshold) {
      // Trip the circuit breaker
      agent.status = 'broken';
      agent.result = {
        ...agent.result,
        circuitTripped: true,
        tripReason: 'consecutive_failures',
        failureCount: failures,
        trippedAt: new Date().toISOString()
      };
      agent.updatedAt = new Date().toISOString();
      tripped.push(agent.workerId);
      
      // Send alert
      sendAlertSync('warning', 'circuit_breaker', {
        agent: agent.label,
        workerId: agent.workerId,
        failureCount: failures,
        threshold,
        action: 'tripped'
      });
    }
  }
  
  if (tripped.length > 0) {
    writeJson(ACTIVE_FILE, active);
  }
  
  return { tripped, checked: active.length };
}

/**
 * Record a failure for an agent (call on task failure)
 * @param {string} workerId - Agent worker ID
 * @returns {Object} { success: boolean, failureCount: number }
 */
function recordFailure(workerId) {
  const active = readJson(ACTIVE_FILE, []);
  const agent = active.find(a => a.workerId === workerId);
  
  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }
  
  agent.failureCount = (agent.failureCount || 0) + 1;
  agent.lastFailureAt = new Date().toISOString();
  agent.updatedAt = new Date().toISOString();
  
  writeJson(ACTIVE_FILE, active);
  
  return { success: true, failureCount: agent.failureCount };
}

/**
 * Record a success - resets failure count
 * @param {string} workerId - Agent worker ID
 * @returns {Object} { success: boolean }
 */
function recordSuccess(workerId) {
  const active = readJson(ACTIVE_FILE, []);
  const agent = active.find(a => a.workerId === workerId);
  
  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }
  
  agent.failureCount = 0;
  agent.lastSuccessAt = new Date().toISOString();
  agent.updatedAt = new Date().toISOString();
  
  writeJson(ACTIVE_FILE, active);
  
  return { success: true };
}

/**
 * Manually reset circuit breaker for an agent
 * @param {string} workerId - Agent worker ID
 * @param {string} reason - Optional reason for reset
 * @returns {Object} { success: boolean }
 */
function resetCircuitBreaker(workerId, reason = 'manual') {
  const active = readJson(ACTIVE_FILE, []);
  const agent = active.find(a => a.workerId === workerId);
  
  if (!agent) {
    return { success: false, error: 'agent_not_found' };
  }
  
  agent.status = 'waiting';
  agent.failureCount = 0;
  agent.circuitResetAt = new Date().toISOString();
  agent.circuitResetReason = reason;
  agent.updatedAt = new Date().toISOString();
  agent.result = {
    ...agent.result,
    circuitReset: true,
    resetReason: reason
  };
  
  writeJson(ACTIVE_FILE, active);
  
  // Send alert
  sendAlertSync('info', 'circuit_breaker_reset', {
    agent: agent.label,
    workerId,
    reason
  });
  
  return { success: true };
}

if (require.main === module) {
  const result = supervisorRunOnce();
  console.log(JSON.stringify(result, null, 2));
  
  if (result.handled.length > 0) {
    console.log('\n=== Next Steps ===');
    result.handled.forEach(h => {
      h.spawned.forEach(s => {
        console.log(`\nFor ${s.label}:`);
        console.log(`  sessions_spawn({`);
        console.log(`    runtime: "subagent",`);
        console.log(`    mode: "session",`);
        console.log(`    label: "${s.label}",`);
        console.log(`    model: "minimax",`);
        console.log(`    task: "<see runtime/active-agents.json for full prompt>"`);
        console.log(`  })`);
      });
    });
  }
}

module.exports = { 
  supervisorRunOnce, 
  spawnAgent, 
  buildAgentPrompt, 
  rehydrateActiveTasks,
  // Phase 2 P1: Stage Advance Enhancement
  deterministicAdvance,
  checkDependencyWithTimeout,
  triggerNextStage,
  // Circuit Breaker
  checkCircuitBreaker,
  recordFailure,
  recordSuccess,
  resetCircuitBreaker
};
