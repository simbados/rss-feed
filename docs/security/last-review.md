# Last security reviews

Used by agents to scope the next review (see "Security reviews" in `AGENTS.md`). Newest first.
Full review: whole codebase. Diff review: changes since the previous reviewed commit.

| Date | Type | Scope (reviewed up to) | Result |
|---|---|---|---|
| 2026-09-26 | Diff review | since `199723d` incl. uncommitted (allowlist, digest site name, daily purge, feed badge, cron */15, mute rules) | 1 Medium (unbounded candidate scan on rule creation, half-applied rule) + 1 Low (rule-id queries without user check): both fixed before commit; allowlist OK |
| 2026-09-26 | Diff review | uncommitted multi-user change (on top of `7600edc`) | no IDOR; 6 Low findings (shared image cache, push on shared devices, Unicode email folding, topic ownership only in index.js, static-rule gaps, sequential ids) |
| 2026-09-26 | Diff review | since `5024363` incl. uncommitted (digest text, PWA polish, auto-refresh, Brave button) | 2 Low findings → `docs/TODO.md` |
| 2026-09-25 | Diff review | up to commit `5024363` (push feature, security fixes, follow-ups) | 3 Low findings → `docs/TODO.md`; all six follow-ups confirmed fixed |
| 2026-09-25 | Full review | whole codebase at `3c3f2e2` + the then-uncommitted push feature | 6 findings (0 Critical/High), all fixed; follow-up review of the fixes: 6 more, all fixed (commit `5024363`) |

**Next diff review:** changes since the commit that contains the mute rules (the next commit after `012dd46`).
**Next full review:** due around 2026-10-25.
