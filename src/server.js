import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { validateChatInput, validateSessionId } from './validation.js';
import { SessionMemory } from './memory.js';
import { chat } from './agent.js';
import {
  LEAD_STATUSES,
  createImovel,
  dataDir,
  deleteImovel,
  deleteLead,
  getImovel,
  listImoveis,
  listImoveisPublicos,
  listLeads,
  sanitizeImovel,
  saveLead,
  updateImovel,
  updateLeadStatus,
} from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
const viewsDir = path.join(rootDir, 'views');
const memory = new SessionMemory();
const sessionTokenSecret = process.env.CHAT_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_MESSAGE_COOLDOWN_MS = 1500;
const MAX_SESSION_ACTIVITY = 1000;
const sessionActivity = new Map();
const painelUser = (process.env.PAINEL_USER || 'admin').trim();
const painelPassword = (process.env.PAINEL_PASSWORD || '').trim();
const PAINEL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAINEL_COOKIE_NAME = 'painel_session';
const MAX_LEAD_FIELDS = 20;
const MAX_LEAD_FIELD_LENGTH = 200;

// Fotos enviadas pelo painel ficam junto do banco (no volume, em produção),
// então sobrevivem a deploys e são servidas em /uploads pelo próprio servidor.
const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const UPLOAD_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Apaga do disco a foto de um imóvel quando ela foi enviada pelo painel
// (caminho /uploads/...) e deixou de ser usada (imóvel excluído ou foto trocada).
function removeUploadedFoto(foto) {
  if (typeof foto !== 'string' || !foto.startsWith('/uploads/')) {
    return;
  }

  const filePath = path.join(uploadsDir, path.basename(foto));
  fs.unlink(filePath, () => {});
}

// O front-end (site + painel) é servido por este mesmo servidor. isTrustedOrigin
// decide apenas quem recebe headers CORS (liberando leitura cross-origin):
// requisições cujo Origin bate com algum host da própria requisição, mais a
// allowlist opcional ALLOWED_ORIGIN para domínios externos.
// A comparação é feita pelo HOST (não pela origin completa) porque atrás do
// proxy da Railway tanto o protocolo (http vs https) quanto o header Host
// podem divergir do domínio público que o browser envia no Origin. Por isso
// reunimos todos os hosts que o proxy pode informar.
// IMPORTANTE: nenhuma requisição é BLOQUEADA por essa comparação — atrás de
// proxies o Host visto pelo app pode divergir do Origin do browser mesmo em
// requisições legítimas. Origem não confiável apenas não recebe headers CORS,
// o que já impede browsers de outros sites de lerem respostas ou passarem no
// preflight; a proteção real dos endpoints /chat e /lead é o token de sessão
// assinado (X-Chat-Token), e a do painel é o login + cookie SameSite.
function requestHosts(req) {
  const hosts = new Set();
  const add = (value) => {
    if (value) {
      hosts.add(String(value).trim().toLowerCase());
    }
  };

  add(req.get('host'));
  add(req.hostname); // respeita X-Forwarded-Host quando trust proxy está ativo
  const forwardedHost = req.get('x-forwarded-host');
  if (forwardedHost) {
    for (const part of forwardedHost.split(',')) {
      add(part);
    }
  }

  hosts.delete('');
  return hosts;
}

function isTrustedOrigin(req, origin) {
  if (!origin) {
    return false;
  }

  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  // Também compara ignorando a porta, cobrindo casos em que um lado inclui
  // :443/:80 e o outro não.
  const originHostname = originHost.split(':')[0];
  for (const host of requestHosts(req)) {
    if (host === originHost || host.split(':')[0] === originHostname) {
      return true;
    }
  }

  return allowedOrigins.includes(origin);
}

const corsOptionsDelegate = (req, callback) => {
  const origin = req.get('origin');
  if (origin && isTrustedOrigin(req, origin)) {
    return callback(null, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Chat-Token'],
      maxAge: 600,
    });
  }

  // Sem headers CORS a requisição segue normalmente (same-origin não precisa
  // deles), mas browsers de outros sites não conseguem ler a resposta.
  return callback(null, { origin: false });
};

function signSessionToken(sessionId) {
  const payload = JSON.stringify({
    sessionId,
    exp: Date.now() + SESSION_TOKEN_TTL_MS,
  });
  const encodedPayload = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionTokenSecret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token, sessionId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }

  const [encodedPayload, providedSignature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', sessionTokenSecret)
    .update(encodedPayload)
    .digest('base64url');

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.sessionId === sessionId && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

// ---- Login do painel -------------------------------------------------------
// Credenciais via PAINEL_USER / PAINEL_PASSWORD; sessão em cookie HttpOnly
// assinado com HMAC (mesmo esquema dos tokens de chat).

function safeStringEquals(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function signPainelSession() {
  const payload = JSON.stringify({ scope: 'painel', exp: Date.now() + PAINEL_SESSION_TTL_MS });
  const encodedPayload = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionTokenSecret)
    .update(`painel.${encodedPayload}`)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function verifyPainelSession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return false;
  }

  const [encodedPayload, providedSignature] = token.split('.');
  const expectedSignature = crypto
    .createHmac('sha256', sessionTokenSecret)
    .update(`painel.${encodedPayload}`)
    .digest('base64url');

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload.scope === 'painel' && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.get('cookie');
  if (!header) {
    return '';
  }

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return '';
}

function painelSessionCookie(req, value, maxAgeMs) {
  const attributes = [
    `${PAINEL_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (req.secure) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

function isPainelAuthenticated(req) {
  return verifyPainelSession(getCookie(req, PAINEL_COOKIE_NAME));
}

function sanitizeLeadFields(rawFields) {
  if (!Array.isArray(rawFields)) {
    return null;
  }

  const fields = [];
  for (const item of rawFields.slice(0, MAX_LEAD_FIELDS)) {
    if (!item || typeof item.label !== 'string' || typeof item.value !== 'string') {
      continue;
    }

    const label = item.label.trim().slice(0, MAX_LEAD_FIELD_LENGTH);
    const value = item.value.trim().slice(0, MAX_LEAD_FIELD_LENGTH);
    if (label && value) {
      fields.push({ label, value });
    }
  }

  return fields.length > 0 ? fields : null;
}

function enforceSessionCooldown(sessionId) {
  const now = Date.now();
  const lastActivityAt = sessionActivity.get(sessionId) || 0;
  if (now - lastActivityAt < SESSION_MESSAGE_COOLDOWN_MS) {
    return false;
  }

  sessionActivity.delete(sessionId);
  sessionActivity.set(sessionId, now);

  while (sessionActivity.size > MAX_SESSION_ACTIVITY) {
    const oldestKey = sessionActivity.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sessionActivity.delete(oldestKey);
  }

  return true;
}

app.set('trust proxy', 1);
app.use(cors(corsOptionsDelegate));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// ---- Rotas de login do painel (antes do static, que serve /painel) --------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

app.get('/painel/login', (req, res) => {
  if (isPainelAuthenticated(req)) {
    return res.redirect('/painel/');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(viewsDir, 'login.html'));
});

app.post(
  '/painel/login',
  loginLimiter,
  express.urlencoded({ extended: false, limit: '2kb' }),
  (req, res) => {
    if (!painelPassword) {
      return res
        .status(503)
        .send('Login do painel não configurado: defina PAINEL_PASSWORD nas variáveis de ambiente.');
    }

    const user = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
    const password = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const userOk = safeStringEquals(user, painelUser);
    const passwordOk = safeStringEquals(password, painelPassword);

    if (!userOk || !passwordOk) {
      return res.redirect('/painel/login?erro=1');
    }

    res.setHeader('Set-Cookie', painelSessionCookie(req, signPainelSession(), PAINEL_SESSION_TTL_MS));
    return res.redirect('/painel/');
  }
);

app.get('/painel/logout', (req, res) => {
  res.setHeader('Set-Cookie', painelSessionCookie(req, '', 0));
  return res.redirect('/painel/login');
});

// Tudo o mais sob /painel exige sessão válida. Para a API do painel a resposta
// é 401 em JSON (o front-end trata e manda para o login); para páginas, redirect.
app.use('/painel', (req, res, next) => {
  if (isPainelAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  return res.redirect('/painel/login');
});

// ---- API do painel (protegida pelo middleware acima) -----------------------
const painelApi = express.Router();
painelApi.use(express.json({ limit: '32kb' }));

painelApi.get('/imoveis', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listImoveis());
});

painelApi.post('/imoveis', (req, res) => {
  const { imovel, error } = sanitizeImovel(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  return res.status(201).json(createImovel(imovel));
});

painelApi.put('/imoveis/:id', (req, res) => {
  const { imovel, error } = sanitizeImovel(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const previous = getImovel(String(req.params.id));
  const updated = updateImovel(String(req.params.id), imovel);
  if (!updated) {
    return res.status(404).json({ error: 'Imóvel não encontrado' });
  }

  if (previous && previous.foto !== updated.foto) {
    removeUploadedFoto(previous.foto);
  }
  return res.json(updated);
});

painelApi.delete('/imoveis/:id', (req, res) => {
  const previous = getImovel(String(req.params.id));
  if (!deleteImovel(String(req.params.id))) {
    return res.status(404).json({ error: 'Imóvel não encontrado' });
  }

  removeUploadedFoto(previous?.foto);
  return res.status(204).end();
});

// Upload da foto do imóvel: o painel envia o arquivo direto no corpo da
// requisição (Content-Type da própria imagem), sem multipart. A resposta
// traz o caminho público para salvar no campo "foto" do imóvel.
painelApi.post(
  '/upload',
  express.raw({ type: Object.keys(UPLOAD_TYPES), limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
    const ext = UPLOAD_TYPES[(req.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!ext) {
      return res
        .status(415)
        .json({ error: 'Formato não suportado. Envie JPG, PNG, WebP ou GIF.' });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Arquivo vazio' });
    }

    const name = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    try {
      fs.writeFileSync(path.join(uploadsDir, name), req.body);
    } catch (err) {
      console.error('Upload error:', err.message);
      return res.status(500).json({ error: 'Falha ao salvar o arquivo' });
    }

    return res.status(201).json({ url: `/uploads/${name}` });
  }
);

painelApi.get('/leads', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(listLeads());
});

painelApi.patch('/leads/:id', (req, res) => {
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status deve ser um de: ${LEAD_STATUSES.join(', ')}` });
  }

  if (!updateLeadStatus(Number(req.params.id), status)) {
    return res.status(404).json({ error: 'Lead não encontrado' });
  }
  return res.json({ status: 'ok' });
});

painelApi.delete('/leads/:id', (req, res) => {
  if (!deleteLead(Number(req.params.id))) {
    return res.status(404).json({ error: 'Lead não encontrado' });
  }
  return res.status(204).end();
});

app.use('/painel/api', painelApi);

// ---- API pública de imóveis (alimenta os cards do site) --------------------
const imoveisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.get('/api/imoveis', imoveisLimiter, (_req, res) => {
  // Cache curto: o site sente a atualização do painel em até 1 minuto.
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(listImoveisPublicos());
});

// Fotos enviadas pelo painel (públicas: o site exibe nos cards). O nome do
// arquivo é único, então pode ter cache longo.
app.use(
  '/uploads',
  express.static(uploadsDir, {
    immutable: true,
    maxAge: '30d',
    fallthrough: false,
  })
);

// Site público em / e painel em /painel, servidos antes do rate limiter
// para que assets (imagens, css, js) não consumam a cota da API.
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      const cacheControl = filePath.endsWith('.html')
        ? 'no-cache'
        : 'public, max-age=86400';
      res.setHeader('Cache-Control', cacheControl);
    },
  })
);

app.use(express.json({ limit: '8kb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: (req) => req.path === '/health',
});

app.use(limiter);

const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many session requests, please try again later' },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat requests, please try again later' },
});

const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lead requests, please try again later' },
});

app.use((err, _req, res, next) => {
  if (!err) {
    return next();
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }

  // Erros com status próprio (ex.: 404 de arquivo inexistente em /uploads).
  const status = Number(err.statusCode || err.status);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message || 'Request error' });
  }

  return res.status(400).json({ error: 'Bad request' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'site-bgsm' });
});

// Atalho: /leads leva ao painel de imóveis/leads.
app.get('/leads', (_req, res) => {
  res.redirect('/painel/');
});

app.post('/chat/session', sessionLimiter, (req, res) => {
  const sessionValidation = validateSessionId(req.body?.sessionId);
  if (!sessionValidation.valid) {
    return res.status(400).json({ error: sessionValidation.error });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    token: signSessionToken(req.body.sessionId),
    expiresInMs: SESSION_TOKEN_TTL_MS,
  });
});

app.post('/chat', chatLimiter, async (req, res) => {
  const { valid, error } = validateChatInput(req.body);
  if (!valid) {
    return res.status(400).json({ error });
  }

  const sessionId = req.body.sessionId;
  const message = req.body.message.trim();
  const sessionToken = req.get('x-chat-token');

  if (!verifySessionToken(sessionToken, sessionId)) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }

  if (!enforceSessionCooldown(sessionId)) {
    return res.status(429).json({ error: 'Please wait before sending another message' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store');
    const reply = await chat(sessionId, message, memory);
    return res.json({ reply });
  } catch (err) {
    console.error('Agent error:', err.message);

    if (err.status) {
      return res.status(err.status).json({ error: 'Upstream service error' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

// O chat do site envia o lead coletado pelo agente; gravamos direto no banco
// e ele aparece no painel na hora. Sem planilha, sem webhook.
app.post('/lead', leadLimiter, (req, res) => {
  const sessionValidation = validateSessionId(req.body?.sessionId);
  if (!sessionValidation.valid) {
    return res.status(400).json({ error: sessionValidation.error });
  }

  const sessionId = req.body.sessionId;
  const sessionToken = req.get('x-chat-token');
  if (!verifySessionToken(sessionToken, sessionId)) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }

  const fields = sanitizeLeadFields(req.body?.lead);
  if (!fields) {
    return res.status(400).json({ error: 'lead must be a non-empty array of { label, value }' });
  }

  const source =
    typeof req.body?.source === 'string' ? req.body.source.trim().slice(0, MAX_LEAD_FIELD_LENGTH) : undefined;

  try {
    saveLead(sessionId, fields, source);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ status: 'saved' });
  } catch (err) {
    console.error('Lead storage error:', err.message);
    return res.status(500).json({ error: 'Failed to store lead' });
  }
});

app.listen(PORT, () => {
  console.log(`site-bgsm running on port ${PORT}`);
});
