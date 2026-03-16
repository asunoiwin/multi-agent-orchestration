#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const POOL_FILE = path.join(ROOT, 'config', 'agent-pool.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function detectFeatures(task) {
  const text = task || '';
  const explicitDocs = /文档|手册|报告|README|Wiki|总结|说明书|交付说明|决策记录|知识沉淀/i.test(text);
  const deliveryNarrative = /总结|报告|说明|整理|沉淀|手册|交付/i.test(text);
  return {
    research: /搜索|调研|分析|研究|对比|查找|了解|收集|查询|验证方案|资料|排查/.test(text),
    planning: /设计|规划|架构|方案|拆分|切分|路线图|技术选型|边界|推进/.test(text),
    implementation: /开发|编写|实现|写代码|创建|制作|修改|改|补测试|补充实现|构建|配置|安装|修复|重构|优化|稳定|恢复|回收|demo|示例|样例|完整示例|例子|代码示例|插件/.test(text),
    audit: /检查|审查|验证|测试|审计|评估|排查|lint|安全|质量检查|回归/.test(text),
    documentation: explicitDocs || (deliveryNarrative && /输出|编写|生成|整理|沉淀|补齐/.test(text)),
    explicitDocumentation: explicitDocs,
    data: /数据|统计|指标|表格|分析数据|分析指标|dataset|metrics?/i.test(text),
    maintenance: /稳定|恢复|阶段推进|推进|结果回收|回收|状态恢复|状态同步|收口|闭环|巡检|watchdog|runtime|orchestration|编排/i.test(text),
    coordination: /协调|统筹|监督|监工|跨团队|跨组|多人协作|多员工|对齐|同步会|standup|review meeting|分派/.test(text),
    parallel: /同时|并行|分别|各自/.test(text),
    serial: /先|然后|之后|接着|最后|基于|根据|再/.test(text)
  };
}

function complexityScore(task, features) {
  let score = 0;
  if ((task || '').length > 40) score += 1;
  if ((task || '').length > 100) score += 1;
  const structureSignals = ((task || '').match(/[、，,；;]/g) || []).length;
  if (structureSignals >= 2) score += 1;
  const count = ['research', 'planning', 'implementation', 'audit', 'documentation', 'data', 'maintenance']
    .filter(k => features[k]).length;
  score += count;
  if (features.parallel) score += 2;
  if (features.serial) score += 2;
  return score;
}

function hasKeyword(task, pattern) {
  return pattern.test(task || '');
}

function deriveCapabilityNeeds(task, features, score) {
  const needs = [];
  const highComplexity = score >= 6;
  const veryComplex = score >= 8;

  if (features.research) {
    needs.push({
      capability: 'research',
      stage: 'discovery',
      count: veryComplex || hasKeyword(task, /对比|竞品|多个方案|方案池|资料汇总/) ? 2 : 1,
      collaborationMode: 'roundtable',
      objective: '并行调研并交叉验证关键事实与候选方案'
    });
  }

  if (features.planning || (features.research && features.implementation)) {
    needs.push({
      capability: 'planning',
      stage: 'design',
      count: score >= 7 ? 1 : 1,
      collaborationMode: 'design-review',
      objective: '沉淀架构、边界、工作拆分和跨团队接口'
    });
  }

  if (features.coordination || (score >= 11 && features.parallel)) {
    needs.push({
      capability: 'coordination',
      stage: 'design',
      count: 1,
      collaborationMode: 'coordination',
      objective: '跨团队同步依赖、处理阻塞并主持关键同步点'
    });
  }

  if (features.data) {
    needs.push({
      capability: 'data',
      stage: 'discovery',
      count: highComplexity ? 2 : 1,
      collaborationMode: 'paired-analysis',
      objective: '拆分数据分析、指标解释与结构化结论'
    });
  }

  if (features.maintenance) {
    needs.push({
      capability: 'planning',
      stage: 'design',
      count: 1,
      collaborationMode: 'design-review',
      objective: '梳理恢复策略、推进机制、状态边界和收口条件'
    });
    needs.push({
      capability: 'implementation',
      stage: 'delivery',
      count: score >= 7 ? 2 : 1,
      collaborationMode: score >= 7 ? 'swarm' : 'owner-driven',
      objective: '落实运行态修复、自愈逻辑和任务推进改造'
    });
    needs.push({
      capability: 'audit',
      stage: 'assurance',
      count: 1,
      collaborationMode: 'peer-review',
      objective: '验证恢复链、阶段推进和结果回收是否稳定'
    });
  }

  if (features.implementation) {
    needs.push({
      capability: 'implementation',
      stage: 'delivery',
      count: features.parallel || veryComplex ? 2 : 1,
      collaborationMode: features.parallel || veryComplex ? 'swarm' : 'owner-driven',
      objective: '并行拆分实现、集成与问题修复'
    });
  }

  if (features.audit) {
    needs.push({
      capability: 'audit',
      stage: 'assurance',
      count: features.parallel || hasKeyword(task, /安全|风险|回归|验证|审查/) ? 2 : 1,
      collaborationMode: 'peer-review',
      objective: '独立复核结果、找风险并给出修复建议'
    });
  }

  const needsDocumentation = features.documentation && (
    features.explicitDocumentation ||
    /readme|wiki|文档|报告|手册|交付说明|决策记录/i.test(task || '') ||
    (veryComplex && (features.implementation || features.audit))
  );

  if (needsDocumentation) {
    needs.push({
      capability: 'documentation',
      stage: 'delivery',
      count: 1,
      collaborationMode: 'handoff',
      objective: '沉淀交付文档、决策记录和后续待办'
    });
  }

  if (hasKeyword(task, /桌面|系统设置|mac|应用|窗口|截图|本地环境|终端|文件夹/)) {
    needs.push({
      capability: 'os-operation',
      stage: 'delivery',
      count: 1,
      collaborationMode: 'specialist',
      objective: '处理本地系统与 GUI 相关动作'
    });
  }

  const merged = new Map();
  for (const need of needs) {
    const key = `${need.stage}:${need.capability}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...need });
      continue;
    }
    existing.count = Math.max(existing.count, need.count);
    if (!existing.objective.includes(need.objective)) {
      existing.objective = `${existing.objective}; ${need.objective}`;
    }
    if (existing.collaborationMode !== need.collaborationMode && need.count > existing.count) {
      existing.collaborationMode = need.collaborationMode;
    }
  }

  return Array.from(merged.values());
}

function rankRoleForCapability(role, capability) {
  const caps = Array.isArray(role.triggerCapabilities) ? role.triggerCapabilities : [];
  if (capability === 'planning' && role.id === 'solution-architect') return 4;
  if (capability === 'planning' && role.id === 'supervisor') return 1;
  if (capability === 'coordination' && role.id === 'supervisor') return 5;
  if (caps.includes(capability)) return 3;
  if (capability === 'research' && caps.includes('comparison')) return 2;
  if (capability === 'implementation' && caps.includes('configuration')) return 2;
  if (capability === 'audit' && caps.includes('verification')) return 2;
  if (capability === 'documentation' && caps.includes('handoff')) return 2;
  return 0;
}

function matchRolesForCapability(capability, pool) {
  return pool.roles
    .map(role => ({ role, score: rankRoleForCapability(role, capability) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.role);
}

function buildAssignments(task, capabilityNeeds, pool) {
  const assignments = [];
  const usageByRole = {};

  for (const need of capabilityNeeds) {
    const candidates = matchRolesForCapability(need.capability, pool);
    if (candidates.length === 0) continue;

    for (let index = 0; index < need.count; index += 1) {
      const role = candidates[index % candidates.length];
      usageByRole[role.id] = (usageByRole[role.id] || 0) + 1;
      const instanceNumber = usageByRole[role.id];
      const workerId = `${role.id}-${instanceNumber}`;
      assignments.push({
        workerId,
        roleId: role.id,
        instanceNumber,
        title: need.count > 1 ? `${role.name} #${instanceNumber}` : role.name,
        capability: need.capability,
        stage: need.stage,
        teamId: `${need.stage}-${need.capability}-team`,
        collaborationMode: need.collaborationMode,
        objective: need.objective,
        description: `${role.purpose}. ${need.objective}. Task: ${task}`,
        skills: role.skills,
        deny: role.deny,
        memory: role.memory,
        lifecycle: role.lifecycle,
        triggerCapabilities: role.triggerCapabilities || []
      });
    }
  }

  return assignments;
}

function buildTeams(assignments) {
  const grouped = new Map();
  for (const item of assignments) {
    if (!grouped.has(item.teamId)) {
      grouped.set(item.teamId, {
        id: item.teamId,
        stage: item.stage,
        capability: item.capability,
        collaborationMode: item.collaborationMode,
        objective: item.objective,
        workers: []
      });
    }
    grouped.get(item.teamId).workers.push({
      workerId: item.workerId,
      roleId: item.roleId,
      title: item.title
    });
  }
  return Array.from(grouped.values());
}

function attachCollaborationMetadata(assignments, teams) {
  const teamIndex = new Map(teams.map(team => [team.id, team]));
  return assignments.map(item => {
    const team = teamIndex.get(item.teamId);
    const coworkers = (team?.workers || [])
      .filter(worker => worker.workerId !== item.workerId)
      .map(worker => ({
        workerId: worker.workerId,
        roleId: worker.roleId,
        title: worker.title
      }));
    return {
      ...item,
      coworkers
    };
  });
}

function buildSubtasks(task, assignments, executionMode) {
  const stages = ['discovery', 'design', 'delivery', 'assurance'];
  const stageWorkers = new Map();

  for (const stage of stages) {
    stageWorkers.set(stage, assignments.filter(item => item.stage === stage));
  }

  return assignments.map(item => {
    let dependsOn = [];
    const deliveryWorkers = stageWorkers
      .get('delivery')
      .filter(worker => worker.capability !== 'documentation')
      .map(worker => worker.workerId);
    const assuranceWorkers = stageWorkers.get('assurance').map(worker => worker.workerId);
    if (item.stage === 'design') {
      dependsOn = stageWorkers.get('discovery').map(worker => worker.workerId);
    } else if (item.stage === 'delivery' && executionMode !== 'parallel') {
      const designDeps = stageWorkers.get('design').map(worker => worker.workerId);
      const discoveryDeps = stageWorkers.get('discovery').map(worker => worker.workerId);
      dependsOn = designDeps.length > 0 ? designDeps : discoveryDeps;
    } else if (item.stage === 'assurance') {
      // Assurance should review implementation outputs, not wait on the final
      // documentation handoff, otherwise audit and docs form a dependency cycle.
      dependsOn = deliveryWorkers;
    }

    if (item.capability === 'documentation') {
      dependsOn = [
        ...stageWorkers.get('design').map(worker => worker.workerId),
        ...deliveryWorkers,
        ...assuranceWorkers
      ].filter(workerId => workerId !== item.workerId);
    }

    return {
      workerId: item.workerId,
      roleId: item.roleId,
      title: item.title,
      stage: item.stage,
      teamId: item.teamId,
      capability: item.capability,
      collaborationMode: item.collaborationMode,
      objective: item.objective,
      description: item.description,
      dependsOn,
      skills: item.skills,
      deny: item.deny,
      memory: item.memory,
      coworkers: item.coworkers,
      lifecycle: item.lifecycle
    };
  });
}

function buildSyncPlan(teams, executionMode) {
  const syncPoints = [];
  const discovery = teams.filter(team => team.stage === 'discovery');
  const design = teams.filter(team => team.stage === 'design');
  const delivery = teams.filter(team => team.stage === 'delivery');
  const assurance = teams.filter(team => team.stage === 'assurance');

  if (discovery.length > 0 && design.length > 0) {
    syncPoints.push({
      id: 'sync-discovery-design',
      kind: 'handoff',
      fromStages: ['discovery'],
      toStages: ['design'],
      participants: [...discovery.flatMap(team => team.workers), ...design.flatMap(team => team.workers)].map(worker => worker.workerId),
      goal: '统一调研结论，形成设计方案和团队拆分'
    });
  }
  if (design.length > 0 && delivery.length > 0) {
    syncPoints.push({
      id: 'sync-design-delivery',
      kind: 'design-review',
      fromStages: ['design'],
      toStages: ['delivery'],
      participants: [...design.flatMap(team => team.workers), ...delivery.flatMap(team => team.workers)].map(worker => worker.workerId),
      goal: '确认接口、工作边界、并行策略与集成约束'
    });
  }
  if (delivery.length > 0 && assurance.length > 0) {
    syncPoints.push({
      id: 'sync-quality-review',
      kind: 'review',
      fromStages: ['delivery'],
      toStages: ['assurance'],
      participants: [...delivery.flatMap(team => team.workers), ...assurance.flatMap(team => team.workers)].map(worker => worker.workerId),
      goal: '交接实现结果、共享风险与验证重点'
    });
  }
  if (executionMode === 'parallel') {
    syncPoints.push({
      id: 'sync-daily-standup',
      kind: 'standup',
      fromStages: ['discovery', 'delivery', 'assurance'],
      toStages: ['discovery', 'delivery', 'assurance'],
      participants: teams.flatMap(team => team.workers).map(worker => worker.workerId),
      goal: '同步阻塞点、冲突和下一步分工'
    });
  }
  return syncPoints;
}

function chooseMode(features, capabilityNeeds) {
  if (features.parallel) return 'parallel';
  const totalWorkers = capabilityNeeds.reduce((sum, item) => sum + item.count, 0);
  if (!features.serial && totalWorkers >= 4) return 'parallel';
  return 'hybrid';
}

function planTask(task) {
  const pool = readJson(POOL_FILE);
  const features = detectFeatures(task);
  const score = complexityScore(task, features);
  const capabilityNeeds = deriveCapabilityNeeds(task, features, score);
  const assignments = buildAssignments(task, capabilityNeeds, pool);
  const needsMultiAgent = score >= 3 && assignments.length > 1;
  const mode = chooseMode(features, capabilityNeeds);
  const teams = buildTeams(assignments);
  const enrichedAssignments = attachCollaborationMetadata(assignments, teams);
  const subtasks = buildSubtasks(task, enrichedAssignments, mode);
  const syncPlan = buildSyncPlan(teams, mode);
  const roleSummary = new Map();
  for (const item of enrichedAssignments) {
    if (!roleSummary.has(item.roleId)) {
      roleSummary.set(item.roleId, {
        id: item.roleId,
        name: item.title.replace(/ #\d+$/, ''),
        instances: 0,
        capabilities: new Set()
      });
    }
    const summary = roleSummary.get(item.roleId);
    summary.instances += 1;
    summary.capabilities.add(item.capability);
  }

  return {
    version: '3.0.0',
    task,
    features,
    complexityScore: score,
    needsMultiAgent,
    orchestrator: 'system-orchestrator',
    roleSource: 'config/agent-pool.json',
    selectedRoles: Array.from(roleSummary.values()).map(item => ({
      id: item.id,
      name: item.name,
      instances: item.instances,
      capabilities: Array.from(item.capabilities)
    })),
    staffingPlan: capabilityNeeds,
    teams: needsMultiAgent ? teams : [],
    syncPlan: needsMultiAgent ? syncPlan : [],
    executionMode: needsMultiAgent ? mode : 'single',
    collaborationModel: needsMultiAgent ? 'company' : 'solo',
    subtasks: needsMultiAgent ? subtasks : []
  };
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node dynamic-orchestrator.js <task>');
    process.exit(1);
  }
  console.log(JSON.stringify(planTask(task), null, 2));
}

module.exports = { planTask, detectFeatures, complexityScore, buildAssignments, buildTeams };
