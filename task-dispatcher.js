#!/usr/bin/env node
/**
 * 多Agent任务分发器 (Task Dispatcher)
 * 
 * 功能：
 * 1. 自动分析任务类型，判断派发给哪个Agent
 * 2. 支持并行分发多个独立任务
 * 3. 支持串行依赖链
 * 4. 收集并汇总结果
 * 
 * 使用方式：
 *   node task-dispatcher.js <任务描述> [--parallel] [--agent=<agent-id>]
 */

const readline = require('readline');

// ==================== 角色配置 ====================
const AGENTS = {
  researcher: {
    name: '研究员',
    keywords: ['搜索', '调研', '分析', '研究', '对比', '查找', '了解', '收集', '查询'],
    tools: ['read', 'exec', 'web_fetch', 'memory', 'browser'],
    description: '信息收集与分析：轻量抓取用 web_fetch，需要交互/搜索/滚动用 browser 工具'
  },
  builder: {
    name: '开发者',
    keywords: ['开发', '编写', '实现', '写代码', '创建', '制作', '修改', '构建', '配置', '安装'],
    tools: ['read', 'write', 'edit', 'exec'],
    description: '代码编写与实现'
  },
  auditor: {
    name: '审计员',
    keywords: ['检查', '审查', '验证', '测试', '审计', '评估', '排查', '修复', 'lint'],
    tools: ['read', 'exec'],
    description: '代码审查与安全检查'
  }
};

// ==================== 任务分析 ====================

/**
 * 分析任务类型
 * @param {string} task - 任务描述
 * @returns {Object} - { type: string, agents: string[], confidence: number }
 */
function analyzeTask(task) {
  const taskLower = task.toLowerCase();
  const scores = {};
  
  // 计算每个Agent的匹配分数
  for (const [agentId, agent] of Object.entries(AGENTS)) {
    let score = 0;
    for (const keyword of agent.keywords) {
      if (taskLower.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    scores[agentId] = score;
  }
  
  // 排序并返回最高匹配
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topScore = sorted[0][1];
  
  // 判断是否为复合任务（多个Agent分数相近）
  const matchedAgents = sorted.filter(([_, score]) => score > 0).map(([id]) => id);
  
  if (matchedAgents.length === 0) {
    return { type: 'unknown', agents: [], confidence: 0 };
  }
  
  const confidence = topScore > 0 ? Math.min(topScore / 2, 1) : 0;
  const isComposite = sorted[0][1] > 0 && sorted[1] && sorted[1][1] > 0 && 
                      (sorted[0][1] - sorted[1][1]) <= 1;
  
  return {
    type: isComposite ? 'composite' : 'single',
    agents: isComposite ? matchedAgents : [matchedAgents[0]],
    confidence,
    scores
  };
}

/**
 * 判断任务是否可并行
 * @param {string} task - 任务描述
 * @returns {Object} - { parallel: boolean, reason: string }
 */
function analyzeParallelism(task) {
  const taskLower = task.toLowerCase();
  
  // 明确需要串行的关键词
  const serialKeywords = ['先', '然后', '之后', '依赖', '基于', '根据', '再'];
  for (const kw of serialKeywords) {
    if (taskLower.includes(kw)) {
      return { parallel: false, reason: `包含顺序关键词: ${kw}` };
    }
  }
  
  // 明确需要并行的关键词
  const parallelKeywords = ['同时', '并行', '多个', '分别', '各自'];
  for (const kw of parallelKeywords) {
    if (taskLower.includes(kw)) {
      return { parallel: true, reason: `包含并行关键词: ${kw}` };
    }
  }
  
  // 多任务符号检测
  if (task.includes('|') || task.includes('&&') || task.includes('和') && task.split('和').length > 2) {
    return { parallel: true, reason: '检测到多任务分隔符' };
  }
  
  return { parallel: false, reason: '默认为串行执行' };
}

// ==================== 任务分发 ====================

/**
 * 生成任务分发指令
 * @param {Object} taskAnalysis - 任务分析结果
 * @param {Object} parallelism - 并行分析结果
 * @param {string} task - 原始任务
 * @returns {Object} - 分发计划
 */
function generateDispatchPlan(taskAnalysis, parallelism, task) {
  const plan = {
    originalTask: task,
    type: taskAnalysis.type,
    parallel: parallelism.parallel,
    reason: parallelism.reason,
    agents: [],
    subtasks: []
  };
  
  if (taskAnalysis.agents.length === 0) {
    plan.fallback = true;
    plan.agents.push({ id: 'researcher', reason: '默认研究员' });
    return plan;
  }
  
  // 为每个匹配的Agent生成任务
  for (const agentId of taskAnalysis.agents) {
    const agent = AGENTS[agentId];
    plan.agents.push({
      id: agentId,
      name: agent.name,
      reason: `匹配度: ${taskAnalysis.scores[agentId]}`,
      tools: agent.tools
    });
    
    // 生成子任务描述
    const subtask = generateSubtask(agentId, task);
    plan.subtasks.push({
      agentId,
      description: subtask,
      dependsOn: plan.parallel ? [] : (plan.subtasks.length > 0 ? [plan.subtasks[plan.subtasks.length - 1].agentId] : [])
    });
  }
  
  return plan;
}

/**
 * 为特定Agent生成子任务描述
 */
function generateSubtask(agentId, task) {
  const templates = {
    researcher: `请调研并分析：${task}。提供详细信息和参考来源。`,
    builder: `请实现：${task}。提供代码/配置和说明。`,
    auditor: `请审查/验证：${task}。提供检查结果和改进建议。`
  };
  return templates[agentId] || task;
}

// ==================== CLI 接口 ====================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  
  // 解析参数
  let task = '';
  let forceParallel = false;
  let forceAgent = null;
  
  for (const arg of args) {
    if (arg.startsWith('--parallel')) {
      forceParallel = true;
    } else if (arg.startsWith('--agent=')) {
      forceAgent = arg.replace('--agent=', '');
    } else if (!arg.startsWith('--')) {
      task = arg;
    }
  }
  
  // 分析任务
  const taskAnalysis = analyzeTask(task);
  const parallelism = forceParallel 
    ? { parallel: true, reason: '强制并行' }
    : analyzeParallelism(task);
  
  // 生成计划
  const plan = generateDispatchPlan(taskAnalysis, parallelism, task);
  
  // 输出结果
  console.log('\n📋 任务分析结果\n');
  console.log(`原始任务: ${task}`);
  console.log(`\n任务类型: ${taskAnalysis.type}`);
  console.log(`匹配Agent: ${taskAnalysis.agents.join(', ') || '无'}`);
  console.log(`置信度: ${(taskAnalysis.confidence * 100).toFixed(0)}%`);
  console.log(`\n执行模式: ${plan.parallel ? '并行' : '串行'}`);
  console.log(`原因: ${plan.reason}`);
  
  if (plan.fallback) {
    console.log(`\n⚠️ 未识别到明确任务类型，使用默认Agent`);
  }
  
  console.log('\n📨 分发计划:\n');
  for (const agent of plan.agents) {
    console.log(`  → ${agent.name} (${agent.id})`);
    console.log(`    理由: ${agent.reason}`);
    console.log(`    工具: ${agent.tools.join(', ')}`);
  }
  
  if (plan.subtasks.length > 0) {
    console.log('\n📝 子任务列表:');
    for (const st of plan.subtasks) {
      const dependsText = st.dependsOn.length > 0 ? ` [依赖: ${st.dependsOn.join(', ')}]` : '';
      console.log(`  ${st.agentId}: ${st.description}${dependsText}`);
    }
  }
  
  // 输出可执行的subagent命令
  console.log('\n🚀 执行命令:\n');
  if (plan.parallel && plan.subtasks.length > 1) {
    console.log('# 并行执行 (在主会话中同时创建多个子代理)');
    for (const st of plan.subtasks) {
      console.log(`subagent create --agent=${st.agentId} --task="${st.description}" &`);
    }
  } else {
    const st = plan.subtasks[0];
    if (st) {
      console.log(`subagent create --agent=${st.agentId} --task="${st.description}"`);
    }
  }
  
  console.log('');
}

function printHelp() {
  console.log(`
多Agent任务分发器 (Task Dispatcher)
======================================

用法:
  node task-dispatcher.js <任务描述> [选项]

选项:
  --parallel           强制并行执行
  --agent=<agent-id>   强制指定Agent (researcher/builder/auditor)
  --help, -h           显示帮助

示例:
  node task-dispatcher.js "搜索React最新版本"
  node task-dispatcher.js "开发用户认证系统" --parallel
  node task-dispatcher.js "检查代码安全性" --agent=auditor

任务类型识别:
  - 调研类 → researcher
  - 开发类 → builder  
  - 审查类 → auditor
  `.trim());
}

// 导出模块接口
module.exports = {
  analyzeTask,
  analyzeParallelism,
  generateDispatchPlan,
  AGENTS
};

// 如果直接运行
if (require.main === module) {
  main();
}
