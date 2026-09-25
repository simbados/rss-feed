# Plan: Categories, tags and search

Status: **planned, not started** (2026-09-25).

## Goal
Classify articles (and feeds) into categories/tags and search across them: full text, by tag, and
later by meaning ("everything about food safety").

## Starting point
- Feeds have one topic; articles store only title + 300-char plain-text snippet (no full text).
- Reserved for scoring: `articles.score`, `feeds.weight`, `topics.weight`.

## Levels (each builds on the previous)
1. **Full-text search (no AI)** — D1 supports SQLite FTS5: an FTS index over title, snippet,
   feed title and tags; search box in the header, ranked results. Exact matches only (no synonyms).
   Small effort, biggest immediate value → **start here**.
2. **Tags: manual + rules** — tables `tags`, `article_tags(article_id, tag_id, source, confidence)`
   with `source` = `manual` | `rule` | `ai`. Default tags per feed (e.g. lebensmittelwarnung → Food,
   Recall), keyword rules per tag applied in the cron to new articles, add/remove tags on an
   article, filter by tag in the sidebar. Very precise, but only catches what rules name.
3. **Automatic tags with Workers AI (optional)** — data stays in Cloudflare.
   - a) Embeddings (multilingual model, e.g. `bge-m3`, for German content): compare article vectors
     with short tag descriptions; cheap, and enables semantic search via **Vectorize**.
   - b) LLM with a fixed tag list ("pick 0–3"): better context understanding, more cost, less
     consistent.
   Tags only above a confidence threshold, stored as `source='ai'`, correctable. Runs in the cron
   after new articles, batched.
4. **Semantic search with Vectorize (optional).**
5. **Later:** tags feed into scoring (weight per tag) and notifications ("only Recall").

## Accuracy (estimates, not measured)
- Broad categories (politics, tech, food, sport): embeddings usable to good; LLM with fixed list
  generally better.
- Fine or overlapping tags: clearly less reliable.
- Limit: only title + 300-char snippet are stored → caps accuracy for every method.
- Before choosing thresholds: hand-tag ~100 articles and measure the AI against them.

## Feasibility on Cloudflare
- FTS5 in D1: yes.
- Workers AI: free daily quota; a few hundred articles/day with embeddings should fit, an LLM per
  article uses much more — check current pricing before step 3.
- AI calls are network waits (little CPU), but the free plan limits subrequests per invocation →
  batch. Queues would help at larger volume (check plan availability).
- Vectorize is a separate product with its own limits.

## Open questions
1. Which categories/tags to start with (fixed list, or free tags)?
2. Stop after level 2 (no AI), or measure level 3 against a hand-tagged sample?
3. Tag feeds, articles, or both?
