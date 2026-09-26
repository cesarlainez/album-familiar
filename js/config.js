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
     Pega aquí tal cual el objeto que te da la consola. */
  FIREBASE: {
    apiKey: 'TU_API_KEY',
    authDomain: 'TU_PROYECTO.firebaseapp.com',
    projectId: 'TU_PROYECTO',
    storageBucket: 'TU_PROYECTO.firebasestorage.app',
    messagingSenderId: 'TU_SENDER_ID',
    appId: 'TU_APP_ID',
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

/* ¿Hay credenciales reales o seguimos en modo local? */
(function (cfg) {
  const sinRellenar = (v) => !v || String(v).indexOf('TU_') === 0;
  cfg.hayBackend =
    cfg.BACKEND === 'supabase'
      ? !sinRellenar(cfg.SUPABASE_URL) && !sinRellenar(cfg.SUPABASE_ANON_KEY)
      : !sinRellenar(cfg.FIREBASE.apiKey) && !sinRellenar(cfg.FIREBASE.projectId);
})(window.ALBUM_CONFIG);
