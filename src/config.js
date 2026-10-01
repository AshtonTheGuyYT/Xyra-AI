import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: required('JWT_SECRET'),
  encryptionKey: required('ENCRYPTION_KEY'),
  dbPath: process.env.DB_PATH || './data/xyraai.db',
  cookieName: 'xyraai_session',
  sessionDays: 30,
};