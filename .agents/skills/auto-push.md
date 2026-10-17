---
# Skill: auto-push

## Trigger
Always active after commit (unless user says "commit only").

## Rules
1. After `git commit` → immediately `git push origin main`.
2. Report: "Pushed [hash] to origin/main" or paste error + STOP.
3. Do NOT wait for user.
4. After push → `git status` confirm clean.

## STOP Conditions
- Remote diverged → `git pull --rebase` first
- Push auth/network fails → paste error, wait
- Uncommitted outside intended files → STOP

## Repo Rules
- Every wave commit → auto-push to origin/main
- Render auto-redeploys after push
- Report deploy trigger if visible
---
