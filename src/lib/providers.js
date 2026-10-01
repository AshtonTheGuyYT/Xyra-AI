export const PROVIDERS = {
  openrouter: { base: 'https://openrouter.ai/api/v1', style: 'openai' },
  openai: { base: 'https://api.openai.com/v1', style: 'openai' },
  anthropic: { base: 'https://api.anthropic.com/v1', style: 'anthropic' },
  custom: { base: '', style: 'openai' },
};

export function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function buildSystem(settings) {
  let p = "You are 3\u00A2H0. You text like a real person, not an assistant: short, casual, lowercase most of the time, no corporate filler. You're chill and a little playful, but still genuinely helpful. Never refer to yourself as an AI assistant, you're just 3\u00A2H0.";
  if (settings?.nickname) p += ' Call the user ' + settings.nickname + '.';
  if (settings?.about) p += ' Here is some context about the user: ' + settings.about;
  return p;
}

export function parseErr(text) {
  try {
    const d = JSON.parse(text);
    return d.error?.message || d.message || null;
  } catch {
    return null;
  }
}

function findBoundary(buf) {
  const i1 = buf.indexOf('\n\n');
  const i2 = buf.indexOf('\r\n\r\n');
  if (i1 === -1 && i2 === -1) return null;
  if (i1 === -1) return { idx: i2, len: 4 };
  if (i2 === -1) return { idx: i1, len: 2 };
  return i1 < i2 ? { idx: i1, len: 2 } : { idx: i2, len: 4 };
}

export async function readSSE(body, handler) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let out = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = findBoundary(buffer))) {
      const raw = buffer.slice(0, boundary.idx);
      buffer = buffer.slice(boundary.idx + boundary.len);

      const lines = raw.split(/\r?\n/);
      let event = '';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!dataStr || dataStr === '[DONE]') continue;

      let parsed;
      try { parsed = JSON.parse(dataStr); } catch { continue; }
      const piece = handler(event, parsed);
      if (piece) out += piece;
    }
  }
  return out;
}