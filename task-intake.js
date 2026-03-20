#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { planTask } = require('./dynamic-orchestrator');

const ROOT = __dirname;
const STATE_DIR = path.join(ROOT, 'runtime');
const TASKS_DIR = path.join(ROOT, 'tasks');
const BRIEF_DIR = path.join(STATE_DIR, 'task-briefs');

function extractExplicitPath(taskText = '') {
  const absoluteMatch = taskText.match(/(\/Users\/[^\s，。；,;]+)/);
  if (absoluteMatch?.[1]) {
    const candidate = absoluteMatch[1].replace(/[)\]"'`,.]+$/, '');
    if (fs.existsSync(candidate)) {
      return fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
    }
  }
  return null;
}

function looksLikeRepoRoot(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const home = process.env.HOME || '';
  if (dir === home && !fs.existsSync(path.join(dir, 'package.json'))) {
    // The home directory may itself be a git repo, but it is too broad to be
    // a good default task root unless it also looks like a concrete project.
    return false;
  }
  return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
}

function inferTaskRoot(taskText = '', context = {}) {
  const explicit = extractExplicitPath(taskText);
  if (explicit) return explicit;

  if (context.taskRoot && looksLikeRepoRoot(context.taskRoot)) {
    return context.taskRoot;
  }

  const cwd = process.cwd();
  if (looksLikeRepoRoot(cwd)) {
    return cwd;
  }

  const parent = path.dirname(cwd);
  if (looksLikeRepoRoot(parent)) {
    return parent;
  }

  if (looksLikeRepoRoot(ROOT)) {
    return ROOT;
  }

  if (context.taskRoot && fs.existsSync(context.taskRoot)) {
    return context.taskRoot;
  }

  return ROOT;
}

function ensureDirs() {
  [STATE_DIR, TASKS_DIR, BRIEF_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function taskId() {
  return `task-${Date.now()}`;
}

function normalizeContext(context = {}, source = 'manual') {
  return {
    sessionId: context.sessionId || process.env.OPENCLAW_SESSION_ID || null,
    parentTaskId: context.parentTaskId || null,
    traceId: context.traceId || null,
    requestedBy: context.requestedBy || source,
    taskRoot: context.taskRoot || process.env.OPENCLAW_TASK_ROOT || null,
  };
}

function inferTaskIntent(taskText = '', context = {}) {
  const text = String(taskText || '');
  const sessionId = String(context.sessionId || '');
  const validationPattern = /demo|smoke|e2e|验证|测试|演练|试跑|压测/i;
  if (validationPattern.test(text) || validationPattern.test(sessionId)) {
    return 'validation';
  }
  return 'production';
}

function collectKeyPaths(taskRoot) {
  return [
    'README.md',
    'package.json',
    'src',
    'config',
    'tasks',
    'runtime',
    'docs',
    'tests'
  ]
    .map((relativePath) => path.join(taskRoot, relativePath))
    .filter((candidate) => fs.existsSync(candidate));
}

function summarizeRepoShape(taskRoot) {
  const keyPaths = collectKeyPaths(taskRoot);
  return {
    taskRoot,
    keyPaths,
    hasReadme: keyPaths.some((candidate) => candidate.endsWith('/README.md')),
    hasPackageJson: keyPaths.some((candidate) => candidate.endsWith('/package.json')),
    hasSourceTree: keyPaths.some((candidate) => candidate.endsWith('/src')),
    hasRuntimeState: keyPaths.some((candidate) => candidate.endsWith('/runtime'))
  };
}

function createTaskBriefPayload(payload, repoShape = summarizeRepoShape(payload?.context?.taskRoot || ROOT)) {
  const plan = payload?.plan || {};
  return {
    taskId: payload.id,
    task: plan.task || payload.task || 'unknown',
    taskRoot: repoShape.taskRoot,
    executionMode: plan.executionMode || 'single',
    collaborationModel: plan.collaborationModel || 'solo',
    selectedRoles: Array.isArray(plan.selectedRoles) ? plan.selectedRoles : [],
    staffingPlan: Array.isArray(plan.staffingPlan) ? plan.staffingPlan : [],
    teams: Array.isArray(plan.teams) ? plan.teams : [],
    syncPlan: Array.isArray(plan.syncPlan) ? plan.syncPlan : [],
    intelligencePlan: plan.intelligencePlan || {
      enabled: false,
      mode: "none",
      platforms: [],
      routes: [],
      collectionPlan: [],
      evidenceSchema: [],
      outputs: []
    },
    meetingPlan: plan.meetingPlan || {
      enabled: false,
      mode: 'none',
      rounds: 0,
      participants: [],
      agenda: []
    },
    keyPaths: repoShape.keyPaths,
    repoShape: {
      hasReadme: repoShape.hasReadme,
      hasPackageJson: repoShape.hasPackageJson,
      hasSourceTree: repoShape.hasSourceTree,
      hasRuntimeState: repoShape.hasRuntimeState
    },
    resourcePolicy: {
      selectedRoles: Array.isArray(plan.selectedRoles)
        ? plan.selectedRoles.map((role) => ({
            id: role.id,
            reputationScore: role.reputationScore ?? 70,
            tiers: role.tiers || [],
            averagePromptTokens: role.averagePromptTokens ?? 0
          }))
        : []
    },
    generatedAt: new Date().toISOString()
  };
}

function writeTaskBrief(payload) {
  const briefPath = path.join(BRIEF_DIR, `${payload.id}.json`);
  const repoShape = summarizeRepoShape(payload?.context?.taskRoot || ROOT);
  const brief = createTaskBriefPayload(payload, repoShape);
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
  return briefPath;
}

function enqueue(taskText, source = 'manual', context = {}) {
  ensureDirs();
  const id = taskId();
  const plan = planTask(taskText);
  const normalizedContext = normalizeContext(context, source);
  normalizedContext.taskRoot = inferTaskRoot(taskText, normalizedContext);
  const payload = {
    id,
    task: taskText,
    source,
    intent: inferTaskIntent(taskText, normalizedContext),
    status: plan.needsMultiAgent ? 'planned' : 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    context: {
      ...normalizedContext,
      taskId: id
    },
    plan,
    results: []
  };
  const file = path.join(TASKS_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  const briefPath = writeTaskBrief(payload);
  return { id, file, payload, briefPath };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node task-intake.js <task>');
    process.exit(1);
  }
  const result = enqueue(task, 'manual');
  console.log(JSON.stringify({ id: result.id, file: result.file, briefPath: result.briefPath, plan: result.payload.plan }, null, 2));
}

module.exports = { enqueue, collectKeyPaths, createTaskBriefPayload, writeTaskBrief };
