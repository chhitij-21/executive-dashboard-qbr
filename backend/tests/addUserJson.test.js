const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { addUserToJson } = require('../scripts/add-user-json');

describe('add-user-json CLI script test suite', () => {
  const tempUsersFile = path.resolve(__dirname, '../data/test_users.json');

  // Cleanup helper
  function cleanup() {
    if (fs.existsSync(tempUsersFile)) {
      try { fs.unlinkSync(tempUsersFile); } catch (e) {}
    }
  }

  it('rejects when email is missing or invalid', () => {
    assert.throws(() => {
      addUserToJson({ email: 'invalid-email', role: 'admin', password: 'password123', usersFilePath: tempUsersFile });
    }, /Invalid email address/);
  });

  it('rejects when password is shorter than 8 characters', () => {
    assert.throws(() => {
      addUserToJson({ email: 'test@portal.com', role: 'admin', password: 'short', usersFilePath: tempUsersFile });
    }, /Password must be at least 8 characters/);
  });

  it('rejects when role is invalid', () => {
    assert.throws(() => {
      addUserToJson({ email: 'test@portal.com', role: 'superhero', password: 'password123', usersFilePath: tempUsersFile });
    }, /Invalid role/);
  });

  it('--dry-run returns the would-be user without modifying the target file', () => {
    cleanup();
    const result = addUserToJson({
      email: 'dryrun@portal.com',
      role: 'admin',
      password: 'password123',
      dryRun: true,
      usersFilePath: tempUsersFile
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.user.email, 'dryrun@portal.com');
    assert.equal(result.user.role, 'admin');
    assert.equal(result.user.assignedClient, 'all');
    assert.equal(fs.existsSync(tempUsersFile), false, 'Dry run must not create the file');
  });

  it('adds a new user to users.json matching authService format', () => {
    cleanup();
    const result = addUserToJson({
      email: 'newadmin@portal.com',
      role: 'admin',
      password: 'mypassword123',
      usersFilePath: tempUsersFile
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.user.email, 'newadmin@portal.com');
    assert.equal(result.user.role, 'admin');
    assert.equal(result.user.password, 'mypassword123');
    assert.equal(result.user.assignedClient, 'all');
    assert.equal(result.user.avatar, '👑');

    // Verify persisted file content
    const fileContent = JSON.parse(fs.readFileSync(tempUsersFile, 'utf8'));
    assert.ok(fileContent[result.user.id]);
    assert.equal(fileContent[result.user.id].email, 'newadmin@portal.com');
    cleanup();
  });

  it('preserves existing MFA data when updating an existing user', () => {
    cleanup();
    // Pre-populate with existing MFA secret
    const initialData = {
      'user-existing-portal-com': {
        mfaSecret: 'EXISTING_SECRET_123',
        mfaEnabled: true,
        pendingMfaSecret: null
      }
    };
    fs.writeFileSync(tempUsersFile, JSON.stringify(initialData, null, 2), 'utf8');

    const result = addUserToJson({
      email: 'existing@portal.com',
      role: 'client_user',
      password: 'newpassword123',
      usersFilePath: tempUsersFile
    });

    assert.equal(result.user.mfaSecret, 'EXISTING_SECRET_123');
    assert.equal(result.user.mfaEnabled, true);

    const fileContent = JSON.parse(fs.readFileSync(tempUsersFile, 'utf8'));
    assert.equal(fileContent['user-existing-portal-com'].mfaSecret, 'EXISTING_SECRET_123');
    assert.equal(fileContent['user-existing-portal-com'].password, 'newpassword123');
    cleanup();
  });
});
