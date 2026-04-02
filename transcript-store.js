#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.OPENCLAW_MULTI_AGENT_ROOT || __dirname;
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const TRANSCRIPTS_DIR = path.join(RUNTIME_DIR, 'transcripts');

function sanitizePathSegment(value, fallback = 'unknown') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function getTranscriptPath(taskId) {
  return path.join(TRANSCRIPTS_DIR, `${sanitizePathSegment(taskId, 'task')}.jsonl`);
}

function appendTranscriptEvent(taskId, kind, payload = {}, meta = {}) {
  if (!taskId || !kind) return null;
  const file = getTranscriptPath(taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    taskId,
    kind,
    payload,
    meta
  };
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return { file, entry };
}

function readTranscript(taskId, limit = 50) {
  const file = getTranscriptPath(taskId);
  if (!fs.existsSync(file)) {
    return { file, entries: [] };
  }
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {}
  }
  const tail = Number(limit) > 0 ? parsed.slice(-Number(limit)) : parsed;
  return { file, entries: tail };
}

function summarizeTranscript(taskId) {
  const { file, entries } = readTranscript(taskId, 200);
  const latest = entries[entries.length - 1] || null;
  return {
    file,
    exists: fs.existsSync(file),
    count: entries.length,
    latestKind: latest?.kind || null,
    latestAt: latest?.ts || null
  };
}

module.exports = {
  getTranscriptPath,
  appendTranscriptEvent,
  readTranscript,
  summarizeTranscript
};
