import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chats.js';
import settingsRoutes from './routes/settings.js';
import proxyRoutes from './routes/proxy.js';
import imageRoutes from './routes/images.js';
import { errorHandler, notFound } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/chats', apiLimiter, chatRoutes);
app.use('/api/settings', apiLimiter, settingsRoutes);
app.use('/api/images', apiLimiter, imageRoutes);
app.use('/api', apiLimiter, proxyRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(express.static(publicDir));

app.use('/api', notFound);
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`XyraAI backend listening on :${config.port}`);
});