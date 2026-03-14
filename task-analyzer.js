#!/usr/bin/env node
/**
 * 任务分析引擎
 * 自动判断任务是否需要多 Agent 协作
 * 支持关键词 + LLM 双重分析
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * LLM 智能分析任务复杂度
 */
async function analyzeWithLLM(userInput) {
  const prompt = `你是一个任务复杂度分析专家。分析以下用户任务，判断是否需要多个 AI Agent 协作完成。

判断标准：
- 需要多 Agent：任务涉及多个阶段（调研→实现→测试）、多个领域、需要并行处理、或者步骤复杂
- 只需要单个 Agent：简单任务，可以一步完成

返回 JSON 格式：
{"needsMultiAgent": true/False, "reason": "简短原因", "suggestedRoles": ["role1", "role2"]}

任务内容：${userInput.slice(0, 500)}

只返回 JSON，不要其他内容。`;

  try {
    const apiKey = process.env.MINIMAX_API_KEY || 'minimax-oauth';
    const curlCmd = `curl -s -X POST 'https://api.minimax.chat/v1/text/chatcompletion_pro' -H 'Authorization: Bearer ${apiKey}' -H 'Content-Type: application/json' -d '{"model":"MiniMax-M2.5-Highspeed","messages":[{"role":"system","content":"你是一个任务复杂度分析专家。只返回JSON。"},{"role":"user","content":"${prompt.replace(/"/g, '\\"').replace(/\n/g, ' ')}"}],"temperature":0.3,"max_tokens":200}'`;
    
    const result = execSync(curlCmd, { encoding: 'utf8', timeout: 15000 });
    const response = JSON.parse(result);
    const resultText = response.choices?.[0]?.message?.content || '';
    
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const r = JSON.parse(jsonMatch[0]);
      console.log('[task-analyzer] LLM 判断:', r.needsMultiAgent, '| roles:', r.suggestedRoles);
      return r;
    }
    return null;
  } catch (e) {
    console.log('[task-analyzer] LLM 调用失败:', e.message);
    return null;
  }
}

/**
 * 分析任务复杂度（关键词 + LLM）
 */
async function analyzeTask(userInput, context = {}) {
  // 先用关键词快速判断
  const signals = {
    keywords: detectKeywords(userInput),
    complexity: estimateComplexity(userInput, context),
    domains: detectDomains(userInput),
    phases: detectPhases(userInput)
  };
  
  const keywordScore = calculateScore(signals);
  
  // 始终尝试 LLM 分析（对于任何任务）
  // LLM 会判断任务是否需要多 Agent
  const llmResult = await analyzeWithLLM(userInput);
  
  if (llmResult) {
    return {
      needsMultiAgent: llmResult.needsMultiAgent,
      score: llmResult.needsMultiAgent ? 8 : keywordScore,
      signals,
      suggestedRoles: llmResult.suggestedRoles || suggestRoles(signals),
      executionMode: determineMode(signals),
      estimatedComplexity: llmResult.needsMultiAgent ? 8 : keywordScore,
      llmReason: llmResult.reason
    };
  }
  
  // LLM 失败时回退到关键词判断
  return {
    needsMultiAgent: keywordScore >= 5,
    score: keywordScore,
    signals,
    suggestedRoles: suggestRoles(signals),
    executionMode: determineMode(signals),
    estimatedComplexity: keywordScore
  };
}

/**
 * 检测关键词信号
 */
function detectKeywords(input) {
  const verbs = [];
  const parallel = false;
  
  // 动词检测
  const verbPatterns = [
    /研究|调研|分析|对比|评估/,
    /实现|开发|编写|构建|创建/,
    /测试|验证|审查|检查|审计/,
    /部署|发布|上线|配置/,
    /优化|改进|重构|升级/
  ];
  
  verbPatterns.forEach(pattern => {
    if (pattern.test(input)) {
      verbs.push(pattern.source);
    }
  });
  
  // 并行信号
  const parallelKeywords = /同时|并行|分别|各自/;
  const hasParallel = parallelKeywords.test(input);
  
  return { verbs, parallel: hasParallel };
}

/**
 * 估算复杂度
 */
function estimateComplexity(input, context) {
  let complexity = 0;
  
  // 长度因素
  if (input.length > 200) complexity += 1;
  if (input.length > 500) complexity += 1;
  
  // 多步骤
  const stepIndicators = /先|然后|接着|最后|第一|第二|步骤/g;
  const steps = (input.match(stepIndicators) || []).length;
  complexity += Math.min(steps, 3);
  
  // 涉及文件数
  const filePatterns = /文件|目录|代码|脚本|配置/g;
  const fileCount = (input.match(filePatterns) || []).length;
  if (fileCount >= 3) complexity += 2;
  else if (fileCount >= 1) complexity += 1;
  
  return complexity;
}

/**
 * 检测涉及领域
 */
function detectDomains(input) {
  const domains = [];
  
  const domainMap = {
    'research': /研究|调研|搜索|查找|分析/,
    'development': /开发|编写|实现|构建|代码/,
    'testing': /测试|验证|检查/,
    'deployment': /部署|发布|上线/,
    'documentation': /文档|说明|注释/,
    'security': /安全|审计|权限/,
    'database': /数据库|存储|查询/,
    'api': /API|接口|服务/
  };
  
  Object.entries(domainMap).forEach(([domain, pattern]) => {
    if (pattern.test(input)) {
      domains.push(domain);
    }
  });
  
  return domains;
}

/**
 * 检测阶段
 */
function detectPhases(input) {
  const phases = [];
  
  if (/先|首先|第一/.test(input)) phases.push('phase1');
  if (/然后|接着|第二/.test(input)) phases.push('phase2');
  if (/最后|第三/.test(input)) phases.push('phase3');
  
  return phases;
}

/**
 * 计算总分
 */
function calculateScore(signals) {
  let score = 0;
  
  // 多个动词
  if (signals.keywords.verbs.length >= 2) score += 3;
  
  // 多个领域
  if (signals.domains.length >= 2) score += 3;
  
  // 明确阶段
  if (signals.phases.length >= 2) score += 2;
  
  // 复杂度
  if (signals.complexity >= 3) score += 2;
  
  // 并行信号
  if (signals.keywords.parallel) score += 2;
  
  return score;
}

/**
 * 建议角色
 */
function suggestRoles(signals) {
  const roles = [];
  
  if (signals.domains.includes('research')) {
    roles.push('researcher');
  }
  
  if (signals.domains.includes('development')) {
    roles.push('builder');
  }
  
  if (signals.domains.includes('testing') || signals.domains.includes('security')) {
    roles.push('auditor');
  }
  
  // 如果没有明确角色，默认使用 researcher + builder
  if (roles.length === 0) {
    roles.push('researcher', 'builder');
  }
  
  return roles;
}

/**
 * 确定执行模式
 */
function determineMode(signals) {
  if (signals.keywords.parallel) {
    return 'parallel';
  }
  
  if (signals.phases.length >= 2) {
    return 'serial';
  }
  
  if (signals.domains.length >= 2) {
    return 'hybrid';
  }
  
  return 'serial';
}

// CLI 接口
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');
  
  if (!input) {
    console.error('Usage: node task-analyzer.js <task description>');
    process.exit(1);
  }
  
  const result = analyzeTask(input);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { analyzeTask };
