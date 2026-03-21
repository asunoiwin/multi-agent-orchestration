const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY_FILE = path.join(ROOT, 'config', 'social-intel-policy.json');

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadPolicy() {
  return readJson(POLICY_FILE, {
    enabled: true,
    platformKeywords: {},
    triggerKeywords: [],
    platformRoutes: {},
    defaultOutputs: ['source_inventory', 'meeting_brief'],
    maxEvidenceCards: 8
  });
}

function collectPlatformSignals(taskText = '', policy = loadPolicy()) {
  const text = String(taskText || '').toLowerCase();
  const matched = [];
  for (const [platform, keywords] of Object.entries(policy.platformKeywords || {})) {
    const hit = (keywords || []).some((keyword) => text.includes(String(keyword).toLowerCase()));
    if (hit) matched.push(platform);
  }
  return matched;
}

function hasSocialIntent(taskText = '', policy = loadPolicy()) {
  const text = String(taskText || '');
  const matchedPlatforms = collectPlatformSignals(text, policy);
  if (matchedPlatforms.length > 0) return true;
  return (policy.triggerKeywords || []).some((keyword) => text.includes(keyword));
}

function buildPlatformRoute(platform, policy = loadPolicy()) {
  const route = (policy.platformRoutes || {})[platform] || {};
  return {
    platform,
    preferredMode: route.preferredMode || 'browser',
    fallbackMode: route.fallbackMode || 'browser',
    sources: Array.isArray(route.sources) ? route.sources : [],
    notes: route.notes || ''
  };
}

function buildCollectionPlan(routes = [], policy = loadPolicy()) {
  const maxSourcesPerPlatform = Number(policy.maxSourcesPerPlatform ?? 5);
  return routes.map((route) => ({
    platform: route.platform,
    preferredMode: route.preferredMode,
    fallbackMode: route.fallbackMode,
    maxSources: maxSourcesPerPlatform,
    steps: [
      `discover:${route.platform}`,
      `extract:${route.platform}`,
      `normalize:${route.platform}`,
      `dedupe:${route.platform}`
    ],
    sources: route.sources,
    notes: route.notes
  }));
}

function buildEvidenceSchema(policy = loadPolicy()) {
  return Array.isArray(policy.evidenceCardFields) ? policy.evidenceCardFields : [
    'platform',
    'title',
    'author',
    'published_at',
    'url',
    'excerpt',
    'signals',
    'credibility'
  ];
}

function buildIntelligencePlan(taskText = '', features = {}, analysis = {}, policy = loadPolicy()) {
  const enabled = Boolean(policy.enabled) && (features.socialIntel || hasSocialIntent(taskText, policy));
  if (!enabled) {
    return {
      enabled: false,
      platforms: [],
      routes: [],
      outputs: [],
      collectionPlan: [],
      evidenceSchema: [],
      rationale: '任务不需要额外的社媒情报层。'
    };
  }

  const explicitPlatforms = collectPlatformSignals(taskText, policy);
  const defaultPlatforms = explicitPlatforms.length > 0 ? explicitPlatforms : ['weibo', 'douyin', 'xiaohongshu'];
  const platforms = Array.from(new Set(defaultPlatforms));
  const routes = platforms.map((platform) => buildPlatformRoute(platform, policy));
  const collectionPlan = buildCollectionPlan(routes, policy);
  const evidenceSchema = buildEvidenceSchema(policy);
  const socialBreadth = Math.max(platforms.length, Number(analysis?.domains ?? 0) >= 3 ? 3 : platforms.length);

  return {
    enabled: true,
    mode: platforms.length >= 2 ? 'multi-source-social-intel' : 'single-source-social-intel',
    platforms,
    routes,
    outputs: Array.isArray(policy.defaultOutputs) ? policy.defaultOutputs : [],
    maxEvidenceCards: Number(policy.maxEvidenceCards ?? 8),
    collectionPlan,
    evidenceSchema,
    socialBreadth,
    rationale: `任务涉及社媒/舆情/平台搜索，优先走 ${routes.map((route) => `${route.platform}:${route.preferredMode}`).join(' | ')} 的混合采集路径。`
  };
}

module.exports = {
  loadPolicy,
  collectPlatformSignals,
  hasSocialIntent,
  buildIntelligencePlan,
  buildCollectionPlan,
  buildEvidenceSchema
};
