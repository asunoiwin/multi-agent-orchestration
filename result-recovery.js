#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TASKS_DIR = path.join(ROOT, 'tasks');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadTask(taskId) {
  const file = path.join(TASKS_DIR, `${taskId}.json`);
  if (!fs.existsSync(file)) return null;
  return { file, data: readJson(file) };
}

function getActiveAgents() {
  return readJson(ACTIVE_FILE, []);
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
  for (const depRoleId of agent.dependsOn) {
    const dep = active.find(a => a.roleId === depRoleId && a.taskId === agent.taskId);
    if (!dep || dep.status !== 'completed') {
      blocking.push(depRoleId);
    }
  }

  return { ready: blocking.length === 0, blocking };
}

function getNextAgents() {
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

function recoverResults(taskId) {
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
      roleId: a.roleId,
      title: a.title,
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

  // 更新任务文件
  task.data.status = summary.status;
  task.data.summary = summary;
  task.data.updatedAt = new Date().toISOString();
  writeJson(task.file, task.data);

  return summary;
}

function recoverAll() {
  const active = getActiveAgents();
  const taskIds = [...new Set(active.map(a => a.taskId))];
  
  return taskIds.map(taskId => recoverResults(taskId));
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
  checkDependencies
};
