/**
 * Multi-Agent Orchestrator Hook
 * 
 * 功能：在消息到达主会话前，强制判断是否需要多 agent
 * 触发时机：before_agent_start
 */

const { analyzeTask } = require('../../workspace/multi-agent-orchestration/task-analyzer');
const { autoExecute } = require('../../workspace/multi-agent-orchestration/auto-executor');

module.exports = {
  name: 'multi-agent-orchestrator',
  version: '1.0.0',
  
  async execute(context, api) {
    const { event, agentId } = context;
    
    // 只处理主会话
    if (agentId !== 'main') {
      return;
    }
    
    // 只处理 before_agent_start 事件
    if (event.type !== 'before_agent_start') {
      return;
    }
    
    const userMessage = event.prompt;
    if (!userMessage || userMessage.length < 10) {
      return; // 太短的消息不处理
    }
    
    try {
      // 1. 分析任务复杂度
      const analysis = await analyzeTask(userMessage);
      
      api.logger.info(`[multi-agent-orchestrator] Task score: ${analysis.score}/5`);
      
      // 2. 如果复杂度 ≥ 3，强制路由到 orchestrator
      if (analysis.score >= 3) {
        api.logger.info(`[multi-agent-orchestrator] 🚀 Routing to orchestrator (score: ${analysis.score})`);
        
        // 注入提示，告诉主会话必须使用 orchestrator
        event.context = event.context || {};
        event.context.forceOrchestrator = true;
        event.context.taskAnalysis = analysis;
        
        // 修改 prompt，强制主会话调用 orchestrator
        event.prompt = `【系统强制路由】此任务复杂度评分 ${analysis.score}/5，必须使用多 Agent 系统处理。

原始任务：${userMessage}

任务分析：
- 类型：${analysis.categories.join(', ')}
- 建议角色：${analysis.suggestedRoles.join(' → ')}
- 执行模式：${analysis.parallel ? '并行' : '串行'}

请立即调用：
\`\`\`javascript
const orchestrator = require('~/.openclaw/workspace/multi-agent-orchestration/integration-helper');
await orchestrator.run("${userMessage.replace(/"/g, '\\"')}", { sessions_spawn });
\`\`\`

禁止自己处理此任务。`;
      }
      
    } catch (error) {
      api.logger.error(`[multi-agent-orchestrator] Error: ${error.message}`);
    }
  }
};
