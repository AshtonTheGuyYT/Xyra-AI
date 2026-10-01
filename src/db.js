import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    memory_on INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL DEFAULT 'openrouter',
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    api_key_cipher TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT 'dark',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    images TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
`);

const messageCols = db.prepare('PRAGMA table_info(messages)').all();
if (!messageCols.some((c) => c.name === 'images')) {
  db.exec("ALTER TABLE messages ADD COLUMN images TEXT NOT NULL DEFAULT ''");
}