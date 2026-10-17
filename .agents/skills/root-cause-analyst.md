---
# Skill: root-cause-analyst

## Trigger
`/rca` or any bug fix.

## Rules
1. Do NOT apply first fix that makes symptom disappear.
2. Produce RCA.md with:
   - Symptom, reproduction, trace to wrong value
   - Root cause: WHY wrong?
   - Fix at root, not symptom
   - Regression test
3. Shared function → check all callers.
4. Report collateral impact.

## Repo Rules
- Phase C pattern: symptom (100% uptime) → root (blank actMin)
- BAD: clamp to 99.99%
- GOOD: fallback chain + cumulative math
---
