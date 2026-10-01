import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, uid } from '../lib/crypto.js';
import { signSession, setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js';

const router = Router();

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, username: row.username };
}

router.post('/signup', (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();

    if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const id = uid();
    const now = Date.now();
    const { salt, hash } = hashPassword(password);
    const displayName = name || email.split('@')[0];

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO users (id, email, name, username, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, email, displayName, '', hash, salt, now);
      db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').run(id, now);
    });
    tx();

    setSessionCookie(res, signSession(id));
    res.status(201).json({
      user: { id, email, name: displayName, username: '' },
    });
  } catch (e) { next(e); }
});

router.post('/login', (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    setSessionCookie(res, signSession(user.id));
    res.json({ user: publicUser(user) });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.patch('/me', requireAuth, (req, res, next) => {
  try {
    const body = req.body || {};
    const fields = [];
    const values = [];

    if (typeof body.username === 'string') {
      fields.push('username = ?');
      values.push(body.username.trim().slice(0, 40));
    }
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      fields.push('name = ?');
      values.push(name);
    }

    if (!fields.length) {
      const row = db.prepare('SELECT id, email, name, username FROM users WHERE id = ?').get(req.user.id);
      return res.json({ user: publicUser(row) });
    }

    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const row = db.prepare('SELECT id, email, name, username FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(row) });
  } catch (e) { next(e); }
});

export default router;