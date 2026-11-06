// Servidor local para el visor de la D-Link DCS-5030L.
// Sirve visor-camara.html y reenvía /cam/* a la cámara añadiendo usuario y contraseña,
// para que el navegador no tenga que pedirlos.
//
// Uso:  node servidor-camara.js          (la primera vez pide los datos y los guarda en camara.json)
//       node servidor-camara.js --config (para volver a introducirlos)
// Luego abre http://localhost:8099

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DIR = __dirname;
const CONFIG = path.join(DIR, 'camara.json');
const PORT = 8099;

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
  console.log('Configuración de la cámara (se guarda en camara.json, en esta carpeta).');
  const dh = prev.host || '192.168.1.10:8010', du = prev.user || 'admin';
  const host = (await ask(`IP:puerto de la cámara [${dh}]: `)) || dh;
  const user = (await ask(`Usuario [${du}]: `)) || du;
  const pass = await ask('Contraseña (no se muestra al escribir): ', true);
  return { host, user, pass };
}

// Pide una imagen a la cámara para comprobar las credenciales. Devuelve el código HTTP.
function testCredentials(cfg) {
  const [h, p = '80'] = cfg.host.split(':');
  return new Promise(res => {
    const r = http.get({ host: h, port: +p, path: '/image/jpeg.cgi', timeout: 5000,
      headers: { Authorization: 'Basic ' + Buffer.from(cfg.user + ':' + cfg.pass).toString('base64') } },
      x => { x.resume(); res(x.statusCode); });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', e => res('error: ' + e.message));
  });
}

async function loadConfig() {
  let cfg = (!process.argv.includes('--config') && fs.existsSync(CONFIG))
    ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')) : await askConfig();
  while (true) {
    process.stdout.write(`Comprobando acceso a ${cfg.host} como "${cfg.user}"... `);
    const code = await testCredentials(cfg);
    if (code === 200) { console.log('OK'); break; }
    if (code === 401) console.log('la cámara RECHAZA el usuario o la contraseña.');
    else console.log(`no se pudo comprobar (${code}).`);
    const again = await ask('¿Volver a introducir los datos? [S/n]: ');
    if (/^n/i.test(again)) break;
    cfg = await askConfig(cfg);
  }
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  return cfg;
}

(async () => {
  const cfg = await loadConfig();
  const [camHost, camPort = '80'] = cfg.host.split(':');
  const auth = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.pass).toString('base64');

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      fs.createReadStream(path.join(DIR, 'visor-camara.html')).pipe(res);
      return;
    }
    if (!req.url.startsWith('/cam/')) { res.writeHead(404); res.end('No encontrado'); return; }

    // Se lee el cuerpo entero (las peticiones con cuerpo son formularios pequeños) para poder
    // reintentar con autenticación Digest, que usa la web de configuración de la cámara.
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const camPath = req.url.slice(4);
      // stage 'basic': primer intento con Basic (vídeo, audio, CGI de NIPCA).
      // Si la cámara pide Digest (401) se reintenta con Digest. Algunos formularios
      // (p. ej. /setSystemDate) responden 403 al ver Basic: entonces se pide sin
      // credenciales ('probe') para obtener el desafío Digest y se reintenta.
      const send = (authorization, stage) => {
        // La web de la cámara responde 403 si el Referer no es una página suya; para guardar
        // formularios exige además que sea la página del formulario (p. ej. /time.htm).
        // Se traduce el Referer del cliente (http://localhost:8099/cam/time.htm → http://cámara/time.htm).
        const refPath = ((req.headers.referer || '').match(/\/cam(\/[^?#]*)/) || [])[1] || '/';
        const headers = { Referer: `http://${cfg.host}${refPath}` };
        if (authorization) headers.Authorization = authorization;
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
        if (body.length) headers['Content-Length'] = body.length;
        const up = http.request({ host: camHost, port: +camPort, method: req.method, path: camPath, headers }, camRes => {
          const chal = camRes.headers['www-authenticate'] || '';
          if (camRes.statusCode === 401 && stage !== 'final' && /^Digest/i.test(chal)) {
            camRes.resume();
            return send(digest(chal, req.method, camPath), 'final');
          }
          if (camRes.statusCode === 403 && stage === 'basic') {
            camRes.resume();
            return send(null, 'probe');
          }
          if (req.method !== 'GET' || camRes.statusCode >= 400) // registro (sin datos sensibles)
            console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${camPath.split('?')[0]} -> ${camRes.statusCode}` + (stage !== 'basic' ? ` (${stage})` : ''));
          const h = { ...camRes.headers };
          delete h['www-authenticate']; // evita que el navegador muestre su propia ventana de login
          res.writeHead(camRes.statusCode, h);
          camRes.pipe(res);
        });
        up.setTimeout(10000, () => up.destroy(new Error('tiempo de espera agotado')));
        up.on('error', e => {
          if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); }
          res.end('Error al conectar con la cámara: ' + e.message);
        });
        res.on('close', () => up.destroy()); // corta el stream MJPEG al cerrar la pestaña
        up.end(body);
      };
      send(auth, 'basic');
    });
  });

  // Autenticación HTTP Digest (RFC 2617, MD5, qop=auth).
  let nc = 0;
  function digest(chal, method, uri) {
    const p = {};
    chal.replace(/(\w+)=("([^"]*)"|[^,\s]+)/g, (_, k, v, q) => { p[k] = q !== undefined ? q : v; });
    const md5 = s => require('crypto').createHash('md5').update(s).digest('hex');
    const ha1 = md5(`${cfg.user}:${p.realm}:${cfg.pass}`), ha2 = md5(`${method}:${uri}`);
    const qop = (p.qop || '').split(',').map(s => s.trim()).includes('auth') ? 'auth' : '';
    const ncs = (++nc).toString(16).padStart(8, '0'), cnonce = require('crypto').randomBytes(8).toString('hex');
    const response = qop ? md5(`${ha1}:${p.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${cfg.user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"`;
    if (qop) h += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (p.algorithm) h += `, algorithm=${p.algorithm}`;
    return h;
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nVisor listo en  http://localhost:${PORT}   (cámara ${cfg.host}, usuario ${cfg.user})`);
    console.log('Deja esta ventana abierta mientras uses el visor. Ctrl+C para cerrar.');
    if (process.argv.includes('--open')) require('child_process').exec(`start "" http://localhost:${PORT}`);
  });
})();
