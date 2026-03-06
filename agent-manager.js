#!/usr/bin/env node
/**
 * Agent Manager
 * 管理多 Agent 的创建、配置和回收
 */

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const WORKSPACE = path.join(homedir(), '.openclaw', 'workspace');
const AGENTS_DIR = path.join(WORKSPACE, '.learnings', 'agents');
const CONFIG_FILE = path.join(AGENTS_DIR, 'orchestration-config.json');

// 默认配置
const DEFAULT_CONFIG = {
  enabled: true,
  threshold: {
    complexity: 5,
    subtasks: 2,
    domains: 2
  },
  roles: {
    supervisor: {
      model: 'minimax-portal/MiniMax-M2.5',
      lifecycle: 'persistent',
      tools: ['sessions_list', 'sessions_history', 'subagents', 'sessions_send', 'read', 'write'],
      maxConcurrent: 1,
      description: '监督员：任务分析、Agent 创建/回收、进度监控、质量评估'
    },
    researcher: {
      model: 'minimax-portal/MiniMax-M2.5',
      lifecycle: 'semi-persistent',
      tools: ['read', 'web_search', 'web_fetch'],
      maxConcurrent: 2,
      description: '研究员：信息收集、技术调研、方案分析'
    },
    builder: {
      model: 'minimax-portal/MiniMax-M2.5',
      lifecycle: 'semi-persistent',
      tools: ['read', 'write', 'edit', 'exec'],
      maxConcurrent: 1,
      description: '构建者：代码编写、文件修改、功能实现'
    },
    auditor: {
      model: 'minimax-portal/MiniMax-M2.5',
      lifecycle: 'temporary',
      tools: ['read', 'exec'],
      maxConcurrent: 1,
      description: '审计员：代码审查、安全检查、质量验证'
    }
  },
  communication: {
    protocol: 'sessions_send',
    timeoutMs: 300000,
    retries: 2
  },
  memory: {
    saveTemporaryAgentMemory: true,
    saveThreshold: {
      complexity: 3,
      durationMs: 3600000
    }
  }
};

/**
 * 初始化配置
 */
function initConfig() {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`[agent-manager] Created config at ${CONFIG_FILE}`);
  }
  
  return loadConfig();
}

/**
 * 加载配置
 */
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

/**
 * 获取角色配置
 */
function getRoleConfig(role) {
  const config = loadConfig();
  return config.roles[role] || null;
}

/**
 * 生成 Agent 配置模板
 */
function generateAgentTemplate(role) {
  const roleConfig = getRoleConfig(role);
  if (!roleConfig) {
    throw new Error(`Unknown role: ${role}`);
  }
  
  return {
    role,
    model: roleConfig.model,
    lifecycle: roleConfig.lifecycle,
    tools: roleConfig.tools,
    maxConcurrent: roleConfig.maxConcurrent,
    description: roleConfig.description,
    permissions: {
      allow: roleConfig.tools,
      deny: getDeniedTools(role)
    }
  };
}

/**
 * 获取禁止工具
 */
function getDeniedTools(role) {
  const commonDenied = ['gateway.*', 'cron.*', 'plugins.*'];
  
  switch (role) {
    case 'researcher':
      return [...commonDenied, 'write', 'edit', 'sessions_spawn'];
    case 'builder':
      return [...commonDenied, 'sessions_spawn'];
    case 'auditor':
      return [...commonDenied, 'write', 'edit', 'sessions_spawn'];
    case 'supervisor':
      return [...commonDenied, 'exec'];
    default:
      return commonDenied;
  }
}

/**
 * 生成人员 roster 文件
 */
function generateRoster() {
  const roles = ['supervisor', 'researcher', 'builder', 'auditor'];
  const roster = {
    generated_at: new Date().toISOString(),
    roles: {}
  };
  
  roles.forEach(role => {
    roster.roles[role] = generateAgentTemplate(role);
  });
  
  const rosterPath = path.join(AGENTS_DIR, 'roster.json');
  fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
  
  return rosterPath;
}

/**
 * 生成人员配置文档
 */
function generateAgentDocs() {
  const docs = {
    supervisor: `# Supervisor\n\n## 职责\n- 任务分析与拆解\n- Agent 创建与回收\n- 进度监控\n- 质量评估\n\n## 权限\n- 可用：sessions_list, sessions_history, subagents, sessions_send, read, write\n- 禁止：exec, gateway.*, cron.*, plugins.*\n`,
    researcher: `# Researcher\n\n## 职责\n- 信息收集\n- 技术调研\n- 方案分析\n\n## 权限\n- 可用：read, web_search, web_fetch\n- 禁止：write, edit, exec, sessions_spawn, gateway.*, cron.*, plugins.*\n`,
    builder: `# Builder\n\n## 职责\n- 代码编写\n- 文件修改\n- 功能实现\n\n## 权限\n- 可用：read, write, edit, exec\n- 禁止：sessions_spawn, gateway.*, cron.*, plugins.*\n`,
    auditor: `# Auditor\n\n## 职责\n- 代码审查\n- 安全检查\n- 质量验证\n\n## 权限\n- 可用：read, exec\n- 禁止：write, edit, sessions_spawn, gateway.*, cron.*, plugins.*\n`
  };
  
  Object.entries(docs).forEach(([role, content]) => {
    const filePath = path.join(AGENTS_DIR, `${role}.md`);
    fs.writeFileSync(filePath, content);
  });
  
  console.log('[agent-manager] Agent documentation generated');
}

// CLI 接口
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'init':
      initConfig();
      generateRoster();
      generateAgentDocs();
      console.log('[agent-manager] Initialization complete');
      break;
      
    case 'show':
      console.log(JSON.stringify(loadConfig(), null, 2));
      break;
      
    case 'template':
      const role = process.argv[3];
      if (!role) {
        console.error('Usage: node agent-manager.js template <role>');
        process.exit(1);
      }
      console.log(JSON.stringify(generateAgentTemplate(role), null, 2));
      break;
      
    default:
      console.log('Usage:');
      console.log('  node agent-manager.js init     - Initialize agent config');
      console.log('  node agent-manager.js show     - Show current config');
      console.log('  node agent-manager.js template <role> - Show role template');
  }
}

module.exports = { initConfig, loadConfig, generateAgentTemplate };
