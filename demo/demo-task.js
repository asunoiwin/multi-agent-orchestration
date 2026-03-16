#!/usr/bin/env node
/**
 * Demo Task - 最小可执行 Demo 入口
 * 
 * 用法：
 *   node demo/demo-task.js [任务描述]
 * 
 * 输出：
 *   JSON 格式的编排结果，包含可执行的 spawn 指令
 */

const path = require('path');

// 将父目录的模块加入路径
const ROOT = path.join(__dirname, '..');
const { orchestrate } = require(path.join(ROOT, 'orchestrator-main'));

// 预定义测试任务
const DEMO_TASKS = {
  '1': '先调研方案，然后实现 demo',
  '2': '同时实现用户认证和订单管理模块',
  '3': '检查代码质量并修复问题',
  '4': '搜索最佳实践，编写技术文档'
};

async function runDemo(taskText, options = {}) {
  const log = options.verbose ? console.log : () => {};
  
  log('\n========== Multi-Agent Orchestration Demo ==========\n');
  log(`Task: ${taskText}`);
  log('');

  try {
    const result = await orchestrate(taskText, {
      verbose: false,
      context: {
        sessionId: process.env.OPENCLAW_SESSION_ID || 'demo-session',
        taskRoot: ROOT
      }
    });

    // 输出结果
    if (options.jsonOnly) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('=== 编排结果 ===');
      console.log(`Task ID: ${result.taskId}`);
      console.log(`模式: ${result.mode}`);
      console.log(`执行模式: ${result.plan?.executionMode || 'N/A'}`);
      console.log(`需要多 Agent: ${result.plan?.needsMultiAgent}`);
      console.log('');
      
      if (result.spawnInstructions?.length > 0) {
        console.log('=== 待 Spawn 的 Agents ===');
        result.spawnInstructions.forEach((inst, idx) => {
          console.log(`[${idx + 1}] ${inst.title} (${inst.label})`);
          console.log(`    Role: ${inst.roleId}`);
          console.log(`    Stage: ${inst.spawnCall?.metadata?.stage || 'N/A'}`);
          console.log('');
        });
      }
      
      if (result.plan?.teams?.length > 0) {
        console.log('=== 团队拆分 ===');
        result.plan.teams.forEach(team => {
          console.log(`- ${team.id}: ${team.workers.map(w => w.title).join(', ')}`);
        });
        console.log('');
      }
      
      if (result.plan?.syncPlan?.length > 0) {
        console.log('=== 同步点 ===');
        result.plan.syncPlan.forEach(sync => {
          console.log(`- ${sync.id}: ${sync.kind} (${sync.goal})`);
        });
        console.log('');
      }
      
      console.log('=== 完整 JSON 输出 ===');
      console.log(JSON.stringify(result, null, 2));
    }

    return result;

  } catch (err) {
    console.error('Demo 失败:', err.message);
    process.exit(1);
  }
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // 解析参数
  const options = {
    verbose: args.includes('-v') || args.includes('--verbose'),
    jsonOnly: args.includes('--json'),
    help: args.includes('-h') || args.includes('--help')
  };
  
  // 过滤掉参数，只保留任务描述
  const taskArgs = args.filter(arg => !arg.startsWith('-'));
  let taskText = taskArgs.join(' ').trim();

  if (options.help) {
    console.log(`
Multi-Agent Orchestration Demo

用法:
  node demo/demo-task.js [选项] [任务描述]

选项:
  -v, --verbose    显示详细日志
  -j, --json      只输出 JSON 结果
  -h, --help      显示帮助

预定义任务:
  1. 先调研方案，然后实现 demo
  2. 同时实现用户认证和订单管理模块
  3. 检查代码质量并修复问题
  4. 搜索最佳实践，编写技术文档

示例:
  node demo/demo-task.js "先调研方案，然后实现 demo"
  node demo/demo-task.js --json "检查代码质量"
  node demo/demo-task.js 1
`);
    process.exit(0);
  }

  // 如果输入是数字，选择预定义任务
  if (DEMO_TASKS[taskText]) {
    taskText = DEMO_TASKS[taskText];
  }

  if (!taskText) {
    // 默认使用第一个任务
    taskText = DEMO_TASKS['1'];
  }

  runDemo(taskText, options);
}

module.exports = { runDemo, DEMO_TASKS };
