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
const taskBriefDir = path.join(pluginRoot, 'runtime', 'task-briefs');
const supervisorRunnerPath = path.join(pluginRoot, 'supervisor-runner.js');
const transcriptStore = require('../transcript-store');

let analyzeTask = null;
let planTask = null;
let supervisorRunOnce = null;

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

try {
  ({ supervisorRunOnce } = require(supervisorRunnerPath));
} catch {
  supervisorRunOnce = null;
}

function getPromptText(event) {
  return String(event?.prompt || '').trim();
}

function isInternalControlEvent(event, ctx) {
  const prompt = String(event?.prompt || '');
  const sessionKey = String(event?.sessionKey || ctx?.sessionKey || event?.session || '');
  const sender = String(
    event?.sender ||
    event?.source ||
    event?.context?.source ||
    ctx?.sender ||
    ctx?.source ||
    ''
  );
  const controlPattern = [
    /^System:/im,
    /^HEARTBEAT(?:_OK)?$/im,
    /Read HEARTBEAT\.md if it exists/im,
    /When reading HEARTBEAT\.md/im,
    /Current time:/im,
    /gateway\.restart/im,
    /openclaw doctor --non-interactive/im,
    /openclaw-control-ui/im,
    /before_agent_start/im,
    /^\[cron:[^\]]+\]/im,
  ];
  if (controlPattern.some((pattern) => pattern.test(prompt))) return true;
  if (/:cron:/.test(sessionKey) || /openclaw-control-ui/i.test(sender)) return true;
  return false;
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

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function getTaskBriefPath(taskId) {
  if (!taskId) return null;
  return path.join(taskBriefDir, `${taskId}.json`);
}

function getLatestTaskBriefPath() {
  try {
    const files = fs.readdirSync(taskBriefDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({
        name,
        file: path.join(taskBriefDir, name),
        mtimeMs: fs.statSync(path.join(taskBriefDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.file || null;
  } catch {
    return null;
  }
}

function getCurrentRuntimeStatus(taskId = null) {
  const decision = readJson(decisionPath, null);
  const routing = readJson(routingPath, null);
  const execution = readJson(executionPath, null);
  const meeting = readJson(meetingPath, null);
  const effectiveTaskId = taskId || routing?.taskId || decision?.taskId || execution?.taskId || null;

  // Stale task guard: if no specific taskId requested and the current task is
  // >1 hour old with no active agents / queued workers, treat it as stale so that
  // ops-watchdog stops polling it.
  const STALE_THRESHOLD_MS = 60 * 60 * 1000;
  let isStale = false;
  if (!taskId && effectiveTaskId && execution?.generated_at && execution?.taskId === effectiveTaskId) {
    const ageMs = Date.now() - new Date(execution.generated_at).getTime();
    const pluginRoot = path.resolve(__dirname, '..');
    const manifest = readJson(path.join(pluginRoot, 'runtime', 'spawn-queue-manifest.json'), { agents: [] });
    const activeAgents = readJson(path.join(pluginRoot, 'runtime', 'active-agents.json'), []);
    const hasActiveWork =
      (Array.isArray(manifest?.agents) && manifest.agents.length > 0) ||
      (Array.isArray(activeAgents) && activeAgents.some((a) => a?.taskId && ['waiting', 'spawning', 'running', 'in_progress'].includes(a.status)));
    if (ageMs > STALE_THRESHOLD_MS && !hasActiveWork) {
      isStale = true;
    }
  }

  const briefPath = getTaskBriefPath(effectiveTaskId) || getLatestTaskBriefPath();
  const brief = briefPath ? readJson(briefPath, null) : null;
  return {
    taskId: isStale ? null : (effectiveTaskId || brief?.taskId || null),
    decision: isStale ? null : decision,
    routing: isStale ? null : routing,
    execution: isStale ? null : execution,
    meeting: isStale ? null : meeting,
    transcript: effectiveTaskId && !isStale ? transcriptStore.summarizeTranscript(effectiveTaskId) : null,
    briefPath: isStale ? null : briefPath,
    brief: isStale ? null : brief,
    isStale,
    staleTaskId: isStale ? effectiveTaskId : null,
  };
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

    api.registerTool?.({
      name: 'multi_agent_runtime_status',
      label: 'Multi-Agent Runtime Status',
      description: 'Inspect the current multi-agent routing, execution snapshot, and artifact refs without relying on prompt injection.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' }
        },
        required: []
      },
      execute: async (args = {}) => {
        const status = getCurrentRuntimeStatus(args.task_id || null);
        if (status.taskId && !status.isStale) {
          transcriptStore.appendTranscriptEvent(status.taskId, 'runtime_status_read', {
            requestedTaskId: args.task_id || null,
            effectiveTaskId: status.taskId,
            hasDecision: Boolean(status.decision),
            hasRouting: Boolean(status.routing),
            hasExecution: Boolean(status.execution),
            hasBrief: Boolean(status.brief)
          });
        }
        const text = [
          `multi-agent task: ${status.taskId || 'none'}`,
          `decision: ${status.decision?.decision || 'none'}`,
          `needsMultiAgent: ${String(Boolean(status.decision?.needsMultiAgent))}`,
          `artifactRefs: ${Array.isArray(status.routing?.artifactRefs) ? status.routing.artifactRefs.length : 0}`,
          `workers: ${Array.isArray(status.execution?.subtasks) ? status.execution.subtasks.length : 0}`,
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          details: { success: true, status }
        };
      }
    });

    api.registerTool?.({
      name: 'multi_agent_task_brief',
      label: 'Multi-Agent Task Brief',
      description: 'Read the structured task brief generated at intake time for the current or specified multi-agent task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' }
        },
        required: []
      },
      execute: async (args = {}) => {
        const status = getCurrentRuntimeStatus(args.task_id || null);
        if (status.taskId && !status.isStale) {
          transcriptStore.appendTranscriptEvent(status.taskId, 'task_brief_read', {
            requestedTaskId: args.task_id || null,
            effectiveTaskId: status.taskId,
            briefPath: status.briefPath || null,
            success: Boolean(status.brief)
          });
        }
        if (!status.brief) {
          return {
            content: [{ type: 'text', text: 'No task brief available.' }],
            details: { success: false, reason: 'missing_task_brief', taskId: status.taskId || null }
          };
        }
        const text = [
          `task brief: ${status.brief.taskId || status.taskId || 'unknown'}`,
          `task: ${status.brief.task || 'unknown'}`,
          `executionMode: ${status.brief.executionMode || 'unknown'}`,
          `collaborationModel: ${status.brief.collaborationModel || 'unknown'}`,
          `selectedRoles: ${Array.isArray(status.brief.selectedRoles) ? status.brief.selectedRoles.length : 0}`,
          `teams: ${Array.isArray(status.brief.teams) ? status.brief.teams.length : 0}`,
          `briefPath: ${status.briefPath || 'n/a'}`
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          details: { success: true, brief: status.brief, briefPath: status.briefPath }
        };
      }
    });

    api.registerTool?.({
      name: 'multi_agent_task_transcript',
      label: 'Multi-Agent Task Transcript',
      description: 'Read the append-only structured transcript for the current or specified multi-agent task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          limit: { type: 'number' }
        },
        required: []
      },
      execute: async (args = {}) => {
        const status = getCurrentRuntimeStatus(args.task_id || null);
        const taskId = args.task_id || status.taskId || null;
        if (!taskId) {
          return {
            content: [{ type: 'text', text: 'No transcript available.' }],
            details: { success: false, reason: 'missing_task_id' }
          };
        }
        const transcript = transcriptStore.readTranscript(taskId, Number(args.limit || 20));
        const latest = transcript.entries[transcript.entries.length - 1] || null;
        // Don't append transcript event for stale tasks (avoids phantom task keep-alive)
        if (!status.isStale) {
          transcriptStore.appendTranscriptEvent(taskId, 'task_transcript_read', {
            requestedTaskId: args.task_id || null,
            effectiveTaskId: taskId,
            limit: Number(args.limit || 20),
            returnedEntries: transcript.entries.length
          });
        }
        const text = [
          `task transcript: ${taskId}`,
          `entries: ${transcript.entries.length}`,
          `file: ${transcript.file}`,
          `latestKind: ${latest?.kind || 'none'}`,
          `latestAt: ${latest?.ts || 'n/a'}`
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          details: { success: true, transcript }
        };
      }
    });

    api.registerTool?.({
      name: 'multi_agent_execution_graph',
      label: 'Multi-Agent Execution Graph',
      description: 'Read a structured execution graph view that joins routing, execution, meeting, brief, and transcript state for the current or specified task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' }
        },
        required: []
      },
      execute: async (args = {}) => {
        const status = getCurrentRuntimeStatus(args.task_id || null);
        const taskId = args.task_id || status.taskId || null;
        if (!taskId) {
          return {
            content: [{ type: 'text', text: 'No execution graph available.' }],
            details: { success: false, reason: 'missing_task_id' }
          };
        }
        const graph = {
          taskId,
          decision: {
            score: Number(status.decision?.score ?? 0),
            needsMultiAgent: Boolean(status.decision?.needsMultiAgent),
            decision: status.decision?.decision || null,
            categories: status.decision?.categories || []
          },
          routing: {
            request: status.routing?.request || null,
            artifactRefs: Array.isArray(status.routing?.artifactRefs) ? status.routing.artifactRefs : [],
            externalized: Boolean(status.routing?.externalized)
          },
          execution: {
            executionMode: status.execution?.executionMode || null,
            collaborationModel: status.execution?.collaborationModel || null,
            subtasks: Array.isArray(status.execution?.subtasks) ? status.execution.subtasks.map((subtask) => ({
              workerId: subtask.workerId || null,
              roleId: subtask.roleId || null,
              stage: subtask.stage || null,
              capability: subtask.capability || null,
              dependsOn: Array.isArray(subtask.dependsOn) ? subtask.dependsOn : []
            })) : []
          },
          meeting: {
            enabled: Boolean(status.meeting?.meetingPlan?.enabled),
            mode: status.meeting?.meetingPlan?.mode || null,
            rounds: Number(status.meeting?.meetingPlan?.rounds || 0),
            participants: Array.isArray(status.meeting?.meetingPlan?.participants) ? status.meeting.meetingPlan.participants : []
          },
          brief: status.brief ? {
            path: status.briefPath || null,
            task: status.brief.task || null,
            executionMode: status.brief.executionMode || null,
            collaborationModel: status.brief.collaborationModel || null
          } : null,
          transcript: status.transcript || null,
          files: {
            routingPath,
            executionPath,
            meetingPath,
            briefPath: status.briefPath || null
          }
        };
        graph.nodes = [
          { id: `task:${taskId}`, kind: 'task', label: taskId },
          { id: `decision:${taskId}`, kind: 'decision', label: graph.decision.decision || 'unknown' },
          { id: `routing:${taskId}`, kind: 'routing', label: graph.routing.request ? 'routing' : 'routing-missing' },
          { id: `execution:${taskId}`, kind: 'execution', label: graph.execution.executionMode || 'unknown' },
          { id: `meeting:${taskId}`, kind: 'meeting', label: graph.meeting.enabled ? (graph.meeting.mode || 'meeting') : 'disabled' },
        ];
        if (graph.brief) {
          graph.nodes.push({ id: `brief:${taskId}`, kind: 'brief', label: graph.brief.executionMode || 'brief' });
        }
        for (const ref of graph.routing.artifactRefs) {
          graph.nodes.push({
            id: `artifact:${ref.id || ref.path || randomId()}`,
            kind: 'artifact',
            label: ref.kind || 'artifact',
            path: ref.path || null
          });
        }
        for (const subtask of graph.execution.subtasks) {
          graph.nodes.push({
            id: `worker:${subtask.workerId || subtask.roleId || randomId()}`,
            kind: 'worker',
            label: subtask.roleId || subtask.workerId || 'worker',
            stage: subtask.stage || null,
            capability: subtask.capability || null
          });
        }
        graph.edges = [
          { from: `task:${taskId}`, to: `decision:${taskId}`, kind: 'decides' },
          { from: `task:${taskId}`, to: `routing:${taskId}`, kind: 'routes' },
          { from: `routing:${taskId}`, to: `execution:${taskId}`, kind: 'materializes' },
          { from: `task:${taskId}`, to: `meeting:${taskId}`, kind: 'coordinates' },
        ];
        if (graph.brief) {
          graph.edges.push({ from: `task:${taskId}`, to: `brief:${taskId}`, kind: 'briefs' });
        }
        for (const ref of graph.routing.artifactRefs) {
          graph.edges.push({
            from: `routing:${taskId}`,
            to: `artifact:${ref.id || ref.path || 'artifact'}`,
            kind: 'references'
          });
        }
        for (const subtask of graph.execution.subtasks) {
          const workerNodeId = `worker:${subtask.workerId || subtask.roleId || 'worker'}`;
          graph.edges.push({
            from: `execution:${taskId}`,
            to: workerNodeId,
            kind: 'spawns'
          });
          for (const dep of subtask.dependsOn) {
            graph.edges.push({
              from: `worker:${dep}`,
              to: workerNodeId,
              kind: 'depends_on'
            });
          }
        }
        if (!status.isStale) {
          transcriptStore.appendTranscriptEvent(taskId, 'execution_graph_read', {
            requestedTaskId: args.task_id || null,
            effectiveTaskId: taskId,
            subtasks: graph.execution.subtasks.length,
            artifactRefs: graph.routing.artifactRefs.length,
            nodes: graph.nodes.length,
            edges: graph.edges.length
          });
        }
        const text = [
          `taskId: ${taskId}`,
          `needsMultiAgent: ${String(graph.decision.needsMultiAgent)}`,
          `executionMode: ${graph.execution.executionMode || 'unknown'}`,
          `subtasks: ${graph.execution.subtasks.length}`,
          `artifactRefs: ${graph.routing.artifactRefs.length}`,
          `meetingEnabled: ${String(graph.meeting.enabled)}`,
          `nodes: ${graph.nodes.length}`,
          `edges: ${graph.edges.length}`
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          details: { success: true, graph }
        };
      }
    });

    // P0 Fix: Add spawn trigger tool so main agent can trigger agent spawning
    api.registerTool?.({
      name: 'multi_agent_spawn',
      label: 'Multi-Agent Spawn',
      description: 'Trigger multi-agent spawning. Reads pending tasks from runtime and spawns agents via sessions_spawn. Call this when routing decision is multi.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Optional specific task ID to spawn' }
        },
        required: []
      },
      execute: async (args = {}) => {
        if (typeof supervisorRunOnce !== 'function') {
          return { content: [{ type: 'text', text: 'Spawn unavailable: supervisorRunOnce not loaded' }], details: { success: false } };
        }
        try {
          const result = supervisorRunOnce();
          const spawned = result?.handled?.flatMap(h => h.spawned || []) || [];
          return {
            content: [{
              type: 'text',
              text: `Spawn trigger: ${spawned.length} agents spawned. pending=${result.pendingCount}, nextAction=${result.nextAction}`
            }],
            details: {
              success: true,
              spawnedCount: spawned.length,
              pendingTasks: result.pendingCount,
              nextAction: result.nextAction,
              spawnDetails: spawned
            }
          };
        } catch (err) {
          return { content: [{ type: 'text', text: `Spawn trigger failed: ${err.message}` }], details: { success: false, error: err.message } };
        }
      }
    });

    api.on('before_prompt_build', async (event, ctx) => {
      if (isInternalControlEvent(event, ctx)) return;
      if (api.pluginConfig?.injectBeforePromptBuild === false) return;
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
        transcriptStore.appendTranscriptEvent(taskId, 'routing_decision', {
          score: Number(analysis?.score ?? analysis?.total_score ?? 0),
          decision: analysis?.decision || null,
          categories: analysis?.categories || [],
          needsMultiAgent,
          requestPreview: prompt.slice(0, 200)
        });

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
        transcriptStore.appendTranscriptEvent(taskId, 'execution_snapshot_generated', {
          path: executionPath,
          executionMode: snapshot?.executionMode || planLite?.executionMode || 'single',
          subtasks: Array.isArray(snapshot?.subtasks) ? snapshot.subtasks.length : 0
        });
        const meetingArtifact = buildMeetingArtifact(taskId, prompt, analysis, planLite);
        fs.writeFileSync(meetingPath, JSON.stringify(meetingArtifact, null, 2));
        transcriptStore.appendTranscriptEvent(taskId, 'meeting_artifact_generated', {
          path: meetingPath,
          enabled: Boolean(meetingArtifact?.meetingPlan?.enabled),
          participants: Array.isArray(meetingArtifact?.meetingPlan?.participants) ? meetingArtifact.meetingPlan.participants.length : 0,
          rounds: Number(meetingArtifact?.meetingPlan?.rounds || 0)
        });
        transcriptStore.appendTranscriptEvent(taskId, 'routing_context_generated', {
          executionMode: planLite?.executionMode || 'single',
          collaborationModel: planLite?.collaborationModel || 'solo',
          teams: Array.isArray(planLite?.teams) ? planLite.teams.length : 0,
          syncPlan: Array.isArray(planLite?.syncPlan) ? planLite.syncPlan.length : 0,
          artifactRefs: Array.isArray(artifactRefs) ? artifactRefs.length : 0,
          externalized
        });

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
module.exports.getCurrentRuntimeStatus = getCurrentRuntimeStatus;
module.exports.__testSanitizePrompt = sanitizePrompt;
module.exports.__testShouldSkip = shouldSkip;
