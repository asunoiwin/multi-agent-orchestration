# Pull Request Notes

## Summary

- hardened multi-agent recovery, retry, and runtime cleanup
- completed the `design -> delivery -> assurance` orchestration chain with real task validation
- added watchdog-based self-healing and regression tests
- updated operator-facing docs for publishable installation and validation

## Why

This repository was close to publishable, but still had a few rough edges:

- completed subagent sessions could be missed after `.deleted.*` rotation
- stalled or fake-running workers could block later stages forever
- runtime/task state could pollute the repository and obscure the actual source changes
- the project lacked a stable regression test for the recovery path

## Validation

```bash
node --check result-recovery.js
node --check supervisor-runner.js
node --check orchestration-watchdog.js
node --check tests/stability-regression.test.js
npm run smoke
npm run e2e:subagent
npm test
openclaw config validate
```

## Follow-ups

- publish a real GitHub PR against `main`
- add more task fixtures for long-running delivery and audit chains
