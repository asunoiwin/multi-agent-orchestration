# Multi-Agent Orchestration Wiki

## What this project is for

This project helps OpenClaw decide when a task should stay in the main agent and when it should be split into specialized subagents, teams, and sync checkpoints.

## Core flow

1. `task-intake.js` creates a task record with `taskId` and optional `sessionId`
2. `orchestrator-main.js` decides whether the task stays single-agent or becomes multi-agent
3. `supervisor-runner.js` prepares worker-specific spawn instructions
4. `live-executor.js` emits the calls that the main agent can translate into `sessions_spawn`
5. `result-recovery.js` collects completion state and dependency progress

## Collaboration model

- `staffingPlan` decides how many employees each capability needs
- `teams` groups employees by stage and collaboration mode
- `syncPlan` defines standups, handoffs, and design/review checkpoints
- `workerId` is the true dependency unit, so multiple people can share the same role archetype

## How it integrates with memory

- each task payload now carries `taskId`
- the optional `OPENCLAW_SESSION_ID` becomes part of task context
- spawn metadata can be forwarded into memory tools so recalls can reconstruct progress

## Recommended operator workflow

```bash
OPENCLAW_SESSION_ID=session-main-123 npm run smoke
node result-recovery.js next
node result-recovery.js <taskId>
```

## Publishing checklist

- keep `runtime/` and `tasks/` ignored
- update `README.md` when changing entrypoints or scripts
- update `PULL_REQUEST.md` with validation commands
- test under the same OpenClaw environment where the plugin will run
