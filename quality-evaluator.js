#!/usr/bin/env node
/**
 * Quality Evaluator
 * 评估任务完成质量与效率
 */

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const WORKSPACE = path.join(homedir(), '.openclaw', 'workspace');
const AGENTS_DIR = path.join(WORKSPACE, '.learnings', 'agents');

/**
 * 评估任务完成度
 */
function evaluateCompleteness(task, deliverables) {
  const checklist = {
    hasDeliverables: deliverables && deliverables.length > 0,
    meetsRequirements: true, // 需要实际验证
    allSubtasksComplete: true // 需要检查子任务状态
  };
  
  const score = Object.values(checklist).filter(Boolean).length / Object.keys(checklist).length;
  
  return {
    score,
    checklist,
    status: score >= 0.8 ? 'complete' : score >= 0.5 ? 'partial' : 'incomplete'
  };
}

/**
 * 评估代码质量
 */
function evaluateQuality(deliverables) {
  const metrics = {
    readability: 0.8, // 默认值，实际应该通过静态分析
    correctness: 0.9,
    security: 0.85,
    performance: 0.8,
    maintainability: 0.75
  };
  
  const avgScore = Object.values(metrics).reduce((a, b) => a + b, 0) / Object.keys(metrics).length;
  
  return {
    score: avgScore,
    metrics,
    grade: avgScore >= 0.9 ? 'A' : avgScore >= 0.8 ? 'B' : avgScore >= 0.7 ? 'C' : 'D'
  };
}

/**
 * 评估效率
 */
function evaluateEfficiency(task) {
  const plannedDuration = task.estimatedDuration || 3600000; // 默认 1 小时
  const actualDuration = task.completedAt - task.startedAt;
  
  const efficiency = plannedDuration / actualDuration;
  
  return {
    score: Math.min(efficiency, 1.5), // 最高 150%
    plannedMs: plannedDuration,
    actualMs: actualDuration,
    rating: efficiency >= 1.2 ? 'excellent' : efficiency >= 0.9 ? 'good' : efficiency >= 0.7 ? 'acceptable' : 'poor'
  };
}

/**
 * 生成改进建议
 */
function generateSuggestions(evaluation) {
  const suggestions = [];
  
  if (evaluation.completeness.score < 0.8) {
    suggestions.push('任务未完全完成，建议检查遗漏项');
  }
  
  if (evaluation.quality.score < 0.8) {
    suggestions.push('代码质量需要改进，建议进行重构');
  }
  
  if (evaluation.efficiency.score < 0.7) {
    suggestions.push('执行效率较低，建议优化任务拆解或 Agent 分配');
  }
  
  if (evaluation.efficiency.score > 1.3) {
    suggestions.push('执行效率很高，可以复用此次的任务模式');
  }
  
  return suggestions;
}

/**
 * 完整评估
 */
function evaluate(taskId) {
  // 加载任务数据
  const taskFile = path.join(AGENTS_DIR, 'tasks', `${taskId}.json`);
  
  if (!fs.existsSync(taskFile)) {
    throw new Error(`Task not found: ${taskId}`);
  }
  
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const deliverables = task.deliverables || [];
  
  const evaluation = {
    taskId,
    timestamp: new Date().toISOString(),
    completeness: evaluateCompleteness(task, deliverables),
    quality: evaluateQuality(deliverables),
    efficiency: evaluateEfficiency(task),
    overallScore: 0,
    grade: '',
    suggestions: []
  };
  
  // 计算总分
  evaluation.overallScore = (
    evaluation.completeness.score * 0.4 +
    evaluation.quality.score * 0.4 +
    evaluation.efficiency.score * 0.2
  );
  
  // 评级
  evaluation.grade = evaluation.overallScore >= 0.9 ? 'A' :
                     evaluation.overallScore >= 0.8 ? 'B' :
                     evaluation.overallScore >= 0.7 ? 'C' : 'D';
  
  // 生成建议
  evaluation.suggestions = generateSuggestions(evaluation);
  
  return evaluation;
}

/**
 * 保存评估报告
 */
function saveReport(evaluation) {
  const reportDir = path.join(AGENTS_DIR, 'evaluations');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  const reportFile = path.join(reportDir, `${evaluation.taskId}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(evaluation, null, 2));
  
  console.log(`[quality-evaluator] Report saved: ${reportFile}`);
  console.log(`[quality-evaluator] Overall grade: ${evaluation.grade} (${(evaluation.overallScore * 100).toFixed(1)}%)`);
  
  if (evaluation.suggestions.length > 0) {
    console.log('[quality-evaluator] Suggestions:');
    evaluation.suggestions.forEach(s => console.log(`  - ${s}`));
  }
}

// CLI 接口
if (require.main === module) {
  const taskId = process.argv[2];
  
  if (!taskId) {
    console.error('Usage: node quality-evaluator.js <task-id>');
    process.exit(1);
  }
  
  try {
    const evaluation = evaluate(taskId);
    saveReport(evaluation);
  } catch (error) {
    console.error('[quality-evaluator] Error:', error.message);
    process.exit(1);
  }
}

module.exports = { evaluate, evaluateCompleteness, evaluateQuality, evaluateEfficiency };
