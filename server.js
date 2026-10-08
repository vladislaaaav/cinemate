/**
 * Cinemate API Server — автономный сервер
 * Хранит аккаунты и библиотеки пользователей на диске (папка data/)
 *
 * Запуск:
 *   node server.js
 *   PORT=3000 HOST=0.0.0.0 node server.js
 *   DATA_DIR=/var/cinemate/data node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[data] Создана папка:', DATA_DIR);
  }
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]\n');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}\n');
}

ensureDataDir();

// ----- надёжная запись на диск (atomic) -----
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  const json = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, file); // atomic на большинстве FS
}

function userFile(userId, name) {
  // только безопасные символы в имени файла
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, safe + '_' + name + '.json');
}

function getUsers() { return readJSON(USERS_FILE, []); }
function saveUsers(u) { writeJSON(USERS_FILE, u); }
function getSessions() { return readJSON(SESSIONS_FILE, {}); }
function saveSessions(s) { writeJSON(SESSIONS_FILE, s); }

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, data, contentType) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': contentType || 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise(function (resolve, reject) {
    var data = '';
    req.on('data', function (chunk) {
      data += chunk;
      if (data.length > 15e6) reject(new Error('Body too large'));
    });
    req.on('end', function () {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  var h = req.headers.authorization || '';
  var t = h.indexOf('Bearer ') === 0 ? h.slice(7) : null;
  if (!t) return null;
  var userId = getSessions()[t];
  if (!userId) return null;
  var user = getUsers().find(function (u) { return u.id === userId; });
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, token: t };
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  var url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  var p = url.pathname;

  try {
    if (p === '/api/health' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        time: new Date().toISOString(),
        users: getUsers().length,
        dataDir: DATA_DIR
      });
    }

    if (p === '/api/register' && req.method === 'POST') {
      var body = await parseBody(req);
      var name = body.name, email = body.email, password = body.password;
      if (!name || !email || !password) return send(res, 400, { error: 'Заполните все поля' });
      if (String(password).length < 4) return send(res, 400, { error: 'Пароль минимум 4 символа' });
      var emailNorm = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return send(res, 400, { error: 'Некорректный email' });
      }
      var users = getUsers();
      if (users.some(function (u) { return u.email === emailNorm; })) {
        return send(res, 400, { error: 'Этот email уже зарегистрирован' });
      }
      var id = 'user_' + uuid();
      var hp = hashPassword(password);
      var user = {
        id: id,
        name: String(name).trim(),
        email: emailNorm,
        salt: hp.salt,
        hash: hp.hash,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      saveUsers(users);
      writeJSON(userFile(id, 'items'), []);
      writeJSON(userFile(id, 'collections'), []);

      var t = makeToken();
      var sessions = getSessions();
      sessions[t] = id;
      saveSessions(sessions);

      console.log('[auth] Регистрация:', emailNorm);
      return send(res, 200, { token: t, user: { id: id, name: user.name, email: user.email } });
    }

    if (p === '/api/login' && req.method === 'POST') {
      var body2 = await parseBody(req);
      var emailNorm2 = String(body2.email || '').trim().toLowerCase();
      var password2 = body2.password || '';
      var users2 = getUsers();
      var user2 = users2.find(function (u) { return u.email === emailNorm2; });
      if (!user2 || !verifyPassword(password2, user2.salt, user2.hash)) {
        return send(res, 401, { error: 'Неверный email или пароль' });
      }
      var t2 = makeToken();
      var sessions2 = getSessions();
      sessions2[t2] = user2.id;
      saveSessions(sessions2);
      console.log('[auth] Вход:', emailNorm2);
      return send(res, 200, {
        token: t2,
        user: { id: user2.id, name: user2.name, email: user2.email }
      });
    }

    if (p === '/api/reset-password' && req.method === 'POST') {
      var body3 = await parseBody(req);
      var emailNorm3 = String(body3.email || '').trim().toLowerCase();
      var password3 = body3.password || '';
      if (!emailNorm3 || !password3) return send(res, 400, { error: 'Заполните все поля' });
      if (password3.length < 4) return send(res, 400, { error: 'Пароль минимум 4 символа' });
      var users3 = getUsers();
      var idx = users3.findIndex(function (u) { return u.email === emailNorm3; });
      if (idx === -1) return send(res, 404, { error: 'Аккаунт с таким email не найден' });
      var hp3 = hashPassword(password3);
      users3[idx].salt = hp3.salt;
      users3[idx].hash = hp3.hash;
      saveUsers(users3);
      console.log('[auth] Сброс пароля:', emailNorm3);
      return send(res, 200, { ok: true, message: 'Пароль успешно изменён' });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      var auth = getAuthUser(req);
      if (auth) {
        var sessions3 = getSessions();
        delete sessions3[auth.token];
        saveSessions(sessions3);
      }
      return send(res, 200, { ok: true });
    }

    if (p === '/api/me' && req.method === 'GET') {
      var auth2 = getAuthUser(req);
      if (!auth2) return send(res, 401, { error: 'Не авторизован' });
      return send(res, 200, { user: { id: auth2.id, name: auth2.name, email: auth2.email } });
    }

    if (p === '/api/items' && req.method === 'GET') {
      var auth3 = getAuthUser(req);
      if (!auth3) return send(res, 401, { error: 'Не авторизован' });
      return send(res, 200, readJSON(userFile(auth3.id, 'items'), []));
    }

    if (p === '/api/items' && req.method === 'PUT') {
      var auth4 = getAuthUser(req);
      if (!auth4) return send(res, 401, { error: 'Не авторизован' });
      var body4 = await parseBody(req);
      if (!Array.isArray(body4)) return send(res, 400, { error: 'Ожидается массив' });
      writeJSON(userFile(auth4.id, 'items'), body4);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/collections' && req.method === 'GET') {
      var auth5 = getAuthUser(req);
      if (!auth5) return send(res, 401, { error: 'Не авторизован' });
      return send(res, 200, readJSON(userFile(auth5.id, 'collections'), []));
    }

    if (p === '/api/collections' && req.method === 'PUT') {
      var auth6 = getAuthUser(req);
      if (!auth6) return send(res, 401, { error: 'Не авторизован' });
      var body5 = await parseBody(req);
      if (!Array.isArray(body5)) return send(res, 400, { error: 'Ожидается массив' });
      writeJSON(userFile(auth6.id, 'collections'), body5);
      return send(res, 200, { ok: true });
    }

    // Статика (фронтенд)
    var rel = p === '/' ? 'index.html' : p;
    var filePath = path.normalize(path.join(__dirname, rel));
    if (!filePath.startsWith(__dirname)) return send(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      var ext = path.extname(filePath).toLowerCase();
      var content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(content);
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('[error]', e);
    send(res, 500, { error: e.message || 'Ошибка сервера' });
  }
}

const server = http.createServer(function (req, res) {
  handle(req, res);
});

server.listen(PORT, HOST, function () {
  console.log('========================================');
  console.log('  Cinemate Server (автономный режим)');
  console.log('  http://' + (HOST === '0.0.0.0' ? '127.0.0.1' : HOST) + ':' + PORT);
  console.log('  Данные: ' + DATA_DIR);
  console.log('========================================');
});

function shutdown() {
  console.log('\n[server] Остановка...');
  server.close(function () {
    console.log('[server] Остановлен. Данные сохранены в', DATA_DIR);
    process.exit(0);
  });
  setTimeout(function () { process.exit(0); }, 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
