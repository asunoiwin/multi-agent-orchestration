---
name: multi-agent-orchestrator
description: "Injects multi-agent orchestration rules during agent bootstrap"
metadata: {"openclaw":{"emoji":"🎯","events":["agent:bootstrap"]}}
---

# Multi-Agent Orchestrator Hook

Injects dynamic agent pool orchestration rules into the main agent's bootstrap context.

## What It Does

- Fires on `agent:bootstrap`
- Only injects into the `main` agent (subagents don't need orchestration rules)
- Adds a reminder block that tells the main agent to:
  1. Analyze every incoming task for complexity
  2. Use the dynamic agent pool for multi-agent tasks
  3. Spawn real subagents via `sessions_spawn`

## Configuration

Enable with:

```bash
# Edit ~/.openclaw/openclaw.json, add to hooks.internal.entries:
"multi-agent-orchestrator": {
  "enabled": true,
  "path": "~/.openclaw/hooks/multi-agent-orchestrator"
}
```
