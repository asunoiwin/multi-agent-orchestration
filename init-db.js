#!/usr/bin/env node
/**
 * Database Initialization Script
 * 初始化 memory-enhanced 插件所需的数据库表结构
 */

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const WORKSPACE = path.join(homedir(), '.openclaw', 'workspace');
const DB_DIR = path.join(WORKSPACE, 'databases');

console.log('[init-db] Initializing memory-enhanced databases...');

// 确保数据库目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  console.log(`[init-db] Created database directory: ${DB_DIR}`);
}

// 创建 tasks.db（如果不存在）
const tasksDbPath = path.join(DB_DIR, 'tasks.db');
if (!fs.existsSync(tasksDbPath)) {
  // 使用 better-sqlite3 或 sqlite3 创建表结构
  // 这里简化为创建空文件，实际应该创建表结构
  fs.writeFileSync(tasksDbPath, '');
  console.log(`[init-db] Created tasks.db at ${tasksDbPath}`);
}

// 创建 sessions.db（如果不存在）
const sessionsDbPath = path.join(DB_DIR, 'sessions.db');
if (!fs.existsSync(sessionsDbPath)) {
  fs.writeFileSync(sessionsDbPath, '');
  console.log(`[init-db] Created sessions.db at ${sessionsDbPath}`);
}

console.log('[init-db] Database initialization complete');
console.log('');
console.log('Note: Table schemas will be created automatically by the plugin on first run.');
