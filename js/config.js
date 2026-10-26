/* ══════════════════════════════════════════════════════════════
   CONFIG — Credenciales del backend
   ──────────────────────────────────────────────────────────────
   ⚠️  RELLENA EL BLOQUE `FIREBASE` con los datos de tu proyecto:
       consola de Firebase → ⚙ Configuración del proyecto → "Tus apps"
       → app web → objeto `firebaseConfig`. Son valores PÚBLICOS por
       diseño (viajan en cualquier página web que use Firebase); lo
       que protege el álbum son las reglas de seguridad de Firestore,
       en backend/firestore.rules.

   Por qué Firebase y no Supabase: el proyecto gratuito de Supabase se
   pausa por inactividad y acaba borrándose — así se perdió el álbum
   una vez. Los proyectos de Firebase no se pausan por estar quietos.
   El servicio antiguo sigue en js/servicios/supabase.js: para volver
   a él basta poner BACKEND: 'supabase' y cargar su SDK en index.html.

   Si dejas los valores como están ("TU_..."), la app funciona igual
   con los datos de prueba locales de datos.js — así puedes maquetar
   sin backend y conectarlo cuando quieras.

   Y pase lo que pase: descarga la copia de seguridad (menú Descargar).
   La nube es comodidad, no respaldo.
   ══════════════════════════════════════════════════════════════ */

window.ALBUM_CONFIG = {
  /* 'firebase' (actual) o 'supabase' (el backend anterior). */
  BACKEND: 'firebase',

  /* ── Firebase ───────────────────────────────────────────────
     Proyecto: album-familiar-lainez (mudado desde albumfamiliar-101cf,
     cuya cuenta de Google ya no se recordaba). Este es el proyecto que
     usa TODA la familia: cuenta de Firebase = cesaralainez@gmail.com. */
  FIREBASE: {
    apiKey: 'AIzaSyBaUTbEhEkTSjvdxnPbmi6D1VmHlMDWtuE',
    authDomain: 'album-familiar-lainez.firebaseapp.com',
    projectId: 'album-familiar-lainez',
    storageBucket: 'album-familiar-lainez.firebasestorage.app',
    messagingSenderId: '748664627285',
    appId: '1:748664627285:web:5cabcdd94f9f7f4048b4dc',
  },

  /* ── Supabase (backend anterior, en desuso) ───────────────── */
  SUPABASE_URL: 'TU_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'TU_SUPABASE_ANON_KEY',

  /* Tenant por defecto. */
  TENANT_POR_DEFECTO: 'Familia_Lainez',

  /* ── Clave familiar ─────────────────────────────────────────
     El álbum se protege con UNA clave compartida por la familia:
     por debajo es una cuenta de Firebase Authentication cuyo correo
     es este identificador y cuya contraseña es la clave que la
     familia teclea. La sesión se recuerda por dispositivo. */
  PROTEGER_CON_CLAVE: true,
  AUTH_EMAIL: 'cesarlainez@hotmail.com',
};

/* ── Mudanza a otro proyecto ─────────────────────────────────
   «Descargar → Mudar a otro proyecto…» puede guardar en ESTE navegador
   los datos de un proyecto de Firebase nuevo: así se prueba, se entra
   con la clave nueva y se restaura la copia antes de cambiar este
   archivo para todos. Los demás visitantes siguen en el de arriba. */
(function (cfg) {
  cfg.FIREBASE_ORIGINAL = Object.assign({}, cfg.FIREBASE);
  cfg.proyectoAlterno = null;
  try {
    const guardado = JSON.parse(localStorage.getItem('albumFamiliar:proyecto') || 'null');
    if (guardado && /^AIza[\w-]{20,}$/.test(guardado.apiKey || '') && /^[a-z0-9-]{4,40}$/.test(guardado.projectId || '')) {
      cfg.FIREBASE = {
        apiKey: guardado.apiKey,
        authDomain: guardado.authDomain || guardado.projectId + '.firebaseapp.com',
        projectId: guardado.projectId,
        storageBucket: guardado.storageBucket || '',
        messagingSenderId: guardado.messagingSenderId || '',
        appId: guardado.appId || '',
      };
      cfg.proyectoAlterno = guardado.projectId;
    }
  } catch (e) { /* sin almacenamiento: se usa el proyecto de siempre */ }
})(window.ALBUM_CONFIG);

/* ¿Hay credenciales reales o seguimos en modo local? */
(function (cfg) {
  const sinRellenar = (v) => !v || String(v).indexOf('TU_') === 0;
  cfg.hayBackend =
    cfg.BACKEND === 'supabase'
      ? !sinRellenar(cfg.SUPABASE_URL) && !sinRellenar(cfg.SUPABASE_ANON_KEY)
      : !sinRellenar(cfg.FIREBASE.apiKey) && !sinRellenar(cfg.FIREBASE.projectId);
  /* ?modo=local → trabaja con los datos de prueba del navegador y NUNCA
     toca la nube. Sirve para desarrollar y para las pruebas automáticas
     sin arriesgar el álbum real. */
  if (/[?&]modo=local(&|$)/.test(location.search)) cfg.hayBackend = false;
})(window.ALBUM_CONFIG);
