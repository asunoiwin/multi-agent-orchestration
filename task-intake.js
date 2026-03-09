#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { planTask } = require('./dynamic-orchestrator');

const ROOT = __dirname;
const STATE_DIR = path.join(ROOT, 'runtime');
const TASKS_DIR = path.join(ROOT, 'tasks');

function ensureDirs() {
  [STATE_DIR, TASKS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function taskId() {
  return `task-${Date.now()}`;
}

function enqueue(taskText, source = 'manual') {
  ensureDirs();
  const id = taskId();
  const plan = planTask(taskText);
  const payload = {
    id,
    source,
    status: plan.needsMultiAgent ? 'planned' : 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan,
    results: []
  };
  const file = path.join(TASKS_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return { id, file, payload };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node task-intake.js <task>');
    process.exit(1);
  }
  const result = enqueue(task);
  console.log(JSON.stringify({ id: result.id, file: result.file, plan: result.payload.plan }, null, 2));
}

module.exports = { enqueue };
