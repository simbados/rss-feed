---
name: code-walkthrough
description: Guides the user through new or changed code in small chunks — flow of information first, then one function or one new file at a time in call order, with complete code and a very brief explanation, waiting for the user after each chunk. Use when the user asks for a walkthrough, code tour or explanation of a change/feature (e.g. "walk me through the new code", "explain the multi-user change"). Optional argument: a git ref/range (e.g. `HEAD~2`, `5024363..HEAD`), a feature name, or file paths.
---

# Code walkthrough

Read-only by default: only git read commands, reading files and searching. The one exception is a fix
the user approved during the walkthrough (see "Findings").

## 1. Scope — what counts as "new code"
- Argument is a ref or range → `git diff <range>`; a feature name → find its commits/files (plan in
  `docs/plan-*.md`, `git log --oneline`); file paths → those files. No argument → everything not yet
  committed: `git diff HEAD` plus untracked files (`git ls-files --others --exclude-standard`).
- From the diff, list every **new or changed function** (and every new file) in `src/`, `migrations/`,
  `scripts/` and `test/`. This list is the coverage checklist — **every entry must be shown once**.
  Config changes (`wrangler.toml`, `package.json`) count as one chunk each.

## 2. First chunk: flow of information
- A small ASCII diagram from the entry points (HTTP request, cron, client script, push) through the
  new/changed functions to where data ends up (D1, response, push service, device).
- Under it, the chunk order (numbered list of function/file names, following the flow) and the total
  number of chunks.
- Then stop and wait.

## 3. One chunk at a time
Order: follow the flow from the entry point. **When a chunk calls a function that is new or changed,
that function is the next chunk** (depth first), then return to where the flow left off. Functions that
already existed and didn't change are named with one line ("existing: …"), not shown.

Each chunk:
- Header: `## <n>/<total> · <function name> — <file:line>`
- **New function / new file:** the complete code exactly as in the file (never shortened with `…` or
  placeholder comments). For a new file that is mostly declarations (SQL schema, config, test
  helper), show the whole file as one chunk; split a long new file into one chunk per function.
- **Changed function:** only the changed lines as a diff (`-`/`+`), plus just enough unchanged context
  lines to understand them (e.g. the signature, the surrounding `if`). Every added line must be shown;
  unchanged parts are left out (say "rest unchanged"), not replaced by placeholder comments inside
  the code.
- **Explanation: at most 3 short bullets** — its role in the flow, where its input comes from, where
  its output goes. Mention a security-relevant detail only if the function has one.
- `Next: <n+1> · <name>` — then **stop and wait** for the user. No summary of what's coming beyond that.

## 4. Replies, questions and findings
- **`n`, `y`, `next` or an empty "ok"** mean: show the next chunk.
- If the user asks something, answer it (briefly, with code if needed) and then offer to continue with
  the same `Next:` chunk. Don't advance on your own.
- **Findings:** if a chunk reveals a bug, a wrong comment or other inaccuracy, say so in one line at the
  end of the chunk and **ask whether to fix it before the next chunk**. Only fix it after the user
  agrees (small, focused edit; run the affected tests), confirm in one line, then show the next chunk.
  Declined findings are listed again at the end.

## 5. End
Show the coverage checklist with every item ticked. If anything was skipped, show it now. List findings
that weren't fixed. Ask whether anything should be looked at again.
