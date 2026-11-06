// DCS-5030L Viewer: servidor local.
//
// Sirve el visor (visor-camara.html) y hace de intermediario con la cámara:
//   /cam/*        → se reenvía a la cámara añadiendo la autenticación (vídeo, audio, CGI…)
//   /api/form/X   → lee (GET) o guarda (POST, JSON) un formulario de ajustes de la cámara
//   /api/info     → información del dispositivo y hora de la cámara
//   /api/calibration, /api/panorama → datos del visor guardados en ./datos
//
// Uso:  node servidor-camara.js [--open] [--config] [--port N]
//   --open    abre el navegador al arrancar
//   --config  vuelve a pedir IP, usuario y contraseña
//   --port N  puerto local (por defecto 8099)
//
// La contraseña se guarda en camara.json cifrada con la protección de datos de Windows (DPAPI),
// que solo puede descifrar tu usuario de Windows en este equipo. En otros sistemas se guarda sin cifrar.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');

const VERSION = '2.0.0';
const DIR = __dirname;
const CONFIG = path.join(DIR, 'camara.json');
const DATA_DIR = path.join(DIR, 'datos');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const PORT = +(arg('--port') || process.env.PORT || 8099);
// Solo para desarrollo: encadena con otro servidor del visor que ya añade la autenticación.
const UPSTREAM = arg('--upstream');

// ───────────────────────── Credenciales ─────────────────────────

// DPAPI mediante Windows PowerShell 5.1 (incluye System.Security.Cryptography.ProtectedData).
// El secreto viaja por stdin, nunca en la línea de comandos.
function dpapi(op, input) {
  const ps = `Add-Type -AssemblyName System.Security; $i = [Console]::In.ReadToEnd().Trim();` +
    (op === 'protect'
      ? `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($i), $null, 'CurrentUser'))`
      : `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i), $null, 'CurrentUser'))`);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error((r.stderr || 'DPAPI no disponible').trim().split('\n')[0]);
  return r.stdout.replace(/\r?\n$/, '');
}
const canDpapi = process.platform === 'win32';

function readConfig() {
  const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (c.passDpapi) c.pass = dpapi('unprotect', c.passDpapi);
  return c;
}
function writeConfig(c) {
  const out = { host: c.host, user: c.user };
  if (canDpapi) {
    try { out.passDpapi = dpapi('protect', c.pass); }
    catch (e) { console.log('Aviso: no se pudo cifrar la contraseña (' + e.message + '); se guarda sin cifrar.'); out.pass = c.pass; }
  } else out.pass = c.pass;
  fs.writeFileSync(CONFIG, JSON.stringify(out, null, 2));
}

function ask(q, hidden) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = s => {
        if (s.includes(q)) rl.output.write(s.slice(0, s.indexOf(q) + q.length) + '*'.repeat(rl.line.length));
        else if (!/[\r\n]/.test(s)) rl.output.write('*'.repeat(s.length));
      };
    }
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a.trim()); });
  });
}

async function askConfig(prev = {}) {
  console.log('Datos de acceso a la cámara (se guardan en camara.json' + (canDpapi ? ', con la contraseña cifrada' : '') + ').');
  const dh = prev.host || '192.168.1.10:8010', du = prev.user || 'admin';
  const host = ((await ask(`IP:puerto de la cámara [${dh}]: `)) || dh).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const user = (await ask(`Usuario (admin para poder mover la cámara) [${du}]: `)) || du;
  const pass = await ask('Contraseña (no se muestra al escribir): ', true);
  return { host, user, pass };
}

function testCredentials(cfg) {
  const [h, p = '80'] = cfg.host.split(':');
  return new Promise(res => {
    const r = http.get({ host: h, port: +p, path: '/image/jpeg.cgi', timeout: 5000,
      headers: { Authorization: 'Basic ' + Buffer.from(cfg.user + ':' + cfg.pass).toString('base64') } },
      x => { x.resume(); res(x.statusCode); });
    r.on('timeout', () => r.destroy(new Error('sin respuesta')));
    r.on('error', e => res('error: ' + e.message));
  });
}

async function loadConfig() {
  if (UPSTREAM) return { host: 'upstream', user: '-', pass: '' };
  let cfg, fresh = false;
  if (!process.argv.includes('--config') && fs.existsSync(CONFIG)) {
    try { cfg = readConfig(); }
    catch (e) { console.log('No se pudo leer camara.json (' + e.message + ').'); }
  }
  if (!cfg) { cfg = await askConfig(); fresh = true; }
  while (true) {
    process.stdout.write(`Comprobando acceso a ${cfg.host} como "${cfg.user}"... `);
    const code = await testCredentials(cfg);
    if (code === 200) { console.log('OK'); break; }
    console.log(code === 401 ? 'la cámara RECHAZA el usuario o la contraseña.' : `no se pudo comprobar (${code}).`);
    if (/^n/i.test(await ask('¿Volver a introducir los datos? [S/n]: '))) break;
    cfg = await askConfig(cfg); fresh = true;
  }
  // Guarda si son datos nuevos o si había una contraseña sin cifrar (migración).
  const raw = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')) : {};
  if (fresh || (canDpapi && raw.pass !== undefined)) writeConfig(cfg);
  return cfg;
}

// ───────────────────────── Acceso a la cámara ─────────────────────────
//
// El servidor web de la cámara (alphapd) tiene varias particularidades (ver api-dcs5030l.md):
//  · CGI estándar → Basic (realm NIPCA). Web de configuración → Digest.
//  · Los formularios responden 403 si ven Basic: hay que pedir sin credenciales para obtener el desafío Digest.
//  · Las páginas exigen un Referer propio, y los formularios, el de su propia página.

let cfg, camHost, camPort, basicAuth, nc = 0;

function digest(chal, method, uri) {
  const p = {};
  chal.replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (_, k, v, q) => { p[k] = q !== undefined ? q : v; });
  const md5 = s => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${cfg.user}:${p.realm}:${cfg.pass}`), ha2 = md5(`${method}:${uri}`);
  const qop = (p.qop || '').split(',').map(s => s.trim()).includes('auth') ? 'auth' : '';
  const ncs = (++nc).toString(16).padStart(8, '0'), cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop ? md5(`${ha1}:${p.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${cfg.user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"`;
  if (qop) h += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  if (p.algorithm) h += `, algorithm=${p.algorithm}`;
  return h;
}

// La cámara admite muy pocas conexiones simultáneas: sin keep-alive (no dejar conexiones ociosas
// ocupando huecos) y, salvo los streams continuos, como mucho 2 peticiones a la vez (el resto espera).
const camAgent = new http.Agent({ keepAlive: false });
const STREAM = /^\/(video|audio|mjpeg|h264)|\.(mpt)$|^\/video\.cgi/;
let active = 0; const queue = [];
function slot(fn) {
  return new Promise(resolve => {
    const run = () => { active++; let done = false; fn(() => { if (!done) { done = true; active--; const n = queue.shift(); if (n) n(); } }); resolve(); };
    active < 2 ? run() : queue.push(run);
  });
}

// Hace una petición a la cámara resolviendo la autenticación. Llama a onResponse(res) con la
// respuesta definitiva (sin consumir). Devuelve una función para abortar.
function camRequest(opts, onResponse, onError) {
  if (STREAM.test(opts.path || '')) return camRequestRaw(opts, onResponse, onError);
  let abort = () => {}, aborted = false;
  slot(release => {
    if (aborted) return release();
    abort = camRequestRaw(opts, (res, stage) => { res.on('end', release); res.on('close', release); res.on('error', release); onResponse(res, stage); },
      e => { release(); onError(e); });
  });
  return () => { aborted = true; abort(); };
}
function camRequestRaw({ method = 'GET', path: camPath, body = Buffer.alloc(0), contentType, referer = '/' }, onResponse, onError) {
  let current;
  const send = (authorization, stage) => {
    let opts;
    if (UPSTREAM) {
      const u = new URL(UPSTREAM);
      opts = { host: u.hostname, port: +u.port, method, path: u.pathname.replace(/\/$/, '') + camPath,
        headers: { Referer: `${UPSTREAM.replace(/\/$/, '')}${referer}` } };
    } else {
      opts = { host: camHost, port: camPort, method, path: camPath, headers: { Referer: `http://${cfg.host}${referer}` } };
      if (authorization) opts.headers.Authorization = authorization;
    }
    if (contentType) opts.headers['Content-Type'] = contentType;
    if (body.length) opts.headers['Content-Length'] = body.length;
    opts.agent = camAgent; opts.headers.Connection = 'close';
    current = http.request(opts, res => {
      const chal = res.headers['www-authenticate'] || '';
      if (!UPSTREAM && res.statusCode === 401 && stage !== 'final' && /^Digest/i.test(chal)) { res.resume(); return send(digest(chal, method, camPath), 'final'); }
      if (!UPSTREAM && res.statusCode === 403 && stage === 'basic') { res.resume(); return send(null, 'probe'); }
      onResponse(res, stage);
    });
    current.setTimeout(15000, () => current.destroy(new Error('la cámara no responde')));
    current.on('error', onError);
    current.end(body);
  };
  send(basicAuth, 'basic');
  return () => current && current.destroy();
}

// Versión con promesa que devuelve el cuerpo completo (texto latin1, como sirve la cámara).
function camFetch(opts) {
  return new Promise((resolve, reject) => {
    camRequest(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('latin1') }));
      res.on('error', reject);
    }, reject);
  });
}

// ───────────────────────── Formularios de ajustes ─────────────────────────

// Lista blanca: solo estos formularios se pueden leer o guardar desde el visor.
// (No se incluyen los de usuarios/contraseñas, Wi-Fi, correo, FTP ni firmware.)
const FORMS = {
  image:   { page: '/image.htm',    action: '/setSystemStream' },
  video:   { page: '/video.htm',    action: '/setSystemStream' },
  audio:   { page: '/audio.htm',    action: '/setSystemStream' },
  night:   { page: '/night.htm',    action: '/setDayNightMode' },
  motion:  { page: '/motion.htm',   action: '/setSystemMotion' },
  sound:   { page: '/sounddb.htm',  action: '/setSystemSoundDB' },
  control: { page: '/advanced.htm', action: '/setSystemControl' },
  privacy: { page: '/advanced.htm', action: '/setSystemPrivacy' },
  time:    { page: '/time.htm',     action: '/setSystemDate' },
  reboot:  { page: '/file.htm',     action: '/setSystemReboot', noVerify: true },
};
const SECRET = /pass|key|psk/i; // nunca se devuelven ni se aceptan

const attr = (a, n) => {
  const m = a.match(new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/\s+/g, ' ').trim();

// Extrae de una página el formulario con la acción indicada: campos con su valor actual (los campos
// ocultos llevan el valor vigente) y las opciones de todos los desplegables de la página.
function parseForm(html, action) {
  const fm = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(m => (attr(m[1], 'action') || '').toLowerCase() === action.toLowerCase());
  if (!fm) return null;
  const fields = {}, order = [];
  for (const m of fm[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>|<(input|textarea)\b([^>]*)>/gi)) {
    if (m[1] !== undefined) {
      const n = attr(m[1], 'name'); if (!n) continue;
      const sel = [...m[2].matchAll(/<option\b([^>]*)>/gi)].find(o => /\bselected\b/i.test(o[1])) || m[2].match(/<option\b([^>]*)>/i);
      if (!(n in fields)) order.push(n);
      fields[n] = sel ? attr(sel[1], 'value') ?? '' : '';
      continue;
    }
    const a = m[4], n = attr(a, 'name'); if (!n) continue;
    const t = (attr(a, 'type') || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'file'].includes(t)) continue;
    if (!(n in fields)) { order.push(n); fields[n] = (t === 'radio' || t === 'checkbox') ? null : ''; }
    if (t === 'radio' || t === 'checkbox') { if (/\bchecked\b/i.test(a)) fields[n] = attr(a, 'value') ?? 'on'; }
    else fields[n] = attr(a, 'value') ?? '';
  }
  const options = {};
  for (const s of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const id = attr(s[1], 'name') || attr(s[1], 'id'); if (!id) continue;
    options[id] = [...s[2].matchAll(/<option\b([^>]*)>([^<]*)/gi)].map(o => [attr(o[1], 'value') ?? strip(o[2]), strip(o[2])]);
  }
  // Mensaje de error/éxito que muestra la cámara tras guardar.
  const msg = (html.match(/RESPONDER AL MENSAJE[\s\S]*?<\/table>/i) || [''])[0];
  return { fields, order, options, message: msg ? strip(msg.replace(/RESPONDER AL MENSAJE/i, '')) : '' };
}

const publicFields = f => Object.fromEntries(Object.entries(f).filter(([k]) => !SECRET.test(k) && k !== 'SessionKey'));

async function readForm(key) {
  const def = FORMS[key];
  const r = await camFetch({ path: def.page, referer: '/' });
  if (r.status !== 200) throw new Error(`la cámara respondió ${r.status} al leer ${def.page}`);
  const f = parseForm(r.text, def.action);
  if (!f) throw new Error(`no se encontró el formulario ${def.action} (¿la cámara mostró el aviso de navegador?)`);
  return f;
}

async function writeForm(key, values) {
  const def = FORMS[key];
  const cur = await readForm(key);
  const fields = { ...cur.fields };
  for (const [k, v] of Object.entries(values || {})) {
    if (!(k in fields)) throw new Error(`campo desconocido: ${k}`);
    if (SECRET.test(k) || k === 'SessionKey') throw new Error(`campo protegido: ${k}`);
    fields[k] = String(v);
  }
  // La zona horaria la selecciona el JavaScript de la página a partir de TimeZoneIndex ("34");
  // al enviar, ambos campos llevan el valor completo de la opción ("34(GMT+01:00)").
  if (key === 'time') {
    const idx = parseInt(fields.TimeZoneIndex, 10);
    const opt = (cur.options.TimeZoneSelect || []).find(([v]) => parseInt(v, 10) === idx);
    if (opt) fields.TimeZoneIndex = fields.TimeZoneSelect = opt[0];
  }
  // Fallo del firmware: la cámara rechaza años posteriores a 2020 (su web solo los ofrece hasta 2020).
  // En modo NTP la fecha no se usa; en modo manual no hay forma de poner un año correcto.
  if (key === 'time' && /^\d{4}-/.test(fields.Date || '') && +fields.Date.slice(0, 4) > 2020) fields.Date = '2020' + fields.Date.slice(4);
  const body = Buffer.from(cur.order.filter(k => fields[k] !== null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k])).join('&'));
  const r = await camFetch({ method: 'POST', path: def.action, body, contentType: 'application/x-www-form-urlencoded', referer: def.page });
  console.log(`${new Date().toLocaleTimeString()}  Guardar ${key} (${Object.keys(values || {}).join(', ') || '—'}) -> ${r.status}`);
  if (r.status !== 200) throw new Error(`la cámara respondió ${r.status}`);
  if (def.noVerify) return { ok: true };
  // La cámara responde 200 aunque no guarde: se relee y se comprueba cada valor.
  const after = await readForm(key);
  const same = (k, a, b) => k === 'TimeZoneIndex' ? parseInt(a, 10) === parseInt(b, 10) : String(a) === String(b);
  const failed = Object.entries(values || {}).filter(([k, v]) => !same(k, after.fields[k], v)).map(([k]) => k);
  const reply = parseForm(r.text, '/') || {};
  return { ok: failed.length === 0, failed, message: (r.text.match(/RESPONDER AL MENSAJE/i) ? reply.message : ''), fields: publicFields(after.fields) };
}

const kv = t => Object.fromEntries(t.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

// ───────────────────────── Servidor HTTP ─────────────────────────

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('cuerpo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  // Protección básica contra peticiones desde otras webs (el servidor solo escucha en localhost,
  // pero una página maliciosa abierta en el navegador podría intentar llamarlo).
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return sendJson(res, 403, { error: 'origen no permitido' });

  const m = url.pathname.match(/^\/api\/form\/(\w+)$/);
  if (m) {
    const key = m[1];
    if (!FORMS[key]) return sendJson(res, 404, { error: 'formulario no disponible' });
    if (req.method === 'GET') {
      if (FORMS[key].noVerify) return sendJson(res, 405, { error: 'solo escritura' });
      const f = await readForm(key);
      if (key === 'time') delete f.fields.TimeZoneSelect; // valor no fiable (lo fija el JS de la página); usar TimeZoneIndex
      return sendJson(res, 200, { fields: publicFields(f.fields), options: f.options });
    }
    if (req.method === 'POST') {
      if (req.headers['content-type'] !== 'application/json') return sendJson(res, 415, { error: 'se esperaba JSON' });
      const values = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      return sendJson(res, 200, await writeForm(key, values));
    }
    return sendJson(res, 405, { error: 'método no permitido' });
  }
  if (url.pathname === '/api/info') {
    const [info, ptz, stream] = await Promise.all(['/common/info.cgi', '/config/ptz_info.cgi', '/config/stream_info.cgi'].map(p => camFetch({ path: p }).then(r => r.status === 200 ? kv(r.text) : {})));
    // Hora de la cámara (la página de estado la lleva en campos ocultos f_year, f_month…).
    let camTime = null;
    try {
      const s = await camFetch({ path: '/stsdev.htm' });
      const g = n => (s.text.match(new RegExp(`(?:id|name)="?f_${n}"?\\s+value="?(\\d+)`)) || [])[1];
      if (g('year')) camTime = `${g('year')}-${g('month').padStart(2, '0')}-${g('date').padStart(2, '0')}T${g('hour').padStart(2, '0')}:${g('min').padStart(2, '0')}:${g('sec').padStart(2, '0')}`;
    } catch {}
    return sendJson(res, 200, { info, ptz, stream, camTime, serverTime: new Date().toISOString() });
  }
  // Datos del visor que conviene conservar entre sesiones: calibración del campo de visión y panorámica.
  const store = { '/api/calibration': ['calibracion.json', 'application/json', 1e4], '/api/panorama': ['panorama.jpg', 'image/jpeg', 8e6] }[url.pathname];
  if (store) {
    const [file, type, max] = store, fp = path.join(DATA_DIR, file);
    if (req.method === 'GET') {
      if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'sin datos' });
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(fp).pipe(res);
    }
    if (req.method === 'PUT') {
      if (req.headers['content-type'] !== type) return sendJson(res, 415, { error: 'tipo no válido' });
      const body = await readBody(req);
      if (body.length > max) return sendJson(res, 413, { error: 'demasiado grande' });
      if (type === 'application/json') JSON.parse(body.toString('utf8'));
      else if (body[0] !== 0xFF || body[1] !== 0xD8) return sendJson(res, 400, { error: 'no es un JPEG' });
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(fp, body);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') { fs.rmSync(fp, { force: true }); return sendJson(res, 200, { ok: true }); }
    return sendJson(res, 405, { error: 'método no permitido' });
  }
  return sendJson(res, 404, { error: 'no encontrado' });
}

const STATIC = { '/': 'visor-camara.html' };

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (STATIC[url.pathname]) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(DIR, STATIC[url.pathname])).pipe(res);
  }
  if (url.pathname.startsWith('/api/')) {
    return handleApi(req, res, url).catch(e => { console.log('Error API:', e.message); if (!res.headersSent) sendJson(res, 502, { error: e.message }); });
  }
  if (!url.pathname.startsWith('/cam/')) { res.writeHead(404); return res.end('No encontrado'); }

  // Proxy transparente hacia la cámara.
  readBody(req).then(body => {
    const camPath = req.url.slice(4);
    const refPath = ((req.headers.referer || '').match(/\/cam(\/[^?#]*)/) || [])[1] || '/';
    const abort = camRequest({ method: req.method, path: camPath, body, contentType: req.headers['content-type'], referer: refPath }, (camRes, stage) => {
      if (req.method !== 'GET' || camRes.statusCode >= 400)
        console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${camPath.split('?')[0]} -> ${camRes.statusCode}` + (stage !== 'basic' ? ` (${stage})` : ''));
      const h = { ...camRes.headers };
      delete h['www-authenticate']; // evita que el navegador muestre su propia ventana de login
      res.writeHead(camRes.statusCode, h);
      camRes.pipe(res);
    }, e => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error al conectar con la cámara: ' + e.message);
    });
    res.on('close', abort); // corta los streams (vídeo/audio) al cerrar la pestaña
  }).catch(() => { res.writeHead(400); res.end(); });
}

module.exports = { dpapi, parseForm, digest: (...a) => digest(...a), _setCfg: c => { cfg = c; } };

if (require.main === module) (async () => {
  cfg = await loadConfig();
  [camHost, camPort] = [cfg.host.split(':')[0], +(cfg.host.split(':')[1] || 80)];
  basicAuth = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.pass).toString('base64');
  http.createServer(handle).listen(PORT, '127.0.0.1', () => {
    console.log(`\nDCS-5030L Viewer ${VERSION} · https://github.com/DigiSoulBcn/dcs5030l-viewer`);
    console.log(`Visor listo en  http://localhost:${PORT}   (cámara ${UPSTREAM || cfg.host}, usuario ${cfg.user})`);
    console.log('Deja esta ventana abierta mientras uses el visor. Ctrl+C para cerrar.\n');
    if (process.argv.includes('--open')) require('child_process').exec(`start "" http://localhost:${PORT}`);
  }).on('error', e => {
    console.log(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso: ¿hay otro visor abierto? Usa --port para elegir otro.` : e.message);
    process.exit(1);
  });
})();
