#!/usr/bin/env node
// backend/scripts/add-user-json.js
// Safe CLI script to add/update user records in data/users.json for file/env-based authentication.

const fs = require('fs');
const path = require('path');

const DEFAULT_USERS_FILE = path.resolve(__dirname, '../../data/users.json');

/**
 * Normalizes email to deterministic user ID
 */
function generateUserId(email) {
  const clean = email.toLowerCase().trim().replace(/[^a-z0-9]/g, '-');
  return `user-${clean}`;
}

/**
 * Core function to add or update a user record in users.json
 */
function addUserToJson({
  email,
  role,
  password,
  assignedClient,
  name,
  dryRun = false,
  usersFilePath = DEFAULT_USERS_FILE
}) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    throw new Error('Invalid email address. Must be a valid email containing "@".');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  const validRoles = ['admin', 'client_user', 'user'];
  if (!role || !validRoles.includes(role.toLowerCase())) {
    throw new Error(`Invalid role: "${role}". Must be one of: ${validRoles.join(', ')}`);
  }

  const normalizedRole = role.toLowerCase() === 'user' ? 'client_user' : role.toLowerCase();
  const normalizedEmail = email.toLowerCase().trim();
  const username = normalizedEmail.split('@')[0];
  const derivedId = generateUserId(normalizedEmail);

  // Read existing users file if present
  let usersMap = {};
  if (fs.existsSync(usersFilePath)) {
    try {
      const raw = fs.readFileSync(usersFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        usersMap = parsed;
      }
    } catch (err) {
      console.warn(`[WARN] Could not parse existing ${usersFilePath}. Initializing clean map.`);
      usersMap = {};
    }
  }

  // Check for existing entry by ID or email
  let targetKey = derivedId;
  let existingEntry = usersMap[targetKey];

  if (!existingEntry) {
    const foundKey = Object.keys(usersMap).find(k => {
      const u = usersMap[k];
      return u && u.email && u.email.toLowerCase() === normalizedEmail;
    });
    if (foundKey) {
      targetKey = foundKey;
      existingEntry = usersMap[foundKey];
    }
  }

  // Default client assignment and avatar
  let client = assignedClient;
  if (!client) {
    if (normalizedRole === 'admin') {
      client = 'all';
    } else if (normalizedEmail.includes('mmtc')) {
      client = 'client-mmtcpamp';
    } else {
      client = 'client-jfl';
    }
  }

  let userAvatar = '👤';
  if (normalizedRole === 'admin') userAvatar = '👑';
  else if (client === 'client-jfl') userAvatar = '🍔';
  else if (client === 'client-mmtcpamp') userAvatar = '🏭';

  // Construct complete user record matching authService structure
  const userRecord = {
    id: existingEntry?.id || targetKey,
    email: normalizedEmail,
    username: existingEntry?.username || username,
    password: password, // exact string format used by authService.js
    name: name || existingEntry?.name || (normalizedRole === 'admin' ? 'Admin User' : 'Portal User'),
    role: normalizedRole,
    assignedClient: client,
    avatar: existingEntry?.avatar || userAvatar,
    // Preserve existing MFA states if already enrolled
    mfaSecret: existingEntry?.mfaSecret || null,
    mfaEnabled: !!existingEntry?.mfaEnabled,
    pendingMfaSecret: existingEntry?.pendingMfaSecret || null,
    updatedAt: new Date().toISOString()
  };

  if (!existingEntry) {
    userRecord.createdAt = new Date().toISOString();
  }

  if (dryRun) {
    return {
      dryRun: true,
      user: userRecord,
      targetKey,
      file: usersFilePath
    };
  }

  // Persist updated map to users.json
  usersMap[targetKey] = userRecord;

  const targetDir = path.dirname(usersFilePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(usersFilePath, JSON.stringify(usersMap, null, 2), 'utf8');

  return {
    dryRun: false,
    user: userRecord,
    targetKey,
    file: usersFilePath
  };
}

// CLI Execution Handler
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cleanArgs = args.filter(a => !a.startsWith('--'));

  if (cleanArgs.length < 3) {
    console.error(`
Usage:
  node backend/scripts/add-user-json.js <email> <role> <password> [clientId] [--dry-run]

Arguments:
  <email>       User email address (e.g. ops@jfl.com)
  <role>        User role: 'admin' or 'client_user' (or 'user')
  <password>    Plaintext password (minimum 8 characters)
  [clientId]    Optional: 'client-jfl', 'client-mmtcpamp', or 'all'

Options:
  --dry-run     Simulate user creation without modifying data/users.json
`);
    process.exit(1);
  }

  const [email, role, password, clientId] = cleanArgs;

  try {
    const result = addUserToJson({
      email,
      role,
      password,
      assignedClient: clientId,
      dryRun
    });

    if (result.dryRun) {
      console.log('\n[DRY-RUN] User would be added/updated in data/users.json:');
      console.log(JSON.stringify(result.user, null, 2));
    } else {
      console.log(`\n[SUCCESS] User successfully saved to ${result.file}:`);
      console.log(JSON.stringify(result.user, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  addUserToJson,
  generateUserId
};
