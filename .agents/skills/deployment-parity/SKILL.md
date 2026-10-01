---
name: deployment-parity
description: Compare structured responses between ENV A (local) and ENV B
  (deployed) across a fixed list of routes. Detects data drift after
  deployments and cache staleness. Use after every push to ENV B, or
  whenever local and deployed dashboards disagree.
---

# deployment-parity

Compares a fixed list of API routes between two environments and reports
whether the responses are byte-identical after normalizing known-dynamic
fields.

## When to invoke

- After every deploy to ENV B
- After any change to `backend/index.js`, `backend/services/processData.js`,
  or `backend/config/rules.yaml`
- Whenever a value differs between the local and deployed dashboard
- When debugging "stale data" symptoms

## Inputs

Configured inside `scripts/deployment-parity.js`:
  ENV A base URL  (default: http://localhost:3000)
  ENV B base URL  (default: https://executive-dashboard-qbr-2.onrender.com)
  Routes to compare (fixed list, edit in the script to extend)
  Normalized fields to strip before hashing:
    jobId, generatedAt, ts, timestamp, duration_ms

## Workflow

1. For each route, fetch the same path from ENV A and ENV B in parallel.
2. Capture raw body, status code, Content-Type.
3. Normalize: remove the whitelisted dynamic fields from the JSON body
   (or from SSE data blocks if the response is `text/event-stream`).
4. Compute SHA256 of raw and normalized bodies for each side.
5. Emit one row per route:

   | Route | A status | B status | A raw hash | B raw hash | A norm hash | B norm hash | Verdict |

6. Verdict rules:
   - A status ≠ B status                       → FAIL
   - A norm hash ≠ B norm hash                 → FAIL
   - A raw hash ≠ B raw hash but norm matches  → PASS (dynamic fields differ, expected)
   - Both hashes match                         → PASS

7. On FAIL, print a 200-character excerpt from each side for the first
   differing route, so the developer can see the divergence immediately.

## Rules

- The skill NEVER modifies code. It reports only.
- The skill NEVER authenticates. If a route returns 401 on both sides,
  that is a PASS (auth behavior is identical).
- SSE routes (`/api/chat/loop`) are compared after stripping per-event
  `ts` and `duration_ms` from each data block.
- Routes that are unreachable on either side are marked UNREACHABLE, not
  FAIL. The overall verdict is only FAIL if at least one route returns
  mismatched data.

## Companion script

    node scripts/deployment-parity.js

Optional environment overrides:

    ENV_A=http://localhost:3001 ENV_B=https://other.example.com \
      node scripts/deployment-parity.js

Exit code: 0 = all routes PASS, 1 = at least one FAIL.
