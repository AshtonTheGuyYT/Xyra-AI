import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { uid } from '../lib/crypto.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT id, title, created_at, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    res.json({
      chats: rows.map(r => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at })),
    });
  } catch (e) { next(e); }
});

router.post('/', (req, res, next) => {
  try {
    const id = uid();
    const now = Date.now();
    const title = String(req.body?.title || 'New chat').slice(0, 80);
    db.prepare('INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(id, req.user.id, title, now, now);
    res.status(201).json({ chat: { id, title, createdAt: now, updatedAt: now, messages: [] } });
  } catch (e) { next(e); }
});

router.get('/:id', (req, res, next) => {
  try {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const messages = db.prepare('SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chat.id);
    res.json({
      chat: {
        id: chat.id,
        title: chat.title,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at })),
      },
    });
  } catch (e) { next(e); }
});

router.patch('/:id', (req, res, next) => {
  try {
    const title = String(req.body?.title || '').slice(0, 80);
    const info = db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(title, Date.now(), req.params.id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', (req, res, next) => {
  try {
    const info = db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!info.changes) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;