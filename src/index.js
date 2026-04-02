const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const pluginRoot = path.resolve(__dirname, '..');
const analyzerPath = path.join(pluginRoot, 'task-analyzer.cjs');
const plannerPath = path.join(pluginRoot, 'dynamic-orchestrator.js');
const runtimeDir = path.join(os.homedir(), '.openclaw', 'workspace', '.openclaw');
const decisionPath = path.join(runtimeDir, 'multi-agent-last-decision.json');
const routingPath = path.join(runtimeDir, 'multi-agent-routing.json');
const executionPath = path.join(runtimeDir, 'multi-agent-execution.json');
const meetingPath = path.join(runtimeDir, 'multi-agent-meeting.json');
const routingArtifactsDir = path.join(runtimeDir, 'routing-artifacts');

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

function resolveEventAgentId(event, ctx) {
  const direct = String(event?.agentId || ctx?.agentId || '').trim();
  if (direct) return direct;
  const nestedDirect = String(
    event?.agent?.id ||
    event?.agent?.name ||
    event?.context?.agentId ||
    ctx?.agent?.id ||
    ctx?.agent?.name ||
    ctx?.context?.agentId ||
    ''
  ).trim();
  if (nestedDirect) return nestedDirect;
  const sessionKey = String(event?.sessionKey || ctx?.sessionKey || event?.session || '').trim();
  const match = sessionKey.match(/^agent:([^:]+):/);
  if (match?.[1]) return match[1];
  return 'main';
}

function sanitizePrompt(prompt) {
  if (!prompt) return '';
  let cleaned = String(prompt);
  cleaned = cleaned.replace(/^System:.*$/gim, '');
  cleaned = cleaned.replace(/Relevant memory:\s*[\s\S]*?(?=\n(?:Read HEARTBEAT\.md|When reading HEARTBEAT\.md|Current time:|$))/gi, '');
  cleaned = cleaned.replace(/Read HEARTBEAT\.md if it exists[\s\S]*?Do not read docs\/heartbeat\.md\.\s*/gi, '');
  cleaned = cleaned.replace(/Current time:.*$/gim, '');
  cleaned = cleaned.replace(/(?:^|\n)Multi-agent routing decision:[\s\S]*?(?=\n(?:Sender \(untrusted metadata\):|Conversation info \(untrusted metadata\):|Relevant memory:|Current time:|Read HEARTBEAT\.md|When reading HEARTBEAT\.md|$))/gi, '\n');
  cleaned = cleaned.replace(/(?:^|\n)Execution brief:[\s\S]*?(?=\n(?:Search orchestration guidance:|Sender \(untrusted metadata\):|Conversation info \(untrusted metadata\):|Relevant memory:|Current time:|Read HEARTBEAT\.md|When reading HEARTBEAT\.md|$))/gi, '\n');
  cleaned = cleaned.replace(/(?:^|\n)Search orchestration guidance:[\s\S]*?(?=\n(?:Sender \(untrusted metadata\):|Conversation info \(untrusted metadata\):|Relevant memory:|Current time:|Read HEARTBEAT\.md|When reading HEARTBEAT\.md|$))/gi, '\n');
  cleaned = cleaned.replace(/\[Internal task completion event\][\s\S]*?<<<END_UNTRUSTED_CHILD_RESULT>>>/gi, '');
  cleaned = cleaned.replace(/<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>[\s\S]*?<<<END_UNTRUSTED_CHILD_RESULT>>>/gi, '');
  cleaned = cleaned.replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, '');
  cleaned = cleaned.replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, '');
  cleaned = cleaned.replace(/\[[^\]]*source=before_agent_start[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\[[^\]]*source=auto-capture[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function shouldSkip(prompt) {
  if (!prompt) return true;
  if (/\[Subagent Context\]|\[Subagent Task\]:|^# Role:/m.test(prompt)) return true;
  if (/^System:/m.test(prompt)) return true;
  if (/\[cron:[^\]]+\]|你是多 agent 编排调度器|你是任务巡检员|你是每日任务汇总助手/i.test(prompt)) return true;
  if (/Sender \(untrusted metadata\):[\s\S]*openclaw-control-ui/i.test(prompt)) return true;
  if (/^Multi-agent routing decision:/mi.test(prompt) && (/^Execution brief:/mi.test(prompt) || /^Search orchestration guidance:/mi.test(prompt))) return true;
  if (/Context nearing limit\. Save critical state to memory-enhanced plugin/i.test(prompt)) return true;
  if (/Store durable memories only in memory\/\d{4}-\d{2}-\d{2}\.md/i.test(prompt)) return true;
  if (/Return your summary as plain text; it will be delivered automatically\./i.test(prompt)) return true;
  if (/memory_enhanced_capture/i.test(prompt) && /NO_REPLY/i.test(prompt)) return true;
  if (/^HEARTBEAT/i.test(prompt)) return true;
  if (/^Continue where you left off\./i.test(prompt)) return true;
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

function isDesktopExecutionTask(prompt = '') {
  const text = String(prompt || '');
  if (!text) return false;
  const desktopSignals = /下载安装|安装.*客户端|打开应用|打开软件|本机识别码|验证码|远程控制|向日葵|识别码与验证码|通过.*飞书.*发送|通过.*企业微信.*发送|读取.*密码|读取.*验证码|桌面软件|本地软件|前台软件|computer use|desktop/i;
  const executionSignals = /下载|安装|启动|打开|读取|发送|发给|推送|deliver|report/i;
  return desktopSignals.test(text) && executionSignals.test(text);
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

function summarizeMeeting(plan = null) {
  const meetingPlan = plan?.meetingPlan || null;
  if (!meetingPlan?.enabled) return 'disabled';
  const participants = Array.isArray(meetingPlan.participants)
    ? meetingPlan.participants.map((seat) => `${seat.seat}:${seat.roleId}`).join(' | ')
    : 'none';
  return `${meetingPlan.mode || 'structured_panel'} / rounds=${meetingPlan.rounds || 0} / participants=${participants}`;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function splitSubtaskHeavyFields(subtask = {}) {
  const lite = { ...subtask };
  const heavy = {
    workerId: subtask.workerId || null,
    roleId: subtask.roleId || null,
    description: typeof subtask.description === 'string' ? subtask.description : null,
    objective: typeof subtask.objective === 'string' ? subtask.objective : null,
    memoryItems: Array.isArray(subtask?.memory?.items) ? subtask.memory.items : null,
    resourceBudget: subtask?.resourceBudget && typeof subtask.resourceBudget === 'object'
      ? subtask.resourceBudget
      : null,
  };

  // Keep semantics in lite snapshot while removing heavy payload.
  if ('description' in lite) delete lite.description;
  if ('objective' in lite) delete lite.objective;
  if (lite.memory && typeof lite.memory === 'object') {
    lite.memory = { ...lite.memory };
    if ('items' in lite.memory) delete lite.memory.items;
    if (Object.keys(lite.memory).length === 0) delete lite.memory;
  }
  if ('resourceBudget' in lite) delete lite.resourceBudget;

  const hasHeavy = Boolean(
    heavy.description ||
    heavy.objective ||
    (Array.isArray(heavy.memoryItems) && heavy.memoryItems.length > 0) ||
    heavy.resourceBudget
  );

  return { lite, heavy: hasHeavy ? heavy : null };
}

function externalizePlanHeavyEvidence(plan, taskId) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
    return { planLite: plan, artifactRefs: [], externalized: false };
  }

  const liteSubtasks = [];
  const heavySubtasks = [];

  for (const subtask of plan.subtasks) {
    const { lite, heavy } = splitSubtaskHeavyFields(subtask);
    liteSubtasks.push(lite);
    if (heavy) heavySubtasks.push(heavy);
  }

  if (heavySubtasks.length === 0) {
    return { planLite: plan, artifactRefs: [], externalized: false };
  }

  const artifactPath = path.join(routingArtifactsDir, String(taskId), 'plan-subtasks-heavy.v1.json');
  const artifactPayload = {
    version: '1.0',
    kind: 'plan-subtasks-heavy',
    generated_at: new Date().toISOString(),
    taskId,
    count: heavySubtasks.length,
    subtasks: heavySubtasks,
  };
  writeJson(artifactPath, artifactPayload);

  const ref = {
    type: 'json',
    kind: 'plan-subtasks-heavy',
    version: '1.0',
    path: artifactPath,
    count: heavySubtasks.length,
  };

  const planLite = {
    ...plan,
    subtasks: liteSubtasks,
    artifacts: {
      ...(plan.artifacts || {}),
      subtasksHeavy: ref,
    },
  };

  return {
    planLite,
    artifactRefs: [ref],
    externalized: true,
  };
}

function hydratePlanFromArtifacts(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const ref = plan?.artifacts?.subtasksHeavy;
  const subtasks = Array.isArray(plan.subtasks) ? plan.subtasks : [];
  if (!ref?.path || !Array.isArray(subtasks) || subtasks.length === 0) {
    return plan;
  }

  try {
    if (!fs.existsSync(ref.path)) return plan;
    const payload = JSON.parse(fs.readFileSync(ref.path, 'utf8'));
    const heavyByWorker = new Map(
      (Array.isArray(payload?.subtasks) ? payload.subtasks : [])
        .map((entry) => [entry.workerId || entry.roleId, entry])
        .filter(([key]) => Boolean(key))
    );

    const hydratedSubtasks = subtasks.map((subtask) => {
      const key = subtask.workerId || subtask.roleId;
      const heavy = heavyByWorker.get(key);
      if (!heavy) return subtask;
      const merged = { ...subtask };
      if (typeof heavy.description === 'string') merged.description = heavy.description;
      if (typeof heavy.objective === 'string') merged.objective = heavy.objective;
      if (Array.isArray(heavy.memoryItems)) {
        merged.memory = {
          ...(merged.memory || {}),
          items: heavy.memoryItems,
        };
      }
      if (heavy.resourceBudget && typeof heavy.resourceBudget === 'object') {
        merged.resourceBudget = heavy.resourceBudget;
      }
      return merged;
    });

    return {
      ...plan,
      subtasks: hydratedSubtasks,
    };
  } catch {
    // Compatibility fallback: keep lite snapshot as-is if artifact cannot be read.
    return plan;
  }
}

function buildRoutingTaskId(prompt) {
  const digest = crypto.createHash('sha1').update(String(prompt || '')).digest('hex').slice(0, 12);
  return `route-${digest}`;
}

function buildExecutionSnapshot(taskId, plan = null, artifactRefs = []) {
  const teams = Array.isArray(plan?.teams) ? plan.teams : [];
  const syncPlan = Array.isArray(plan?.syncPlan) ? plan.syncPlan : [];
  return {
    version: '2.0',
    generated_at: new Date().toISOString(),
    taskId,
    executionMode: plan?.executionMode || 'single',
    meetingMode: plan?.meetingPlan?.enabled ? plan.meetingPlan.mode : 'none',
    intelligenceMode: plan?.intelligencePlan?.enabled ? plan.intelligencePlan.mode : 'none',
    artifactRefs: Array.isArray(artifactRefs) ? artifactRefs : [],
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

function buildMeetingArtifact(taskId, prompt, analysis, plan) {
  const meetingPlan = plan?.meetingPlan || null;
  return {
    generated_at: new Date().toISOString(),
    taskId,
    request: prompt,
    analysis: {
      decision: analysis?.decision || 'single',
      score: Number(analysis?.score ?? analysis?.total_score ?? 0),
      score_breakdown: analysis?.score_breakdown || {}
    },
    meetingPlan: meetingPlan || { enabled: false, mode: 'none', participants: [] },
    status: meetingPlan?.enabled ? 'pending_deliberation' : 'not_required'
  };
}

function buildContext(prompt, analysis, plan, artifactRefs = []) {
  const taskId = buildRoutingTaskId(prompt);
  const score = Number(analysis?.score ?? analysis?.total_score ?? 0);
  const decision = analysis?.decision || 'single';
  const categories = Array.isArray(analysis?.categories) ? analysis.categories : [];
  const teamSummary = summarizeTeams(plan);
  const snapshot = buildExecutionSnapshot(taskId, plan, artifactRefs);
  const lines = [
    'Multi-agent routing decision:',
    `- taskId: ${taskId}`,
    `- score: ${score}`,
    `- decision: ${decision}`,
  ];

  if (categories.length > 0) {
    lines.push(`- categories: ${categories.join(', ')}`);
  }
  if (teamSummary.length > 0) {
    lines.push(`- teams: ${teamSummary.join(' | ')}`);
  }
  if (plan?.intelligencePlan?.enabled) {
    lines.push(`- intelligence: ${(plan.intelligencePlan.platforms || []).join(', ')} / ${plan.intelligencePlan.mode}`);
  }
  if (plan?.meetingPlan?.enabled) {
    lines.push(`- meeting: ${summarizeMeeting(plan)}`);
  }

  lines.push('- Use multi-agent orchestration proactively for this request unless a concrete blocker prevents it.');
  lines.push(`- Inspect ${routingPath} before acting.`);
  lines.push(`- Use ${executionPath} as the quick execution snapshot.`);
  if (plan?.meetingPlan?.enabled) {
    lines.push('- Before execution, respect the meeting plan: converge on a recommendation, capture risks, then hand off to execution teams.');
    lines.push('- Treat meeting output as a structured decision artifact, not free-form brainstorming.');
  }
  lines.push('- Spawn or simulate worker/team execution instead of handling all stages sequentially.');
  lines.push('- When calling sessions_spawn with runtime="subagent", never set streamTo. streamTo is only valid for runtime="acp".');
  lines.push('- When calling sessions_spawn with runtime="subagent" and mode="session", always set thread=true.');
  lines.push('- If a sessions_spawn call fails due to invalid parameters, correct the payload and retry once before falling back to single-agent execution.');
  lines.push('- If you still stay single-agent, continue autonomously and state the blocker briefly without asking the user to choose.');
  lines.push('- After each substantial tool/action phase, convert progress into a short human-readable status update instead of silently stopping.');
  lines.push('- If execution is interrupted or resumed after restart, first explain what has been recovered, what stage is active now, and what the next concrete step is.');
  lines.push('- Only use NO_REPLY when there is truly no new progress, no recovery event, and no next-step information worth surfacing.');

  return {
    taskId,
    context: lines.join('\n'),
    snapshot,
  };
}

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(routingArtifactsDir, { recursive: true });
}

const plugin = {
  register(api) {
    api.logger.info?.('[openclaw-multi-agent] plugin registered');

    api.on('before_prompt_build', async (event, ctx) => {
      const prompt = sanitizePrompt(getPromptText(event));
      if (shouldSkip(prompt)) return;
      const agentId = resolveEventAgentId(event, ctx);
      const mainAgentOnly = api.pluginConfig?.mainAgentOnly !== false;
      if (mainAgentOnly && agentId !== 'main') return;
      if (typeof analyzeTask !== 'function') return;

	      try {
	        const analysis = await analyzeTask(prompt);
	        const isolatedWorkflowAgent = agentId !== 'main';
        const explicitDeliverableReport = /写到\s+\/[^\s]+\.md/i.test(prompt) && /不要停在计划|直接写报告/i.test(prompt);
        const needsMultiAgent = isolatedWorkflowAgent && explicitDeliverableReport
          ? false
          : isDesktopExecutionTask(prompt)
            ? false
            : shouldRouteComplexTask(analysis);
	        const plan = needsMultiAgent && typeof planTask === 'function' ? planTask(prompt) : null;
        const taskId = buildRoutingTaskId(prompt);

        ensureRuntimeDir();
	        fs.writeFileSync(
	          decisionPath,
	          JSON.stringify(
	            {
	              generated_at: new Date().toISOString(),
                taskId,
	              score: Number(analysis?.score ?? analysis?.total_score ?? 0),
	              needsMultiAgent,
              decision: analysis?.decision || null,
              categories: analysis?.categories || [],
              meeting: analysis?.meeting || null,
              request_preview: prompt.slice(0, 200),
              teams: summarizeTeams(plan),
              meetingSummary: summarizeMeeting(plan),
            },
            null,
            2
          )
        );

        if (!needsMultiAgent) {
          return;
        }

        const { planLite, artifactRefs, externalized } = externalizePlanHeavyEvidence(plan, taskId);
        const { context, snapshot } = buildContext(prompt, analysis, planLite, artifactRefs);

        fs.writeFileSync(
          routingPath,
          JSON.stringify(
            {
              version: '2.0',
              generated_at: new Date().toISOString(),
              taskId,
              request: prompt,
              analysis,
              // Keep legacy key `plan` for compatibility; payload is lite + artifact refs.
              plan: planLite,
              artifactRefs,
              externalized,
            },
            null,
            2
          )
        );

        fs.writeFileSync(executionPath, JSON.stringify(snapshot, null, 2));
        fs.writeFileSync(meetingPath, JSON.stringify(buildMeetingArtifact(taskId, prompt, analysis, planLite), null, 2));

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
module.exports.hydratePlanFromArtifacts = hydratePlanFromArtifacts;
module.exports.externalizePlanHeavyEvidence = externalizePlanHeavyEvidence;
module.exports.__testSanitizePrompt = sanitizePrompt;
module.exports.__testShouldSkip = shouldSkip;
