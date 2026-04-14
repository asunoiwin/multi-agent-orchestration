# Multi-Agent Meeting And Reputation Design

## Goal

This design adds a structured deliberation phase before execution for complex tasks, and a lightweight reputation/resource layer that affects how agents participate.

The intent is:

- use a single agent by default
- escalate to a bounded meeting only when ambiguity, risk, or cross-domain complexity is high
- separate discussion from execution
- turn reward/punishment into observable scheduling behavior instead of vague encouragement

## Core Principles

1. Discussion is optional, not default.
2. Meetings are finite and structured.
3. Execution starts only after a recommendation is formed.
4. Reward/punishment changes resource access, priority, and trust.
5. System logic handles orchestration; LLMs handle reasoning.

## Deliberation Mode

### Trigger

Meeting mode is enabled only when:

- the task already needs multi-agent orchestration
- and complexity/risk/ambiguity crosses configured thresholds

Current trigger inputs:

- total score
- uncertainty
- risk
- domains
- structure

### Meeting Roles

Default seats:

- `moderator`
- `challenger`
- `executor`

Optional seat:

- `research`

### Meeting Output

Every meeting is expected to converge on:

- problem statement
- constraints
- options
- risks
- recommendation
- execution handoff

### Stop Conditions

Meetings do not run indefinitely.

They stop when:

- maximum rounds are reached
- a single recommendation is formed
- disagreements remain but tradeoffs are already explicit

## Reputation And Resource Control

Each role keeps a local score and tier.

The score affects:

- vote weight
- priority boost
- token multiplier
- lifecycle hint

This allows:

- trusted roles to influence decisions more
- guarded roles to receive less budget and stricter execution expectations
- cooldown roles to stay available but constrained

## Why This Is Better Than Free Discussion

Free discussion often causes:

- long conversations with weak convergence
- repeated reasoning
- unclear handoffs
- execution delays

This design instead enforces:

- bounded rounds
- explicit seats
- structured outcomes
- execution-ready handoff

## Current Integration Points

- `task-analyzer.cjs`
  adds a meeting recommendation signal
- `dynamic-orchestrator.js`
  produces `meetingPlan`, role reputation, and resource budgets
- `task-intake.js`
  stores meeting/resource state in task briefs
- `src/index.js`
  injects meeting-aware routing context
- `supervisor-runner.js`
  adds meeting/budget instructions to worker prompts

## Future Integration

When this is integrated into the running OpenClaw environment, the next useful steps are:

1. persist reputation updates from actual task outcomes
2. let meeting decisions write a dedicated decision artifact
3. let execution workers consume that artifact explicitly
4. add reviewer-based scoring after each completed task
