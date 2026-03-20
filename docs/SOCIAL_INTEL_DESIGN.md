# Social Intel Researcher Design

## Goal

Add a dedicated `social-intel-researcher` role so multi-agent planning can collect structured evidence from:

- Weibo
- Douyin
- Xiaohongshu
- Bilibili
- community/forum sources

without forcing the generic `web-researcher` to own all social discovery work.

## Recommended path

1. Prefer platform-aware routing rather than one universal search path.
2. Use API only where it is stable enough to provide searchable evidence.
3. Keep browser automation as the default fallback for login-heavy or anti-bot platforms.
4. Feed meeting mode with evidence cards, not raw page dumps.

## Platform routing

- Weibo: API first, browser fallback
- Douyin: browser first
- Xiaohongshu: browser first
- Bilibili: browser first
- Forum/community: browser first, direct fetch fallback

## Output contract

The social-intel layer should produce:

- `source_inventory`
- `evidence_cards`
- `deduped_findings`
- `credibility_notes`
- `meeting_brief`

## Why this path is preferred

- avoids over-dependence on weak third-party API coverage
- keeps OneAPI useful where it works well (`weibo`)
- preserves browser path for `douyin` and `xiaohongshu`
- makes social evidence reusable in deliberation and execution
