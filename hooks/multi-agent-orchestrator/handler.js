/**
 * Multi-Agent Orchestrator Hook
 *
 * 功能：
 * 1. 拦截 before_agent_start 事件
 * 2. 分析任务复杂度
 * 3. 复杂任务自动路由到多 Agent 系统
 * 4. 简单任务放行给主 Agent
 *
 * 触发时机：before_agent_start
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'stability.json');

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Load config to check mainAgentOnly setting
function isMultiAgentEnabled() {
  const openclawConfig = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(openclawConfig, 'utf8'));
    const maConfig = config?.plugins?.entries?.['openclaw-multi-agent'];
    // If mainAgentOnly is explicitly false, multi-agent is enabled
    return maConfig?.config?.mainAgentOnly === false;
  } catch {
    return false;
  }
}

/**
 * 任务复杂度分析
 * 基于 task-analyzer.cjs 的评分逻辑
 */
function analyzeComplexity(taskText) {
  if (!taskText || typeof taskText !== 'string') {
    return { score: 0, level: 'low', reasons: [] };
  }

  const text = taskText.toLowerCase();
  let score = 0;
  const reasons = [];

  // Stage indicators (0-3)
  const stagePatterns = [
    /调研|研究|分析|对比|评估|搜索|排查|讨论|比较|权衡/i,
    /设计|规划|方案|选型|拆分|切分|制定|决策|路线/i,
    /实现|开发|编写|构建|写|创建|优化|修复|加固|执行|落地/i,
    /测试|验证|检查|回归|审查|评审|稳定|review/i,
  ];

  let stageScore = 0;
  for (const pattern of stagePatterns) {
    if (pattern.test(text)) {
      stageScore++;
      score++;
    }
  }
  if (stageScore >= 3) reasons.push('multi_stage');

  // Multi-domain indicators
  const domainPatterns = [
    /前端|后端|全栈|数据库|架构|运维|安全|性能|UI|UX/i,
    /后端|database|backend|server|api/i,
    /前端|frontend|client|web|react|vue/i,
  ];

  const domainCount = domainPatterns.filter(p => p.test(text)).length;
  if (domainCount >= 2) {
    score += 2;
    reasons.push('multi_domain');
  }

  // Parallelism indicators
  if (/同时|并行|分别|各自/i.test(text)) {
    score += 2;
    reasons.push('parallel');
  }

  // Structure indicators (long complex tasks)
  const clauseCount = taskText.split(/[,，;；。\n]/).filter(Boolean).length;
  if (clauseCount >= 4) {
    score += 1;
    reasons.push('structured');
  }

  // Length bonus
  if (taskText.length > 100) {
    score += 1;
  }
  if (taskText.length > 300) {
    score += 1;
  }

  // Risk/complexity keywords
  const riskPatterns = [
    /重构|重写|迁移|改造|架构调整/i,
    /调试|debug|根因|排查.*问题/i,
    /性能优化|安全|合规|审计/i,
  ];

  for (const pattern of riskPatterns) {
    if (pattern.test(text)) {
      score += 2;
      reasons.push('high_risk');
      break;
    }
  }

  const level = score >= 11 ? 'multi' : score >= 6 ? 'medium' : 'low';
  return { score, level, reasons };
}

/**
 * 判断是否为内部控制任务（应该跳过）
 */
function isInternalControlTask(prompt) {
  if (!prompt || typeof prompt !== 'string') return true;

  const controlPatterns = [
    /^system:/im,
    /^heartbeat(?:_ok)?$/im,
    /read heartbeat\.md if it exists/im,
    /when reading heartbeat\.md/im,
    /^current time:/im,
    /gateway\.restart/im,
    /openclaw doctor/im,
    /openclaw-control-ui/im,
    /before_agent_start/im,
    /^\[cron:/im,
  ];

  return controlPatterns.some(p => p.test(prompt));
}

/**
 * Main hook handler - called by OpenClaw core
 */
const handler = async (event) => {
  const logger = console;

  // Only process main agent bootstrap
  if (!event || typeof event !== 'object') return;
  if (event.type !== 'agent' || event.action !== 'bootstrap') return;

  const session = event.session || {};
  if (session?.agent !== 'main') return;

  // Check if multi-agent is enabled
  if (!isMultiAgentEnabled()) {
    logger.debug('[multi-agent-orchestrator] mainAgentOnly=true, skipping');
    return;
  }

  const prompt = event?.context?.prompt || event?.prompt || '';
  const taskText = typeof prompt === 'string' ? prompt : String(prompt);

  // Skip internal control tasks
  if (isInternalControlTask(taskText)) {
    return;
  }

  // Skip trivial prompts
  if (taskText.length < 10) {
    return;
  }

  // Analyze task complexity
  const complexity = analyzeComplexity(taskText);

  logger.info(`[multi-agent-orchestrator] Task complexity: score=${complexity.score}, level=${complexity.level}, reasons=${complexity.reasons.join(',')}`);

  // If low complexity, let main agent handle it
  if (complexity.level === 'low') {
    logger.debug('[multi-agent-orchestrator] Low complexity, passing to main agent');
    return;
  }

  // High/medium complexity - trigger multi-agent orchestration
  if (complexity.level === 'multi' || complexity.level === 'medium') {
    logger.info(`[multi-agent-orchestrator] ${complexity.level} complexity task detected, triggering multi-agent orchestration`);

    try {
      const { enqueue } = require(path.join(ROOT, 'task-intake'));
      const intake = enqueue(taskText, 'hook', {
        sessionId: session?.sessionId || null,
        complexity: complexity,
      });

      if (intake) {
        logger.info(`[multi-agent-orchestrator] Task enqueued: ${intake.id}, needsMultiAgent=${intake.payload.plan.needsMultiAgent}`);
      }
    } catch (err) {
      logger.error(`[multi-agent-orchestrator] Failed to enqueue task: ${err.message}`);
    }
  }
};

module.exports = {
  name: 'multi-agent-orchestrator',
  version: '1.2.0',
  events: ['agent'], // agent type with bootstrap action checked in handler
  handler,
};
