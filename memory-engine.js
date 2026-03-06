#!/usr/bin/env node
/**
 * Memory Enhanced - Core Engine
 * 直接运行的核心引擎，不依赖插件编译
 * 
 * 用法:
 *   node memory-engine.js status    # 查看状态
 *   node memory-engine.js sync     # 同步 memory/*.md
 *   node memory-engine.js audit   # 运行审计
 *   node memory-engine.js capture "内容" # 捕获记忆
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WORKSPACE = path.join(HOME, '.openclaw', 'workspace');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const SESSIONS_DIR = path.join(HOME, '.openclaw', 'agents', 'main', 'sessions');

// ============================================================================
// 配置
// ============================================================================

const CONFIG = {
  // 自动捕获模式
  capture: {
    task: ['帮我', '帮我做', 'task', '任务', '做一下'],
    rule: ['必须', '禁止', '以后都', '记住'],
    decision: ['好', '可以', '用这个', '确定'],
    correction: ['不对', '错了', '应该是', '不是']
  },
  importance: {
    task: 0.9,
    rule: 1.0,
    decision: 0.8,
    correction: 0.95
  }
};

// ============================================================================
// 工具函数
// ============================================================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getBackupFile() {
  return path.join(MEMORY_DIR, 'enhanced-backup.jsonl');
}

// ============================================================================
// 向量存储（简化版）
// ============================================================================

function storeMemory(entry) {
  ensureDir(MEMORY_DIR);
  const file = getBackupFile();
  const line = JSON.stringify({
    ...entry,
    stored_at: Date.now()
  }) + '\n';
  fs.appendFileSync(file, line);
  console.log('[memory-enhanced] Stored:', entry.category, '| importance:', entry.importance);
  return true;
}

function getRecentMemories(limit = 10) {
  const file = getBackupFile();
  if (!fs.existsSync(file)) return [];
  
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  return lines.slice(-limit).map(line => JSON.parse(line)).reverse();
}

// ============================================================================
// 自动捕获引擎
// ============================================================================

function analyzeContent(content) {
  const lower = content.toLowerCase();
  
  for (const [type, patterns] of Object.entries(CONFIG.capture)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        return {
          type,
          importance: CONFIG.importance[type],
          text: content.slice(0, 500)
        };
      }
    }
  }
  return null;
}

// ============================================================================
// 会话链接
// ============================================================================

function getSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  
  return fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const stat = fs.statSync(path.join(SESSIONS_DIR, f));
      return {
        file: f,
        session_id: f.replace('.jsonl', ''),
        is_deleted: f.includes('.deleted.'),
        size: stat.size,
        modified: stat.mtime
      };
    })
    .sort((a, b) => b.modified - a.modified);
}

// ============================================================================
// 同步 memory/*.md
// ============================================================================

function syncMemoryFiles() {
  if (!fs.existsSync(MEMORY_DIR)) return { synced: 0, failed: 0 };
  
  const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
  
  let synced = 0, failed = 0;
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8');
      const lines = content.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('##'));
      
      if (lines.length > 0) {
        storeMemory({
          text: `From ${file}:\n${lines.join('\n').slice(0, 500)}`,
          category: 'fact',
          importance: 0.6,
          scope: 'global',
          source: 'memory-flush'
        });
        synced++;
      }
    } catch (e) {
      failed++;
    }
  }
  
  return { synced, failed };
}

// ============================================================================
// 审计
// ============================================================================

function runAudit() {
  const memories = getRecentMemories(100);
  const sessions = getSessions();
  
  const stats = {
    total_memories: memories.length,
    active_sessions: sessions.filter(s => !s.is_deleted).length,
    deleted_sessions: sessions.filter(s => s.is_deleted).length,
    orphaned: memories.filter(m => !m.session_id).length
  };
  
  console.log('\n=== Memory Enhanced Audit ===');
  console.log('Memories:', stats.total_memories);
  console.log('Active Sessions:', stats.active_sessions);
  console.log('Deleted Sessions:', stats.deleted_sessions);
  console.log('Orphaned Memories:', stats.orphaned);
  
  // 保存审计结果
  ensureDir(path.join(MEMORY_DIR, 'audits'));
  const auditFile = path.join(MEMORY_DIR, 'audits', `audit-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(auditFile, JSON.stringify({
    timestamp: Date.now(),
    stats
  }, null, 2));
  
  return stats;
}

// ============================================================================
// 主命令
// ============================================================================

const command = process.argv[2];

switch (command) {
  case 'status':
    console.log('\n=== Memory Enhanced Status ===');
    console.log('Version: 1.0.0 (Script Mode)');
    console.log('Memory Dir:', MEMORY_DIR);
    console.log('Sessions Dir:', SESSIONS_DIR);
    console.log('\nRecent Memories:');
    const recent = getRecentMemories(5);
    recent.forEach((m, i) => {
      console.log(`  ${i+1}. [${m.category}] ${m.text?.slice(0, 50)}...`);
    });
    break;
    
  case 'sync':
    console.log('\n=== Syncing memory/*.md ===');
    const syncResult = syncMemoryFiles();
    console.log('Synced:', syncResult.synced, '| Failed:', syncResult.failed);
    break;
    
  case 'audit':
    runAudit();
    break;
    
  case 'capture':
    const content = process.argv[3];
    if (content) {
      const result = analyzeContent(content);
      if (result) {
        storeMemory({
          text: result.text,
          category: result.type,
          importance: result.importance,
          scope: 'global',
          source: 'manual'
        });
        console.log('Captured:', result.type);
      } else {
        console.log('No pattern matched');
      }
    } else {
      console.log('Usage: node memory-engine.js capture "内容"');
    }
    break;
    
  default:
    console.log('Memory Enhanced Engine v1.0.0');
    console.log('\nCommands:');
    console.log('  status              - Show status');
    console.log('  sync                - Sync memory/*.md files');
    console.log('  audit               - Run audit');
    console.log('  capture "content"   - Capture a memory');
}
