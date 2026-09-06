# GitHub Issues & Projects workflow

GitHub Issues + the repo's Project board (v2) are the **single source of truth** for task state —
not a local TODO list, not a plan checkbox alone. The reason: sessions/agents change (Claude Code,
opencode/GLM, a human), and the board is the only state that survives a handover without re-reading
this whole conversation. Every task in a plan doc under `docs/superpowers/plans/` maps 1:1 to a
GitHub issue.

Repo: https://github.com/malkavian-librarian/tubeguard
Project board: https://github.com/users/malkavian-librarian/projects/2

`gh` CLI is available and authenticated on this machine — use it directly, no need to open the
browser.

## Push often and fast

- Commit and push at the end of **every** task, not batched across tasks. A task is "done" only
  once its commit is pushed to a feature branch and its PR is opened (or merged, for Phase 0).
- Small, single-purpose commits/PRs over large ones — keep diffs reviewable (~400 lines / ~6 files
  as a soft ceiling). If a task is trending larger, split it before starting, not after.
- Never let uncommitted or unpushed work sit across a stop-and-review checkpoint.

## Issues

- One issue per plan task, filed with the task's title from the plan doc. Labels: `phase:0`
  through `phase:6` matching `docs/superpowers/plans/2026-09-06-quality-reliability-memory-design-fix-plan.md`
  phases (phase:6 = Chrome Web Store publishing guide, added outside the original plan doc).
- Reference the issue number in the commit message (`#12`) and use a closing keyword
  (`Closes #12`, `Fixes #12`) in the PR description so merging auto-closes it.
- Keep the issue body itself thin — link to the plan doc section rather than duplicating task
  detail. The issue's job is status + discussion, not spec.
- When a task's scope changes mid-work (cut, expanded, blocked), update the issue immediately.

## Acceptance criteria (required, before every task)

**Before starting any task**, its GitHub issue must contain an **Acceptance Criteria** checklist
using GitHub's native task-list syntax (`- [ ]`), derived from that task's own description/test
assertions in the plan doc — not a generic "tests pass" line.

**On completion of the task:**
1. Re-check the implementation against each criterion individually — run the actual tests/commands
   each criterion names, don't eyeball the code.
2. Edit the issue body to check off (`- [x]`) every criterion that passed. Leave unchecked any that
   didn't, and say why in the completion comment (deferred, cut for time budget, or a real gap).
3. Post a completion comment (`gh issue comment <n> --body "..."`) stating pass/fail per criterion.
4. Only then close the issue (or move it to Done on the board) and proceed to the next task.

**Mechanics:**

```powershell
# Append acceptance criteria to an issue
gh issue edit 11 --body "$(gh issue view 11 --json body -q .body)

## Acceptance Criteria
- [ ] Outbox failure clears ownership.automatic after backoff threshold
- [ ] Channel becomes re-plannable within N retries"

# Post the completion comment
gh issue comment 11 --body "Acceptance criteria check:
- [x] ownership cleared after threshold - confirmed, test passes
All criteria met."
```

## Project board

- Move the issue's board status (Todo -> In Progress -> Done) at the same time you touch the
  issue — not as a separate end-of-session sweep.
- Add every phase's issues to the board *before* implementation starts for that phase.

## Common `gh` commands

```powershell
# Create an issue from a plan task
gh issue create -R malkavian-librarian/tubeguard --title "Phase 1.1: Outbox permanent-failure stuck ownership" `
  --body "See docs/superpowers/plans/2026-09-06-quality-reliability-memory-design-fix-plan.md#phase-1" `
  --label "phase:1"

# List open issues for a phase
gh issue list -R malkavian-librarian/tubeguard --label "phase:1" --state open

# Add an existing issue to the project board (project number 2, user malkavian-librarian)
gh project item-add 2 --owner malkavian-librarian --url https://github.com/malkavian-librarian/tubeguard/issues/12

# Open a PR that auto-closes its issue on merge
gh pr create -R malkavian-librarian/tubeguard --title "Phase 1: reliability fixes" --body "Closes #12" --base main

# Close an issue when a task's commit lands
gh issue close 12 --comment "Done in <commit-sha>"
```

## Model preferences

| Task | Model |
|------|-------|
| Architectural/concurrency-sensitive decisions (storage.js split, outbox/lease logic), final reviews | Top tier |
| Default implementation, plan writing | Mid tier |
| Boilerplate tests, constant extraction, docs/comment cleanup, mechanical code-review/smoke passes | Haiku |
