#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config', 'agent-pool.json');
const TASKS_DIR = path.join(ROOT, 'tasks');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');
const STATE_FILE = path.join(RUNTIME_DIR, 'supervisor-state.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadTasks() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: path.join(TASKS_DIR, f), data: readJson(path.join(TASKS_DIR, f)) }))
    .sort((a, b) => new Date(a.data.createdAt) - new Date(b.data.createdAt));
}

function buildAgentPrompt(subtask, taskContext) {
  const sessionId = taskContext?.context?.sessionId || taskContext?.sessionId || 'unknown';
  const lines = [
    `# Role: ${subtask.title}`,
    ``,
    `## Purpose`,
    subtask.description,
    ``,
    `## Task Context`,
    `- Task ID: ${taskContext.id}`,
    `- Session ID: ${sessionId}`,
    `- Original Task: ${taskContext.task}`,
    `- Your Role: ${subtask.roleId}`,
    `- Execution Mode: ${taskContext.executionMode}`,
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
    `## Instructions`,
    `1. Focus only on your role's responsibility`,
    `2. Use only allowed tools`,
    `3. Track required memory items and keep task/session metadata attached to notes`,
    `4. When storing progress, include taskId=${taskContext.id} and sessionId=${sessionId}`,
    `5. Report results clearly when done`,
    `6. If blocked, explain why and what you need`,
    ``,
    `## Deliverable`,
    `Provide a clear summary of what you accomplished and any artifacts created.`
  ];
  return lines.join('\n');
}

function spawnAgent(subtask, taskContext) {
  const prompt = buildAgentPrompt(subtask, taskContext);
  
  // 构造 sessions_spawn 调用参数
  const spawnConfig = {
    runtime: 'subagent',
    mode: 'session',
    task: prompt,
    label: `${taskContext.id}-${subtask.roleId}`,
    model: 'minimax',
    cleanup: 'keep',
    timeoutSeconds: 1800 // 30分钟超时
  };
  
  return {
    config: spawnConfig,
    subtask,
    taskId: taskContext.id,
    sessionId: taskContext?.context?.sessionId || null
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
    const agentRecord = {
      taskId: task.id,
      sessionId: task.context?.sessionId || null,
      roleId: subtask.roleId,
      title: subtask.title,
      status: isReady ? 'spawning' : 'waiting',
      dependsOn: subtask.dependsOn,
      skills: subtask.skills,
      deny: subtask.deny,
      memory: subtask.memory,
      createdAt: new Date().toISOString(),
      task: subtask.description
    };

    if (isReady) {
      const spawnInfo = spawnAgent(subtask, task);
      spawned.push(spawnInfo);
      agentRecord.spawnConfig = spawnInfo.config;
      agentRecord.label = spawnInfo.config.label;
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

module.exports = { supervisorRunOnce, spawnAgent, buildAgentPrompt };
