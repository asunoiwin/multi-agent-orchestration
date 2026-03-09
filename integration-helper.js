#!/usr/bin/env node
/**
 * Integration Helper - 主会话集成辅助
 * 
 * 提供给主会话（Jarvis）直接调用的简化接口
 */

const { autoExecute, progressNext } = require('./auto-executor');
const { recoverResults } = require('./result-recovery');

/**
 * 主会话调用入口
 * 
 * 用法（在主会话中）：
 * ```javascript
 * const orchestrator = require('~/. openclaw/workspace/multi-agent-orchestration/integration-helper');
 * 
 * // 执行任务
 * const result = await orchestrator.run("先调研方案，然后实现 demo", {
 *   sessions_spawn: sessions_spawn  // 传入真实工具
 * });
 * 
 * // 推进下一个
 * await orchestrator.progress({ sessions_spawn });
 * 
 * // 获取结果
 * const summary = orchestrator.getSummary(result.taskId);
 * ```
 */

async function run(taskText, context = {}) {
  return await autoExecute(taskText, {
    ...context,
    verbose: context.verbose !== false
  });
}

async function progress(context = {}) {
  return await progressNext({
    ...context,
    verbose: context.verbose !== false
  });
}

function getSummary(taskId) {
  return recoverResults(taskId);
}

/**
 * 一键执行（用于简单场景）
 * 
 * 用法：
 * ```javascript
 * const result = await orchestrator.quickRun("搜索并对比最新 AI 框架", {
 *   sessions_spawn: sessions_spawn
 * });
 * ```
 */
async function quickRun(taskText, context = {}) {
  const result = await run(taskText, context);
  
  if (result.mode === 'single') {
    return {
      mode: 'single',
      message: 'Task handled by main agent directly'
    };
  }

  return {
    mode: 'multi',
    taskId: result.taskId,
    spawned: result.spawned,
    message: `Spawned ${result.spawned.length} agents. Monitor with getSummary("${result.taskId}")`
  };
}

module.exports = {
  run,
  progress,
  getSummary,
  quickRun
};
