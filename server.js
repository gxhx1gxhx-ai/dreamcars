// server.js - سيرفر Dream Cars
// بدون أي مكتبات خارجية. يحتاج Node.js 18 أو أحدث.
// التشغيل:  node server.js
// ضع index.html بنفس المجلد، وبعدين افتح: http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'data.json');
const MAX_BODY = 200 * 1024;          // 200 KB كحد أقصى للطلب
const ENDLESS_FROM = 4000;            // الأوضاع اللانهائية: الأفضل = أعلى موجة

// ---------- قاعدة البيانات (ملف JSON بسيط) ----------
let db = { scores: {}, saves: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* أول تشغيل */ }
db.scores = db.scores || {};
db.saves = db.saves || {};

let dirty = false;
function save() { dirty = true; }
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(DATA_FILE, JSON.stringify(db), (err) => {
    if (err) console.error('save error:', err.message);
  });
}, 1500);

// ---------- أدوات مساعدة ----------
const cleanName = (s) => String(s || '').replace(/[<>&"'`]/g, '').trim().slice(0, 20);
const cleanId = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
const cleanCar = (s) => String(s || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 30);

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

// ---------- الدرجات ----------
// يحفظ أفضل نتيجة لكل لاعب في كل مرحلة.
// المراحل العادية: أقل وقت هو الأفضل. الأوضاع اللانهائية: أعلى موجة هي الأفضل.
function submitScore(b) {
  const id = cleanId(b.id);
  const name = cleanName(b.name);
  const level = Math.floor(+b.level);
  const time = +b.time;
  const stars = Math.min(3, Math.max(0, Math.floor(+b.stars) || 0));
  const car = cleanCar(b.car);

  if (!id || !name || !(level > 0) || !isFinite(time) || time < 0) {
    return { error: 'bad data' };
  }

  const endless = level >= ENDLESS_FROM;
  const lv = (db.scores[level] = db.scores[level] || {});
  const old = lv[id];
  const better = !old || (endless ? time > old.time : time < old.time);

  if (!old) {
    lv[id] = { name, time, stars, car, updated: Date.now() };
  } else {
    lv[id].name = name;                       // آخر اسم يظهر
    lv[id].stars = Math.max(old.stars || 0, stars);
    if (better) {
      lv[id].time = time;
      lv[id].car = car;
    }
    lv[id].updated = Date.now();
  }
  save();
  return { ok: true, best: better, rank: rankOf(level, id) };
}

function rankOf(level, id) {
  const endless = level >= ENDLESS_FROM;
  const arr = Object.values(db.scores[level] || {});
  arr.sort((a, b) => (endless ? b.time - a.time : a.time - b.time));
  return arr.indexOf(db.scores[level][id]) + 1;
}

function topLevel(level, limit) {
  const endless = level >= ENDLESS_FROM;
  const entries = Object.values(db.scores[level] || {}).map((e) => ({
    name: e.name, time: e.time, stars: e.stars, car: e.car,
  }));
  entries.sort((a, b) => (endless ? b.time - a.time : a.time - b.time));
  return entries.slice(0, limit);
}

// مجموع النجوم لكل لاعب (المراحل العادية فقط)
function topStars(limit) {
  const totals = {};
  for (const lvl of Object.keys(db.scores)) {
    if (+lvl >= ENDLESS_FROM) continue;
    for (const [id, e] of Object.entries(db.scores[lvl])) {
      if (!totals[id]) totals[id] = { name: e.name, stars: 0 };
      totals[id].name = e.name;
      totals[id].stars += e.stars || 0;
    }
  }
  return Object.values(totals)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit);
}

// ---------- حفظ السحابة بكود قصير ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do {
    c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (db.saves[c]);
  return c;
}

// ---------- الملفات الثابتة ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.woff2': 'font/woff2',
};
const HIDDEN = new Set(['server.js', 'data.json', 'package.json']);

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(DIR, rel));
  if (!file.startsWith(DIR + path.sep) || HIDDEN.has(path.basename(file))) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- السيرفر ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  try {
    // POST /api/score
    if (p === '/api/score' && req.method === 'POST') {
      const out = submitScore(await readBody(req));
      return send(res, out.error ? 400 : 200, out);
    }

    // GET /api/top?level=2001&limit=20
    if (p === '/api/top' && req.method === 'GET') {
      const level = Math.floor(+url.searchParams.get('level'));
      const limit = Math.min(100, Math.max(1, +url.searchParams.get('limit') || 20));
      if (!(level > 0)) return send(res, 400, { error: 'bad level' });
      return send(res, 200, { level, top: topLevel(level, limit) });
    }

    // GET /api/stars?limit=20
    if (p === '/api/stars' && req.method === 'GET') {
      const limit = Math.min(100, Math.max(1, +url.searchParams.get('limit') || 20));
      return send(res, 200, { top: topStars(limit) });
    }

    // POST /api/save  -> { code }
    if (p === '/api/save' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body || typeof body.data !== 'object') return send(res, 400, { error: 'bad data' });
      const code = newCode();
      db.saves[code] = { data: body.data, created: Date.now() };
      save();
      return send(res, 200, { code });
    }

    // GET /api/save?code=ABC123  -> { data }
    if (p === '/api/save' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const rec = db.saves[code];
      if (!rec) return send(res, 404, { error: 'not found' });
      return send(res, 200, { data: rec.data });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });

    if (req.method === 'GET') return serveStatic(req, res, p);
    res.writeHead(405); res.end();
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Dream Cars server running on http://localhost:${PORT}`);
});
