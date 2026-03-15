#!/usr/bin/env node
/**
 * Multi-Agent Orchestrator
 * 多 Agent 协作系统主入口
 */

const { analyzeTask } = require('./task-analyzer.cjs');
const { generateAgentTemplate } = require('./agent-manager.js');

/**
 * 编排任务
 */
async function orchestrate(userInput, context = {}) {
  console.log('[orchestrator] Analyzing task...');
  
  // 1. 分析任务
  const analysis = await analyzeTask(userInput, context);
  const needsMultiAgent = analysis.decision === 'light_multi' || analysis.decision === 'multi';
  const suggestedRoles = (analysis.agents || []).map((agent) => String(agent.role || '').toLowerCase());
  const executionMode = analysis.decision === 'multi' ? 'parallel' : needsMultiAgent ? 'serial' : 'single';
  
  console.log(`[orchestrator] Task complexity: ${analysis.total_score}`);
  console.log(`[orchestrator] Needs multi-agent: ${needsMultiAgent}`);
  
  if (!needsMultiAgent) {
    console.log('[orchestrator] Task is simple, main agent will handle it');
    return {
      mode: 'single',
      handler: 'main'
    };
  }
  
  // 2. 生成执行计划
  console.log(`[orchestrator] Suggested roles: ${suggestedRoles.join(', ')}`);
  console.log(`[orchestrator] Execution mode: ${executionMode}`);
  
  const plan = {
    mode: 'multi',
    executionMode,
    agents: [],
    workflow: []
  };
  
  // 3. 为每个角色生成配置
  for (const role of suggestedRoles) {
    const agentConfig = generateAgentTemplate(role);
    plan.agents.push({
      role,
      config: agentConfig,
      status: 'pending'
    });
  }
  
  // 4. 生成工作流
  if (executionMode === 'parallel') {
    plan.workflow = [
      {
        step: 1,
        agents: suggestedRoles,
        mode: 'parallel'
      }
    ];
  } else if (executionMode === 'serial') {
    plan.workflow = suggestedRoles.map((role, index) => ({
      step: index + 1,
      agents: [role],
      mode: 'serial'
    }));
  } else {
    // hybrid
    plan.workflow = [
      {
        step: 1,
        agents: ['researcher'],
        mode: 'serial'
      },
      {
        step: 2,
        agents: ['builder', 'auditor'],
        mode: 'parallel'
      }
    ];
  }
  
  return plan;
}

/**
 * 显示执行计划
 */
function displayPlan(plan) {
  console.log('\n=== Execution Plan ===');
  console.log(`Mode: ${plan.mode}`);
  
  if (plan.mode === 'single') {
    console.log(`Handler: ${plan.handler}`);
    return;
  }
  
  console.log(`Execution Mode: ${plan.executionMode}`);
  console.log('\nAgents:');
  plan.agents.forEach(agent => {
    console.log(`  - ${agent.role} (${agent.config.model})`);
    console.log(`    Tools: ${agent.config.tools.join(', ')}`);
  });
  
  console.log('\nWorkflow:');
  plan.workflow.forEach(step => {
    console.log(`  Step ${step.step} (${step.mode}):`);
    step.agents.forEach(agent => {
      console.log(`    - ${agent}`);
    });
  });
  
  console.log('======================\n');
}

// CLI 接口
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');
  
  if (!input) {
    console.error('Usage: node orchestrator.js <task description>');
    process.exit(1);
  }
  
  orchestrate(input)
    .then(plan => {
      displayPlan(plan);
      
      // 保存计划
      const fs = require('fs');
      const path = require('path');
      const { homedir } = require('os');
      
      const planFile = path.join(
        homedir(),
        '.openclaw',
        'workspace',
        '.learnings',
        'agents',
        'current-plan.json'
      );
      
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
      console.log(`Plan saved to: ${planFile}`);
    })
    .catch(error => {
      console.error('[orchestrator] Error:', error);
      process.exit(1);
    });
}

module.exports = { orchestrate };
