const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const authService = require('../services/authService');

describe('AuthService users.json dynamic persistence suite', () => {
  const usersFilePath = path.resolve(__dirname, '../../data/users.json');
  let originalFileContent = '{}';

  before(() => {
    if (fs.existsSync(usersFilePath)) {
      originalFileContent = fs.readFileSync(usersFilePath, 'utf8');
    }
  });

  after(() => {
    // Restore clean users.json state
    fs.writeFileSync(usersFilePath, originalFileContent || '{}', 'utf8');
    authService.loadUserData();
  });

  it('authenticates a new user loaded dynamically from users.json', () => {
    const mockUser = {
      id: 'user-mock-test-admin',
      email: 'mockadmin@enterprise.com',
      username: 'mockadmin',
      password: 'MockAdminPassword123!',
      name: 'Mock Test Admin',
      role: 'admin',
      assignedClient: 'all',
      avatar: '👑'
    };

    // Write mock user to users.json
    const usersMap = {
      [mockUser.id]: mockUser
    };
    fs.writeFileSync(usersFilePath, JSON.stringify(usersMap, null, 2), 'utf8');

    // Reload users into authService
    authService.loadUserData();

    // Authenticate with valid credentials
    const session = authService.authenticateUser('mockadmin@enterprise.com', 'MockAdminPassword123!');
    assert.ok(session, 'Authentication should succeed for user loaded from users.json');
    assert.ok(session.token, 'Session should contain a valid Bearer token');
    assert.equal(session.user.email, 'mockadmin@enterprise.com');
    assert.equal(session.user.role, 'admin');
    assert.equal(session.user.assignedClient, 'all');

    // Authenticate with invalid password
    const failedSession = authService.authenticateUser('mockadmin@enterprise.com', 'WrongPassword123');
    assert.equal(failedSession, null, 'Authentication must fail with incorrect password');
  });

  it('authenticates a client user and assigns appropriate client scope', () => {
    const mockClientUser = {
      id: 'user-mock-client-operator',
      email: 'operator@clientcorp.com',
      username: 'operator',
      password: 'ClientOperatorPass123!',
      name: 'Client Operator',
      role: 'client_user',
      assignedClient: 'client-jfl',
      avatar: '🍔'
    };

    const usersMap = {
      [mockClientUser.id]: mockClientUser
    };
    fs.writeFileSync(usersFilePath, JSON.stringify(usersMap, null, 2), 'utf8');

    authService.loadUserData();

    const session = authService.authenticateUser('operator@clientcorp.com', 'ClientOperatorPass123!');
    assert.ok(session);
    assert.equal(session.user.role, 'client_user');
    assert.equal(session.user.assignedClient, 'client-jfl');
  });
});
