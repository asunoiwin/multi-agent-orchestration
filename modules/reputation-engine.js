const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_FILE = path.join(ROOT, 'config', 'reputation-policy.json');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const SCOREBOARD_FILE = path.join(RUNTIME_DIR, 'reputation-scoreboard.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadPolicy() {
  return readJson(POLICY_FILE, {
    enabled: true,
    defaults: { score: 70, completed: 0, failed: 0, adopted: 0, rework: 0, stalled: 0 },
    tiers: [],
    penalties: {},
    rewards: {},
    resourceBands: { small: 1200, medium: 2200, large: 3200 }
  });
}

function loadScoreboard() {
  const policy = loadPolicy();
  const current = readJson(SCOREBOARD_FILE, { agents: {} });
  return {
    updatedAt: current.updatedAt || null,
    agents: current.agents || {},
    defaults: policy.defaults
  };
}

function saveScoreboard(scoreboard) {
  writeJson(SCOREBOARD_FILE, {
    updatedAt: new Date().toISOString(),
    agents: scoreboard.agents || {}
  });
}

function ensureRoleScore(scoreboard, roleId) {
  const defaults = scoreboard.defaults || {};
  if (!scoreboard.agents[roleId]) {
    scoreboard.agents[roleId] = {
      roleId,
      score: defaults.score ?? 70,
      completed: defaults.completed ?? 0,
      failed: defaults.failed ?? 0,
      adopted: defaults.adopted ?? 0,
      rework: defaults.rework ?? 0,
      stalled: defaults.stalled ?? 0,
      lastUpdatedAt: null
    };
  }
  return scoreboard.agents[roleId];
}

function resolveTier(score, policy = loadPolicy()) {
  const tiers = Array.isArray(policy.tiers) ? policy.tiers : [];
  return tiers.find((tier) => score >= Number(tier.minScore ?? 0)) || tiers[tiers.length - 1] || {
    name: 'standard',
    tokenMultiplier: 1,
    lifetime: 'semi-persistent',
    priorityBoost: 0,
    voteWeight: 1
  };
}

function scoreRole(roleId, event, options = {}) {
  const policy = loadPolicy();
  const scoreboard = loadScoreboard();
  const entry = ensureRoleScore(scoreboard, roleId);
  const rewards = policy.rewards || {};
  const penalties = policy.penalties || {};
  const delta = Number(rewards[event] ?? penalties[event] ?? 0);
  entry.score = Math.max(0, Math.min(100, entry.score + delta));
  if (event === 'completed') entry.completed += 1;
  if (event === 'failed') entry.failed += 1;
  if (event === 'adopted') entry.adopted += 1;
  if (event === 'rework') entry.rework += 1;
  if (event === 'stalled') entry.stalled += 1;
  entry.lastReason = options.reason || event;
  entry.lastUpdatedAt = new Date().toISOString();
  saveScoreboard(scoreboard);
  return {
    roleId,
    score: entry.score,
    delta,
    tier: resolveTier(entry.score, policy)
  };
}

function getRoleProfile(roleId, role = {}) {
  const policy = loadPolicy();
  const scoreboard = loadScoreboard();
  const entry = ensureRoleScore(scoreboard, roleId);
  const tier = resolveTier(entry.score, policy);
  return {
    roleId,
    score: entry.score,
    tier: tier.name,
    voteWeight: Number(tier.voteWeight ?? 1),
    priorityBoost: Number(tier.priorityBoost ?? 0),
    tokenMultiplier: Number(tier.tokenMultiplier ?? 1),
    lifecycle: tier.lifetime || role.lifecycle || 'ephemeral',
    stats: {
      completed: entry.completed,
      failed: entry.failed,
      adopted: entry.adopted,
      rework: entry.rework,
      stalled: entry.stalled
    }
  };
}

function baseBudgetForCapability(capability, policy = loadPolicy()) {
  const resourceBands = policy.resourceBands || {};
  if (capability === 'planning' || capability === 'coordination') return Number(resourceBands.large ?? 3200);
  if (capability === 'research' || capability === 'audit' || capability === 'documentation') {
    return Number(resourceBands.medium ?? 2200);
  }
  return Number(resourceBands.small ?? 1200);
}

function getResourceBudget(roleId, capability, role = {}) {
  const profile = getRoleProfile(roleId, role);
  const base = baseBudgetForCapability(capability);
  const promptTokens = Math.round(base * profile.tokenMultiplier);
  const contextItems = capability === 'planning' || capability === 'coordination'
    ? 10
    : capability === 'research' || capability === 'audit' || capability === 'documentation'
      ? 7
      : 5;
  const maxRounds = capability === 'planning' || capability === 'coordination' ? 3 : 2;
  const persistAcrossStages = ['trusted', 'standard'].includes(profile.tier) && capability !== 'audit';
  return {
    promptTokens,
    contextItems,
    maxRounds,
    persistAcrossStages,
    tier: profile.tier,
    voteWeight: profile.voteWeight,
    lifecycle: profile.lifecycle,
    priorityBoost: profile.priorityBoost,
    score: profile.score
  };
}

module.exports = {
  loadPolicy,
  loadScoreboard,
  saveScoreboard,
  ensureRoleScore,
  resolveTier,
  scoreRole,
  getRoleProfile,
  getResourceBudget
};
