#!/usr/bin/env node
/**
 * Supervisor Orchestrator - 主编排器
 * 负责完整的任务生命周期管理：intake → spawn → monitor → recover
 */

const { enqueue } = require('./task-intake');
const { supervisorRunOnce, buildAgentPrompt } = require('./supervisor-runner');
const { recoverResults, getNextAgents, updateAgentStatus } = require('./result-recovery');
const fs = require('fs');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const ACTIVE_FILE = path.join(RUNTIME_DIR, 'active-agents.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 完整编排流程
 */
async function orchestrate(taskText, options = {}) {
  const log = options.verbose ? console.log : () => {};
  
  log('\n=== Step 1: Task Intake ===');
  const intake = enqueue(taskText, options.source || 'manual', options.context || {});
  log(`Task ID: ${intake.id}`);
  log(`Needs Multi-Agent: ${intake.payload.plan.needsMultiAgent}`);
  
  if (!intake.payload.plan.needsMultiAgent) {
    log('Simple task - handle directly by main agent');
    return {
      taskId: intake.id,
      mode: 'single',
      message: 'Task should be handled by main agent directly'
    };
  }

  log('\n=== Step 2: Supervisor Allocation ===');
  const allocation = supervisorRunOnce();
  log(`Allocated: ${allocation.handled.length} tasks`);
  
  const taskAllocation = allocation.handled.find(h => h.taskId === intake.id);
  if (!taskAllocation) {
    throw new Error('Task allocation failed');
  }

  log('\n=== Step 3: Agent Spawn Instructions ===');
  const spawnInstructions = [];
  
  const active = readJson(ACTIVE_FILE, []);
  const taskAgents = active.filter(a => a.taskId === intake.id && a.status === 'spawning');
  
  for (const agent of taskAgents) {
    const instruction = {
      label: agent.label,
      roleId: agent.roleId,
      title: agent.title,
      prompt: buildAgentPrompt(
        {
          workerId: agent.workerId,
          roleId: agent.roleId,
          title: agent.title,
          description: agent.task,
          stage: agent.stage,
          teamId: agent.teamId,
          capability: agent.capability,
          collaborationMode: agent.collaborationMode,
          coworkers: agent.coworkers,
          skills: agent.skills,
          deny: agent.deny,
          memory: agent.memory
        },
        {
          id: intake.id,
          context: intake.payload.context,
          task: taskText,
          executionMode: intake.payload.plan.executionMode,
          syncPlan: intake.payload.plan.syncPlan
        }
      ),
      spawnCall: {
        runtime: 'subagent',
        mode: 'session',
        label: agent.label,
        model: 'minimax',
        task: `<see prompt above>`,
        cleanup: 'keep',
        timeoutSeconds: 1800,
        metadata: {
          taskId: intake.id,
          sessionId: intake.payload.context?.sessionId || null,
          workerId: agent.workerId,
          roleId: agent.roleId,
          teamId: agent.teamId,
          stage: agent.stage
        }
      }
    };
    spawnInstructions.push(instruction);
  }

  log(`Ready to spawn: ${spawnInstructions.length} agents`);

  return {
    taskId: intake.id,
    context: intake.payload.context,
    mode: 'multi',
    plan: intake.payload.plan,
    allocation: taskAllocation,
    spawnInstructions,
    nextSteps: [
      '1. Call sessions_spawn for each agent in spawnInstructions',
      '2. Monitor progress with: node result-recovery.js next',
      '3. Recover results with: node result-recovery.js <taskId>'
    ]
  };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  
  if (!task) {
    console.error('Usage: node orchestrator-main.js <task>');
    console.error('Example: node orchestrator-main.js "先调研方案，然后实现 demo"');
    process.exit(1);
  }

  orchestrate(task, { verbose: true })
    .then(result => {
      console.log('\n=== Orchestration Result ===');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.mode === 'multi' && result.spawnInstructions) {
        console.log('\n=== Agent Spawn Commands ===');
        result.spawnInstructions.forEach((inst, idx) => {
          console.log(`\n[${idx + 1}] ${inst.title} (${inst.label})`);
          console.log('---');
          console.log('Prompt:');
          console.log(inst.prompt.split('\n').slice(0, 10).join('\n'));
          console.log('...');
          console.log('\nSpawn with sessions_spawn:');
          console.log(JSON.stringify(inst.spawnCall, null, 2));
        });
      }
    })
    .catch(err => {
      console.error('Orchestration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { orchestrate };
