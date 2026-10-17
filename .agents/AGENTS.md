# Agent Skills Configuration — Phase D Workflow

## Active Skills
- [plan-first](skills/plan-first.md)
- [test-driven](skills/test-driven.md)
- [ruthless-reviewer](skills/ruthless-reviewer.md)
- [root-cause-analyst](skills/root-cause-analyst.md)
- [auto-push](skills/auto-push.md)

## Default Workflow (per task)
1. `/plan` → propose plan, wait for "PLAN APPROVED"
2. `/tdd` → failing test first
3. `/rca` → trace root cause
4. `/review` → self-review before commit
5. auto-push → push to origin/main after commit

## Repo Invariants (never break)
- Backend tests: 63/63 pass
- Frontend build: succeeds
- JFL/MMTC isolation: enforced
- Phase B: 21 sites, 145 devices, 0 stock
- Formula changes: require plan-first + test-driven

## Wave-Specific Requirements
- Wave 2 (uptime + other activity): all 5 skills
- Wave 3 (visual): plan, review, auto-push
- Wave 4 (polish): review, auto-push

## Loading Instruction
Every prompt that needs skills must start with:
  "Load .agents/AGENTS.md and all .agents/skills/*.md.
   Follow them. Confirm loaded before proceeding."
