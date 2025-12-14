/**
 * Authentication Middleware
 */

const auth = require('../lib/auth');

const authMiddleware = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const user = await auth.validateToken(token);
    req.user = user;
  } catch (error) {
    req.user = null;
  }

  next();
};

const requireAuth = async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ success: false, error: 'Silakan login terlebih dahulu' });
    }
    return res.redirect('/login');
  }

  try {
    const user = await auth.validateToken(token);
    if (!user) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Sesi tidak valid' });
      }
      res.clearCookie('token');
      return res.redirect('/login');
    }
    req.user = user;
    next();
  } catch (error) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ success: false, error: 'Token tidak valid' });
    }
    res.clearCookie('token');
    return res.redirect('/login');
  }
};

const requireAdmin = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.is_admin !== 'true') {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ success: false, error: 'Akses ditolak' });
      }
      return res.status(403).render('error', {
        message: 'Akses ditolak',
        error: { status: 403 }
      });
    }
    next();
  });
};

const requireVIP = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (!req.user || (req.user.tier !== 'vip' && req.user.is_admin !== 'true')) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ success: false, error: 'Fitur ini hanya untuk VIP' });
      }
      return res.status(403).render('error', {
        message: 'Fitur ini hanya untuk member VIP',
        error: { status: 403 }
      });
    }
    next();
  });
};

module.exports = { authMiddleware, requireAuth, requireAdmin, requireVIP };
