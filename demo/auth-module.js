/**
 * User Authentication Module
 * 
 * Features:
 * - User registration with password hashing
 * - Login with JWT token generation
 * - Token validation
 * - User profile management
 */

const crypto = require('crypto');

// In-memory user store (replace with database in production)
const users = new Map();

// JWT secret (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
const TOKEN_EXPIRY = '24h';

/**
 * Hash password using SHA-256 with salt
 */
function hashPassword(password, salt = null) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt: useSalt };
}

/**
 * Verify password against stored hash
 */
function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

/**
 * Generate JWT token
 */
function generateToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
  })).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  
  return `${header}.${payload}.${signature}`;
}

/**
 * Validate JWT token
 */
function validateToken(token) {
  try {
    const [header, payload, signature] = token.split('.');
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    // Check expiration
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    
    return decoded;
  } catch (e) {
    return null;
  }
}

/**
 * Register a new user
 */
function register(username, password, email) {
  if (users.has(username)) {
    throw new Error('Username already exists');
  }
  
  const { hash, salt } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    email,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
    roles: ['user']
  };
  
  users.set(username, user);
  
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    createdAt: user.createdAt
  };
}

/**
 * Login user
 */
function login(username, password) {
  const user = users.get(username);
  if (!user) {
    throw new Error('Invalid username or password');
  }
  
  if (!verifyPassword(password, user.passwordHash, user.salt)) {
    throw new Error('Invalid username or password');
  }
  
  const token = generateToken(user.id);
  
  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles
    },
    token
  };
}

/**
 * Get user by ID
 */
function getUserById(userId) {
  for (const user of users.values()) {
    if (user.id === userId) {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
        createdAt: user.createdAt
      };
    }
  }
  return null;
}

/**
 * Get user by username
 */
function getUserByUsername(username) {
  const user = users.get(username);
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    roles: user.roles,
    createdAt: user.createdAt
  };
}

module.exports = {
  register,
  login,
  validateToken,
  getUserById,
  getUserByUsername,
  users
};

// Demo usage
if (require.main === module) {
  console.log('=== User Authentication Module Demo ===\n');
  
  // Register users
  console.log('1. Registering users...');
  const user1 = register('alice', 'password123', 'alice@example.com');
  console.log('   Registered:', user1.username);
  
  const user2 = register('bob', 'securepass456', 'bob@example.com');
  console.log('   Registered:', user2.username);
  
  // Login
  console.log('\n2. Logging in...');
  const loginResult = login('alice', 'password123');
  console.log('   Logged in:', loginResult.user.username);
  console.log('   Token:', loginResult.token.substring(0, 50) + '...');
  
  // Validate token
  console.log('\n3. Validating token...');
  const validated = validateToken(loginResult.token);
  console.log('   Valid:', validated ? 'Yes' : 'No');
  console.log('   User ID:', validated?.sub);
  
  // Get user
  console.log('\n4. Getting user by ID...');
  const fetchedUser = getUserById(user1.id);
  console.log('   Found:', fetchedUser?.username);
  
  // Invalid login
  console.log('\n5. Testing invalid login...');
  try {
    login('alice', 'wrongpassword');
  } catch (e) {
    console.log('   Correctly rejected:', e.message);
  }
  
  console.log('\n=== Demo Complete ===');
}
