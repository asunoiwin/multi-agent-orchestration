#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POOL_FILE = path.join(ROOT, 'config', 'agent-pool.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function detectFeatures(task) {
  const text = task || '';
  return {
    research: /搜索|调研|分析|研究|对比|查找|了解|收集|查询|验证方案|资料/.test(text),
    implementation: /开发|编写|实现|写代码|创建|制作|修改|构建|配置|安装|修复|重构|demo/.test(text),
    audit: /检查|审查|验证|测试|审计|评估|排查|lint|安全|质量检查/.test(text),
    documentation: /文档|总结|报告|说明|整理|沉淀|手册/.test(text),
    data: /数据|统计|指标|表格|分析数据|分析指标/.test(text),
    parallel: /同时|并行|分别|各自/.test(text),
    serial: /先|然后|之后|接着|最后|基于|根据|再/.test(text)
  };
}

function complexityScore(task, features) {
  let score = 0;
  if ((task || '').length > 40) score += 1;
  if ((task || '').length > 100) score += 1;
  const count = ['research', 'implementation', 'audit', 'documentation', 'data']
    .filter(k => features[k]).length;
  score += count;
  if (features.parallel) score += 2;
  if (features.serial) score += 2;
  return score;
}

function desiredRoleOrder(features) {
  const order = [];
  if (features.research) order.push('web-researcher');
  if (features.data) order.push('data-analyst');
  if (features.implementation) order.push('code-implementer');
  if (features.audit) order.push('quality-auditor');
  if (features.documentation) order.push('doc-synthesizer');
  return order;
}

function matchRoles(features, pool) {
  const desired = desiredRoleOrder(features);
  return desired
    .map(roleId => pool.roles.find(role => role.id === roleId))
    .filter(Boolean);
}

function chooseMode(features) {
  if (features.parallel) return 'parallel';
  if (features.serial) return 'serial';
  return 'serial';
}

function buildSubtasks(task, roles, mode) {
  return roles.map((role, index) => ({
    roleId: role.id,
    title: role.name,
    description: `${role.purpose}. Task: ${task}`,
    dependsOn: mode === 'serial' && index > 0 ? [roles[index - 1].id] : [],
    skills: role.skills,
    deny: role.deny,
    memory: role.memory
  }));
}

function planTask(task) {
  const pool = readJson(POOL_FILE);
  const features = detectFeatures(task);
  const score = complexityScore(task, features);
  const roles = matchRoles(features, pool);
  const needsMultiAgent = score >= 3 && roles.length > 0;
  const mode = chooseMode(features);

  return {
    version: '2.0.0',
    task,
    features,
    complexityScore: score,
    needsMultiAgent,
    orchestrator: 'jarvis-supervisor',
    roleSource: 'config/agent-pool.json',
    selectedRoles: roles.map(r => ({
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      skills: r.skills,
      deny: r.deny,
      memory: r.memory,
      lifecycle: r.lifecycle
    })),
    executionMode: needsMultiAgent ? mode : 'single',
    subtasks: needsMultiAgent ? buildSubtasks(task, roles, mode) : []
  };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node dynamic-orchestrator.js <task>');
    process.exit(1);
  }
  console.log(JSON.stringify(planTask(task), null, 2));
}

module.exports = { planTask, detectFeatures, complexityScore, matchRoles };
