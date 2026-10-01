# XyraAI Backend

Node + Express + SQLite backend for XyraAI.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in `JWT_SECRET` and `ENCRYPTION_KEY`
3. Drop your frontend into `public/index.html`
4. `npm run dev`

## Endpoints

Auth
- `POST /api/auth/signup`   { email, password, name }
- `POST /api/auth/login`    { email, password }
- `POST /api/auth/logout`
- `GET  /api/auth/me`

Settings
- `GET   /api/settings`
- `PATCH /api/settings`     { nickname?, about?, memoryOn?, provider?, baseUrl?, model?, theme?, apiKey? }

Chats
- `GET    /api/chats`
- `POST   /api/chats`       { title? }
- `GET    /api/chats/:id`
- `PATCH  /api/chats/:id`   { title }
- `DELETE /api/chats/:id`

Proxy
- `GET  /api/models`
- `POST /api/chat`          { chatId, message, stream? }

`/api/chat` returns Server-Sent Events when `stream !== false`:
`data: { "delta": "..." }` for tokens, `data: { "done": true, ... }` at end, `data: { "error": "..." }` on failure.