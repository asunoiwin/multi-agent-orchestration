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

function allocateAgents(task) {
  const plan = task.plan;
  if (!plan.needsMultiAgent) {
    task.status = 'single';
    task.updatedAt = new Date().toISOString();
    return { allocated: [], task };
  }

  const active = readJson(ACTIVE_FILE, []);
  const allocated = plan.subtasks.map((subtask, idx) => ({
    taskId: task.id,
    roleId: subtask.roleId,
    title: subtask.title,
    status: idx === 0 || plan.executionMode === 'parallel' ? 'ready' : 'waiting',
    dependsOn: subtask.dependsOn,
    skills: subtask.skills,
    deny: subtask.deny,
    memory: subtask.memory,
    createdAt: new Date().toISOString(),
    task: subtask.description
  }));

  writeJson(ACTIVE_FILE, active.concat(allocated));
  task.status = 'allocated';
  task.updatedAt = new Date().toISOString();
  return { allocated, task };
}

function supervisorRunOnce() {
  const tasks = loadTasks();
  const pending = tasks.filter(t => ['planned'].includes(t.data.status));
  const results = [];

  for (const item of pending) {
    const { allocated, task } = allocateAgents(item.data);
    writeJson(item.file, task);
    results.push({ taskId: task.id, allocated: allocated.map(a => ({ roleId: a.roleId, status: a.status })) });
  }

  writeJson(STATE_FILE, {
    checkedAt: new Date().toISOString(),
    pendingCount: pending.length,
    handled: results
  });

  return {
    checkedAt: new Date().toISOString(),
    pendingCount: pending.length,
    handled: results
  };
}

if (require.main === module) {
  console.log(JSON.stringify(supervisorRunOnce(), null, 2));
}

module.exports = { supervisorRunOnce };
