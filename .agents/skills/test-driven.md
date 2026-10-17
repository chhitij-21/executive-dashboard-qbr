---
# Skill: test-driven

## Trigger
Activate when user says `/tdd` or fixing data-integrity bug.

## Rules
1. Write FAILING test BEFORE fix code.
2. Run test → confirm fails for right reason.
3. Write minimum code to make test pass.
4. Refactor without breaking test.
5. Report: test path, initial fail, final pass.

## Test Quality
- Deterministic, self-cleaning, behavior-named
- Edge cases: null, empty, boundaries

## Repo Rules
- Uptime (RC1-RC4) → test first
- Other Activity (Bug 1-3) → test first
- Mandatory uptime test scenarios:
  * Zero incidents → 100.00%
  * Blank actMin → holdMin fallback
  * Multi-incident → cumulative division (not averaging)
  * Bounds: Math.max(0, Math.min(100, ...))
---
