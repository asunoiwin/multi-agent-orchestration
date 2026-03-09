#!/usr/bin/env node
/**
 * Auto Executor - 完整自动化执行器
 * 
 * 功能：
 * 1. 接收任务
 * 2. 生成执行计划
 * 3. 真正调用 sessions_spawn 创建 agent
 * 4. 监控完成状态
 * 5. 自动推进下一个 waiting agent
 * 6. 汇总结果
 * 
 * 用法：
 *   在主会话中调用：
 *   const { autoExecute } = require('./auto-executor');
 *   await autoExecute("先调研方案，然后实现 demo");
 */

const fs = require('fs');
const path = require('path');
const { execute } = require('./live-executor');
const { updateAgentStatus, getNextAgents, recoverResults } = require('./result-recovery');

const ROOT = __dirname;
const RUNTIME_DIR = path.join(ROOT, 'runtime');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * 主自动执行函数
 * 
 * @param {string} taskText - 任务描述
 * @param {object} context - 执行上下文（包含 sessions_spawn 等工具）
 * @returns {Promise<object>} 执行结果
 */
async function autoExecute(taskText, context = {}) {
  const log = context.verbose ? console.log : () => {};
  
  // Step 1: 生成执行计划
  log('\n=== Step 1: Generate Execution Plan ===');
  const plan = await execute(taskText);
  
  if (plan.mode === 'single') {
    return {
      taskId: plan.taskId,
      mode: 'single',
      message: 'Simple task - main agent handles directly',
      result: null
    };
  }

  const taskId = plan.taskId;
  log(`Task ID: ${taskId}`);
  log(`Execution Mode: ${plan.executionMode}`);
  log(`Total Agents: ${plan.totalAgents}`);

  // Step 2: 启动第一批 agent
  log('\n=== Step 2: Spawn Initial Agents ===');
  const spawnedLabels = [];
  
  for (const agent of plan.spawnNow) {
    log(`Spawning: ${agent.label} (${agent.roleId})`);
    
    if (context.sessions_spawn) {
      try {
        // 真实调用 sessions_spawn
        const result = await context.sessions_spawn({
          runtime: 'subagent',
          agentId: agent.agentId,
          model: agent.model,
          mode: agent.mode,
          label: agent.label,
          task: agent.task,
          cleanup: agent.cleanup,
          runTimeoutSeconds: agent.runTimeoutSeconds
        });
        
        log(`✓ Spawned: ${agent.label}`);
        spawnedLabels.push(agent.label);
        
        // 更新状态为 running
        updateAgentStatus(agent.label, 'running');
      } catch (err) {
        log(`✗ Failed to spawn ${agent.label}: ${err.message}`);
        updateAgentStatus(agent.label, 'failed', { error: err.message });
      }
    } else {
      // 模拟模式（用于测试）
      log(`[MOCK] Would spawn: ${agent.label}`);
      spawnedLabels.push(agent.label);
    }
  }

  // Step 3: 等待完成并推进
  log('\n=== Step 3: Monitor & Progress ===');
  
  if (context.sessions_spawn) {
    // 真实模式：返回控制权，由外部监控完成
    return {
      taskId,
      mode: 'multi',
      executionMode: plan.executionMode,
      spawned: spawnedLabels,
      waiting: plan.spawnLater.map(a => a.roleId),
      message: 'Agents spawned. Use result-recovery.js to monitor progress.',
      nextSteps: [
        `1. Wait for agents to complete`,
        `2. Run: node result-recovery.js next`,
        `3. Spawn next agents if dependencies met`,
        `4. Run: node result-recovery.js ${taskId} to get final results`
      ]
    };
  } else {
    // 模拟模式：直接返回计划
    return {
      taskId,
      mode: 'multi',
      executionMode: plan.executionMode,
      plan,
      message: '[MOCK] Execution plan generated. Pass context.sessions_spawn to execute.'
    };
  }
}

/**
 * 检查并推进下一个 agent
 * 
 * @param {object} context - 执行上下文
 * @returns {Promise<object>} 推进结果
 */
async function progressNext(context = {}) {
  const log = context.verbose ? console.log : () => {};
  
  const nextAgents = getNextAgents();
  
  if (nextAgents.length === 0) {
    return { message: 'No agents ready to spawn', next: [] };
  }

  log(`\n=== Ready to spawn: ${nextAgents.length} agents ===`);
  
  const spawned = [];
  for (const agent of nextAgents) {
    log(`Spawning: ${agent.label} (${agent.roleId})`);
    
    if (context.sessions_spawn) {
      try {
        await context.sessions_spawn({
          runtime: 'subagent',
          agentId: agent.agentId || 'main',
          model: agent.model || 'minimax',
          mode: 'run',
          label: agent.label,
          task: agent.task,
          cleanup: 'delete',
          runTimeoutSeconds: 600
        });
        
        log(`✓ Spawned: ${agent.label}`);
        updateAgentStatus(agent.label, 'running');
        spawned.push(agent.label);
      } catch (err) {
        log(`✗ Failed: ${err.message}`);
        updateAgentStatus(agent.label, 'failed', { error: err.message });
      }
    } else {
      log(`[MOCK] Would spawn: ${agent.label}`);
      spawned.push(agent.label);
    }
  }

  return { spawned, total: nextAgents.length };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  
  if (!task) {
    console.error('Usage: node auto-executor.js <task>');
    console.error('Example: node auto-executor.js "先调研方案，然后实现 demo"');
    process.exit(1);
  }

  autoExecute(task, { verbose: true })
    .then(result => {
      console.log('\n=== Auto Execution Result ===');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
      console.error('Auto execution failed:', err.message);
      process.exit(1);
    });
}

module.exports = { autoExecute, progressNext };
