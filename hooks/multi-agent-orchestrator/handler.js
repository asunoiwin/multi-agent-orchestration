/**
 * Multi-Agent Orchestrator Hook for OpenClaw
 * 
 * Injects orchestration rules into main agent bootstrap.
 * Tells the agent to analyze tasks and use dynamic agent pool.
 */

const ORCHESTRATION_REMINDER = `
## Multi-Agent Orchestration (Auto-Injected)

When you receive a task, evaluate whether it needs multi-agent orchestration:

### Quick Decision
- **Simple task** (single domain, no phases): Handle directly.
- **Complex task** (multiple domains, explicit phases, parallel work): Use orchestration.

### Orchestration Flow
1. Run: \`node ~/. openclaw/workspace/multi-agent-orchestration/live-executor.js "<task>"\`
2. Read the output JSON
3. For each entry in \`spawnNow\`, call \`sessions_spawn\` with:
   - \`runtime: "subagent"\`
   - \`agentId\`: from the output
   - \`model\`: from the output  
   - \`label\`: from the output
   - \`task\`: the prompt from the output
   - \`mode: "run"\`
4. When a serial agent completes, check \`spawnLater\` for the next agent whose dependencies are met
5. After all agents complete, use \`result-recovery.js\` to collect results
6. Synthesize and deliver to user

### Available Roles (from config/agent-pool.json)
- web-researcher → agentId: researcher
- code-implementer → agentId: builder  
- quality-auditor → agentId: auditor
- doc-synthesizer → agentId: researcher
- data-analyst → agentId: researcher

### Complexity Signals
- Multiple verbs (研究+实现+测试): likely multi-agent
- Multiple domains (research+development+audit): likely multi-agent
- Explicit phases (先...然后...最后): likely multi-agent, serial mode
- Parallel keywords (同时/并行/分别): likely multi-agent, parallel mode
`.trim();

const handler = async (event) => {
  if (!event || typeof event !== 'object') return;
  if (event.type !== 'agent' || event.action !== 'bootstrap') return;
  if (!event.context || typeof event.context !== 'object') return;

  // Only inject into main agent
  const agentId = event.context.agentId || event.context.agent || '';
  if (agentId && agentId !== 'main') return;

  if (Array.isArray(event.context.bootstrapFiles)) {
    event.context.bootstrapFiles.push({
      path: 'MULTI_AGENT_ORCHESTRATION.md',
      content: ORCHESTRATION_REMINDER,
      virtual: true,
    });
  }
};

module.exports = handler;
module.exports.default = handler;
