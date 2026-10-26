/* ══════════════════════════════════════════════════════════════
   MUDANZA — llevar el álbum a otro proyecto de Firebase
   ──────────────────────────────────────────────────────────────
   Para cuando el proyecto de siempre ya no se puede administrar (por
   ejemplo, se olvidó con qué cuenta se creó). El camino:

     1. Descargar la copia de seguridad (.zip) del proyecto actual.
     2. Crear un proyecto nuevo (los pasos están en el README).
     3. Pegar aquí su `firebaseConfig`: se prueba la conexión y se usa
        SOLO en este navegador (localStorage; ver js/config.js).
     4. Entrar con la clave nueva y «Restaurar copia…».
     5. Cuando todo esté bien, cambiar js/config.js para todos.

   Mientras tanto, cualquier otro visitante sigue viendo el original.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CLAVE = 'albumFamiliar:proyecto';
  const CAMPOS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

  /** Saca los campos de lo que se pegue: el objeto que muestra Firebase
   *  ("const firebaseConfig = { apiKey: "…", … }"), JSON, o solo las
   *  líneas. Devuelve null si falta lo imprescindible. */
  function leerConfig(texto) {
    const salida = {};
    CAMPOS.forEach((k) => {
      const m = new RegExp('["\']?' + k + '["\']?\\s*[:=]\\s*["\']([^"\']+)["\']').exec(String(texto || ''));
      if (m) salida[k] = m[1].trim();
    });
    if (!/^AIza[\w-]{20,}$/.test(salida.apiKey || '')) return null;
    if (!/^[a-z0-9-]{4,40}$/.test(salida.projectId || '')) return null;
    if (!salida.authDomain) salida.authDomain = salida.projectId + '.firebaseapp.com';
    return salida;
  }

  /** Abre una conexión aparte con el proyecto pegado y lee la colección
   *  de familias: así se sabe si existe y si sus reglas ya están puestas. */
  async function probar(config) {
    if (!global.firebase || !global.firebase.initializeApp) throw new Error('El SDK de Firebase no está cargado.');
    const app = global.firebase.initializeApp(config, 'prueba-' + Date.now());
    /* Un proyecto que no existe no siempre falla: a veces solo no
       contesta. A los 15 s se da por perdido. */
    const conTope = (promesa) => Promise.race([promesa, new Promise((_, no) =>
      setTimeout(() => no(Object.assign(new Error('sin respuesta'), { code: 'sin respuesta en 15 s' })), 15000))]);
    try {
      const familias = await conTope(app.firestore().collection('familias').get());
      /* La regla nueva de audios es de lectura libre: si responde, las
         reglas publicadas son las de este álbum y no las de fábrica. */
      let reglasNuevas = true;
      try {
        await conTope(app.firestore().collection('familias').doc('_').collection('audios').doc('_').get());
      } catch (e) {
        reglasNuevas = false;
      }
      return { ok: true, familias: familias.size, reglasNuevas };
    } catch (e) {
      const codigo = String(e.code || e.message || '');
      if (/permission-denied/.test(codigo)) return { ok: true, familias: null, reglasNuevas: false };
      return { ok: false, error: codigo };
    } finally {
      app.delete().catch(() => {});
    }
  }

  function Mudanza(opciones) {
    this.o = opciones; // { toast }
    this.panel = $('panelMudar');
    this.config = null;
    this._conectar();
    this._avisoActivo();
  }

  Mudanza.prototype.abrir = function () {
    const cfg = global.ALBUM_CONFIG || {};
    this.panel.hidden = false;
    $('mudarActual').textContent = cfg.proyectoAlterno
      ? 'En este navegador estás usando el proyecto «' + cfg.proyectoAlterno + '». El de todos sigue siendo «' + cfg.FIREBASE_ORIGINAL.projectId + '».'
      : 'Proyecto actual: «' + (cfg.FIREBASE || {}).projectId + '».';
    $('mudarVolver').hidden = !cfg.proyectoAlterno;
    this._estado('');
  };

  Mudanza.prototype.cerrar = function () {
    this.panel.hidden = true;
  };

  Mudanza.prototype._estado = function (texto, tipo) {
    const el = $('mudarEstado');
    el.textContent = texto;
    el.className = 'panel__nota' + (tipo ? ' mudar__estado--' + tipo : '');
  };

  /** Franja fija mientras este navegador usa otro proyecto: que nadie
   *  crea que lo que ve aquí es lo que ven los demás. */
  Mudanza.prototype._avisoActivo = function () {
    const cfg = global.ALBUM_CONFIG || {};
    const aviso = $('avisoMudanza');
    if (!cfg.proyectoAlterno) { aviso.hidden = true; return; }
    aviso.textContent = '';
    aviso.appendChild(document.createTextNode('Este navegador usa el proyecto nuevo «' + cfg.proyectoAlterno + '». Los demás aún ven el original. '));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-crud btn-crud--mini';
    b.textContent = 'Ver la mudanza';
    b.addEventListener('click', () => this.abrir());
    aviso.appendChild(b);
    aviso.hidden = false;
  };

  Mudanza.prototype._conectar = function () {
    const probarBtn = $('mudarProbar');
    const usarBtn = $('mudarUsar');
    probarBtn.addEventListener('click', async () => {
      const config = leerConfig($('mudarConfig').value);
      usarBtn.disabled = true;
      this.config = null;
      if (!config) {
        this._estado('No encontré apiKey y projectId en lo que pegaste. Copia el bloque firebaseConfig completo de la consola.', 'error');
        return;
      }
      probarBtn.disabled = true;
      this._estado('Probando la conexión con «' + config.projectId + '»…');
      const r = await probar(config).catch((e) => ({ ok: false, error: e.message }));
      probarBtn.disabled = false;
      if (!r.ok) {
        this._estado('No se pudo conectar con «' + config.projectId + '» (' + r.error + '). Revisa que copiaste bien los datos y que el proyecto tiene Firestore creado.', 'error');
        return;
      }
      this.config = config;
      usarBtn.disabled = false;
      if (!r.reglasNuevas) {
        this._estado('Conecta con «' + config.projectId + '», pero todavía no tiene las reglas del álbum: publícalas (backend/firestore.rules) antes de restaurar. Puedes usarlo igual para seguir.', 'aviso');
      } else {
        this._estado('Todo bien: «' + config.projectId + '» responde y tiene las reglas del álbum' +
          (r.familias ? ' (ya tiene ' + r.familias + ' familia' + (r.familias === 1 ? '' : 's') + ').' : ' (está vacío, listo para restaurar).'), 'ok');
      }
    });
    usarBtn.addEventListener('click', () => {
      if (!this.config) return;
      if (!global.confirm('Este navegador pasará a usar «' + this.config.projectId + '». Después: «Iniciar» con la clave NUEVA y «Descargar → Restaurar copia…».\n\n¿Continuar?')) return;
      try {
        localStorage.setItem(CLAVE, JSON.stringify(this.config));
      } catch (e) {
        global.alert('Este navegador no deja guardar la configuración: ' + e.message);
        return;
      }
      location.reload();
    });
    $('mudarVolver').addEventListener('click', () => {
      try { localStorage.removeItem(CLAVE); } catch (e) { /* nada que quitar */ }
      location.reload();
    });
    $('mudarDescargar').addEventListener('click', () => {
      this.cerrar();
      $('descargarRespaldo').click();
    });
  };

  global.Mudanza = Mudanza;
  global.AlbumMudanza = { leerConfig };
})(window);
