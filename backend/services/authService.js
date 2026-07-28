// backend/services/authService.js
// Authentication & Role-Based Access Control (RBAC) service.
// Supports Admin and Client User roles out-of-the-box.

const USERS = [
  {
    id: 'user-admin',
    email: 'admin@portal.com',
    password: 'admin123',
    name: 'System Admin',
    role: 'admin',
    assignedClient: 'all',
    avatar: '👨‍💼'
  },
  {
    id: 'user-jfl',
    email: 'jfl@jubilant.com',
    password: 'user123',
    name: 'JFL Executive',
    role: 'client_user',
    assignedClient: 'client-jfl',
    avatar: '👩‍💻'
  },
  {
    id: 'user-client-a',
    email: 'user@clienta.com',
    password: 'user123',
    name: 'Client A Lead',
    role: 'client_user',
    assignedClient: 'client-a',
    avatar: '👨‍💼'
  },
  {
    id: 'user-client-b',
    email: 'user@clientb.com',
    password: 'user123',
    name: 'Client B Manager',
    role: 'client_user',
    assignedClient: 'client-b',
    avatar: '👩‍💼'
  }
];

// Simple in-memory token map for session management
const tokens = new Map();

function authenticateUser(email, password) {
  const user = USERS.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password
  );

  if (!user) return null;

  const token = `token_${user.id}_${Date.now()}`;
  const session = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      assignedClient: user.assignedClient,
      avatar: user.avatar,
    },
    token,
    createdAt: new Date().toISOString()
  };

  tokens.set(token, session);

  return session;
}

function verifyToken(token) {
  if (!token) return null;
  const cleanToken = token.replace('Bearer ', '').trim();
  return tokens.get(cleanToken) || null;
}

function getDemoUsers() {
  return USERS.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    assignedClient: u.assignedClient,
    password: u.password
  }));
}

module.exports = {
  authenticateUser,
  verifyToken,
  getDemoUsers,
};
