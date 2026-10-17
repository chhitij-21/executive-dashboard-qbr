---
# Skill: ruthless-reviewer

## Trigger
`/review` or automatically before every commit.

## Rules
1. Produce CODE_REVIEW.md with:
   - Changes summary (file:line)
   - Correctness vs spec
   - Security (injection, auth, leaks)
   - Performance (O(n^2), N+1, memory)
   - Readability (naming, length, comments)
   - Test coverage
2. List ≥3 improvement points.
3. CRITICAL issue → STOP, fix before commit.
4. Be harsh. No "looks good" without justification.

## Checklist
- No console.log in production
- No hardcoded secrets
- Error handling on I/O
- No silent catch
- Input validation

## Repo Rules
- JFL user must NOT access MMTC data
- Uptime must clamp 0-100
- Preserve Phase B: 21 sites, 145 devices, 0 stock
- 63/63 tests pass, frontend build succeeds
---
