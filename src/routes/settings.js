import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { encryptSecret } from '../lib/crypto.js';

const router = Router();
router.use(requireAuth);

function ensureRow(userId) {
  let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').run(userId, Date.now());
    row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  }
  return row;
}

function present(row) {
  return {
    nickname: row.nickname,
    about: row.about,
    memoryOn: !!row.memory_on,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    theme: row.theme,
    hasApiKey: !!row.api_key_cipher,
  };
}

router.get('/', (req, res, next) => {
  try {
    res.json({ settings: present(ensureRow(req.user.id)) });
  } catch (e) { next(e); }
});

router.patch('/', (req, res, next) => {
  try {
    ensureRow(req.user.id);
    const body = req.body || {};
    const fields = [];
    const values = [];

    const stringMap = {
      nickname: 'nickname',
      about: 'about',
      provider: 'provider',
      baseUrl: 'base_url',
      model: 'model',
      theme: 'theme',
    };
    for (const [key, col] of Object.entries(stringMap)) {
      if (typeof body[key] === 'string') {
        fields.push(`${col} = ?`);
        values.push(body[key]);
      }
    }
    if (typeof body.memoryOn === 'boolean') {
      fields.push('memory_on = ?');
      values.push(body.memoryOn ? 1 : 0);
    }
    if (typeof body.apiKey === 'string') {
      fields.push('api_key_cipher = ?');
      values.push(body.apiKey ? encryptSecret(body.apiKey) : '');
    }

    if (fields.length) {
      fields.push('updated_at = ?');
      values.push(Date.now(), req.user.id);
      db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    }

    res.json({ settings: present(ensureRow(req.user.id)) });
  } catch (e) { next(e); }
});

export default router;