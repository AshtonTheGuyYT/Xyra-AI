import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db.js';

export function signSession(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
}

export function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

function loadUserFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return db.prepare('SELECT id, email, name, username FROM users WHERE id = ?').get(payload.sub) || null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const user = loadUserFromToken(req.cookies?.[config.cookieName]);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

export function optionalAuth(req, res, next) {
  const user = loadUserFromToken(req.cookies?.[config.cookieName]);
  if (user) req.user = user;
  next();
}