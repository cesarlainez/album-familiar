-- ══════════════════════════════════════════════════════════════
-- ÁLBUM FAMILIAR — Esquema de base de datos (Supabase / PostgreSQL)
-- ──────────────────────────────────────────────────────────────
-- Ejecutar en:  Supabase → SQL Editor → New query → pegar → Run.
-- Es idempotente: puedes correrlo varias veces sin romper nada.
-- ══════════════════════════════════════════════════════════════

-- ── Tabla de perfiles (un nodo del árbol = una persona) ─────────
create table if not exists public.perfiles (
  id_familia            text        not null,               -- Tenant (SaaS)
  id                    text        not null,               -- PK dentro del tenant
  nombre_completo       text        not null,
  fecha_nacimiento      date,
  fecha_fallecimiento   date,
  disciplina_artistica  text,
  obra_maestra          text,
  biografia             text,
  galeria               text[]      not null default '{}',  -- hasta 3 URLs
  id_padre              text,
  id_madre              text,
  id_pareja             text[]      not null default '{}',  -- parejas/cónyuges
  creado_en             timestamptz not null default now(),

  -- La clave primaria es COMPUESTA: el mismo `id` puede repetirse
  -- entre familias distintas, pero es único dentro de una familia.
  constraint perfiles_pk primary key (id_familia, id),

  -- Las conexiones del árbol apuntan a personas de la MISMA familia.
  constraint perfiles_padre_fk
    foreign key (id_familia, id_padre)
    references public.perfiles (id_familia, id) on delete set null,
  constraint perfiles_madre_fk
    foreign key (id_familia, id_madre)
    references public.perfiles (id_familia, id) on delete set null,

  -- Tope de 3 fotos por perfil (regla de la "Galería Nocturna").
  constraint perfiles_galeria_max3 check (cardinality(galeria) <= 3)
);

-- Migración: si la tabla ya existía de una versión anterior, añade la columna.
alter table public.perfiles
  add column if not exists id_pareja text[] not null default '{}';

-- Índices para el trazado de los "hilos de luz" y la carga por tenant.
create index if not exists perfiles_familia_idx  on public.perfiles (id_familia);
create index if not exists perfiles_padre_idx    on public.perfiles (id_familia, id_padre);
create index if not exists perfiles_madre_idx    on public.perfiles (id_familia, id_madre);


-- ── Row Level Security: el aislamiento REAL entre familias ──────
-- Sin RLS, la anon key podría leer cualquier familia. Con RLS activo,
-- el servidor filtra por política, no por el cliente.
alter table public.perfiles enable row level security;

-- ┌───────────────────────────────────────────────────────────┐
-- │ ITERACIÓN 2 (sin Auth todavía): lectura pública.            │
-- │ Deja ver el álbum a cualquiera con la anon key. Adecuado    │
-- │ para maquetar y demostrar. Sin permiso de escritura.        │
-- └───────────────────────────────────────────────────────────┘
drop policy if exists "lectura publica perfiles" on public.perfiles;
create policy "lectura publica perfiles"
  on public.perfiles for select
  to anon, authenticated
  using (true);

-- ┌───────────────────────────────────────────────────────────┐
-- │ ESCRITURA para el CRUD de esta fase (sin Auth todavía).     │
-- │ Permite insertar/editar/borrar con la anon key. Es abierto  │
-- │ a propósito para poder mantener los datos desde la UI;      │
-- │ ⚠️ reemplázalo por las políticas por-usuario de la Iteración │
-- │ 3 (más abajo) en cuanto actives Auth.                       │
-- └───────────────────────────────────────────────────────────┘
drop policy if exists "escritura publica perfiles" on public.perfiles;
create policy "escritura publica perfiles"
  on public.perfiles for insert
  to anon, authenticated
  with check (true);

drop policy if exists "edicion publica perfiles" on public.perfiles;
create policy "edicion publica perfiles"
  on public.perfiles for update
  to anon, authenticated
  using (true) with check (true);

drop policy if exists "borrado publico perfiles" on public.perfiles;
create policy "borrado publico perfiles"
  on public.perfiles for delete
  to anon, authenticated
  using (true);

-- ┌───────────────────────────────────────────────────────────┐
-- │ ITERACIÓN 3 (cuando actives Auth): descomenta lo de abajo   │
-- │ y BORRA la política pública anterior. Cada usuario llevará  │
-- │ su familia en un custom claim `id_familia` dentro del JWT,  │
-- │ y solo verá/editará su propio tenant.                       │
-- └───────────────────────────────────────────────────────────┘
-- drop policy if exists "lectura publica perfiles" on public.perfiles;
--
-- create policy "ver mi familia"
--   on public.perfiles for select to authenticated
--   using (id_familia = (auth.jwt() ->> 'id_familia'));
--
-- create policy "editar mi familia"
--   on public.perfiles for all to authenticated
--   using      (id_familia = (auth.jwt() ->> 'id_familia'))
--   with check (id_familia = (auth.jwt() ->> 'id_familia'));


-- ══════════════════════════════════════════════════════════════
-- STORAGE — Bucket para las fotografías de la galería
-- ══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('galeria', 'galeria', true)
on conflict (id) do nothing;

-- Lectura pública de las imágenes del bucket (para poder mostrarlas).
drop policy if exists "galeria lectura publica" on storage.objects;
create policy "galeria lectura publica"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'galeria');
