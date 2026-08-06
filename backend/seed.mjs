/* ══════════════════════════════════════════════════════════════
   SEED (JS) — Inyecta los perfiles de prueba vía SDK de Supabase
   ──────────────────────────────────────────────────────────────
   Alternativa programática a seed.sql. Corre en TU máquina, no en el
   navegador, y usa la SERVICE_ROLE key (salta RLS) — por eso jamás debe
   ir al frontend ni subirse a git.

   Uso:
     1) cd backend
     2) npm install
     3) copia .env.example a .env y rellena las 2 variables
     4) npm run seed
   ══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Carga mínima de .env sin dependencias externas */
const aquí = dirname(fileURLToPath(import.meta.url));
try {
  for (const línea of readFileSync(join(aquí, '.env'), 'utf8').split('\n')) {
    const m = línea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* sin .env: se usarán las variables ya presentes en el entorno */
}

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (revisa backend/.env).');
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

/* Perfil con contenido en blanco: solo nombre + relaciones. Los datos
   personales (fechas, disciplina, obra, biografía, fotos) se completan
   luego con el CRUD, porque son personas reales. */
const p = (o) =>
  Object.assign(
    {
      id_familia: 'Familia_Lainez',
      fecha_nacimiento: null, fecha_fallecimiento: null,
      disciplina_artistica: '', obra_maestra: '', biografia: '',
      galeria: [], id_padre: null, id_madre: null, id_pareja: [],
    },
    o
  );

/* Orden = de ancestros a descendientes: respeta las claves foráneas. */
const PERFILES = [
  /* Raíces */
  p({ id: 'julio-cesar', nombre_completo: 'Julio Cesar Lainez', id_pareja: ['maria-atanasia'] }),
  p({ id: 'maria-atanasia', nombre_completo: 'Maria Atanasia Otilia Alvarez Somoza', id_pareja: ['julio-cesar'] }),
  p({ id: 'yolanda', nombre_completo: 'Yolanda del Carmen Jimenez Benitez de Lainez', id_pareja: ['carlos-alfredo'] }),

  /* Hijos de Pareja 1 */
  p({ id: 'carlos-alfredo', nombre_completo: 'Carlos Alfredo Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia', id_pareja: ['yolanda'] }),
  p({ id: 'julio-cesar-hijo', nombre_completo: 'Julio Cesar Lainez (hijo)', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
  p({ id: 'cesar-mauricio', nombre_completo: 'Cesar Mauricio Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
  p({ id: 'pepe', nombre_completo: 'Pepe Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
  p({ id: 'lourdes', nombre_completo: 'Lourdes Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),

  /* Hijas solo del abuelo Julio Cesar (madre externa → medios hermanos).
     Iris = nombre temporal, para probar la edición. */
  p({ id: 'guadalupe', nombre_completo: 'Guadalupe Lainez', id_padre: 'julio-cesar' }),
  p({ id: 'iris', nombre_completo: 'Iris Lainez', id_padre: 'julio-cesar' }),

  /* Hijos de Pareja 2 */
  p({ id: 'carlos-g', nombre_completo: 'Carlos G. Lainez Jimenez', id_padre: 'carlos-alfredo', id_madre: 'yolanda' }),
  p({ id: 'cesar-alberto', nombre_completo: 'Cesar Alberto Lainez Jimenez', id_padre: 'carlos-alfredo', id_madre: 'yolanda' }),
];

console.log('🌱 Sembrando', PERFILES.length, 'perfiles en Familia_Lainez…');

/* upsert en orden preserva las FKs; onConflict sobre la PK compuesta */
for (const perfil of PERFILES) {
  const { error } = await db
    .from('perfiles')
    .upsert(perfil, { onConflict: 'id_familia,id' });
  if (error) {
    console.error('  ✗', perfil.id, '→', error.message);
    process.exit(1);
  }
  console.log('  ✓', perfil.nombre_completo);
}

console.log('✅ Semilla completada.');
