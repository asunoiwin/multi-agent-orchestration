#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.getoneapi.com';
const OUT_DIR = path.join(__dirname, '..', 'runtime', 'social-intel-smoke');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function postJson(endpoint, body, apiKey) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function main() {
  const apiKey = process.env.ONEAPI_API_KEY;
  if (!apiKey) {
    console.error('ONEAPI_API_KEY is required');
    process.exit(1);
  }

  ensureDir(OUT_DIR);
  const keyword = process.argv.slice(2).join(' ').trim() || 'OpenClaw';
  const tasks = [
    { name: 'balance', endpoint: '/back/user/balance', body: {} },
    { name: 'weibo-search', endpoint: '/api/weibo/search', body: { keyword, page: 1 } },
    { name: 'douyin-search', endpoint: '/api/douyin/search_general_v2', body: { keyword, page: 1, count: 10, sort_type: 0, publish_time: 0, content_type: 0 } }
  ];

  for (const task of tasks) {
    const result = await postJson(task.endpoint, task.body, apiKey);
    fs.writeFileSync(path.join(OUT_DIR, `${task.name}.json`), result.text);
    console.log(`${task.name}: http=${result.status} bytes=${result.text.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
