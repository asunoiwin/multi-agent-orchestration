#!/usr/bin/env node
/**
 * spawn-queue-processor.js
 * 读取 spawn-queue 目录中的待执行 spawn 指令，通过 sessions_spawn API 实际拉起 agent
 * 由 gateway hook 每次消息事件触发，或由 cron agent 通过 exec 调用
 *
 * 用法：
 *   node spawn-queue-processor.js           # 处理所有 pending spawn
 *   node spawn-queue-processor.js --dry    # 只打印，不实际 spawn
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const QUEUE_DIR = path.join(HOME, '.openclaw', 'extensions', 'openclaw-multi-agent', 'runtime', 'spawn-queue');
const ACTIVE_FILE = path.join(HOME, '.openclaw', 'extensions', 'openclaw-multi-agent', 'runtime', 'active-agents.json');
const DRY = process.argv.includes('--dry');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function updateAgentStatus(label, status, extra = {}) {
  try {
    const { updateAgentStatus: fn } = require('./result-recovery');
    fn(label, status, extra);
  } catch (e) {
    // fallback: update active-agents.json directly
    try {
      const active = readJson(ACTIVE_FILE, []);
      const idx = active.findIndex(a => a.label === label);
      if (idx >= 0) {
        active[idx] = { ...active[idx], ...extra, status, updatedAt: new Date().toISOString() };
        writeJson(ACTIVE_FILE, active);
      }
    } catch {}
  }
}

async function main() {
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log(JSON.stringify({ spawned: [], skipped: 0, reason: 'queue_dir_missing' }));
    return;
  }

  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.log(JSON.stringify({ spawned: [], skipped: 0, reason: 'queue_empty' }));
    return;
  }

  const results = [];
  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);
    const trigger = readJson(filePath);
    if (!trigger || trigger.processed) {
      fs.unlinkSync(filePath);
      continue;
    }

    const { action, payload, requestedAt, spawnedAt } = trigger;
    if (action !== 'spawn') {
      fs.unlinkSync(filePath);
      continue;
    }

    if (DRY) {
      console.log(`[DRY] Would spawn: ${payload.label}`);
      results.push({ label: payload.label, status: 'dry', file });
      fs.renameSync(filePath, filePath + '.dry');
      continue;
    }

    try {
      // 调用 sessions_spawn
      const { spawnAgent } = require('./supervisor-runner');
      const agentSession = await spawnAgent({
        runtime: payload.runtime || 'subagent',
        agentId: payload.agentId || 'main',
        model: payload.model || 'minimax',
        mode: payload.mode || 'run',
        label: payload.label,
        task: payload.task,
        cleanup: payload.cleanup || 'delete',
        runTimeoutSeconds: payload.runTimeoutSeconds || 600,
        metadata: payload.metadata || {},
      });

      // 标记为已处理
      trigger.processed = true;
      trigger.spawnedAt = new Date().toISOString();
      trigger.sessionKey = agentSession?.sessionKey || null;
      writeJson(filePath, trigger);

      // 更新 agent 状态
      updateAgentStatus(payload.label, 'running', {
        sessionId: agentSession?.sessionId || null,
        sessionKey: agentSession?.sessionKey || null,
      });

      results.push({ label: payload.label, status: 'spawned', file, sessionKey: agentSession?.sessionKey });
      console.error(`[spawn-queue] Spawned ${payload.label} → ${agentSession?.sessionKey}`);
    } catch (err) {
      trigger.error = err.message;
      trigger.errorAt = new Date().toISOString();
      writeJson(filePath, trigger);
      results.push({ label: payload.label, status: 'error', error: err.message, file });
      console.error(`[spawn-queue] Failed to spawn ${payload.label}: ${err.message}`);
    }
  }

  const out = {
    spawned: results.filter(r => r.status === 'spawned').map(r => ({ label: r.label, sessionKey: r.sessionKey })),
    errors: results.filter(r => r.status === 'error'),
    dry: results.filter(r => r.status === 'dry'),
    total: files.length,
    processedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { main };
