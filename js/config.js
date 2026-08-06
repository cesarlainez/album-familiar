/* ══════════════════════════════════════════════════════════════
   CONFIG — Credenciales del backend (Supabase)
   ──────────────────────────────────────────────────────────────
   ⚠️  RELLENA ESTOS DOS VALORES con los de tu proyecto Supabase.
       Panel de Supabase → Project Settings → Data API / API Keys.

   · La `anon key` es PÚBLICA por diseño: puede vivir en el frontend.
     Lo que protege tus datos NO es ocultarla, sino las políticas RLS
     (Row Level Security) que activarás con el SQL de /backend.
   · NUNCA pongas aquí la `service_role` key: esa salta el RLS y solo
     debe usarse en el script de seed (que corre en tu máquina).

   Si dejas los valores como están ("TU_..."), la app funciona igual
   con los datos de prueba locales de datos.js — así puedes maquetar
   sin backend y conectarlo cuando quieras.
   ══════════════════════════════════════════════════════════════ */

window.ALBUM_CONFIG = {
  SUPABASE_URL: 'https://gmpuzwfpnlriardfqmvq.supabase.co',
  /* Clave PÚBLICA (esquema nuevo de Supabase: "publishable"). Segura en el
     frontend; lo que protege los datos son las políticas RLS. Si la conexión
     fallara con esta, usa la anon "eyJ..." de Settings → API Keys → Legacy. */
    SUPABASE_ANON_KEY: 'sb_publishable_ivgnraaRONBN7nvkmoo_IQ_F6JVOw5z',

  /* Tenant por defecto. Al añadir Auth, saldrá del JWT del usuario. */
  TENANT_POR_DEFECTO: 'Familia_Lainez',
};

/* ¿Hay credenciales reales o seguimos en modo local? */
window.ALBUM_CONFIG.hayBackend =
  !!window.ALBUM_CONFIG.SUPABASE_URL &&
  !window.ALBUM_CONFIG.SUPABASE_URL.startsWith('TU_') &&
  !!window.ALBUM_CONFIG.SUPABASE_ANON_KEY &&
  !window.ALBUM_CONFIG.SUPABASE_ANON_KEY.startsWith('TU_');
