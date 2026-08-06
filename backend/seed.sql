-- ══════════════════════════════════════════════════════════════
-- ÁLBUM FAMILIAR — Semilla: familia fundadora "Familia_Lainez"
-- ──────────────────────────────────────────────────────────────
-- Se siembran NOMBRES y RELACIONES exactos. Los campos de contenido
-- (fechas, disciplina, obra, biografía, fotos) quedan en blanco: son
-- personas reales y se completan luego con el CRUD (botón "Editar").
--
--   Pareja 1: Julio Cesar Lainez × Maria Atanasia Otilia Alvarez Somoza
--     hijos: Carlos Alfredo, Julio Cesar (hijo), Cesar Mauricio, Pepe, Lourdes
--   Solo del abuelo Julio Cesar (madre externa → medios hermanos):
--     Guadalupe, Iris  (Iris = nombre temporal, para probar la edición)
--   Pareja 2: Carlos Alfredo Lainez × Yolanda del Carmen Jimenez Benitez
--     hijos: Carlos G. Lainez Jimenez, Cesar Alberto Lainez Jimenez
--
-- OPCIÓN A — SQL puro:  Supabase → SQL Editor → pegar → Run.
-- OPCIÓN B — script JS: `node backend/seed.mjs` (ver README).
--
-- Idempotente. El ORDEN importa: primero raíces (padres), luego hijos,
-- porque id_padre / id_madre son claves foráneas.
-- ══════════════════════════════════════════════════════════════

insert into public.perfiles
  (id_familia, id, nombre_completo, fecha_nacimiento, fecha_fallecimiento,
   disciplina_artistica, obra_maestra, biografia, galeria, id_padre, id_madre, id_pareja)
values
  -- ── Raíces ──────────────────────────────────────────────────
  ('Familia_Lainez', 'julio-cesar', 'Julio Cesar Lainez',
   null, null, '', '', '', array[]::text[], null, null, array['maria-atanasia']),

  ('Familia_Lainez', 'maria-atanasia', 'Maria Atanasia Otilia Alvarez Somoza',
   null, null, '', '', '', array[]::text[], null, null, array['julio-cesar']),

  ('Familia_Lainez', 'yolanda', 'Yolanda del Carmen Jimenez Benitez de Lainez',
   null, null, '', '', '', array[]::text[], null, null, array['carlos-alfredo']),

  -- ── Hijos de Pareja 1 (padre Julio Cesar, madre Maria Atanasia) ──
  ('Familia_Lainez', 'carlos-alfredo', 'Carlos Alfredo Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', 'maria-atanasia', array['yolanda']),

  ('Familia_Lainez', 'julio-cesar-hijo', 'Julio Cesar Lainez (hijo)',
   null, null, '', '', '', array[]::text[], 'julio-cesar', 'maria-atanasia', array[]::text[]),

  ('Familia_Lainez', 'cesar-mauricio', 'Cesar Mauricio Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', 'maria-atanasia', array[]::text[]),

  ('Familia_Lainez', 'pepe', 'Pepe Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', 'maria-atanasia', array[]::text[]),

  ('Familia_Lainez', 'lourdes', 'Lourdes Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', 'maria-atanasia', array[]::text[]),

  -- ── Hijas SOLO del abuelo Julio Cesar (medios hermanos) ─────────
  ('Familia_Lainez', 'guadalupe', 'Guadalupe Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', null, array[]::text[]),

  ('Familia_Lainez', 'iris', 'Iris Lainez',
   null, null, '', '', '', array[]::text[], 'julio-cesar', null, array[]::text[]),

  -- ── Hijos de Pareja 2 (padre Carlos Alfredo, madre Yolanda) ─────
  ('Familia_Lainez', 'carlos-g', 'Carlos G. Lainez Jimenez',
   null, null, '', '', '', array[]::text[], 'carlos-alfredo', 'yolanda', array[]::text[]),

  ('Familia_Lainez', 'cesar-alberto', 'Cesar Alberto Lainez Jimenez',
   null, null, '', '', '', array[]::text[], 'carlos-alfredo', 'yolanda', array[]::text[])

on conflict (id_familia, id) do update set
  nombre_completo      = excluded.nombre_completo,
  fecha_nacimiento     = excluded.fecha_nacimiento,
  fecha_fallecimiento  = excluded.fecha_fallecimiento,
  disciplina_artistica = excluded.disciplina_artistica,
  obra_maestra         = excluded.obra_maestra,
  biografia            = excluded.biografia,
  galeria              = excluded.galeria,
  id_padre             = excluded.id_padre,
  id_madre             = excluded.id_madre,
  id_pareja            = excluded.id_pareja;
