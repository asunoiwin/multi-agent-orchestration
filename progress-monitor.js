#!/usr/bin/env node
/**
 * Progress Monitor
 * 实时监控多 Agent 任务进度
 */

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const WORKSPACE = path.join(homedir(), '.openclaw', 'workspace');
const AGENTS_DIR = path.join(WORKSPACE, '.learnings', 'agents');

/**
 * 获取所有活跃的子 Agent
 */
async function getActiveAgents() {
  // 这里应该调用 OpenClaw 的 subagents list
  // 简化实现：从文件系统读取
  const statusFile = path.join(AGENTS_DIR, 'active-agents.json');
  
  if (!fs.existsSync(statusFile)) {
    return [];
  }
  
  return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
}

/**
 * 检查 Agent 进度
 */
function checkAgentProgress(agent) {
  const progress = {
    agentId: agent.id,
    role: agent.role,
    status: 'running',
    startTime: agent.startTime,
    elapsedMs: Date.now() - agent.startTime,
    blocked: false,
    blocker: null
  };
  
  // 检查是否超时
  const timeoutMs = 300000; // 5分钟
  if (progress.elapsedMs > timeoutMs) {
    progress.blocked = true;
    progress.blocker = 'timeout';
  }
  
  return progress;
}

/**
 * 监控所有 Agent
 */
async function monitorAll() {
  const agents = await getActiveAgents();
  const report = {
    timestamp: new Date().toISOString(),
    totalAgents: agents.length,
    agents: []
  };
  
  for (const agent of agents) {
    const progress = checkAgentProgress(agent);
    report.agents.push(progress);
    
    if (progress.blocked) {
      console.log(`[progress-monitor] ⚠️  Agent ${agent.id} (${agent.role}) blocked: ${progress.blocker}`);
    }
  }
  
  return report;
}

/**
 * 生成监控报告
 */
function generateReport(report) {
  const reportPath = path.join(AGENTS_DIR, 'progress-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`[progress-monitor] Report saved to ${reportPath}`);
  console.log(`[progress-monitor] Total agents: ${report.totalAgents}`);
  
  const blocked = report.agents.filter(a => a.blocked);
  if (blocked.length > 0) {
    console.log(`[progress-monitor] Blocked agents: ${blocked.length}`);
  }
}

// CLI 接口
if (require.main === module) {
  monitorAll()
    .then(report => {
      generateReport(report);
      process.exit(0);
    })
    .catch(error => {
      console.error('[progress-monitor] Error:', error);
      process.exit(1);
    });
}

module.exports = { monitorAll, checkAgentProgress };
