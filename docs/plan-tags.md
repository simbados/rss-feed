# Plan: AI tags, importance score and learning from behaviour

Status: **planned, not started** (2026-09-26). Replaces the earlier tags/search plan; full-text and
semantic search are kept under "Later" at the end.

## Context
The earlier version of this plan covered categories/tags and search. Scoring columns exist in the schema (`articles.score`,
`feeds.weight`, `topics.weight`) but nothing uses them, and the timeline is date-only. Decisions:
- **Tags per article** from a **starter list + LLM suggestions**. Suggestions only apply after you accept them.
- **LLM via Workers AI** is fine, as long as the cost is **visible** and requests are **batched**.
- The score drives a **Top sort**, **highlights** and **top titles in the daily push**. It **never hides** anything.
- **Learn from behaviour**, but keep it cheap and simple.
- The account is on the **Free plan**, so running out of quota means the AI calls fail. That's safe: nothing is billed, and
  articles wait until the next day.

Cost estimate (pricing page, 2026-09-26): Llama 3.1 8B fast costs $0.045/M input and $0.384/M output tokens.
The free allowance is 10k neurons per day, then $0.011/1k. With 20 articles per request that's about 150 input and 15 output tokens per article.
At 200 articles a day that's ≈ $0.002/day, about 2 % of the free allowance.

Delivered in 3 phases, each shippable and reviewable on its own. Phase 1 already records "opened", so
there is data for learning when phase 3 arrives.

## Phase 1: Tags via LLM + cost transparency
**Migration `migrations/0002_ai_tags.sql`** (additive):
- `tags(id, user_id → users ON DELETE CASCADE, name, description, status 'active'|'suggested'|'rejected',
  weight REAL DEFAULT 1.0, created_at, UNIQUE(user_id, name COLLATE NOCASE))`
- `article_tags(article_id → articles CASCADE, tag_id → tags CASCADE, source 'ai'|'manual', PK(article_id, tag_id))`
- `articles` + `ai_status INTEGER DEFAULT 0` (0 pending · 1 done · 2 given up), `ai_attempts INTEGER DEFAULT 0`,
  `importance INTEGER DEFAULT 0`, `opened_at INTEGER` (NULL)
- `ai_usage(day TEXT, user_id, requests, articles, input_tokens, output_tokens, PK(day, user_id))`
- `users` + `interest_profile TEXT NOT NULL DEFAULT ''`: your own text about what matters to you (max 1000 chars,
  edited on `/tags`). It goes into the prompt once per request, so importance is rated for you rather than generically.
  Empty means a generic newsworthiness rating.
- Starter tags for existing users (`INSERT … SELECT FROM users`) and for new users next to `DEFAULT_TOPICS`
  in `src/db.js`. Draft list: Vulnerability, Data breach, Recall, AI, Politics, Economy, Science, Sport. We finalise it before implementing.

**New `src/classify.js`**, a cron step in `src/index.js` after the feed refresh and before purge:
- Picks up to 40 pending articles fetched in the last 48 h. Older articles are never processed, so there's no backlog cost.
  Articles are grouped by user because each user has their own tag list. 20 articles go into one `env.AI.run()` call,
  so there are at most 2 calls per run.
- Model constant `AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'`, with prices as constants next to it.
  `response_format` JSON schema: `[{i, tags:[…], importance:1-5, suggest?:string}]`. Articles are numbered 1..20; DB ids are
  never sent. The prompt treats title and snippet as data inside delimiters.
- **Strict validation, because feed content can contain prompt injection:** a tag is used only if it exactly matches an
  active tag of that user (case-insensitive). Importance must be an integer 1–5, else 3. A suggestion is limited to
  letters, digits, space and `-`, at most 30 characters, at most 10 open suggestions per user, and is stored as `suggested`
  only. No free text from the LLM is ever shown.
- Records usage (`response.usage` if present, else chars/4 as an estimate). Stops at `MAX_AI_ARTICLES_PER_DAY` (≈ 1000).
  If the quota is exhausted (error), it sets `app_state ai_blocked_until` to the next UTC day. For other errors,
  `ai_attempts++`, and after 3 the article is set to `ai_status = 2`.
- Without `env.AI` (tests, `npm run dev` without a flag) the step is skipped, so no quota is used during local work.

**Setup: nothing to switch on in the dashboard.**
- `wrangler.toml` gets `[ai] binding = "AI"`. The next deploy connects the Worker to Workers AI, which is available on
  every account, including the Free plan. Code calls it as `env.AI.run(model, …)`.
- The model is a constant in `src/classify.js` (`AI_MODEL`). Changing the model is a code change, with nothing to
  provision. Prices go next to it for the usage page.
- Usage appears in the dashboard under AI → Workers AI; our `/tags` page shows the per-user estimate.
- Local `npm run dev`: Workers AI has no local simulation, so a call from dev goes to Cloudflare, uses the real quota and
  needs an API token with Workers AI permission. That's why dev skips classification unless explicitly enabled (ask first).
- To check at rollout: whether the Workers Builds deploy token accepts the new binding. If the first deploy fails, the
  message says which permission is missing.

**UI** (`src/views.js`, `src/static.js`, `src/index.js`):
- Tag chips in the actions row of each article (not in the meta line, which is full on mobile). Clicking one filters
  by `?tag=<id>`. `×` removes the tag (POST `/articles/:id/tags/:tagId/delete`).
- Tag list with unread counts in the sidebar.
- New page `/tags`: create, rename and delete tags, edit descriptions, accept or reject suggestions, and an **AI usage**
  table for today and the last 30 days (articles, requests, tokens, estimated $, % of the free daily allowance).
- Opening an article: the click handler in `app.js` (`a.title, a.open-brave`, currently `/read`) posts
  `/articles/:id/open` instead, which marks it read and sets `opened_at`.

## Phase 2: Score, Top sort, highlight, push
- `score = importance × feed.weight × max(tag.weight of its tags, 1 if none)`, computed in SQL on classification
  and after each weight update (UPDATE for unread articles from the last 7 days).
- Toolbar "Newest | Top" (`?sort=top`). Top = articles from the last 48 h, `ORDER BY score DESC, published_at DESC`.
  Date order stays the default.
- Highlight: `score ≥ 4` gets the class `is-top` (accent border). A tooltip explains the score, e.g.
  "Importance 4 · Vulnerability ×1.4 · heise security ×1.1".
- Daily push (`src/digest.js`): "12 new · Top: <title 1>, <title 2>" within the existing `MAX_BODY`.

## Phase 3: Learning from behaviour (once a day, one SQL pass per user)
- Signals over the last 90 days: positive = opened + 2×starred, negative = 2×hidden. "Mark read" without opening is
  neutral (it's ambiguous, e.g. mark-all-read).
- For each tag and each feed: `factor = ((pos+1)/(seen+2)) / (overall rate)`, clamped to **[0.6, 1.6]**. The smoothing
  and the clamp mean one click changes little and nothing sinks completely. The factor is stored in `tags.weight` and
  `feeds.weight`, then scores are recalculated.
- Runs once a day through `app_state` (like the digest). No extra AI calls, no new tables.
- `/tags` and the Feeds page show the learned weight, so you can see why something ranks where it does.
- **Automatic hints in the prompt:** after the profile, one generated line such as "Often opened: Vulnerability, heise security.
  Often hidden: Sport." It uses at most 3 tags or feeds with weight ≥ 1.2 and at most 3 with weight ≤ 0.8. Feed titles
  come from feeds (untrusted), so they are limited to 40 characters and to letters, digits, space and punctuation, and
  put inside the data delimiters. The output is validated as before either way.
- `/tags` shows **"What the AI sees"**: your profile plus the current hint line, exactly as it goes into the prompt.

## Rules and security
- New db functions take `userId`. Tag and article IDs from requests are checked for ownership (foreign ID → 404).
  The cron functions go into `CRON_ONLY`. Extend `test/security-rules.test.js` and `test/users.test.js`.
- New routes are POSTs behind the existing same-origin check. Tag names are escaped by `html```.
- New attack surface (LLM output, prompt injection): add it to `docs/security/owasp-top10-2025.md`. `wrangler.toml` and
  `migrations/` are security-relevant, so suggest a diff review before release.

## Verification
- `npm test`: a new `test/classify.test.js` with a fake `env.AI` covers valid output, unknown tags dropped, importance
  clamped, an injection attempt in the snippet, suggestion sanitising, the daily cap, the quota error → blocked until
  tomorrow, and 3 failures → given up. Plus tests for the learning formula (clamp, smoothing), isolation tests for
  tags, article_tags and usage between two users, and HTML tests for chips, highlight and escaping.
- Locally: `npm run db:migrate:local && npm run dev`. Test classification by hand with remote AI only after asking
  (it uses quota); otherwise the fake.
- Rollout, one Cloudflare step at a time with your approval: you push, the deploy applies the migration, then we check the
  usage table after the first cron runs.

## Later (from the earlier plan, not part of this one)
- **Full-text search (no AI):** an FTS5 index in D1 over title, snippet, feed title and tags; search box
  in the header, ranked results. Exact matches only.
- **Semantic search:** Workers AI embeddings (multilingual, e.g. `bge-m3`) + Vectorize, "everything
  about food safety". Separate product with its own limits.
- Tags in notifications ("only Recall").
