#!/usr/bin/env node
/**
 * Live Executor - 真正调用 sessions_spawn 创建 subagent
 * 
 * 用法：
 *   node live-executor.js "<任务描述>"
 * 
 * 流程：
 *   1. 调用 orchestrator-main 生成计划
 *   2. 读取 agent-mapping 映射到真实 agentId
 *   3. 输出可直接被 Jarvis 主会话执行的 spawn 指令
 */

const fs = require('fs');
const path = require('path');
const { orchestrate } = require('./orchestrator-main');
const { buildAgentPrompt } = require('./supervisor-runner');

const ROOT = __dirname;
const MAPPING_FILE = path.join(ROOT, 'config', 'agent-mapping.json');
const RUNTIME_DIR = path.join(ROOT, 'runtime');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function resolveAgent(roleId) {
  const mapping = readJson(MAPPING_FILE, { mapping: {}, defaults: {} });
  const mapped = mapping.mapping[roleId];
  if (mapped) return { ...mapping.defaults, ...mapped };
  return { ...mapping.defaults };
}

async function execute(taskText) {
  // Step 1: 生成编排计划
  const result = await orchestrate(taskText, {
    verbose: false,
    context: {
      sessionId: process.env.OPENCLAW_SESSION_ID || null
    }
  });

  if (result.mode === 'single') {
    return {
      mode: 'single',
      taskId: result.taskId,
      message: 'Simple task - main agent handles directly',
      spawnCalls: []
    };
  }

  // Step 2: 为每个 spawn 指令映射真实 agentId
  const spawnCalls = [];
  for (const inst of result.spawnInstructions) {
    const resolved = resolveAgent(inst.roleId);
    spawnCalls.push({
      label: inst.label,
      roleId: inst.roleId,
      title: inst.title,
      agentId: resolved.agentId,
      model: resolved.model,
      mode: resolved.mode || 'run',
      cleanup: resolved.cleanup || 'delete',
      runTimeoutSeconds: resolved.runTimeoutSeconds || 600,
      task: inst.prompt,
      metadata: {
        taskId: result.taskId,
        sessionId: result.context?.sessionId || null,
        roleId: inst.roleId
      }
    });
  }

  // Step 3: 把待执行的后续 agent 也准备好（串行模式下 waiting 的）
  const waitingRoles = result.plan.subtasks
    .filter(st => !spawnCalls.find(s => s.roleId === st.roleId))
    .map(st => {
      const resolved = resolveAgent(st.roleId);
      return {
        roleId: st.roleId,
        title: st.title,
        agentId: resolved.agentId,
        model: resolved.model,
        dependsOn: st.dependsOn,
        status: 'waiting',
        prompt: buildAgentPrompt(st, {
          id: result.taskId,
          context: result.context || {},
          task: taskText,
          executionMode: result.plan.executionMode
        })
      };
    });

  const execution = {
    taskId: result.taskId,
    context: result.context || {},
    mode: 'multi',
    executionMode: result.plan.executionMode,
    spawnNow: spawnCalls,
    spawnLater: waitingRoles,
    totalAgents: spawnCalls.length + waitingRoles.length
  };

  // 保存执行计划
  writeJson(path.join(RUNTIME_DIR, 'execution-plan.json'), execution);

  return execution;
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node live-executor.js <task>');
    process.exit(1);
  }

  execute(task).then(result => {
    console.log(JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('Execution failed:', err.message);
    process.exit(1);
  });
}

module.exports = { execute, resolveAgent };
