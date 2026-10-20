/* ══════════════════════════════════════════════════════════════
   PRUEBAS DE PUNTA A PUNTA — funcionalidad y fluidez
   ──────────────────────────────────────────────────────────────
   Maneja un Chrome real (sin dependencias: Node 22 + el protocolo
   DevTools por WebSocket) contra la app en ?modo=local, así que
   NUNCA toca la base de datos real.

   Uso:   node pruebas/e2e.mjs            (desde la raíz del proyecto)
   Sale con código 1 si alguna prueba falla.
   ══════════════════════════════════════════════════════════════ */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((r) => r && fs.existsSync(r));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Servidor estático (sin caché, como serve.py) ─────────── */
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
function servir() {
  return new Promise((resolver) => {
    const srv = http.createServer((req, res) => {
      const ruta = decodeURIComponent(req.url.split('?')[0]);
      const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
      if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(archivo).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolver(srv));
  });
}

/* ── Cliente mínimo del protocolo DevTools ────────────────── */
async function abrirChrome() {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'album-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + perfil,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolver, rechazar) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) resolver(m[1]);
    });
    setTimeout(() => rechazar(new Error('Chrome no arrancó')), 20000);
  });
  const puerto = new URL(wsUrl).port;
  const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
  const pagina = lista.find((t) => t.type === 'page');
  const ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pendientes = new Map();
  const oyentes = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendientes.has(msg.id)) {
      const { resolver, rechazar } = pendientes.get(msg.id);
      pendientes.delete(msg.id);
      if (msg.error) rechazar(new Error(msg.error.message)); else resolver(msg.result);
    } else if (msg.method) {
      oyentes.forEach((f) => f(msg));
    }
  });
  const cdp = (method, params = {}) => new Promise((resolver, rechazar) => {
    const n = ++id;
    pendientes.set(n, { resolver, rechazar });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const cerrar = () => { try { ws.close(); } catch (e) {} proc.kill(); };
  return { cdp, oyentes, cerrar };
}

/* ── Pruebas ──────────────────────────────────────────────── */
const resultados = [];
function anotar(nombre, ok, detalle) {
  resultados.push({ nombre, ok, detalle });
  console.log((ok ? '  ✔ ' : '  ✘ ') + nombre + (detalle ? '  — ' + detalle : ''));
}

async function main() {
  if (!CHROME) throw new Error('No encontré Chrome/Edge. Define la variable CHROME con su ruta.');
  const srv = await servir();
  const base = `http://127.0.0.1:${srv.address().port}/index.html?modo=local`;
  const { cdp, oyentes, cerrar } = await abrirChrome();
  const errores = [];
  oyentes.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') errores.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    /* "sin red" es el fallo que una prueba provoca a propósito */
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !JSON.stringify(m.params.args).includes('sin red')) errores.push(m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Page.javascriptDialogOpening') cdp('Page.handleJavaScriptDialog', { accept: true });
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((m, o) => { if (document.querySelector('.nodo')) { window.__relojAlDibujar = document.getElementById('hilos').getCurrentTime(); o.disconnect(); } })
        .observe(document.getElementById('nodos'), { childList: true }); });` });
  await cdp('Performance.enable');

  const ev = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Evaluación: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const cargar = async (url) => {
    await cdp('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      await espera(100);
      if (await ev("document.readyState === 'complete' && document.querySelectorAll('.nodo').length > 0").catch(() => false)) break;
    }
    await espera(300);
  };
  const raton = async (tipo, x, y, extra = {}) => cdp('Input.dispatchMouseEvent', Object.assign({ type: tipo, x, y, button: 'left', buttons: tipo === 'mouseReleased' ? 0 : 1, clickCount: 1 }, extra));
  const clic = async (x, y) => { await raton('mouseMoved', x, y, { buttons: 0 }); await raton('mousePressed', x, y); await raton('mouseReleased', x, y); };
  const arrastrar = async (x, y, dx, dy, pasos = 20, ms = 16) => {
    await raton('mousePressed', x, y);
    for (let i = 1; i <= pasos; i++) { await raton('mouseMoved', x + (dx * i) / pasos, y + (dy * i) / pasos); await espera(ms); }
    await raton('mouseReleased', x + dx, y + dy);
  };
  const dedo = async (tipo, puntos) => cdp('Input.dispatchTouchEvent', { type: tipo, touchPoints: puntos.map(([x, y], i) => ({ x, y, id: i })) });
  const centroNodo = (id) => ev(`(() => { const n = document.querySelector('.nodo[data-id="${id}"] .nodo__marco'); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const fichaAbierta = () => ev("document.getElementById('flipCapa').classList.contains('abierta')");
  const cerrarFicha = async () => { await ev("document.querySelector('.carta__cerrar').click()"); await espera(700); };
  const transform = () => ev("document.getElementById('mundo').style.transform");
  const nodoVisibleCercano = () => ev(`(() => { const W = innerWidth, H = innerHeight; let m = null;
      document.querySelectorAll('.nodo').forEach((n) => { const r = n.querySelector('.nodo__marco').getBoundingClientRect();
        const c = [r.left + r.width / 2, r.top + r.height / 2]; if (c[0] < 40 || c[0] > W - 40 || c[1] < 110 || c[1] > H - 40) return;
        const d = Math.hypot(c[0] - W / 2, c[1] - H / 2); if (!m || d < m.d) m = { d, id: n.dataset.id, c }; }); return m; })()`);

  /* Datos de la familia real (62) cargados en el modo local */
  const familia = JSON.parse(fs.readFileSync(path.join(RAIZ, 'backend/recuperado-2026-08-25.json'), 'utf8')).perfiles;

  /* ═════ ESCRITORIO ═════ */
  console.log('\nEscritorio 1280×800 (ratón)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cargar(base);
  await ev(`localStorage.setItem('albumFamiliar:datos:v1', ${JSON.stringify(JSON.stringify(familia))})`);
  const t0 = Date.now();
  await cargar(base);
  const nNodos = await ev("document.querySelectorAll('.nodo').length");
  anotar('Carga los 62 perfiles de la familia', nNodos === 62, nNodos + ' nodos');

  /* Tiempo hasta que la última tarjeta termina de aparecer */
  for (let i = 0; i < 80; i++) {
    const listo = await ev("document.getAnimations().filter((a) => a.effect && a.effect.target && ['revelar', 'encender', 'aparecer'].includes(a.animationName)).length === 0 && [...document.querySelectorAll('.nodo')].every((n) => getComputedStyle(n).opacity === '1')");
    if (listo) break;
    await espera(100);
  }
  const tVisible = Date.now() - t0;
  anotar('Árbol completo (tarjetas E hilos) visible en menos de 3 s', tVisible < 3000, tVisible + ' ms');

  const geo = await ev(`(() => { const ps = [...document.querySelectorAll('.nodo')].map((n) => [parseFloat(n.style.left), parseFloat(n.style.top)]);
     let choques = 0; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++)
       if (Math.abs(ps[i][0] - ps[j][0]) < 168 && Math.abs(ps[i][1] - ps[j][1]) < 228) choques++;
     return { choques, filas: new Set(ps.map((p) => p[1])).size }; })()`);
  anotar('Sin tarjetas encimadas y 7 generaciones', geo.choques === 0 && geo.filas === 7, JSON.stringify(geo));

  let obj = await nodoVisibleCercano();
  await clic(obj.c[0], obj.c[1]);
  await espera(900);
  anotar('Clic en una tarjeta abre su ficha', await fichaAbierta(), obj.id);
  anotar('La ficha muestra el nombre correcto', (await ev("document.getElementById('modalNombre').textContent")) === familia.find((p) => p.id === obj.id).nombre_completo);
  anotar('Con la ficha abierta las chispas se pausan', await ev("document.getElementById('hilos').animationsPaused()"));
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await espera(700);
  anotar('Escape cierra la ficha', !(await fichaAbierta()));
  anotar('Al cerrar, las chispas se reanudan', !(await ev("document.getElementById('hilos').animationsPaused()")));

  /* El clic sintético que llega justo tras ABRIR no debe cerrarla
     (guarda de 450 ms), y el velo la cierra después. */
  obj = await nodoVisibleCercano();
  await clic(obj.c[0], obj.c[1]); await espera(60);
  await clic(15, 790); await espera(300);
  anotar('Un clic inmediato tras abrir no cierra la ficha (guarda anti-fantasma)', await fichaAbierta());
  await espera(400);
  await clic(15, 790); await espera(700);
  anotar('Clic en el velo cierra la ficha', !(await fichaAbierta()));

  const antes = await transform();
  obj = await nodoVisibleCercano();
  await arrastrar(obj.c[0], obj.c[1], 180, 90);
  await espera(400);
  anotar('Arrastrar desde una tarjeta mueve el lienzo y NO abre la ficha', antes !== (await transform()) && !(await fichaAbierta()));

  obj = await nodoVisibleCercano();
  await clic(obj.c[0], obj.c[1]); await espera(900);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await espera(700);
  const zA = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'Equal', text: '+', windowsVirtualKeyCode: 187 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: '+', code: 'Equal', windowsVirtualKeyCode: 187 });
  await espera(300);
  const zB = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  anotar('La tecla + acerca aunque el foco quedó en una tarjeta', zB > zA, zA + '% → ' + zB + '%');
  const vistaAntes = await ev("[document.getElementById('zoomHud').textContent, (() => { const r = document.querySelector('.nodo[data-id=\"" + obj.id + "\"]').getBoundingClientRect(); return Math.round(r.left + r.width / 2 - innerWidth / 2); })()]");
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false });
  await espera(500);
  const vistaDespues = await ev("[document.getElementById('zoomHud').textContent, (() => { const r = document.querySelector('.nodo[data-id=\"" + obj.id + "\"]').getBoundingClientRect(); return Math.round(r.left + r.width / 2 - innerWidth / 2); })()]");
  anotar('Redimensionar conserva el zoom y lo que se estaba mirando', vistaAntes[0] === vistaDespues[0] && Math.abs(vistaAntes[1] - vistaDespues[1]) <= 2, JSON.stringify([vistaAntes, vistaDespues]));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await espera(500);
  await ev("document.getElementById('btnCentrar').click()"); await espera(600);

  const escala0 = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: -300 });
  await espera(400);
  const escala1 = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  anotar('La rueda hace zoom', escala1 > escala0, escala0 + '% → ' + escala1 + '%');

  await ev("document.getElementById('btnCentrar').click()");
  await espera(600);
  obj = await nodoVisibleCercano();
  await ev(`document.querySelector('.nodo[data-id="${obj.id}"]').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await espera(800);
  anotar('Teclado: Enter sobre una tarjeta abre la ficha', await fichaAbierta());

  /* Rama */
  await ev("document.getElementById('btnVerRama').click()");
  await espera(800);
  const enRama = await ev("document.querySelectorAll('.nodo').length");
  await ev("document.getElementById('chipRamaQuitar').click()");
  await espera(500);
  anotar('Ver rama filtra y quitarla devuelve el árbol completo', enRama > 1 && enRama < 62 && (await ev("document.querySelectorAll('.nodo').length")) === 62, enRama + ' en la rama');

  /* ── CRUD ── */
  await ev("document.getElementById('btnCentrar').click()"); await espera(500);
  obj = await nodoVisibleCercano();
  await clic(obj.c[0], obj.c[1]); await espera(900);
  await ev("document.querySelector('[data-accion=\"hijo\"]').click()");
  await espera(900);
  const editorVisible = await ev("!document.getElementById('fichaEditor').hidden");
  anotar('+ Hijo crea a la persona y abre su edición', editorVisible && (await ev("document.querySelectorAll('.nodo').length")) === 63);
  await ev("document.getElementById('editNombre').value = 'Persona de Prueba'; document.getElementById('editNacimiento').value = '2020-05-01';");
  const posAntes = await ev("JSON.stringify([...document.querySelectorAll('.nodo')].filter(n => n.dataset.id !== '" + "x" + "').map(n => [n.dataset.id, n.style.left, n.style.top]))");
  await ev("document.querySelector('#fichaEditor button[type=submit]').click()");
  await espera(1000);
  anotar('Guardar la edición actualiza el nombre en el árbol', await ev("[...document.querySelectorAll('.nodo__nombre')].some((h) => h.textContent === 'Persona de Prueba')"));
  const posDespues = await ev("JSON.stringify([...document.querySelectorAll('.nodo')].map(n => [n.dataset.id, n.style.left, n.style.top]))");
  anotar('Cambiar una fecha no reacomoda el árbol', posAntes === posDespues);
  await cargar(base);
  anotar('La persona nueva sigue ahí tras recargar', await ev("[...document.querySelectorAll('.nodo__nombre')].some((h) => h.textContent === 'Persona de Prueba')"));
  const idNuevo = await ev("[...document.querySelectorAll('.nodo')].find((n) => n.querySelector('.nodo__nombre').textContent === 'Persona de Prueba').dataset.id");
  await ev(`document.querySelector('.nodo[data-id="${idNuevo}"]').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await espera(900);
  await ev("document.querySelector('[data-accion=\"eliminar\"]').click()");
  await espera(1000);
  anotar('Eliminar la borra (con confirmación)', (await ev("document.querySelectorAll('.nodo').length")) === 62 && !(await fichaAbierta()));

  /* ── Fotos (URL en modo local) ── */
  const foto = await ev(`(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 1000; const g = c.getContext('2d');
     const gr = g.createLinearGradient(0, 0, 800, 1000); gr.addColorStop(0, '#a86'); gr.addColorStop(1, '#246'); g.fillStyle = gr; g.fillRect(0, 0, 800, 1000);
     return c.toDataURL('image/jpeg', 0.8); })()`);
  obj = await nodoVisibleCercano();
  await clic(obj.c[0], obj.c[1]); await espera(900);
  await ev("document.querySelector('[data-accion=\"editar\"]').click()");
  await ev(`document.getElementById('editFoto1').value = ${JSON.stringify(foto)}; document.getElementById('editFoto2').value = ${JSON.stringify(foto)};`);
  await ev("document.querySelector('#fichaEditor button[type=submit]').click()");
  await espera(1000);
  anotar('Con foto, la tarjeta muestra la imagen', await ev(`!!document.querySelector('.nodo[data-id="${obj.id}"] img.nodo__foto')`));
  anotar('El carrusel muestra la foto y sus 2 puntos', await ev("!document.getElementById('carruselFoto').hidden && document.querySelectorAll('#carruselPuntos > *').length === 2"));
  await ev("document.getElementById('fotoNext').click()"); await espera(300);
  await ev("document.getElementById('btnPantallaCompleta').click()"); await espera(500);
  const visorAbierto = await ev("!document.getElementById('visor').hidden");
  await ev("document.getElementById('visorCerrar').click()"); await espera(500);
  anotar('Pantalla completa abre y cierra', visorAbierto && (await ev("document.getElementById('visor').hidden")));
  await cerrarFicha();

  /* ── Fotos guardadas en la nube que llegan tarde (simulado) ──
     El perfil trae una ref "foto:" y el servicio tarda 1,5 s en dársela. */
  await ev(`(() => { const d = JSON.parse(localStorage.getItem('albumFamiliar:datos:v1'));
     d.find((p) => p.id === '${obj.id}').galeria = ['foto:prueba-lenta']; localStorage.setItem('albumFamiliar:datos:v1', JSON.stringify(d)); })()`);
  await cargar(base);
  await ev(`window.AlbumBackend = { resolverPerfil: (p) => new Promise((r) => setTimeout(() => r(Object.assign({}, p, { galeria: (p.galeria || []).map((g) => g === 'foto:prueba-lenta' ? ${JSON.stringify(foto)} : g) })), 1500)) }`);
  await ev("document.getElementById('btnCentrar').click()"); await espera(600);
  const cLenta = await centroNodo(obj.id);
  anotar('Una foto aún sin llegar se muestra con iniciales, sin src roto', await ev(`!!document.querySelector('.nodo[data-id="${obj.id}"] .nodo__placeholder') && ![...document.querySelectorAll('img')].some((i) => (i.getAttribute('src') || '').startsWith('foto:'))`));
  await clic(cLenta[0], cLenta[1]); await espera(700);
  await ev("document.querySelector('[data-accion=\"editar\"]').click()");
  await espera(2200);
  anotar('El editor muestra la foto ya resuelta, nunca la ref interna', await ev("!document.getElementById('fichaEditor').hidden && document.getElementById('editFoto1').value.startsWith('data:image')"));
  await ev("document.getElementById('editNombre').value = 'Nombre Editado'");
  await ev("document.querySelector('#fichaEditor button[type=submit]').click()");
  await espera(2500);
  anotar('Las fotos tardías no pisan una ficha recién editada', (await ev("document.getElementById('modalNombre').textContent")) === 'Nombre Editado' && (await ev(`JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).find((p) => p.id === '${obj.id}').nombre_completo`)) === 'Nombre Editado');
  anotar('Y la foto aparece en el carrusel', await ev("!document.getElementById('carruselFoto').hidden && (document.getElementById('carruselFoto').getAttribute('src') || '').startsWith('data:image')"));
  await cerrarFicha();

  /* Editor mientras bajan las fotos: botón ocupado, un 2.º toque no hace
     nada y, si se cierra la ficha, el editor NO se abre solo después. */
  await ev(`(() => { const d = JSON.parse(localStorage.getItem('albumFamiliar:datos:v1'));
     d.find((p) => p.id === '${obj.id}').galeria = ['foto:prueba-lenta']; localStorage.setItem('albumFamiliar:datos:v1', JSON.stringify(d)); })()`);
  await cargar(base);
  await ev(`window.__resoluciones = 0; window.AlbumBackend = { resolverPerfil: (p) => { window.__resoluciones++; return new Promise((r) => setTimeout(() => r(Object.assign({}, p, { galeria: (p.galeria || []).map((g) => g === 'foto:prueba-lenta' ? ${JSON.stringify(foto)} : g) })), 2000)); } }`);
  await ev("document.getElementById('btnCentrar').click()"); await espera(600);
  const cE = await centroNodo(obj.id);
  await clic(cE[0], cE[1]); await espera(700);
  await ev("window.__resoluciones = 0; document.querySelector('[data-accion=\"editar\"]').click()");
  await espera(100);
  const botonOcupado = await ev("(() => { const b = document.querySelector('[data-accion=\"editar\"]'); return b.disabled && b.textContent !== 'Editar'; })()");
  await ev("document.querySelector('[data-accion=\"editar\"]').click()");
  anotar('Editar mientras bajan las fotos: botón ocupado y sin descargas repetidas', botonOcupado && (await ev('window.__resoluciones')) === 1);
  /* Mientras esa espera sigue, otra ficha y "+ Hijo" deben poder editarse */
  await cerrarFicha();
  const otro = await ev(`(() => { const W = innerWidth, H = innerHeight; let m = null;
      document.querySelectorAll('.nodo').forEach((n) => { if (n.dataset.id === '${obj.id}') return; const r = n.querySelector('.nodo__marco').getBoundingClientRect();
        const c = [r.left + r.width / 2, r.top + r.height / 2]; if (c[0] < 40 || c[0] > W - 40 || c[1] < 110 || c[1] > H - 40) return;
        const d = Math.hypot(c[0] - W / 2, c[1] - H / 2); if (!m || d < m.d) m = { d, id: n.dataset.id, c }; }); return m; })()`);
  await clic(otro.c[0], otro.c[1]); await espera(800);
  await ev("document.querySelector('[data-accion=editar]').click()"); await espera(200);
  const estadoOtro = await ev("({ nombre: document.getElementById('modalNombre').textContent, editor: !document.getElementById('fichaEditor').hidden, boton: document.querySelector('[data-accion=editar]').textContent })");
  anotar('Otra ficha se puede editar aunque la anterior siga bajando fotos', estadoOtro.editor && estadoOtro.boton === 'Editar', JSON.stringify(estadoOtro));
  await cerrarFicha();
  await espera(2200);
  const cE2 = await centroNodo(obj.id); // al abrir, la cámara se centró en ella
  await clic(cE2[0], cE2[1]); await espera(2600);
  const reabierta = await ev("({ abierta: document.getElementById('flipCapa').classList.contains('abierta'), editor: !document.getElementById('fichaEditor').hidden, nombre: document.getElementById('modalNombre').textContent })");
  anotar('Cerrar y reabrir mientras cargaba: la ficha no salta sola a edición', reabierta.abierta && !reabierta.editor, JSON.stringify(reabierta));
  await cerrarFicha();

  /* Si la relectura falla tras crear, se dice "Se creó…" y no se duplica */
  const cE3 = await centroNodo(obj.id);
  await clic(cE3[0], cE3[1]); await espera(900);
  const antesHijo = await ev("JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).length");
  await ev("window.__alertas = []; window.alert = (m) => window.__alertas.push(m); const o = AlbumDatos.obtenerPerfiles; window.__obtener = o; AlbumDatos.obtenerPerfiles = () => Promise.reject(new Error('sin red'));");
  await ev("document.querySelector('[data-accion=\"hijo\"]').click()"); await espera(800);
  const tras = await ev("({ n: JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).length, alerta: window.__alertas[0] || '' })");
  await ev("AlbumDatos.obtenerPerfiles = window.__obtener");
  anotar('Con la relectura caída, "+ Hijo" avisa que SÍ se creó (sin invitar a duplicar)', tras.n === antesHijo + 1 && /^Se creó/.test(tras.alerta), JSON.stringify(tras));
  await cargar(base);
  const extra = await ev("JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).filter((p) => p.nombre_completo === 'Nuevo hijo/a').map((p) => p.id)");
  await ev(`(() => { const ids = ${JSON.stringify(extra)}; const d = JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).filter((p) => !ids.includes(p.id));
     d.find((p) => p.id === '${obj.id}').galeria = [${JSON.stringify(foto)}]; localStorage.setItem('albumFamiliar:datos:v1', JSON.stringify(d)); })()`);
  await cargar(base);

  /* ── Respaldo y exportación ── */
  const capturar = async (selector) => ev(`(async () => {
      const real = URL.createObjectURL.bind(URL); let blob = null;
      URL.createObjectURL = (b) => { blob = b; return real(b); };
      document.getElementById('descargarMenu').hidden = false;
      document.querySelector('${selector}').click();
      for (let i = 0; i < 200 && !blob; i++) await new Promise((r) => setTimeout(r, 50));
      URL.createObjectURL = real;
      if (!blob) return null;
      const b = new Uint8Array(await blob.arrayBuffer());
      window.__ultimoBlob = blob;
      return { tam: b.length, inicio: [...b.slice(0, 5)] };
    })()`);
  const zip = await capturar('#descargarRespaldo');
  const leido = zip && await ev("(async () => { const b = window.__ultimoBlob; b.name = 'c.zip'; const r = await AlbumRespaldo.leer(b); return { perfiles: r.manifiesto.perfiles.length, fotos: [...r.archivos.keys()].filter((k) => k.startsWith('fotos/')).length, miniatura: r.manifiesto.perfiles.some((p) => 'miniatura' in p) }; })()");
  const fotosEsperadas = await ev("JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).reduce((n, p) => n + (p.galeria || []).filter((g) => /^data:/.test(g)).length, 0)");
  anotar('La copia .zip trae los 62 perfiles y TODAS sus fotos (formato v1)', !!leido && leido.perfiles === 62 && leido.fotos === fotosEsperadas && fotosEsperadas > 0 && !leido.miniatura, JSON.stringify(leido) + ', esperadas ' + fotosEsperadas);
  await ev("localStorage.removeItem('albumFamiliar:datos:v1')");
  await ev("(async () => { const r = await AlbumRespaldo.leer(window.__ultimoBlob); await AlbumRespaldo.restaurar(r.manifiesto, r.archivos, 'Familia_Lainez', () => {}); })()");
  await cargar(base);
  anotar('Restaurar la copia devuelve las 62 personas', (await ev("document.querySelectorAll('.nodo').length")) === 62);
  const png = await capturar('#descargarPNG');
  anotar('Exportar PNG produce un PNG válido', !!png && png.inicio[0] === 0x89 && png.inicio[1] === 0x50, png && png.tam + ' bytes');
  const pdf = await capturar('#descargarPDF');
  anotar('Exportar PDF produce un PDF válido', !!pdf && String.fromCharCode(...pdf.inicio.slice(0, 4)) === '%PDF', pdf && pdf.tam + ' bytes');

  /* ═════ FLUIDEZ (CPU de celular emulada ×4) ═════ */
  console.log('\nFluidez con CPU ×4');
  await cargar(base);
  await espera(1500);
  await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
  /* Las mediciones de cuadros en un Chrome sin pantalla oscilan de una
     pasada a otra: se toma la MEDIANA de 3 repeticiones. */
  const iniciarCuadros = () => ev(`(() => { window.__cuadros = []; let prev = performance.now(); const f = (t) => { window.__cuadros.push(t - prev); prev = t; if (window.__midiendo) requestAnimationFrame(f); }; window.__midiendo = true; requestAnimationFrame(f); })()`);
  const finCuadros = () => ev(`(() => { window.__midiendo = false; const c = window.__cuadros.slice(2).sort((a, b) => a - b); return { p95: Math.round(c[Math.floor(c.length * 0.95)] || 0), largos: c.filter((x) => x > 34).length }; })()`);
  const mediana = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const intros = [];
  for (let k = 0; k < 3; k++) {
    if (k) { await cdp('Emulation.setCPUThrottlingRate', { rate: 1 }); await cargar(base); await espera(400); await cdp('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    await espera(800);
    await iniciarCuadros();
    await arrastrar(420, 450, -300, 120, 50, 16);
    intros.push((await finCuadros()).p95);
  }
  anotar('Arrastre fluido durante la entrada (al tocar, las chispas se pausan): mediana del p95 ≤ 34 ms', mediana(intros) <= 34, 'p95 de 3 cargas: ' + intros.join(', ') + ' ms');
  /* Que se apaguen de verdad: 15 s (de reloj del svg) después del dibujo. */
  await ev(`new Promise((r) => { const t = setInterval(() => { if (document.getElementById('hilos').getCurrentTime() >= window.__relojAlDibujar + 15) { clearInterval(t); r(); } }, 100); })`);
  const vivas = await ev(`[...document.querySelectorAll('animateMotion')].filter((a) => { try { return a.getStartTime() + a.getSimpleDuration() > document.getElementById('hilos').getCurrentTime(); } catch (e) { return false; } }).length`);
  anotar('A los 15 s del dibujo ya no queda ninguna chispa animándose', vivas === 0, vivas + ' vivas');
  const pans = [];
  for (let k = 0; k < 3; k++) { await iniciarCuadros(); await arrastrar(400, 450, k % 2 ? -360 : 360, 160, 60, 16); pans.push((await finCuadros()).p95); await espera(300); }
  anotar('Arrastre fluido: mediana del p95 ≤ 34 ms (30 fps con CPU ×4)', mediana(pans) <= 34, 'p95 de 3 pasadas: ' + pans.join(', ') + ' ms');
  const zooms = [];
  for (let k = 0; k < 3; k++) {
    await iniciarCuadros();
    for (let i = 0; i < 20; i++) { await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: i < 10 ? -60 : 60 }); await espera(30); }
    zooms.push((await finCuadros()).p95);
  }
  anotar('Zoom con rueda fluido: mediana del p95 ≤ 34 ms', mediana(zooms) <= 34, 'p95 de 3 pasadas: ' + zooms.join(', ') + ' ms');
  const m0 = (await cdp('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  await espera(3000);
  const m1 = (await cdp('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  const ocupado = Math.round(((m1 - m0) / 3) * 100);
  anotar('En reposo el hilo principal descansa (≤ 15 % ocupado)', ocupado <= 15, ocupado + ' %');
  await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });

  /* ═════ CELULAR ═════ */
  console.log('\nCelular 390×844 (dedo)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cargar(base);
  await espera(2500);
  const escalaMovil = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  const visibles = await ev("[...document.querySelectorAll('.nodo__marco')].filter((m) => { const r = m.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; }).length");
  anotar('Arranque en celular legible (zoom ≥ 60 %) y con tarjetas a la vista', escalaMovil >= 60 && visibles >= 3, escalaMovil + '%, ' + visibles + ' visibles');
  obj = await nodoVisibleCercano();
  await dedo('touchStart', [[obj.c[0], obj.c[1]]]);
  await dedo('touchMove', [[obj.c[0] + 8, obj.c[1] + 6]]);
  await dedo('touchEnd', []);
  await espera(900);
  anotar('Un toque con temblor de dedo (10 px) abre la ficha', await fichaAbierta());
  await cerrarFicha();
  await espera(500);
  obj = await nodoVisibleCercano();
  const tAntes = await transform();
  await dedo('touchStart', [[obj.c[0], obj.c[1]]]);
  for (let i = 1; i <= 10; i++) { await dedo('touchMove', [[obj.c[0] - i * 8, obj.c[1] + i * 4]]); await espera(16); }
  await dedo('touchEnd', []);
  await espera(600);
  anotar('Deslizar el dedo mueve el lienzo y no abre la ficha', tAntes !== (await transform()) && !(await fichaAbierta()));
  const eAntes = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  await dedo('touchStart', [[150, 400], [240, 400]]);
  for (let i = 1; i <= 10; i++) { await dedo('touchMove', [[150 - i * 6, 400], [240 + i * 6, 400]]); await espera(16); }
  await dedo('touchEnd', []);
  await espera(500);
  const eDespues = await ev("parseFloat(document.getElementById('zoomHud').textContent)");
  anotar('Pellizcar hace zoom', eDespues > eAntes, eAntes + '% → ' + eDespues + '%');
  const tPinza = await transform();
  await dedo('touchStart', [[150, 500], [240, 500]]);
  for (let i = 1; i <= 6; i++) { await dedo('touchMove', [[150 - i * 4, 500], [240 + i * 4, 500]]); await espera(16); }
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 126, y: 500, id: 0 }] });
  const tTrasPinza = await transform();
  for (let i = 1; i <= 12; i++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 126 + i * 10, y: 500 + i * 5, id: 0 }] }); await espera(16); }
  const tArrastre = await transform();
  await dedo('touchEnd', []);
  anotar('Tras pellizcar y soltar un dedo, el otro sigue arrastrando', tPinza !== tTrasPinza && tTrasPinza !== tArrastre);
  const pinzas = [];
  for (let k = 0; k < 3; k++) {
    await cdp('Emulation.setCPUThrottlingRate', { rate: 4 });
    await iniciarCuadros();
    await dedo('touchStart', [[150, 420], [240, 420]]);
    for (let i = 1; i <= 25; i++) { const d = (k % 2 ? -1 : 1) * i * 3; await dedo('touchMove', [[150 - d, 420], [240 + d, 420]]); await espera(16); }
    await dedo('touchEnd', []);
    pinzas.push((await finCuadros()).p95);
    await cdp('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  anotar('Pellizco fluido en celular con CPU ×4: mediana del p95 ≤ 34 ms', mediana(pinzas) <= 34, 'p95 de 3 pasadas: ' + pinzas.join(', ') + ' ms');
  const scrollH = await ev("document.documentElement.scrollWidth <= innerWidth");
  anotar('Sin desplazamiento horizontal de la página en celular', scrollH);

  console.log('\nCasos límite');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: base + '&familia=Familia_Vacia' });
  await espera(1500);
  const bVacio = await ev("(() => { const b = document.getElementById('btnPrimeraPersona'); const r = b.getBoundingClientRect(); return document.getElementById('lienzoVacio').hidden ? null : [r.left + r.width / 2, r.top + r.height / 2]; })()");
  if (bVacio) { await clic(bVacio[0], bVacio[1]); await espera(1200); }
  anotar('Familia vacía: "Agregar primera persona" responde al ratón', !!bVacio && (await ev("document.querySelectorAll('.nodo').length")) === 1 && (await ev("!document.getElementById('fichaEditor').hidden")));
  await ev("(() => { const d = JSON.parse(localStorage.getItem('albumFamiliar:datos:v1')).filter((p) => p.id_familia !== 'Familia_Vacia'); localStorage.setItem('albumFamiliar:datos:v1', JSON.stringify(d)); })()");

  /* Datos que tardan 3 s en llegar: las chispas igual deben arrancar después
     de la entrada, no a medias ni ya terminadas. */
  const { identifier: retardo } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    Object.defineProperty(window, 'AlbumDatos', { configurable: true, get() { return undefined; }, set(v) {
      const original = v.obtenerPerfiles.bind(v);
      v.obtenerPerfiles = async (...a) => { await new Promise((r) => setTimeout(r, 3000)); return original(...a); };
      Object.defineProperty(window, 'AlbumDatos', { value: v, writable: true, configurable: true });
    } });` });
  await cdp('Page.navigate', { url: base });
  for (let i = 0; i < 80 && !(await ev("window.__relojAlDibujar != null").catch(() => false)); i++) await espera(100);
  const cronologia = await ev(`(() => { const ini = [...document.querySelectorAll('animateMotion')].map((a) => { try { return a.getStartTime(); } catch (e) { return -1; } });
     return { dibujo: +window.__relojAlDibujar.toFixed(2), primeraChispa: +Math.min(...ini).toFixed(2), sinIntervalo: ini.filter((x) => x < 0).length }; })()`);
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: retardo });
  anotar('Con datos lentos (3 s), las chispas arrancan tras la entrada del árbol', cronologia.sinIntervalo === 0 && cronologia.primeraChispa >= cronologia.dibujo + 1.5, JSON.stringify(cronologia));

  anotar('Ningún error de JavaScript en toda la sesión', errores.length === 0, errores.slice(0, 3).join(' | '));

  cerrar();
  srv.close();
  const fallos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallos.length}/${resultados.length} pruebas superadas`);
  fs.writeFileSync(path.join(os.tmpdir(), 'album-e2e-resultado.json'), JSON.stringify(resultados, null, 1));
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => { console.error('ERROR DEL ARNÉS:', e); process.exit(2); });
