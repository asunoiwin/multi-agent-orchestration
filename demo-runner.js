#!/usr/bin/env node
/**
 * Demo Runner - 整合编排系统与业务 Demo
 * 
 * 用法：
 *   node demo-runner.js [任务描述]
 * 
 * 功能：
 *   1. 调用编排系统分析任务
 *   2. 输出可执行的 spawn 指令
 *   3. 执行业务 Demo 模块
 */

const path = require('path');

const ROOT = path.join(__dirname);
const DEMO_DIR = path.join(ROOT, 'demo');

async function runDemo(taskText) {
  console.log('\n========== Multi-Agent Orchestration Demo Runner ==========\n');
  console.log(`Task: ${taskText}\n`);

  try {
    // Step 1: 编排任务
    console.log('--- Step 1: 编排任务分析 ---');
    const { orchestrate } = require(path.join(ROOT, 'orchestrator-main'));
    
    const result = await orchestrate(taskText, {
      verbose: false,
      context: {
        sessionId: process.env.OPENCLAW_SESSION_ID || 'demo-runner-session',
        taskRoot: ROOT
      }
    });

    console.log(`✓ Task ID: ${result.taskId}`);
    console.log(`✓ 模式: ${result.mode}`);
    console.log(`✓ 复杂度: ${result.plan?.complexityScore}`);
    console.log(`✓ 需要多 Agent: ${result.plan?.needsMultiAgent}`);

    // Step 2: 输出 Agent 分配
    if (result.spawnInstructions?.length > 0) {
      console.log('\n--- Step 2: 待启动 Agents ---');
      result.spawnInstructions.forEach((inst, idx) => {
        console.log(`[${idx + 1}] ${inst.title} (${inst.label})`);
        console.log(`    Role: ${inst.roleId}`);
        console.log(`    Stage: ${inst.spawnCall?.metadata?.stage || 'N/A'}`);
        console.log('');
      });
    }

    // Step 3: 执行业务 Demo
    console.log('--- Step 3: 执行业务 Demo ---');
    
    // 根据任务类型选择 Demo
    let demoModule;
    if (/认证|登录|用户|auth|login|user/i.test(taskText)) {
      demoModule = require(path.join(DEMO_DIR, 'auth-module'));
      console.log('→ 运行认证模块 Demo');
    } else if (/订单|order/i.test(taskText)) {
      demoModule = require(path.join(DEMO_DIR, 'order-module'));
      console.log('→ 运行订单模块 Demo');
    } else {
      // 默认运行组合 Demo
      const authDemo = require(path.join(DEMO_DIR, 'auth-module'));
      const orderDemo = require(path.join(DEMO_DIR, 'order-module'));
      
      console.log('→ 运行组合 Demo (Auth + Order)');
      
      // 演示用户注册
      const user = authDemo.register('demo_user', 'demo123', 'demo@example.com');
      console.log(`  ✓ 注册用户: ${user.username}`);
      
      // 演示登录
      const login = authDemo.login('demo_user', 'demo123');
      console.log(`  ✓ 用户登录: ${login.user.username}`);
      
      // 演示创建订单
      const order = orderDemo.createOrder({
        userId: login.user.id,
        items: [
          { name: 'Demo Product', price: 99.99, quantity: 1 }
        ]
      });
      console.log(`  ✓ 创建订单: ${order.id}`);
      
      // 演示状态流转
      const confirmed = orderDemo.updateOrderStatus(order.id, orderDemo.OrderStatus.CONFIRMED);
      console.log(`  ✓ 订单状态: ${confirmed.status}`);
    }

    // Step 4: 输出执行指令
    console.log('\n--- Step 4: 可执行的 sessions_spawn 指令 ---');
    if (result.spawnInstructions?.length > 0) {
      const spawnJson = JSON.stringify(result.spawnInstructions.map(inst => inst.spawnCall), null, 2);
      console.log(spawnJson);
    } else {
      console.log('(无需启动额外 Agents)');
    }

    console.log('\n========== Demo 完成 ==========\n');
    
    return {
      orchestration: result,
      demoOutput: 'success'
    };

  } catch (err) {
    console.error('Demo 失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  let taskText = args.join(' ').trim();

  if (!taskText) {
    taskText = '先调研方案，然后实现 demo';
  }

  runDemo(taskText);
}

module.exports = { runDemo };
