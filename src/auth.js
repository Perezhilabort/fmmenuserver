import crypto from 'node:crypto';

// Простой вход: логин и пароль лежат в .env (ADMIN_USER, ADMIN_PASSWORD).
// После входа выдаётся подписанный токен на 12 часов. Он не хранится в памяти,
// поэтому переживает перезапуск сервера.
const TTL_MS = 12 * 60 * 60 * 1000;

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function login(req, res) {
  const { username = '', password = '' } = req.body || {};
  const user = process.env.ADMIN_USER || '';
  const pass = process.env.ADMIN_PASSWORD || '';
  const userOk = safeEqual(username, user);
  const passOk = safeEqual(password, pass);

  if (!user || !pass || !userOk || !passOk) {
    // небольшая пауза затрудняет подбор пароля
    return setTimeout(() => res.status(401).json({ error: 'Неверный логин или пароль' }), 600);
  }
  const expires = String(Date.now() + TTL_MS);
  res.json({ token: `${expires}.${sign(expires)}`, expiresAt: Number(expires) });
}

export function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [expires, signature] = token.split('.');

  if (secret() && expires && signature && Number(expires) > Date.now() && safeEqual(signature, sign(expires))) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}
