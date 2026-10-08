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
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

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

function getShares() { return readJSON(SHARES_FILE, {}); }
function saveShares(s) { writeJSON(SHARES_FILE, s); }

/** Обновить индекс публичных ссылок для пользователя */
function rebuildSharedInboxFromOwner(ownerId, cols, prevCols) {
  var affected = {};
  function markMembers(list) {
    (list || []).forEach(function (col) {
      (col.sharedWith || []).forEach(function (m) {
        if (m && m.userId) affected[m.userId] = true;
      });
    });
  }
  markMembers(prevCols);
  markMembers(cols);

  var currentByMember = {};
  (cols || []).forEach(function (col) {
    (col.sharedWith || []).forEach(function (m) {
      if (!m || !m.userId) return;
      if (!currentByMember[m.userId]) currentByMember[m.userId] = [];
      currentByMember[m.userId].push(col.id);
    });
  });

  Object.keys(affected).forEach(function (memberId) {
    var inbox = readJSON(userFile(memberId, 'shared_inbox'), []);
    inbox = inbox.filter(function (e) { return e.ownerId !== ownerId; });
    (currentByMember[memberId] || []).forEach(function (collectionId) {
      inbox.push({ ownerId: ownerId, collectionId: collectionId });
    });
    writeJSON(userFile(memberId, 'shared_inbox'), inbox);
  });
}

function updateSharesForUser(userId, cols) {
  var shares = getShares();
  Object.keys(shares).forEach(function (sid) {
    if (shares[sid] && shares[sid].userId === userId) delete shares[sid];
  });
  (cols || []).forEach(function (col) {
    if (col && col.isPublic && col.shareId) {
      shares[col.shareId] = { userId: userId, collectionId: col.id, name: col.name || '' };
    }
  });
  saveShares(shares);
}


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

    // Редактирование профиля
    if (p === '/api/me' && req.method === 'PUT') {
      var authMe = getAuthUser(req);
      if (!authMe) return send(res, 401, { error: 'Не авторизован' });
      var bodyMe = await parseBody(req);
      var usersMe = getUsers();
      var idxMe = usersMe.findIndex(function (u) { return u.id === authMe.id; });
      if (idxMe === -1) return send(res, 404, { error: 'Пользователь не найден' });
      if (bodyMe.name && String(bodyMe.name).trim()) {
        usersMe[idxMe].name = String(bodyMe.name).trim();
      }
      if (bodyMe.email) {
        var emailNew = String(bodyMe.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNew)) {
          return send(res, 400, { error: 'Некорректный email' });
        }
        if (usersMe.some(function (u, i) { return i !== idxMe && u.email === emailNew; })) {
          return send(res, 400, { error: 'Этот email уже занят' });
        }
        usersMe[idxMe].email = emailNew;
      }
      saveUsers(usersMe);
      return send(res, 200, {
        user: { id: usersMe[idxMe].id, name: usersMe[idxMe].name, email: usersMe[idxMe].email }
      });
    }

    // Смена пароля
    if (p === '/api/me/password' && req.method === 'PUT') {
      var authPw = getAuthUser(req);
      if (!authPw) return send(res, 401, { error: 'Не авторизован' });
      var bodyPw = await parseBody(req);
      var cur = bodyPw.currentPassword || '';
      var neu = bodyPw.newPassword || '';
      if (!cur || !neu) return send(res, 400, { error: 'Заполните все поля' });
      if (String(neu).length < 4) return send(res, 400, { error: 'Новый пароль минимум 4 символа' });
      var usersPw = getUsers();
      var idxPw = usersPw.findIndex(function (u) { return u.id === authPw.id; });
      if (idxPw === -1) return send(res, 404, { error: 'Пользователь не найден' });
      var uPw = usersPw[idxPw];
      if (!verifyPassword(cur, uPw.salt, uPw.hash)) {
        return send(res, 401, { error: 'Неверный текущий пароль' });
      }
      var hpPw = hashPassword(neu);
      usersPw[idxPw].salt = hpPw.salt;
      usersPw[idxPw].hash = hpPw.hash;
      saveUsers(usersPw);
      return send(res, 200, { ok: true, message: 'Пароль изменён' });
    }

    // Поиск пользователя по email (для шаринга)
    if (p === '/api/users/lookup' && req.method === 'GET') {
      var authLu = getAuthUser(req);
      if (!authLu) return send(res, 401, { error: 'Не авторизован' });
      var emailLu = (url.searchParams.get('email') || '').trim().toLowerCase();
      if (!emailLu) return send(res, 400, { error: 'Укажите email' });
      var found = getUsers().find(function (u) { return u.email === emailLu; });
      if (!found) return send(res, 404, { error: 'Пользователь не найден' });
      if (found.id === authLu.id) return send(res, 400, { error: 'Нельзя добавить самого себя' });
      return send(res, 200, { user: { id: found.id, name: found.name, email: found.email } });
    }

    // Подборки, которыми поделились со мной
    if (p === '/api/shared-with-me' && req.method === 'GET') {
      var authSw = getAuthUser(req);
      if (!authSw) return send(res, 401, { error: 'Не авторизован' });
      var inbox = readJSON(userFile(authSw.id, 'shared_inbox'), []);
      var result = [];
      inbox.forEach(function (entry) {
        var cols = readJSON(userFile(entry.ownerId, 'collections'), []);
        var col = cols.find(function (c) { return c.id === entry.collectionId; });
        if (!col) return;
        var still = (col.sharedWith || []).some(function (m) { return m.userId === authSw.id; });
        if (!still) return;
        var owner = getUsers().find(function (u) { return u.id === entry.ownerId; });
        result.push({
          collectionId: col.id,
          name: col.name,
          ownerId: entry.ownerId,
          ownerName: owner ? owner.name : 'Пользователь',
          ownerEmail: owner ? owner.email : '',
          itemCount: (col.itemIds || []).length,
          updatedAt: col.updatedAt || col.createdAt || null
        });
      });
      return send(res, 200, result);
    }

    // Просмотр чужой закрытой общей подборки
    if (p.indexOf('/api/shared-collection/') === 0 && req.method === 'GET') {
      var authSc = getAuthUser(req);
      if (!authSc) return send(res, 401, { error: 'Не авторизован' });
      // /api/shared-collection/:ownerId/:collectionId
      var partsSc = p.split('/');
      var ownerId = partsSc[3];
      var colIdSc = partsSc[4];
      if (!ownerId || !colIdSc) return send(res, 400, { error: 'Некорректный запрос' });
      var colsSc = readJSON(userFile(ownerId, 'collections'), []);
      var colSc = colsSc.find(function (c) { return c.id === colIdSc; });
      if (!colSc) return send(res, 404, { error: 'Подборка не найдена' });
      var allowed = (colSc.sharedWith || []).some(function (m) { return m.userId === authSc.id; });
      if (!allowed && ownerId !== authSc.id) {
        return send(res, 403, { error: 'Нет доступа к этой подборке' });
      }
      var itemsSc = readJSON(userFile(ownerId, 'items'), []);
      var listSc = (colSc.itemIds || []).map(function (id) {
        return itemsSc.find(function (i) { return i.id === id; });
      }).filter(Boolean).map(function (i) {
        return {
          id: i.id,
          title: i.title,
          originalTitle: i.originalTitle,
          type: i.type,
          year: i.year,
          genres: i.genres,
          overview: i.overview,
          poster: i.poster,
          rating: i.rating,
          dataSource: i.dataSource,
          kinopoiskId: i.kinopoiskId,
          tmdbId: i.tmdbId
        };
      });
      var ownerSc = getUsers().find(function (u) { return u.id === ownerId; });
      return send(res, 200, {
        name: colSc.name,
        ownerName: ownerSc ? ownerSc.name : '',
        items: listSc
      });
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
      var prevCols = readJSON(userFile(auth6.id, 'collections'), []);
      writeJSON(userFile(auth6.id, 'collections'), body5);
      updateSharesForUser(auth6.id, body5);
      rebuildSharedInboxFromOwner(auth6.id, body5, prevCols);
      return send(res, 200, { ok: true });
    }

    // Публичная подборка по ссылке (без авторизации)
    if (p.indexOf('/api/public/collection/') === 0 && req.method === 'GET') {
      var shareId = p.split('/').pop();
      if (!shareId || shareId.length < 6) return send(res, 400, { error: 'Некорректная ссылка' });
      var shares = getShares();
      var meta = shares[shareId];
      if (!meta) return send(res, 404, { error: 'Подборка не найдена или закрыта' });
      var cols = readJSON(userFile(meta.userId, 'collections'), []);
      var col = cols.find(function (c) { return c.id === meta.collectionId; });
      if (!col || !col.isPublic || col.shareId !== shareId) {
        return send(res, 404, { error: 'Подборка не найдена или закрыта' });
      }
      var allItems = readJSON(userFile(meta.userId, 'items'), []);
      var pubItems = (col.itemIds || []).map(function (id) {
        return allItems.find(function (i) { return i.id === id; });
      }).filter(Boolean).map(function (i) {
        return {
          id: i.id,
          title: i.title,
          originalTitle: i.originalTitle,
          type: i.type,
          year: i.year,
          genres: i.genres,
          overview: i.overview,
          poster: i.poster,
          rating: i.rating,
          dataSource: i.dataSource,
          kinopoiskId: i.kinopoiskId,
          tmdbId: i.tmdbId,
          kpRating: i.kpRating
        };
      });
      return send(res, 200, {
        name: col.name,
        shareId: col.shareId,
        itemCount: pubItems.length,
        items: pubItems
      });
    }


    // ----- Kinopoisk proxy (ключ только на сервере) -----
    if (p === '/api/kp/search' && req.method === 'GET') {
      var kpKey = process.env.KP_API_KEY || process.env.KINOPOISK_API_KEY || '';
      if (!kpKey || kpKey === 'ВАШ_КЛЮЧ_КИНОПОИСК') {
        return send(res, 401, { error: 'Ключ Кинопоиска не задан на сервере. Укажите переменную окружения KP_API_KEY на Render (или в .env).' });
      }
      var keyword = url.searchParams.get('keyword') || '';
      var page = url.searchParams.get('page') || '1';
      if (!keyword.trim()) return send(res, 400, { error: 'Пустой запрос' });
      try {
        var kpUrl = 'https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=' +
          encodeURIComponent(keyword) + '&page=' + encodeURIComponent(page);
        var kpRes = await fetch(kpUrl, {
          headers: { 'X-API-KEY': kpKey.trim(), 'Accept': 'application/json' }
        });
        var text = await kpRes.text();
        var body;
        try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
        if (!kpRes.ok) {
          var msg = (body && body.message) || text || ('HTTP ' + kpRes.status);
          if (kpRes.status === 401) msg = 'Неверный API-ключ Кинопоиска (401). Проверьте KP_API_KEY на сервере.';
          return send(res, kpRes.status, { error: msg, status: kpRes.status });
        }
        return send(res, 200, body);
      } catch (e) {
        console.error('[kp]', e);
        return send(res, 502, { error: 'Не удалось связаться с API Кинопоиска: ' + e.message });
      }
    }

    if (p.indexOf('/api/kp/film/') === 0 && req.method === 'GET') {
      var kpKey2 = process.env.KP_API_KEY || process.env.KINOPOISK_API_KEY || '';
      if (!kpKey2 || kpKey2 === 'ВАШ_КЛЮЧ_КИНОПОИСК') {
        return send(res, 401, { error: 'Ключ Кинопоиска не задан на сервере (KP_API_KEY).' });
      }
      var parts = p.split('/'); // ['', 'api', 'kp', 'film', id, optional]
      var filmId = parts[4];
      var sub = parts[5] || ''; // seasons | staff | ''
      if (!filmId || !/^\d+$/.test(filmId)) return send(res, 400, { error: 'Некорректный id фильма' });
      var pathKp = 'https://kinopoiskapiunofficial.tech/api/v2.2/films/' + filmId;
      if (sub === 'seasons') pathKp += '/seasons';
      else if (sub === 'staff') pathKp = 'https://kinopoiskapiunofficial.tech/api/v1/staff?filmId=' + filmId;
      try {
        var kpRes2 = await fetch(pathKp, {
          headers: { 'X-API-KEY': kpKey2.trim(), 'Accept': 'application/json' }
        });
        var text2 = await kpRes2.text();
        var body2;
        try { body2 = JSON.parse(text2); } catch (_) { body2 = { raw: text2 }; }
        if (!kpRes2.ok) {
          var msg2 = (body2 && body2.message) || ('HTTP ' + kpRes2.status);
          if (kpRes2.status === 401) msg2 = 'Неверный API-ключ Кинопоиска (401).';
          return send(res, kpRes2.status, { error: msg2 });
        }
        return send(res, 200, body2);
      } catch (e2) {
        console.error('[kp]', e2);
        return send(res, 502, { error: e2.message });
      }
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
