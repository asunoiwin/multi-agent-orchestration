#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractStructuredCompletion } = require('./result-recovery');

const HOME = process.env.HOME || '/Users/rico';
const RESEARCHER_SESSIONS_DIR = path.join(HOME, '.openclaw', 'agents', 'researcher', 'sessions');

function fail(message, details = null) {
  const payload = { ok: false, message, details };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 120000
  });
  if (result.error) fail(`Command failed: ${cmd}`, result.error.message);
  if (result.status !== 0) {
    fail(`Command exited with code ${result.status}`, {
      cmd,
      args,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  return result.stdout;
}

function newestResearcherSession(beforeMs) {
  if (!fs.existsSync(RESEARCHER_SESSIONS_DIR)) return null;
  const files = fs.readdirSync(RESEARCHER_SESSIONS_DIR)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => {
      const fullPath = path.join(RESEARCHER_SESSIONS_DIR, file);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .filter((file) => file.mtimeMs >= beforeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.fullPath || null;
}

function waitForSession(beforeMs, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = newestResearcherSession(beforeMs);
    if (found) return found;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return null;
}

function parseJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractAssistantText(entries) {
  const assistants = entries.filter((entry) => entry?.type === 'message' && entry.message?.role === 'assistant');
  for (let idx = assistants.length - 1; idx >= 0; idx -= 1) {
    const content = assistants[idx].message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((item) => item && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n');
      if (text.trim()) return text;
    }
  }
  return '';
}

function main() {
  const sessionId = `codex-e2e-${Date.now()}`;
  const beforeMs = Date.now();
  const prompt = [
    '你在做多agent稳定性验证。',
    '直接调用 sessions_spawn 启动一个 researcher 子agent。',
    'agentId 用 researcher，mode 用 run，label 用 e2e-researcher。',
    'task 只做一件事：返回一句中文总结，并在最后附带一个 json fenced code block，字段包含 taskId=e2e-test、workerId=e2e-worker、roleId=web-researcher、status=completed、summary、artifacts、blockers、handoff、nextStep。',
    '启动后立刻结束本轮，不要轮询。'
  ].join('');

  const raw = run('openclaw', ['agent', '--agent', 'main', '--session-id', sessionId, '--json', '-m', prompt], { timeoutMs: 180000 });
  const turn = JSON.parse(raw);
  const childSessionFile = waitForSession(beforeMs, 45000);
  if (!childSessionFile) fail('No researcher subagent session was created');

  const entries = parseJsonl(childSessionFile);
  const text = extractAssistantText(entries);
  const structured = extractStructuredCompletion(text);
  if (!structured) fail('Structured completion block missing from subagent response', { childSessionFile, text });
  if (structured.taskId !== 'e2e-test' || structured.workerId !== 'e2e-worker' || structured.status !== 'completed') {
    fail('Structured completion fields do not match expectations', { childSessionFile, structured });
  }

  console.log(JSON.stringify({
    ok: true,
    sessionId,
    childSessionFile,
    parentRunId: turn.runId || null,
    structured
  }, null, 2));
}

if (require.main === module) {
  main();
}
