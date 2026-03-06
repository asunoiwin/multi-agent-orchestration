#!/usr/bin/env node
/**
 * Memory Extractor
 * 从临时 Agent 提取有价值的记忆
 */

const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const WORKSPACE = path.join(homedir(), '.openclaw', 'workspace');
const AGENTS_DIR = path.join(WORKSPACE, '.learnings', 'agents');
const MEMORY_DIR = path.join(WORKSPACE, '.learnings', 'agents', 'memories');

/**
 * 判断是否应该保存记忆
 */
function shouldSaveMemory(agent, task) {
  const criteria = {
    complexity: task.complexity >= 3,
    duration: task.duration > 3600000, // 超过 1 小时
    hasLearnings: task.learnings && task.learnings.length > 0,
    isReusable: task.reusable === true
  };
  
  return Object.values(criteria).some(Boolean);
}

/**
 * 提取任务模式
 */
function extractPattern(task) {
  return {
    type: task.type || 'unknown',
    domains: task.domains || [],
    roles: task.assignedRoles || [],
    executionMode: task.executionMode || 'serial',
    complexity: task.complexity,
    duration: task.duration,
    success: task.status === 'completed'
  };
}

/**
 * 提取解决方案
 */
function extractSolution(task) {
  return {
    problem: task.description,
    approach: task.approach || 'unknown',
    steps: task.steps || [],
    tools: task.toolsUsed || [],
    outcome: task.outcome || 'unknown',
    effectiveness: task.effectiveness || 0.8
  };
}

/**
 * 提取错误教训
 */
function extractLessons(task) {
  const lessons = [];
  
  if (task.errors && task.errors.length > 0) {
    task.errors.forEach(error => {
      lessons.push({
        error: error.message,
        context: error.context,
        fix: error.fix,
        prevention: error.prevention
      });
    });
  }
  
  if (task.blockers && task.blockers.length > 0) {
    task.blockers.forEach(blocker => {
      lessons.push({
        error: `Blocker: ${blocker.reason}`,
        context: blocker.context,
        fix: blocker.resolution,
        prevention: 'Check dependencies before starting'
      });
    });
  }
  
  return lessons;
}

/**
 * 提取可复用模板
 */
function extractTemplates(task) {
  const templates = [];
  
  if (task.deliverables) {
    task.deliverables.forEach(deliverable => {
      if (deliverable.type === 'code' && deliverable.reusable) {
        templates.push({
          name: deliverable.name,
          type: 'code',
          path: deliverable.path,
          description: deliverable.description
        });
      }
      
      if (deliverable.type === 'config' && deliverable.reusable) {
        templates.push({
          name: deliverable.name,
          type: 'config',
          path: deliverable.path,
          description: deliverable.description
        });
      }
    });
  }
  
  return templates;
}

/**
 * 提取记忆
 */
function extractMemory(agentId, taskId) {
  // 加载任务数据
  const taskFile = path.join(AGENTS_DIR, 'tasks', `${taskId}.json`);
  
  if (!fs.existsSync(taskFile)) {
    throw new Error(`Task not found: ${taskId}`);
  }
  
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  
  // 判断是否应该保存
  if (!shouldSaveMemory({ id: agentId }, task)) {
    console.log(`[memory-extractor] Task ${taskId} does not meet save criteria`);
    return null;
  }
  
  const memory = {
    agentId,
    taskId,
    extractedAt: new Date().toISOString(),
    pattern: extractPattern(task),
    solution: extractSolution(task),
    lessons: extractLessons(task),
    templates: extractTemplates(task)
  };
  
  return memory;
}

/**
 * 保存记忆
 */
function saveMemory(memory) {
  if (!memory) return;
  
  // 确保目录存在
  const dirs = ['patterns', 'solutions', 'lessons', 'templates'];
  dirs.forEach(dir => {
    const dirPath = path.join(MEMORY_DIR, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
  
  // 保存模式
  if (memory.pattern) {
    const patternsFile = path.join(MEMORY_DIR, 'patterns.json');
    const patterns = fs.existsSync(patternsFile) 
      ? JSON.parse(fs.readFileSync(patternsFile, 'utf8'))
      : [];
    patterns.push(memory.pattern);
    fs.writeFileSync(patternsFile, JSON.stringify(patterns, null, 2));
  }
  
  // 保存解决方案
  if (memory.solution) {
    const solutionsFile = path.join(MEMORY_DIR, 'solutions.json');
    const solutions = fs.existsSync(solutionsFile)
      ? JSON.parse(fs.readFileSync(solutionsFile, 'utf8'))
      : [];
    solutions.push(memory.solution);
    fs.writeFileSync(solutionsFile, JSON.stringify(solutions, null, 2));
  }
  
  // 保存教训
  if (memory.lessons && memory.lessons.length > 0) {
    const lessonsFile = path.join(MEMORY_DIR, 'lessons.json');
    const lessons = fs.existsSync(lessonsFile)
      ? JSON.parse(fs.readFileSync(lessonsFile, 'utf8'))
      : [];
    lessons.push(...memory.lessons);
    fs.writeFileSync(lessonsFile, JSON.stringify(lessons, null, 2));
  }
  
  // 保存模板
  if (memory.templates && memory.templates.length > 0) {
    memory.templates.forEach(template => {
      const templateFile = path.join(MEMORY_DIR, 'templates', `${template.name}.json`);
      fs.writeFileSync(templateFile, JSON.stringify(template, null, 2));
    });
  }
  
  console.log(`[memory-extractor] Memory saved for task ${memory.taskId}`);
  console.log(`  - Patterns: ${memory.pattern ? 1 : 0}`);
  console.log(`  - Solutions: ${memory.solution ? 1 : 0}`);
  console.log(`  - Lessons: ${memory.lessons.length}`);
  console.log(`  - Templates: ${memory.templates.length}`);
}

// CLI 接口
if (require.main === module) {
  const agentId = process.argv[2];
  const taskId = process.argv[3];
  
  if (!agentId || !taskId) {
    console.error('Usage: node memory-extractor.js <agent-id> <task-id>');
    process.exit(1);
  }
  
  try {
    const memory = extractMemory(agentId, taskId);
    saveMemory(memory);
  } catch (error) {
    console.error('[memory-extractor] Error:', error.message);
    process.exit(1);
  }
}

module.exports = { extractMemory, saveMemory, shouldSaveMemory };
