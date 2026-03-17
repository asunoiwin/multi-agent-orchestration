const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const pluginRoot = path.resolve(__dirname, '..');
const analyzerPath = path.join(pluginRoot, 'task-analyzer.cjs');
const plannerPath = path.join(pluginRoot, 'dynamic-orchestrator.js');
const runtimeDir = path.join(os.homedir(), '.openclaw', 'workspace', '.openclaw');
const decisionPath = path.join(runtimeDir, 'multi-agent-last-decision.json');
const routingPath = path.join(runtimeDir, 'multi-agent-routing.json');
const executionPath = path.join(runtimeDir, 'multi-agent-execution.json');

let analyzeTask = null;
let planTask = null;

try {
  ({ analyzeTask } = require(analyzerPath));
} catch {
  analyzeTask = null;
}

try {
  ({ planTask } = require(plannerPath));
} catch {
  planTask = null;
}

function getPromptText(event) {
  return String(event?.prompt || '').trim();
}

function shouldSkip(prompt) {
  if (!prompt) return true;
  if (/\[Subagent Context\]|\[Subagent Task\]:|^# Role:/m.test(prompt)) return true;
  if (/\[cron:[^\]]+\]|你是多 agent 编排调度器|你是任务巡检员|你是每日任务汇总助手/i.test(prompt)) return true;
  if (/^HEARTBEAT/i.test(prompt)) return true;
  return false;
}

function shouldRouteComplexTask(analysis = {}) {
  const decision = analysis?.decision || 'single';
  const score = Number(analysis?.score ?? analysis?.total_score ?? 0);
  const breakdown = analysis?.score_breakdown || analysis || {};
  const stages = Number(breakdown?.stages ?? 0);
  const structure = Number(breakdown?.structure ?? 0);
  const domains = Number(breakdown?.domains ?? 0);
  const parallelism = Number(breakdown?.parallelism ?? 0);
  const toolLoad = Number(breakdown?.tool_load ?? breakdown?.toolLoad ?? 0);
  const risk = Number(breakdown?.risk ?? 0);

  if (decision === 'multi' || decision === 'light_multi') return true;
  if (score >= 7) return true;
  if (stages >= 3) return true;
  if (structure >= 2 && (domains >= 2 || toolLoad >= 2)) return true;
  if (parallelism >= 1 && (domains >= 2 || stages >= 2)) return true;
  if (risk >= 2 && (stages >= 2 || toolLoad >= 2)) return true;
  return false;
}

function summarizeTeams(plan = null) {
  const teams = Array.isArray(plan?.teams) ? plan.teams : [];
  return teams.map((team) => {
    const stage = team.stage || 'stage';
    const capability = team.capability || 'capability';
    const count = Array.isArray(team.workers) ? team.workers.length : 0;
    return `${stage}:${capability}(${count})`;
  });
}

function buildExecutionSnapshot(plan = null) {
  const teams = Array.isArray(plan?.teams) ? plan.teams : [];
  const syncPlan = Array.isArray(plan?.syncPlan) ? plan.syncPlan : [];
  return {
    generated_at: new Date().toISOString(),
    executionMode: plan?.executionMode || 'single',
    teams: teams.map((team) => ({
      stage: team.stage || 'stage',
      capability: team.capability || 'capability',
      workers: Array.isArray(team.workers)
        ? team.workers.map((worker) => worker.workerId).filter(Boolean)
        : [],
    })),
    syncPlan: syncPlan.map((item) => ({
      id: item.id || 'sync',
      kind: item.kind || 'sync',
    })),
  };
}

function buildContext(prompt, analysis, plan) {
  const score = Number(analysis?.score ?? analysis?.total_score ?? 0);
  const decision = analysis?.decision || 'single';
  const categories = Array.isArray(analysis?.categories) ? analysis.categories : [];
  const teamSummary = summarizeTeams(plan);
  const snapshot = buildExecutionSnapshot(plan);
  const lines = [
    'Multi-agent routing decision:',
    `- score: ${score}`,
    `- decision: ${decision}`,
  ];

  if (categories.length > 0) {
    lines.push(`- categories: ${categories.join(', ')}`);
  }
  if (teamSummary.length > 0) {
    lines.push(`- teams: ${teamSummary.join(' | ')}`);
  }

  lines.push('- Use multi-agent orchestration proactively for this request unless a concrete blocker prevents it.');
  lines.push(`- Inspect ${routingPath} before acting.`);
  lines.push(`- Use ${executionPath} as the quick execution snapshot.`);
  lines.push('- Spawn or simulate worker/team execution instead of handling all stages sequentially.');
  lines.push('- If you still stay single-agent, continue autonomously and state the blocker briefly without asking the user to choose.');

  return {
    context: lines.join('\n'),
    snapshot,
  };
}

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

const plugin = {
  register(api) {
    api.logger.info?.('[openclaw-multi-agent] plugin registered');

    api.on('before_agent_start', async (event) => {
      const prompt = getPromptText(event);
      if (shouldSkip(prompt)) return;
      if (event?.agentId && event.agentId !== 'main') return;
      if (typeof analyzeTask !== 'function') return;

      try {
        const analysis = await analyzeTask(prompt);
        const needsMultiAgent = shouldRouteComplexTask(analysis);
        const plan = needsMultiAgent && typeof planTask === 'function' ? planTask(prompt) : null;

        ensureRuntimeDir();
        fs.writeFileSync(
          decisionPath,
          JSON.stringify(
            {
              generated_at: new Date().toISOString(),
              score: Number(analysis?.score ?? analysis?.total_score ?? 0),
              needsMultiAgent,
              decision: analysis?.decision || null,
              categories: analysis?.categories || [],
              request_preview: prompt.slice(0, 200),
              teams: summarizeTeams(plan),
            },
            null,
            2
          )
        );

        if (!needsMultiAgent) {
          return;
        }

        const { context, snapshot } = buildContext(prompt, analysis, plan);

        fs.writeFileSync(
          routingPath,
          JSON.stringify(
            {
              generated_at: new Date().toISOString(),
              request: prompt,
              analysis,
              plan,
            },
            null,
            2
          )
        );

        fs.writeFileSync(executionPath, JSON.stringify(snapshot, null, 2));

        api.logger.info?.('[openclaw-multi-agent] injecting multi-agent routing context');
        return {
          prependContext: `${context}\n`,
        };
      } catch (error) {
        api.logger.error?.(
          `[openclaw-multi-agent] routing error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  },
};

module.exports = plugin;
module.exports.default = plugin;
