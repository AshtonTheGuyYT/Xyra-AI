import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptSecret, uid } from '../lib/crypto.js';
import { PROVIDERS, parseErr, normalizeBase } from '../lib/providers.js';

const router = Router();
router.use(requireAuth);

function loadUserConfig(userId) {
  const row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!row) return null;
  const cfg = PROVIDERS[row.provider] || PROVIDERS.openrouter;
  const base = row.provider === 'custom' ? normalizeBase(row.base_url) : cfg.base;
  return {
    provider: row.provider,
    base,
    apiKey: decryptSecret(row.api_key_cipher),
  };
}

function defaultImageModel(provider) {
  if (provider === 'openrouter') return 'openai/dall-e-3';
  return 'dall-e-3';
}

router.get('/', (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT m.id, m.chat_id, m.images, m.created_at, c.title
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
      WHERE c.user_id = ? AND m.images != ''
      ORDER BY m.created_at DESC
      LIMIT 300
    `).all(req.user.id);

    const images = [];
    for (const row of rows) {
      let arr;
      try { arr = JSON.parse(row.images); } catch { continue; }
      if (!Array.isArray(arr)) continue;
      for (const data of arr) {
        images.push({
          id: row.id,
          chatId: row.chat_id,
          chatTitle: row.title,
          data,
          createdAt: row.created_at,
        });
      }
    }
    res.json({ images });
  } catch (e) { next(e); }
});

router.post('/generate', async (req, res, next) => {
  try {
    const cfg = loadUserConfig(req.user.id);
    if (!cfg) return res.status(400).json({ error: 'No settings found' });
    if (!cfg.apiKey) return res.status(400).json({ error: 'No API key set, go to your settings!' });
    if (!cfg.base) return res.status(400).json({ error: 'No base URL set' });

    const prompt = String(req.body?.prompt || '').trim();
    const size = String(req.body?.size || '1024x1024');
    const chatId = String(req.body?.chatId || '');
    if (!prompt) return res.status(400).json({ error: 'Empty prompt' });

    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const now = Date.now();
    const userMsgId = uid();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, images, created_at) VALUES (?,?,?,?,?,?)')
      .run(userMsgId, chatId, 'user', prompt, '', now);

    const newTitle = chat.title === 'New chat'
      ? 'Image: ' + prompt.replace(/\s+/g, ' ').slice(0, 32) + (prompt.length > 32 ? '\u2026' : '')
      : chat.title;
    db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(newTitle, now, chatId);

    const model = String(req.body?.model || defaultImageModel(cfg.provider));
    const body = {
      model,
      prompt,
      n: 1,
      size,
      response_format: 'b64_json',
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cfg.apiKey,
    };
    if (cfg.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://xyraai.local';
      headers['X-Title'] = 'XyraAI';
    }

    const r = await fetch(cfg.base + '/images/generations', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!r.ok) {
      const msg = parseErr(text) || 'Image generation failed';
      const errId = uid();
      db.prepare('INSERT INTO messages (id, chat_id, role, content, images, created_at) VALUES (?,?,?,?,?,?)')
        .run(errId, chatId, 'assistant', 'Error: ' + msg, '', Date.now());
      return res.status(r.status).json({ error: msg });
    }

    const entry = (data.data && data.data[0]) || {};
    let dataUrl = '';
    if (entry.b64_json) {
      dataUrl = 'data:image/png;base64,' + entry.b64_json;
    } else if (entry.url) {
      const imgRes = await fetch(entry.url);
      if (!imgRes.ok) return res.status(502).json({ error: 'Could not download generated image' });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const ct = imgRes.headers.get('content-type') || 'image/png';
      dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
    } else {
      return res.status(502).json({ error: 'Provider returned no image' });
    }

    const assistantMsgId = uid();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, images, created_at) VALUES (?,?,?,?,?,?)')
      .run(assistantMsgId, chatId, 'assistant', '', JSON.stringify([dataUrl]), Date.now());
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chatId);

    res.json({
      userMessage: { id: userMsgId, role: 'user', content: prompt, images: [] },
      assistantMessage: { id: assistantMsgId, role: 'assistant', content: '', images: [dataUrl] },
      title: newTitle,
    });
  } catch (e) { next(e); }
});

export default router;