import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptSecret, uid } from '../lib/crypto.js';
import { PROVIDERS, buildSystem, parseErr, normalizeBase, readSSE } from '../lib/providers.js';

const router = Router();
router.use(requireAuth);

function isFreeModel(m) {
  const p = m.pricing;
  if (!p) return false;
  return parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0;
}

function loadUserConfig(userId) {
  const row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
  if (!row) return null;
  const cfg = PROVIDERS[row.provider] || PROVIDERS.openrouter;
  const base = row.provider === 'custom' ? normalizeBase(row.base_url) : cfg.base;
  return {
    provider: row.provider,
    style: cfg.style,
    base,
    model: row.model,
    apiKey: decryptSecret(row.api_key_cipher),
    settings: row,
  };
}

router.get('/models', async (req, res, next) => {
  try {
    const cfg = loadUserConfig(req.user.id);
    if (!cfg) return res.status(400).json({ error: 'No settings found' });
    if (!cfg.apiKey) return res.status(400).json({ error: 'No API key set, go to your settings!' });
    if (!cfg.base) return res.status(400).json({ error: 'No base URL set' });

    if (cfg.provider === 'openrouter') {
      const r = await fetch(cfg.base + '/models');
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: parseErr(JSON.stringify(data)) || 'Failed to fetch models' });
      const all = data.data || [];
      const free = all.filter(isFreeModel);
      const list = (free.length ? free : all).slice().sort((a, b) => a.id.localeCompare(b.id));

      let credits = null;
      try {
        const cr = await fetch(cfg.base + '/auth/key', { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
        if (cr.ok) {
          const cd = await cr.json();
          const d = cd.data || {};
          credits = { limit: d.limit ?? null, usage: d.usage ?? null };
        }
      } catch { /* ignore */ }

      return res.json({
        models: list.map(m => ({ id: m.id, name: m.name || m.id, free: isFreeModel(m) })),
        credits,
      });
    }

    if (cfg.provider === 'openai' || cfg.provider === 'custom') {
      const r = await fetch(cfg.base + '/models', { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: parseErr(JSON.stringify(data)) || 'Failed to fetch models' });
      return res.json({ models: (data.data || []).map(m => ({ id: m.id, name: m.name || m.id })) });
    }

    if (cfg.provider === 'anthropic') {
      const r = await fetch(cfg.base + '/models', {
        headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: parseErr(JSON.stringify(data)) || 'Failed to fetch models' });
      return res.json({ models: (data.data || []).map(m => ({ id: m.id, name: m.display_name || m.id })) });
    }

    res.status(400).json({ error: 'Unsupported provider' });
  } catch (e) { next(e); }
});

function parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function toProviderMessages(history, style) {
  return history.map((m) => {
    const images = parseImages(m.images);
    if (!images.length) {
      return { role: m.role, content: m.content || '' };
    }
    if (style === 'anthropic') {
      const parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const img of images) {
        const match = String(img).match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) continue;
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] },
        });
      }
      return { role: m.role, content: parts };
    }
    const parts = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const img of images) {
      parts.push({ type: 'image_url', image_url: { url: img } });
    }
    return { role: m.role, content: parts };
  });
}

async function callProvider({ cfg, history, stream, onDelta }) {
  if (cfg.style === 'anthropic') {
    const body = {
      model: cfg.model,
      max_tokens: 2048,
      system: buildSystem(cfg.settings),
      messages: toProviderMessages(history, 'anthropic'),
      stream,
    };
    const r = await fetch(cfg.base + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(parseErr(text) || 'Anthropic request failed');
    }
    if (!stream) {
      const data = await r.json();
      return (data.content || []).map((b) => b.text || '').join('');
    }
    return readSSE(r.body, (event, data) => {
      if (event === 'content_block_delta' && data.delta?.type === 'text_delta') {
        const t = data.delta.text || '';
        if (t) onDelta(t);
        return t;
      }
      return '';
    });
  }

  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: buildSystem(cfg.settings) },
      ...toProviderMessages(history, 'openai'),
    ],
    stream,
  };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://xyraai.local';
    headers['X-Title'] = 'XyraAI';
  }

  const r = await fetch(cfg.base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(parseErr(text) || 'Provider request failed');
  }
  if (!stream) {
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  }
  return readSSE(r.body, (event, data) => {
    const delta = data.choices?.[0]?.delta?.content;
    if (delta) { onDelta(delta); return delta; }
    return '';
  });
}

router.post('/chat', async (req, res, next) => {
  try {
    const cfg = loadUserConfig(req.user.id);
    if (!cfg) return res.status(400).json({ error: 'No settings found' });
    if (!cfg.apiKey) return res.status(400).json({ error: 'No API key set, go to your settings!' });
    if (!cfg.model) return res.status(400).json({ error: 'No model selected' });

    const chatId = String(req.body?.chatId || '');
    const message = String(req.body?.message || '').trim();
    const rawImages = Array.isArray(req.body?.images) ? req.body.images : [];

    const images = rawImages
      .filter((s) => typeof s === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s))
      .slice(0, 8)
      .map((s) => (s.length > 4_000_000 ? '' : s))
      .filter(Boolean);

    if (!message && !images.length) return res.status(400).json({ error: 'Empty message' });

    const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const now = Date.now();
    const userMessageId = uid();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, images, created_at) VALUES (?,?,?,?,?,?)')
      .run(userMessageId, chatId, 'user', message, images.length ? JSON.stringify(images) : '', now);

    const titleSeed = message || (images.length ? '[image]' : '');
    const newTitle = chat.title === 'New chat'
      ? titleSeed.replace(/\s+/g, ' ').slice(0, 40) + (titleSeed.length > 40 ? '\u2026' : '')
      : chat.title;
    db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(newTitle, now, chatId);

    const history = db.prepare('SELECT role, content, images FROM messages WHERE chat_id = ? ORDER BY created_at ASC').all(chatId);

    const wantsStream = req.body?.stream !== false;

    if (wantsStream) {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
    }

    const reply = await callProvider({
      cfg,
      history,
      stream: wantsStream,
      onDelta: (chunk) => {
        if (wantsStream) res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
      },
    });

    const assistantMessageId = uid();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, images, created_at) VALUES (?,?,?,?,?,?)')
      .run(assistantMessageId, chatId, 'assistant', reply, '', Date.now());
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chatId);

    if (wantsStream) {
      res.write(`data: ${JSON.stringify({
        done: true,
        userMessageId,
        assistantMessageId,
        title: newTitle,
      })}\n\n`);
      res.end();
    } else {
      res.json({
        userMessage: { id: userMessageId, role: 'user', content: message, images },
        assistantMessage: { id: assistantMessageId, role: 'assistant', content: reply, images: [] },
        title: newTitle,
      });
    }
  } catch (err) {
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ error: err.message || 'Unknown error' })}\n\n`);
        res.end();
      } catch { /* ignore */ }
      return;
    }
    next(err);
  }
});

export default router;