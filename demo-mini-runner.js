#!/usr/bin/env node
/**
 * Minimal Demo Runner - 最小可执行 demo 演示脚本
 * 
 * 用途: 演示 multi-agent-orchestration 的完整流程
 * 配置: 精简版 3-agent 流程 (Web Researcher → Solution Architect → Code Implementer)
 * 
 * 使用方式:
 *   node demo-mini-runner.js                    # 交互模式
 *   node demo-mini-runner.js "搜索 AI Agent 框架" # 命令行模式
 */

const { orchestrate } = require('./orchestrator-main');
const fs = require('fs');
const path = require('path');

const RUNTIME_DIR = path.join(__dirname, 'runtime');
const TASKS_DIR = path.join(__dirname, 'tasks');

/**
 * 构建 agent prompt (从 supervisor-runner.js 简化)
 */
function buildPrompt(subtask, taskContext) {
  const sessionId = taskContext?.context?.sessionId || taskContext?.sessionId || 'unknown';
  const originalTask = taskContext?.task || 'unknown';
  const executionMode = taskContext?.executionMode || 'hybrid';
  const taskRoot = taskContext?.context?.taskRoot || __dirname;
  const coworkers = Array.isArray(subtask.coworkers) ? subtask.coworkers : [];
  
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
    `- Team ID: ${subtask.stage}-${subtask.capability}-team`,
    `- Stage: ${subtask.stage}`,
    `- Execution Mode: ${executionMode}`,
    `- Task Root: ${taskRoot}`,
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

/**
 * 过滤为精简版 agents (最多 3 个)
 */
function filterMiniAgents(taskFile, maxAgents = 3) {
  // 从 task file 读取完整的 subtasks
  const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const subtasks = taskData.plan?.subtasks || [];
  
  // 优先选择: research → planning → implementation
  const priority = ['research', 'planning', 'implementation'];
  
  const filtered = [];
  for (const cap of priority) {
    const subtask = subtasks.find(st => st.capability === cap);
    if (subtask && filtered.length < maxAgents) {
      // 避免重复添加
      if (!filtered.find(f => f.workerId === subtask.workerId)) {
        filtered.push({
          workerId: subtask.workerId,
          roleId: subtask.roleId,
          title: subtask.title,
          stage: subtask.stage,
          capability: subtask.capability,
          description: subtask.description,
          objective: subtask.objective,
          dependsOn: subtask.dependsOn,
          skills: subtask.skills,
          deny: subtask.deny,
          memory: subtask.memory,
          coworkers: subtask.coworkers,
          collaborationMode: subtask.collaborationMode
        });
      }
    }
  }
  
  // 如果不够 3 个，从剩余中补充
  if (filtered.length < maxAgents) {
    const used = new Set(filtered.map(a => a.workerId));
    for (const subtask of subtasks) {
      if (!used.has(subtask.workerId) && filtered.length < maxAgents) {
        filtered.push({
          workerId: subtask.workerId,
          roleId: subtask.roleId,
          title: subtask.title,
          stage: subtask.stage,
          capability: subtask.capability,
          description: subtask.description,
          objective: subtask.objective,
          dependsOn: subtask.dependsOn,
          skills: subtask.skills,
          deny: subtask.deny,
          memory: subtask.memory,
          coworkers: subtask.coworkers,
          collaborationMode: subtask.collaborationMode
        });
      }
    }
  }
  
  return filtered;
}

/**
 * 模拟 sessions_spawn (实际使用时替换为真实工具)
 */
async function mockSpawn(spawnCall) {
  console.log('\n=== 模拟 spawn ===');
  console.log(`Label: ${spawnCall.label}`);
  console.log(`Role: ${spawnCall.metadata?.roleId || 'unknown'}`);
  console.log(`Stage: ${spawnCall.metadata?.stage || 'unknown'}`);
  console.log('(实际调用 sessions_spawn 时会创建真实子会话)');
  
  return {
    ok: true,
    sessionId: `mock-session-${Date.now()}`,
    label: spawnCall.label
  };
}

/**
 * 运行 mini demo
 */
async function runMiniDemo(taskText, options = {}) {
  const verbose = options.verbose !== false;
  const log = verbose ? console.log : () => {};
  
  console.log('\n' + '='.repeat(60));
  console.log('  Mini Demo Runner - 最小可执行 Demo');
  console.log('='.repeat(60));
  
  log('\n📋 步骤 1: 任务分析');
  const result = await orchestrate(taskText, { verbose: false });
  
  console.log(`\n任务 ID: ${result.taskId}`);
  console.log(`复杂度评分: ${result.plan.complexityScore}`);
  console.log(`执行模式: ${result.plan.executionMode}`);
  console.log(`需要多 Agent: ${result.plan.needsMultiAgent}`);
  
  if (!result.plan.needsMultiAgent) {
    console.log('\n⚠️ 任务过于简单，不需要多 Agent 处理');
    return { taskId: result.taskId, mode: 'single' };
  }
  
  log('\n📋 步骤 2: 过滤精简版 Agents');
  // 找到对应的 task file
  const taskFile = path.join(TASKS_DIR, `${result.taskId}.json`);
  const miniAgents = filterMiniAgents(taskFile, 3);
  
  console.log('\n精简版 Agent 列表:');
  miniAgents.forEach((agent, idx) => {
    console.log(`  ${idx + 1}. ${agent.title} (${agent.roleId}) - Stage: ${agent.stage}, Capability: ${agent.capability}`);
  });
  
  // 保存执行计划
  const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const planFile = path.join(RUNTIME_DIR, 'execution-plan.mini.json');
  fs.writeFileSync(planFile, JSON.stringify({
    taskId: result.taskId,
    taskText,
    executionMode: result.plan.executionMode,
    teams: result.plan.teams,
    agents: miniAgents.map(a => ({
      label: `${result.taskId}-${a.workerId}`,
      workerId: a.workerId,
      roleId: a.roleId,
      title: a.title,
      stage: a.stage,
      capability: a.capability,
      objective: a.objective,
      dependsOn: a.dependsOn
    }))
  }, null, 2));
  
  log('\n📋 步骤 3: 生成 Spawn 指令');
  
  // 构建 spawn 指令
  for (const agent of miniAgents) {
    console.log(`\n--- Agent: ${agent.title} (${agent.roleId}) ---`);
    console.log(`Stage: ${agent.stage}, Capability: ${agent.capability}`);
    console.log(`Objective: ${agent.objective}`);
    console.log(`Depends on: ${agent.dependsOn.join(', ') || 'none'}`);
    console.log(`Skills: ${agent.skills.join(', ')}`);
    
    // 构建完整的 prompt
    const prompt = buildPrompt(agent, {
      id: result.taskId,
      task: taskText,
      executionMode: result.plan.executionMode,
      context: result.context
    });
    
    console.log(`\nPrompt (前 500 字符):`);
    console.log(prompt.substring(0, 500) + '...');
    
    // 构建 spawn call
    const spawnCall = {
      runtime: 'subagent',
      mode: 'session',
      label: `${result.taskId}-${agent.workerId}`,
      model: 'minimax',
      task: '<see prompt above>',
      cleanup: 'keep',
      timeoutSeconds: 1800,
      metadata: {
        taskId: result.taskId,
        sessionId: result.context?.sessionId || null,
        workerId: agent.workerId,
        roleId: agent.roleId,
        teamId: `${agent.stage}-${agent.capability}-team`,
        stage: agent.stage
      }
    };
    
    console.log('\nSpawn Call:');
    console.log(JSON.stringify(spawnCall, null, 2));
    
    // 如果是模拟模式，跳过真实 spawn
    if (options.mock !== false) {
      await mockSpawn(spawnCall);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('  Mini Demo 计划生成完成!');
  console.log('='.repeat(60));
  
  console.log('\n📖 后续步骤:');
  console.log('1. 使用 sessions_spawn 依次创建子会话');
  console.log('2. 每个 agent 完成后，调用 result-recovery.js 更新状态');
  console.log('3. 所有 agent 完成后，汇总结果');
  
  return {
    taskId: result.taskId,
    mode: 'multi',
    agents: miniAgents,
    planFile
  };
}

/**
 * 主入口
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const taskText = args.join(' ').trim() || '先调研现有方案并给出一个最小可执行 demo 的设计切分，再安排后续实现、审查和交付说明';
  
  runMiniDemo(taskText, { verbose: true, mock: true })
    .then(result => {
      console.log('\n✅ Demo 完成');
      console.log('结果已保存到:', result.planFile);
    })
    .catch(err => {
      console.error('❌ Demo 失败:', err.message);
      process.exit(1);
    });
}

module.exports = { runMiniDemo, filterMiniAgents };
