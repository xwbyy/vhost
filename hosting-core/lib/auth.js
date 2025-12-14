/**
 * Authentication Module
 * Mengelola login, registrasi, dan session management
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('./sheets-db');

const JWT_SECRET = process.env.JWT_SECRET || 'hosting-mandiri-secret-key-2024';
const TOKEN_EXPIRY = '7d';

class Auth {
  async register(userData) {
    await db.init();

    const { username, email, password } = userData;

    if (!username || !email || !password) {
      throw new Error('Username, email, dan password wajib diisi');
    }

    if (password.length < 6) {
      throw new Error('Password minimal 6 karakter');
    }

    const existingUser = await db.findOne('Users', { username });
    if (existingUser) {
      throw new Error('Username sudah digunakan');
    }

    const existingEmail = await db.findOne('Users', { email });
    if (existingEmail) {
      throw new Error('Email sudah terdaftar');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    const userCount = await db.count('Users');
    const isFirstUser = userCount === 0;

    const user = await db.insert('Users', {
      id: userId,
      username,
      email,
      password: hashedPassword,
      tier: isFirstUser ? 'vip' : 'free',
      created_at: new Date().toISOString(),
      last_login: new Date().toISOString(),
      is_admin: isFirstUser ? 'true' : 'false',
      status: 'active',
      avatar: ''
    });

    await db.insert('Logs', {
      id: uuidv4(),
      user_id: userId,
      app_id: '',
      type: 'auth',
      message: `User ${username} registered`,
      created_at: new Date().toISOString(),
      level: 'info'
    });

    const token = this.generateToken(user);
    return { user: this.sanitizeUser(user), token };
  }

  async login(username, password, meta = {}) {
    await db.init();

    const user = await db.findOne('Users', { username });
    if (!user) {
      throw new Error('Username atau password salah');
    }

    if (user.status === 'banned') {
      throw new Error('Akun Anda telah diblokir');
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      throw new Error('Username atau password salah');
    }

    await db.update('Users', { id: user.id }, {
      last_login: new Date().toISOString()
    });

    const token = this.generateToken(user);
    const sessionId = uuidv4();

    await db.insert('Sessions', {
      id: sessionId,
      user_id: user.id,
      token,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ip_address: meta.ip || '',
      user_agent: meta.userAgent || ''
    });

    await db.insert('Logs', {
      id: uuidv4(),
      user_id: user.id,
      app_id: '',
      type: 'auth',
      message: `User ${username} logged in`,
      created_at: new Date().toISOString(),
      level: 'info'
    });

    return { user: this.sanitizeUser(user), token };
  }

  async logout(token) {
    await db.init();
    await db.delete('Sessions', { token });
  }

  async validateToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await db.init();

      const session = await db.findOne('Sessions', { token });
      if (!session) {
        return null;
      }

      if (new Date(session.expires_at) < new Date()) {
        await db.delete('Sessions', { token });
        return null;
      }

      const user = await db.findOne('Users', { id: decoded.userId });
      if (!user || user.status === 'banned') {
        return null;
      }

      return this.sanitizeUser(user);
    } catch (error) {
      return null;
    }
  }

  generateToken(user) {
    return jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );
  }

  sanitizeUser(user) {
    const { password, ...safeUser } = user;
    return safeUser;
  }

  async updateProfile(userId, data) {
    await db.init();

    const allowedFields = ['email', 'avatar'];
    const updateData = {};

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    if (data.newPassword) {
      if (data.newPassword.length < 6) {
        throw new Error('Password minimal 6 karakter');
      }
      updateData.password = await bcrypt.hash(data.newPassword, 10);
    }

    return await db.update('Users', { id: userId }, updateData);
  }

  async getAllUsers() {
    await db.init();
    const users = await db.getAll('Users');
    return users.map(u => this.sanitizeUser(u));
  }

  async getUserById(userId) {
    await db.init();
    const user = await db.findOne('Users', { id: userId });
    return user ? this.sanitizeUser(user) : null;
  }

  async updateUser(userId, data) {
    await db.init();
    return await db.update('Users', { id: userId }, data);
  }

  async deleteUser(userId) {
    await db.init();
    return await db.delete('Users', { id: userId });
  }

  async getUserStats(userId) {
    await db.init();
    const apps = await db.findMany('Apps', { user_id: userId });
    const user = await db.findOne('Users', { id: userId });

    const maxApps = user.tier === 'vip' 
      ? parseInt(await db.getSetting('max_apps_vip') || '20')
      : parseInt(await db.getSetting('max_apps_free') || '3');

    const maxStorage = user.tier === 'vip'
      ? parseInt(await db.getSetting('max_storage_vip') || '1000')
      : parseInt(await db.getSetting('max_storage_free') || '100');

    return {
      totalApps: apps.length,
      maxApps,
      runningApps: apps.filter(a => a.status === 'running').length,
      storageUsed: 0,
      maxStorage,
      tier: user.tier,
      isAdmin: user.is_admin === 'true'
    };
  }
}

module.exports = new Auth();
