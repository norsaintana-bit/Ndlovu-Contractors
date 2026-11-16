import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const adminEmail = 'bonganimadanile@gmail.com';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const defaultContent = {
  hero_intro: 'From floor plan to final finish, we design, build and supply the pieces that bring better spaces to life.',
  about_lead: 'Ndlovu Contractors brings architectural thinking, construction know-how and a strong eye for interiors into one practical local partner.',
  about_body: 'Whether you are planning a new home, extending the one you have, or looking for the right fitted finish, we help make the next step clear.',
  services_intro: 'Clear support for the parts of a project that turn an idea into a finished space.',
  contact_intro: 'Prefer to speak directly? Reach Ndlovu Contractors by phone, WhatsApp or email.'
};
let pool;
let dbReady = false;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}
function sessionSecret() {
  return createHash('sha256').update(`${process.env.MANUS_PROJECT_ID || 'ndlovu'}:${process.env.NDLOVU_ADMIN_PASSWORD || 'runtime-session'}`).digest();
}
function makeSession(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 86400000 })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readSession(req) {
  const token = parseCookies(req).ndlovu_admin;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() && data.email === adminEmail ? data : null;
  } catch { return null; }
}
function setSession(res, token) {
  res.setHeader('Set-Cookie', `ndlovu_admin=${encodeURIComponent(token)}; Path=/; Max-Age=86400; HttpOnly; SameSite=None; Secure`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'ndlovu_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure');
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (raw.length > 1000000) throw new Error('payload_too_large');
  return raw ? JSON.parse(raw) : {};
}
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [, salt, encoded] = String(stored || '').split(':');
  if (!salt || !encoded) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
async function initDatabase() {
  const url = process.env.DATABASE_URL || process.env.DRIZZLE_DATABASE_URL;
  if (!url) return;
  pool = mysql.createPool({ uri: url, waitForConnections: true, connectionLimit: 5, ssl: url.includes('ssl') ? { rejectUnauthorized: false } : undefined });
  await pool.query(`CREATE TABLE IF NOT EXISTS ndlovu_admins (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ndlovu_enquiries (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, phone VARCHAR(80) NOT NULL, email VARCHAR(255), project VARCHAR(120) NOT NULL, location VARCHAR(180) NOT NULL, start_date VARCHAR(120), details TEXT NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'new', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(status))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ndlovu_content (content_key VARCHAR(80) PRIMARY KEY, content_value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  for (const [key, value] of Object.entries(defaultContent)) await pool.query('INSERT IGNORE INTO ndlovu_content (content_key, content_value) VALUES (?, ?)', [key, value]);
  const [admins] = await pool.query('SELECT id FROM ndlovu_admins WHERE email = ? LIMIT 1', [adminEmail]);
  if (!admins.length && process.env.NDLOVU_ADMIN_PASSWORD) {
    await pool.query('INSERT INTO ndlovu_admins (email, password_hash) VALUES (?, ?)', [adminEmail, await passwordHash(process.env.NDLOVU_ADMIN_PASSWORD)]);
    console.log(`Seeded administrator account for ${adminEmail}`);
  }
  dbReady = true;
}
async function requireAdmin(req, res) {
  if (!dbReady || !pool || !readSession(req)) { json(res, 401, { error: 'unauthorized' }); return false; }
  return true;
}
async function serveFile(pathname, res) {
  const mapped = pathname === '/manus-routes.json' ? '/public/manus-routes.json'
    : pathname === '/' ? '/index.html'
    : pathname === '/admin' ? '/admin.html'
    : pathname === '/ndlovu-logo-chrome.png' ? '/public/ndlovu-logo-chrome.png'
    : pathname.startsWith('/portfolio/') ? `/public${pathname}`
    : pathname;
  const safePath = normalize(mapped).replace(/^\.\.(\/|\\)/, '');
  try {
    const filePath = join(root, safePath);
    const file = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(file);
  } catch {
    const fallback = await readFile(join(root, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(fallback);
  }
}
async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/content') {
    if (!dbReady) return json(res, 503, { error: 'database_unavailable' });
    const [rows] = await pool.query('SELECT content_key, content_value FROM ndlovu_content');
    return json(res, 200, Object.fromEntries(rows.map(row => [row.content_key, row.content_value])));
  }
  if (req.method === 'POST' && url.pathname === '/api/enquiries') {
    if (!dbReady) return json(res, 503, { error: 'database_unavailable' });
    const data = await body(req);
    const required = ['name', 'phone', 'project', 'location', 'details'];
    if (required.some(key => !String(data[key] || '').trim())) return json(res, 400, { error: 'missing_required_fields' });
    const [result] = await pool.query('INSERT INTO ndlovu_enquiries (name, phone, email, project, location, start_date, details) VALUES (?, ?, ?, ?, ?, ?, ?)', [String(data.name).trim().slice(0, 160), String(data.phone).trim().slice(0, 80), String(data.email || '').trim().slice(0, 255) || null, String(data.project).trim().slice(0, 120), String(data.location).trim().slice(0, 180), String(data.start || '').trim().slice(0, 120) || null, String(data.details).trim().slice(0, 10000)]);
    return json(res, 201, { ok: true, id: result.insertId });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (!dbReady) return json(res, 503, { error: 'database_unavailable' });
    const data = await body(req);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const [rows] = await pool.query('SELECT email, password_hash FROM ndlovu_admins WHERE email = ? LIMIT 1', [email]);
    if (!rows.length || !(await passwordMatches(password, rows[0].password_hash))) return json(res, 401, { error: 'invalid_credentials' });
    setSession(res, makeSession(email));
    return json(res, 200, { ok: true, email });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') { clearSession(res); return json(res, 200, { ok: true }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/me') return json(res, 200, { authenticated: Boolean(dbReady && readSession(req)), email: readSession(req)?.email || null });
  if (url.pathname.startsWith('/api/admin/')) {
    if (!(await requireAdmin(req, res))) return;
    if (req.method === 'GET' && url.pathname === '/api/admin/enquiries') {
      const [rows] = await pool.query('SELECT id, name, phone, email, project, location, start_date, details, status, created_at FROM ndlovu_enquiries ORDER BY created_at DESC LIMIT 200');
      return json(res, 200, rows);
    }
    if (req.method === 'PATCH' && /^\/api\/admin\/enquiries\/\d+$/.test(url.pathname)) {
      const id = Number(url.pathname.split('/').pop());
      const data = await body(req);
      const status = ['new', 'contacted', 'completed'].includes(data.status) ? data.status : null;
      if (!status) return json(res, 400, { error: 'invalid_status' });
      await pool.query('UPDATE ndlovu_enquiries SET status = ? WHERE id = ?', [status, id]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/content') {
      const [rows] = await pool.query('SELECT content_key, content_value FROM ndlovu_content');
      return json(res, 200, Object.fromEntries(rows.map(row => [row.content_key, row.content_value])));
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/content') {
      const data = await body(req);
      for (const key of Object.keys(defaultContent)) if (typeof data[key] === 'string') await pool.query('INSERT INTO ndlovu_content (content_key, content_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE content_value = VALUES(content_value)', [key, data[key].trim().slice(0, 3000)]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/password') {
      const data = await body(req);
      if (String(data.password || '').length < 12) return json(res, 400, { error: 'password_too_short' });
      await pool.query('UPDATE ndlovu_admins SET password_hash = ? WHERE email = ?', [await passwordHash(String(data.password)), readSession(req).email]);
      return json(res, 200, { ok: true });
    }
  }
  json(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health' || url.pathname === '/_app/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveFile(url.pathname, res);
  } catch (error) {
    console.error('Request error:', error.message);
    json(res, 500, { error: 'server_error' });
  }
});

try { await initDatabase(); } catch (error) { console.error('Database initialization failed:', error.message); }
server.listen(port, '0.0.0.0', () => console.log(`Ndlovu Contractors listening on ${port}`));
