#!/usr/bin/env node
/**
 * 任务分析引擎 (v2)
 * 基于 6 维度评分判断任务复杂度
 * 借鉴 GPT 方案优化
 */

const { execSync } = require('child_process');

// ============================================================================
// 评分配置
// ============================================================================

const SCORE_THRESHOLDS = {
  single: 6,
  multi: 11
};

// ============================================================================
// 评分函数
// ============================================================================

/**
 * 评估阶段数 (0-3)
 */
function scoreStages(input) {
  let score = 0;
  
  // 明确阶段词
  if (/调研|研究|分析|对比|评估|搜索/.test(input)) score++;
  if (/设计|规划|方案|选型/.test(input)) score++;
  if (/实现|开发|编写|构建|写|创建/.test(input)) score++;
  if (/测试|验证|检查/.test(input)) score++;
  if (/部署|发布|上线/.test(input)) score++;
  
  // 明确多阶段
  if (/第一.{1,10}第二|首先.{1,10}然后|分析.{1,20}实现/.test(input)) score = Math.min(score, 3);
  
  return Math.min(score, 3);
}

/**
 * 评估并行性 (0-3)
 */
function scoreParallelism(input) {
  let score = 0;
  
  if (/同时|并行|分别|各自/.test(input)) score += 2;
  if (/和|与|以及/.test(input) && input.length > 50) score += 1;
  
  // 多个独立子任务
  const taskCount = (input.match(/任务|事情|项|个/g) || []).length;
  if (taskCount >= 3) score += 1;
  
  return Math.min(score, 3);
}

/**
 * 评估领域跨度 (0-3)
 */
function scoreDomains(input) {
  const domains = {
    research: /调研|研究|搜索|分析/,
    dev: /开发|编码|实现|构建/,
    security: /安全|权限|审计|加固/,
    infra: /部署|运维|配置|服务器|云/,
    data: /数据库|存储|数据|查询/,
    docs: /文档|说明|注释/
  };
  
  let count = 0;
  Object.values(domains).forEach(pattern => {
    if (pattern.test(input)) count++;
  });
  
  return Math.min(count, 3);
}

/**
 * 评估不确定性 (0-3)
 */
function scoreUncertainty(input) {
  let score = 0;
  
  // 模糊词
  if (/可能|也许|大概|差不多|随意|都行/.test(input)) score += 2;
  
  // 缺少具体信息
  if (/什么|哪个|如何|怎么做/.test(input)) score += 1;
  
  // 需要探索
  if (/试试|尝试|探索|研究/.test(input)) score += 1;
  
  return Math.min(score, 3);
}

/**
 * 评估风险 (0-3)
 */
function scoreRisk(input, context = {}) {
  let score = 0;
  
  const riskKeywords = /删除|移除|drop|rm|git push|发布|上线|部署|重启|改配置|权限|密码|token|key/;
  if (riskKeywords.test(input)) score += 2;
  
  // 高风险动作
  if (/sudo|rm -rf|force push|drop table/.test(input)) score += 1;
  
  return Math.min(score, 3);
}

/**
 * 评估工具负载 (0-3)
 */
function scoreToolLoad(input) {
  let score = 0;
  
  // 长任务
  if (input.length > 300) score += 1;
  if (input.length > 500) score += 1;
  
  // 多文件/目录
  const fileCount = (input.match(/\/|\\|\.(js|ts|py|md|json|yml)/g) || []).length;
  if (fileCount >= 5) score += 2;
  else if (fileCount >= 2) score += 1;
  
  // 复杂工具需求
  if (/浏览器|browser|curl|wget|api|数据库/.test(input)) score += 1;
  
  return Math.min(score, 3);
}

// ============================================================================
// 主分析函数
// ============================================================================

function calculateScores(input, context = {}) {
  return {
    stages: scoreStages(input),
    parallelism: scoreParallelism(input),
    domains: scoreDomains(input),
    uncertainty: scoreUncertainty(input),
    risk: scoreRisk(input, context),
    tool_load: scoreToolLoad(input)
  };
}

function totalScore(scores) {
  return Object.values(scores).reduce((a, b) => a + b, 0);
}

function decide(scores) {
  const total = totalScore(scores);

  // 多阶段 + 跨领域任务不应落回 single。
  if (scores.stages >= 3 && scores.domains >= 2) {
    return scores.parallelism >= 1 ? 'multi' : 'light_multi';
  }
  if (scores.parallelism >= 2 && scores.domains >= 2) {
    return 'multi';
  }
  if (scores.stages >= 2 && scores.domains >= 2) {
    return 'light_multi';
  }
  
  if (total < SCORE_THRESHOLDS.single) {
    return 'single';
  } else if (total < SCORE_THRESHOLDS.multi) {
    return 'light_multi';
  }
  return 'multi';
}

// ============================================================================
// LLM 智能分析（可选增强）
// ============================================================================

async function analyzeWithLLM(userInput) {
  const input = userInput.slice(0, 600);
  
  const prompt = `你是任务复杂度路由器。只输出严格JSON。

任务：${input}

根据以下维度评分（0-3分）：
1. stages: 调研→设计→实现→验证→交付的阶段数
2. parallelism: 可并行推进的子目标数
3. domains: 跨领域数（开发/安全/运维/数据/文档等）
4. uncertainty: 需求含糊/缺信息/需探索程度
5. risk: 高风险动作（发布/删除/改配置）程度
6. tool_load: 工具调用多、长流程程度

阈值：总分≤6=single, 7-10=light_multi, ≥11=multi

输出格式：
{"decision":"single|light_multi|multi","total_score":数字,"stages":数字,"parallelism":数字,"domains":数字,"uncertainty":数字,"risk":数字,"tool_load":数字,"rationale":"一句话","confidence":0-1}`;

  try {
    const apiKey = process.env.MINIMAX_API_KEY || 'minimax-oauth';
    const curlCmd = `curl -s -X POST 'https://api.minimax.chat/v1/text/chatcompletion_pro' -H 'Authorization: Bearer ${apiKey}' -H 'Content-Type: application/json' -d '{"model":"MiniMax-M2.5-Highspeed","messages":[{"role":"system","content":"你是任务复杂度路由器。只输出严格JSON。"},{"role":"user","content":"${prompt.replace(/"/g, '\\"').replace(/\n/g, ' ')}"}],"temperature":0.2,"max_tokens":300}'`;
    
    const result = execSync(curlCmd, { encoding: 'utf8', timeout: 15000 });
    const response = JSON.parse(result);
    const content = response.choices?.[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const r = JSON.parse(jsonMatch[0]);
      console.log('[task-analyzer] LLM:', r.decision, 'score:', r.total_score);
      return r;
    }
  } catch (e) {
    console.log('[task-analyzer] LLM failed:', e.message);
  }
  return null;
}

// ============================================================================
// 主入口
// ============================================================================

async function analyzeTask(userInput, context = {}) {
  // 1. 快速规则判断
  const scores = calculateScores(userInput, context);
  const basicTotal = totalScore(scores);
  const basicDecision = decide(scores);
  
  // 2. LLM 增强判断
  const llmResult = await analyzeWithLLM(userInput);
  
  if (llmResult && llmResult.confidence >= 0.7) {
    // 使用 LLM 判断（高置信度）
    return {
      decision: llmResult.decision,
      total_score: llmResult.total_score,
      score_breakdown: {
        stages: llmResult.stages,
        parallelism: llmResult.parallelism,
        domains: llmResult.domains,
        uncertainty: llmResult.uncertainty,
        risk: llmResult.risk,
        tool_load: llmResult.tool_load
      },
      rationale: llmResult.rationale || `LLM综合评分${llmResult.total_score}`,
      agents: generateAgents(llmResult.decision, scores),
      merge_plan: getMergePlan(llmResult.decision),
      guardrails: getGuardrails(scores),
      missing_info_questions: [],
      confidence: llmResult.confidence
    };
  }
  
  // 3. 回退到规则判断
  return {
    decision: basicDecision,
    total_score: basicTotal,
    score_breakdown: scores,
    rationale: getRationale(scores, basicDecision),
    agents: generateAgents(basicDecision, scores),
    merge_plan: getMergePlan(basicDecision),
    guardrails: getGuardrails(scores),
    missing_info_questions: getMissingQuestions(scores),
    confidence: 0.6
  };
}

function getRationale(scores, decision) {
  const reasons = [];
  if (scores.stages >= 2) reasons.push('多阶段');
  if (scores.parallelism >= 2) reasons.push('可并行');
  if (scores.domains >= 2) reasons.push('跨领域');
  if (scores.risk >= 2) reasons.push('高风险');
  if (scores.tool_load >= 2) reasons.push('工具负载高');
  
  return reasons.length > 0 
    ? `${reasons.join('+')} → ${decision}` 
    : `简单任务 → ${decision}`;
}

function generateAgents(decision, scores) {
  if (decision === 'single') return [];
  
  const agents = [];
  
  if (scores.domains >= 2 || scores.stages >= 3) {
    agents.push({
      role: 'Researcher',
      objective: '调研信息、分析方案',
      inputs_needed: ['任务描述', '相关文档'],
      expected_outputs: ['调研报告', '可行方案']
    });
  }
  
  if (scores.tool_load >= 2 || scores.stages >= 2) {
    agents.push({
      role: 'Builder',
      objective: '执行实现',
      inputs_needed: ['方案文档', '代码规范'],
      expected_outputs: ['可运行代码', '配置文件']
    });
  }
  
  if (scores.risk >= 2 || decision === 'multi') {
    agents.push({
      role: 'Auditor',
      objective: '审查风险、验证结果',
      inputs_needed: ['实现代码', '变更内容'],
      expected_outputs: ['审查报告', '风险清单']
    });
  }
  
  // light_multi 限制 1 个
  if (decision === 'light_multi' && agents.length > 1) {
    return [agents[0]];
  }
  
  return agents.slice(0, 4);
}

function getMergePlan(decision) {
  if (decision === 'single') return '无冲突';
  
  return '主Agent收集子Agent结果，按优先级合并；冲突时以安全为优先';
}

function getGuardrails(scores) {
  return {
    requires_one_time_confirm: scores.risk >= 2,
    requires_security_review: scores.risk >= 2 && /安全|权限|密码/.test(JSON.stringify(scores)),
    requires_rollback_plan: scores.risk >= 2
  };
}

function getMissingQuestions(scores) {
  const questions = [];
  if (scores.uncertainty >= 2) {
    questions.push('具体需求是什么？');
  }
  if (scores.risk >= 2 && scores.tool_load >= 2) {
    questions.push('如何验证变更安全？');
  }
  return questions.slice(0, 3);
}

if (require.main === module) {
  (async () => {
    const input = process.argv.slice(2).join(' ');
    
    if (!input) {
      console.error('Usage: node task-analyzer.cjs <task>');
      process.exit(1);
    }
    
    const result = await analyzeTask(input);
    console.log(JSON.stringify(result, null, 2));
  })();
}

module.exports = { analyzeTask };
