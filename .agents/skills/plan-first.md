---
# Skill: plan-first

## Trigger
Activate when user says `/plan` or task touches >2 files.

## Rules
1. Do NOT write/edit code until user says "PLAN APPROVED".
2. Produce IMPLEMENTATION_PLAN.md with:
   - Problem statement (1 paragraph)
   - Files to touch (exact paths + line numbers)
   - Data flow / control flow changes
   - Risks and edge cases
   - Test cases to add/update
   - Rollback plan
3. STOP and wait for review.
4. Only after "PLAN APPROVED" → code changes.
5. If mid-implementation plan is wrong → STOP, propose revision.

## Repo Rules
- Wave 2 uptime fixes (RC1-RC4) MUST use this skill
- Any change to processData.js uptime logic REQUIRES plan approval
- Formula changes without plan = automatic reject
---
