# Last security reviews

Used by agents to scope the next review (see "Security reviews" in `AGENTS.md`). Newest first.
Full review: whole codebase. Diff review: changes since the previous reviewed commit.

| Date | Type | Scope (reviewed up to) | Result |
|---|---|---|---|
| 2026-09-25 | Diff review | up to commit `5024363` (push feature, security fixes, follow-ups) | 3 Low findings → `docs/TODO.md`; all six follow-ups confirmed fixed |
| 2026-09-25 | Full review | whole codebase at `3c3f2e2` + the then-uncommitted push feature | 6 findings (0 Critical/High), all fixed; follow-up review of the fixes: 6 more, all fixed (commit `5024363`) |

**Next diff review:** changes since commit `5024363`.
**Next full review:** due around 2026-10-25.
