# Implementation Plan — Item #4: Real Auth (JWT, bcrypt, 4h TTL & Redis Revocation)

**Status**: Waiting for user **APPROVED** before writing code.  
**Roadmap Item**: **#4 Real Auth (JWT/bcrypt)**  
**Sequence Context**: Implemented prior to **#3 (Database Layer)** and **#14 (API Versioning)** to guarantee the v1 API contract incorporates production authentication primitives.

---

## 1. Overview & Objectives

Item #4 replaces legacy in-memory plain token authentication with an enterprise-grade, stateless signed JWT architecture hardened with:
1. **4-Hour Access Token TTL**: Tokens expire 4 hours after issuance (`TOKEN_TTL = 4 * 60 * 60 * 1000`), bounded and compliant for enterprise SaaS.
2. **Two-Tier Active Revocation via Redis**:
   - **Per-Token Blocklist (`jti`)**: Single-session logout (`POST /api/auth/logout`) blacklists the token's `jti` with TTL matching the remaining token lifetime.
   - **User-Level Instant Cutoff (`user_revoked_before`)**: Terminating an employee, admin suspension, or changing a password invalidates all existing sessions for that user across all pods in $< 1$ ms.
3. **Fail-Closed Production Resilience**: In production, Redis is strictly required. If Redis becomes unreachable during a revocation check, `requireAuth` fails closed with **HTTP 503 Service Unavailable** (never fail-open). In-memory fallback is isolated to `NODE_ENV === 'test'` and non-production dev.
4. **Login Brute-Force Rate Limiting (`checkLoginRateLimit`)**: Enforces 5 failed attempts per 15 minutes per `(IP, username)` via Redis counters (`login_attempt:{ip}:{username}`, TTL 900s). Exceeding limit returns **HTTP 429 Too Many Requests** with header `Retry-After: 900`. Successful login resets the counter.
5. **Bcrypt Password Security & On-Boot Migration**: Passwords stored as `bcrypt` hashes (cost factor 10). On boot under `AUTH_V2`, legacy plaintext passwords in `data/users.json` are automatically upgraded to bcrypt hashes without locking out demo accounts.
6. **No User Enumeration & Constant-Time Comparisons**: Standardized generic error responses and constant-time password verification eliminate timing and enumeration attacks.
7. **`AUTH_V2` Rollback Gate**: Gated behind `AUTH_V2 !== 'false'`; setting `AUTH_V2=false` instantly restores legacy in-memory session behavior if emergency rollback is required.

---

## 2. Architecture & Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │             Client Request with Bearer Token                │
   │             Authorization: Bearer <JWT>                     │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │        backend/middleware/auth.js: requireAuth              │
   │  1. Check AUTH_V2 flag: if false -> fallback to legacy map  │
   │  2. Verify JWT signature & expiration (4h max lifetime)     │
   │  3. Extract { sub: userId, jti, iat, exp, role }            │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         Active Revocation Check (authService)               │
   │  4. In prod: Check Redis connectivity; if down -> 503       │
   │  5. Redis GET blocklist:{jti} -> if exists -> 401 REVOKED   │
   │  6. Redis GET user_revoked_before:{userId}                  │
   │     If server_revoked_at > jwt.iat -> 401 SESSION_KILLED    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │         Attach req.user & Proceed to Controller             │
   │  req.user = { id: userId, email, role, assignedClient }     │
   └─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 Token Minting, Secret Management & Rotation Specification (`backend/services/authService.js`)
- **Mechanism**: Native Node.js `crypto` HMAC-SHA256 (RFC 7519 standard JWT format). Ensures zero external dependency CVE risks, 100% environment parity, and native execution speed.
- **JWT Header**:
  ```json
  { "alg": "HS256", "typ": "JWT" }
  ```
- **JWT Payload**:
  ```json
  {
    "sub": "user-client-jfl",
    "email": "jfl@portal.com",
    "role": "client_user",
    "assignedClient": "client-jfl",
    "jti": "d3b07384-d113-4a11-8c9a-245f78acba10",
    "iat": 1795348800,
    "exp": 1795363200
  }
  ```
- **TTL**: Exactly 4 hours (14,400 seconds).
- **`JWT_SECRET` Production Guard**:
  - Read from `process.env.JWT_SECRET`.
  - In production (`NODE_ENV === 'production'`), startup halts immediately (`throw new Error('[FATAL] Production startup halted: Missing or insecure JWT_SECRET (must be >= 32 chars).')`) if `JWT_SECRET` is unset or shorter than 32 characters.
  - In non-production/test, defaults to a safe test secret with an explicit console warning.
- **`JWT_SECRET` Rotation Path**:
  - Current baseline: changing `JWT_SECRET` invalidates all existing active tokens immediately, requiring users to log in again.
  - Backlog architecture path: dual-secret verification (`JWT_SECRET_CURRENT` and `JWT_SECRET_PREVIOUS`) planned for zero-downtime key rotation once external API integrations land.

### 3.2 Redis-Backed Revocation & Fail-Closed Guard
- **Shared Redis Connection**: Reuses `redisClient` from `queueService` (or initializes Redis connection via `ioredis` when `REDIS_URL` is configured).
- **In-Memory Fallback**: Isolated strictly to `NODE_ENV === 'test'` or local non-production development when `REDIS_URL` is undefined.
- **Fail-Closed Logic in Production**:
  ```javascript
  async function isTokenRevoked(jti, userId, iatSeconds) {
    if (process.env.AUTH_V2 === 'false') return { revoked: false };

    const isProd = process.env.NODE_ENV === 'production';
    const redis = getRedisClient();

    if (isProd && (!redis || redis.status !== 'ready')) {
      const err = new Error('Authentication validation service temporarily unavailable.');
      err.statusCode = 503;
      err.code = 'AUTH_SERVICE_UNAVAILABLE';
      throw err;
    }

    if (redis && redis.status === 'ready') {
      // 1. Check specific token blocklist
      const isBlocklisted = await redis.get(`blocklist:${jti}`);
      if (isBlocklisted) return { revoked: true, reason: 'TOKEN_REVOKED' };

      // 2. Check user-level termination timestamp
      const revokedBefore = await redis.get(`user_revoked_before:${userId}`);
      if (revokedBefore && iatSeconds < parseInt(revokedBefore, 10)) {
        return { revoked: true, reason: 'USER_SESSION_TERMINATED' };
      }
      return { revoked: false };
    }

    // In-memory fallback (test / local non-prod only)
    return checkInMemoryRevocation(jti, userId, iatSeconds);
  }
  ```
- **TTL of Revocation Keys**:
  - `blocklist:{jti}`: `Math.max(1, Math.floor(exp - Date.now() / 1000))` (auto-evicts as soon as token naturally expires).
  - `user_revoked_before:{userId}`: `4 * 60 * 60` (4 hours; after 4 hours, all tokens minted before that timestamp have naturally expired).

### 3.3 Login Rate Limiting (`checkLoginRateLimit`)
- **Rate Limit Window**: 5 attempts per 15 minutes (900 seconds) per `(IP, username)`.
- **Redis Implementation**:
  ```javascript
  async function checkLoginRateLimit(ip, username) {
    const key = `login_attempt:${ip}:${username.toLowerCase()}`;
    const redis = getRedisClient();

    if (redis && redis.status === 'ready') {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 900);
      if (count > 5) {
        const ttl = await redis.ttl(key);
        return { allowed: false, retryAfter: Math.max(1, ttl) };
      }
      return { allowed: true };
    }

    // In-memory sliding map fallback (test / dev)
    return checkInMemoryLoginRate(ip, username);
  }
  ```
- **HTTP Response on Breach**:
  - Status: **HTTP 429 Too Many Requests**
  - Header: `Retry-After: 900`
  - Body: `{ error: 'Too many login attempts. Please try again in 15 minutes.', code: 'RATE_LIMIT_EXCEEDED', retryAfter: 900 }`
- **Reset on Success**: When `authenticateUser` successfully verifies credentials, it calls `clearLoginRateLimit(ip, username)` (`DEL login_attempt:{ip}:{username}`), resetting the counter immediately.

### 3.4 Endpoints & RBAC Rules
1. **`POST /api/auth/logout` (Self-Only)**:
   - Protected by `requireAuth`.
   - Extracts calling user's token `jti` and `exp` from `req.user`.
   - Adds `blocklist:{jti}` to Redis with remaining TTL.
   - Returns HTTP 200 `{ success: true, message: 'Logged out successfully.' }`.

2. **`POST /api/auth/revoke` (Admin-Only)**:
   - Protected by `requireAuth` + `requireAdmin`.
   - Request body: `{ userId: string, jti?: string }`.
   - If `userId` provided: sets `user_revoked_before:{userId} = Math.floor(Date.now() / 1000)` in Redis (TTL: 4h).
   - If `jti` provided: sets `blocklist:{jti}` with 4h TTL.
   - Emits structured audit log to `data/audit/auth.log` (`action: 'TOKEN_REVOCATION', admin: req.user.email, targetUserId: userId`).
   - Returns HTTP 200 `{ success: true, message: 'User sessions revoked successfully.' }`.

3. **Password Change Integration**:
   - Whenever a user updates their password (or an admin resets a user password), the service automatically executes:
     ```javascript
     await revokeAllUserTokens(userId);
     ```
   - All active tokens for that user immediately fail validation on subsequent requests.

### 3.5 Demo Users, Password Storage & Git Strategy
- **Git Tracking Strategy**:
  - `data/users.json` is strictly **gitignored** (`.gitignore` line 27), ensuring no customer credentials, user records, or password hashes are ever checked into git history.
  - In-memory seed users (`SUPER_ADMIN`, `client-jfl`, `client-mmtc`) provide zero-dependency first-boot initialization.
- **Multi-Pod Atomic File Writes**:
  - Migrating or updating user passwords in `data/users.json` uses atomic writes via `safeWriteJson(targetPath, data)` (temp-file write + rename with Windows 3-tier fallback), preventing multi-pod file corruption.
- **On-Boot & Lazy Upgrade to bcrypt**:
  - Uses `bcryptjs@2.4.3` (cost factor 10) for pure-JS cross-platform stability (eliminates native C++ compilation failures on Windows/Render).
  - On startup inside `authService.initAuth()`:
    1. Reads `data/users.json` (and seeded demo user array).
    2. Inspects password field for each user.
    3. If password does NOT match `/^\$2[aby]\$\d{2}\$/` (not a valid bcrypt hash):
       - Computes `const hash = await bcrypt.hash(plaintext, 10);`
       - Replaces plaintext password with `hash`.
       - Writes updated user records back to `data/users.json` via `safeWriteJson`.
  - **Login Lazy Upgrade**: If an existing user record still contains plaintext when `authenticateUser` runs, it compares constant-time, verifies, upgrades password to bcrypt hash in the background, and saves.
  - Guarantees zero credential lockouts for default demo users (`admin123`, `jfl123`, `mmtc123`).

### 3.6 Section 21 Hardening Checklist
- [x] **Rate Limit on `/login`**: 5 attempts per 15-minute sliding window per IP + username combination with `Retry-After: 900`.
- [x] **Constant-Time Compare**: `bcrypt.compare` (which uses constant-time string comparison internally).
- [x] **Token Lifespan**: Exactly 4 hours (24h plain token eliminated).
- [x] **No User Enumeration**: Returns generic `{ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' }` with HTTP 401 for both unknown email and incorrect password.
- [x] **Payload Sanitation**: Outbound user objects in sessions and `/api/auth/me` are stripped of `password`, `mfaSecret`, `pendingMfaSecret`.
- [x] **`.env.example` Entries**:
  - `JWT_SECRET=replace_with_at_least_32_byte_secure_random_key`
  - `AUTH_V2=true`
  - `REDIS_URL=redis://localhost:6379`

---

## 4. File Changes & Touches

### Files to Modify
1. `package.json`: Add exact dependency `bcryptjs@2.4.3`.
2. `backend/services/authService.js`:
   - Add JWT minting, verification, and decoding (native RFC 7519 HMAC-SHA256).
   - Implement `checkLoginRateLimit(ip, username)` and `clearLoginRateLimit(ip, username)`.
   - Implement `revokeToken(jti, exp)` and `revokeAllUserTokens(userId)`.
   - Implement Redis blocklist check with 503 fail-closed in production.
   - Add on-boot bcrypt migration for unhashed user passwords using `safeWriteJson`.
   - Support `AUTH_V2=false` fallback toggle.
3. `backend/middleware/auth.js`:
   - Update `requireAuth` to support JWT verification, `jti` blocklist check, and `user_revoked_before` timestamp check.
   - Attach decoded JWT payload to `req.user`.
   - Catch Redis errors in production and emit HTTP 503 `AUTH_SERVICE_UNAVAILABLE`.
4. `backend/index.js`:
   - Update `/api/auth/login` to integrate `checkLoginRateLimit` and reset on success.
   - Mount `POST /api/auth/revoke` (admin only).
   - Update `POST /api/auth/logout` to invoke `authService.revokeToken`.
5. `.env.example`: Add `JWT_SECRET`, `AUTH_V2`, and `REDIS_URL` documentation.

### New Test Files
1. `backend/tests/authV2.test.js`:
   - 14 comprehensive unit and integration tests covering JWT minting, 4h TTL, blocklist revocation, user termination, password change session kill, fail-closed production behavior, login rate limiting, and backward compatibility.

---

## 5. Verification Plan & Test Suite (14 Tests)

1. **`mintJwt_valid4hTtl`**: Minted token contains `exp - iat === 14400` seconds (4 hours) and valid signature.
2. **`verifyToken_validSignature`**: `requireAuth` succeeds with HTTP 200 and attaches `req.user` accurately.
3. **`verifyToken_expiredToken_returns401`**: Token with past `exp` rejected with HTTP 401 `TOKEN_EXPIRED`.
4. **`verifyToken_invalidSecret_returns401`**: Token signed with mismatched secret rejected with HTTP 401 `INVALID_TOKEN`.
5. **`logout_revokesJti_subsequentRequest401`**: `POST /api/auth/logout` places `jti` in blocklist; subsequent call with same token returns HTTP 401 `TOKEN_REVOKED`.
6. **`revoke_adminOnly_nonAdminForbidden`**: `POST /api/auth/revoke` returns HTTP 403 when called by client user.
7. **`revoke_userLevel_killsAllActiveSessions`**: Admin revoking user ID sets `user_revoked_before`; all previously issued tokens for that user immediately return HTTP 401 `USER_SESSION_TERMINATED`.
8. **`passwordChange_triggersUserRevocation`**: Updating user password automatically kills existing sessions.
9. **`prodFailClosed_redisDown_returns503`**: In production (`NODE_ENV=production`), Redis outage during revocation check returns HTTP 503 `AUTH_SERVICE_UNAVAILABLE`.
10. **`onBootMigration_hashesPlaintextDemoUsers`**: Boot process detects plaintext passwords and upgrades to bcrypt `$2b$` in `data/users.json`.
11. **`noUserEnumeration_constantTimeCompare`**: Non-existent user and wrong password return identical HTTP 401 `INVALID_CREDENTIALS`.
12. **`authV2_rollbackFlag_preservesLegacyMap`**: Setting `AUTH_V2=false` successfully routes authentication through legacy in-memory session map.
13. **`loginRateLimit_5Attempts_6thReturns429`**: 5 failed login attempts for `(ip, username)` succeed, 6th attempt returns HTTP 429 with `Retry-After: 900`; successful login resets counter.
14. **`prodStartup_missingJwtSecret_throws`**: In production (`NODE_ENV=production`), server halts with fatal error if `JWT_SECRET` is missing or $<32$ characters.
