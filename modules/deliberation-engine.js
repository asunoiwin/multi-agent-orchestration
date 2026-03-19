const fs = require('fs');
const path = require('path');
const { getRoleProfile, getResourceBudget } = require('./reputation-engine');

const ROOT = path.resolve(__dirname, '..');
const POLICY_FILE = path.join(ROOT, 'config', 'deliberation-policy.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadPolicy() {
  return readJson(POLICY_FILE, {
    enabled: true,
    triggerThresholds: { score: 8, ambiguity: 2, risk: 2, domains: 2, structure: 2 },
    maxRounds: 3,
    defaultRounds: 2,
    maxParticipants: 4,
    defaultParticipants: 3,
    roles: {}
  });
}

function shouldUseMeeting(analysis = {}, plan = null, policy = loadPolicy(), taskText = '') {
  if (!policy.enabled) return false;
  const thresholds = policy.triggerThresholds || {};
  const score = Number(analysis?.score ?? analysis?.total_score ?? 0);
  const ambiguity = Number(analysis?.uncertainty ?? 0);
  const risk = Number(analysis?.risk ?? 0);
  const domains = Number(analysis?.domains ?? 0);
  const structure = Number(analysis?.structure ?? 0);
  const needsMultiAgent = Boolean(plan?.needsMultiAgent);
  const explicitMeetingIntent = /讨论|辩论|评审|会议|圆桌|panel|约束|候选方案|推荐方案|权衡|tradeoff|方案比较|比较方案|形成推荐/i.test(String(taskText || ''));
  if (!needsMultiAgent) return false;
  if (explicitMeetingIntent) return true;
  if (score >= Number(thresholds.score ?? 8)) return true;
  if (ambiguity >= Number(thresholds.ambiguity ?? 2) && domains >= Number(thresholds.domains ?? 2)) return true;
  if (risk >= Number(thresholds.risk ?? 2) && structure >= Number(thresholds.structure ?? 2)) return true;
  return false;
}

function candidateScore(role, seat, analysis = {}) {
  const profile = getRoleProfile(role.id, role);
  const capabilityMatch = Array.isArray(role.triggerCapabilities) && seat.capabilities.some((item) => role.triggerCapabilities.includes(item)) ? 3 : 0;
  const planningBias = seat.seat === 'moderator' && role.id === 'solution-architect' ? 2 : 0;
  const challengeBias = seat.seat === 'challenger' && ['quality-auditor', 'test-engineer'].includes(role.id) ? 2 : 0;
  const executionBias = seat.seat === 'executor' && ['code-implementer', 'os-operator'].includes(role.id) ? 2 : 0;
  const researchBias = seat.seat === 'research' && ['web-researcher', 'data-analyst'].includes(role.id) ? 2 : 0;
  return capabilityMatch + planningBias + challengeBias + executionBias + researchBias + (profile.priorityBoost || 0) + profile.voteWeight;
}

function selectSeat(pool, seat, usedRoles) {
  const candidates = pool.roles
    .filter((role) => !usedRoles.has(role.id))
    .map((role) => ({ role, score: candidateScore(role, seat) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.role || null;
}

function buildMeetingSeats(analysis = {}) {
  const seats = [
    { seat: 'moderator', capabilities: ['planning', 'architecture', 'coordination'] },
    { seat: 'challenger', capabilities: ['audit', 'verification', 'review'] },
    { seat: 'executor', capabilities: ['implementation', 'configuration', 'os-operation'] }
  ];
  if (Number(analysis?.domains ?? 0) >= 2 || Number(analysis?.uncertainty ?? 0) >= 2) {
    seats.push({ seat: 'research', capabilities: ['research', 'analysis', 'data'] });
  }
  return seats;
}

function buildMeetingPlan(task, analysis, plan, pool, policy = loadPolicy()) {
  const seats = buildMeetingSeats(analysis).slice(0, Number(policy.maxParticipants ?? 4));
  const usedRoles = new Set();
  const participants = [];
  for (const seat of seats) {
    const role = selectSeat(pool, seat, usedRoles);
    if (!role) continue;
    usedRoles.add(role.id);
    const profile = getRoleProfile(role.id, role);
    const budget = getResourceBudget(role.id, seat.capabilities[0], role);
    participants.push({
      seat: seat.seat,
      roleId: role.id,
      roleName: role.name,
      purpose: role.purpose,
      voteWeight: profile.voteWeight,
      tier: profile.tier,
      reputationScore: profile.score,
      resourceBudget: budget
    });
  }

  const rounds = Math.min(Number(policy.maxRounds ?? 3), Math.max(Number(policy.defaultRounds ?? 2), Number(analysis?.risk ?? 0) >= 2 ? 3 : 2));
  const agenda = [
    '统一问题定义与成功标准',
    '明确约束、风险和不可接受结果',
    '提出候选方案并比较成本/稳定性/维护性',
    '形成推荐方案与执行移交'
  ];

  return {
    enabled: participants.length >= 3,
    mode: participants.length >= 4 ? 'structured_panel' : 'mini_panel',
    rounds,
    participants,
    agenda,
    decisionRule: 'moderated-weighted-consensus',
    outputs: policy.requiredOutputs || [],
    requiredOutputs: policy.requiredOutputs || [],
    consensus: {
      method: 'weighted-consensus',
      moderatorTieBreaker: true
    },
    stopConditions: [
      '达到最大轮次',
      '形成单一推荐方案',
      '仍有分歧但已明确记录取舍与建议'
    ],
    outputTemplate: {
      problem_statement: '',
      constraints: [],
      options: [],
      risks: [],
      recommendation: '',
      execution_handoff: []
    },
    rationale: `任务复杂度=${Number(analysis?.score ?? analysis?.total_score ?? 0)}，适合先进行有限轮次会议讨论再进入执行。`,
    taskPreview: String(task || '').slice(0, 200)
  };
}

module.exports = {
  loadPolicy,
  shouldUseMeeting,
  buildMeetingPlan
};
