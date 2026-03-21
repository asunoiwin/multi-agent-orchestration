# Social Intel Researcher Design

## Goal

Add a dedicated `social-intel-researcher` role so multi-agent planning can collect structured evidence from:

- Weibo
- Douyin
- Xiaohongshu
- Bilibili
- Zhihu
- Kuaishou
- Tieba
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
- Zhihu: browser first, direct fetch fallback
- Kuaishou: browser first
- Tieba: browser first, direct fetch fallback
- Forum/community: browser first, direct fetch fallback

## Output contract

The social-intel layer should produce:

- `source_inventory`
- `collection_plan`
- `evidence_cards`
- `deduped_findings`
- `credibility_notes`
- `meeting_brief`

Each evidence card should preserve:

- `platform`
- `title`
- `author`
- `published_at`
- `url`
- `excerpt`
- `signals`
- `credibility`

## Acceptance criteria

- planning detects social-intel tasks without degrading normal tasks
- meeting mode prefers `social-intel-researcher` for the research seat
- intelligence plans include explicit platform routes and collection limits
- OneAPI smoke confirms `weibo` remains API-viable
- non-API platforms remain on browser-first routing

## Why this path is preferred

- avoids over-dependence on weak third-party API coverage
- keeps OneAPI useful where it works well (`weibo`)
- preserves browser path for `douyin` and `xiaohongshu`
- makes social evidence reusable in deliberation and execution
