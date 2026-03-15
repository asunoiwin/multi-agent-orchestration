# Pull Request Notes

## Summary

- fixed CommonJS execution under OpenClaw root `type: module`
- normalized task analyzer entry to `task-analyzer.cjs`
- propagated `taskId` / `sessionId` through intake, planning, and spawn metadata
- improved operator-facing docs and added repeatable smoke scripts

## Why

This repository was close to publishable, but still had a few rough edges:

- runtime entrypoints could break when executed inside an ESM parent workspace
- task/session traceability was incomplete, which made memory integration weaker
- the README did not clearly explain how to validate the project after clone

## Validation

```bash
node --check task-intake.js
node --check orchestrator-main.js
node --check supervisor-runner.js
node --check live-executor.js
npm run smoke
```

## Follow-ups

- add a real `sessions_spawn` integration harness for end-to-end spawn testing
- persist subagent progress back into the shared memory layer automatically
