# Álbum Familiar — "La Galería Nocturna"

Plataforma SaaS multi-tenant para árboles genealógicos visuales. Frontend en
HTML/CSS/JS puro (sin build step); backend en **Supabase** (Postgres + Storage + RLS).

El lienzo no es un organigrama jerárquico: es un **grafo libre (force-directed)**
en espacio infinito. La familia crece hacia arriba (ancestros), a los lados
(tíos/primos) y hacia abajo (descendientes). Las posiciones se derivan por
simulación física de las relaciones `id_padre` / `id_madre`; no hay coordenadas
en el código.

```
Album Familiar/
├─ index.html            Lienzo, modal y visor
├─ css/galeria.css       Estilo "Galería Nocturna"
├─ js/
│  ├─ config.js          ← credenciales Supabase (RELLENAR)
│  ├─ servicios/
│  │  └─ supabase.js     Cliente y consulta de perfiles
│  ├─ datos.js           Capa de datos + layout + semilla de respaldo
│  ├─ lienzo.js          Pan / zoom / nodos / hilos de luz
│  ├─ perfil.js          Modal, carrusel (máx. 3), pantalla completa
│  └─ app.js             Arranque
└─ backend/
   ├─ schema.sql         Tabla, índices, RLS y bucket de Storage
   ├─ seed.sql           Semilla en SQL puro
   ├─ seed.mjs           Semilla vía SDK (Node)
   ├─ package.json
   └─ .env.example
```

> **Sin configurar nada**, la app ya se ve con los 12 perfiles de la familia
> fundadora (modo maqueta, datos locales) y el CRUD funciona en memoria. Los
> pasos de abajo la conectan a datos reales y persistentes en la nube.

---

## Puesta en marcha (local, sin backend)

Ábrela con cualquier servidor estático (los `file://` no ejecutan `fetch` en
algunos navegadores):

```bash
npx serve .
```

Y visita la URL que imprima (p. ej. `http://localhost:3000`).

---

## Conectar el backend (Supabase) — 5 pasos

### 1. Crear el proyecto
1. Entra en <https://supabase.com> → **New project**.
2. Anota la contraseña de la base de datos (la pide una vez).

### 2. Crear la tabla, el RLS y el bucket
1. En el panel: **SQL Editor → New query**.
2. Pega el contenido de [`backend/schema.sql`](backend/schema.sql) y pulsa **Run**.

Esto crea la tabla `perfiles`, sus índices, activa Row Level Security con una
**política de lectura pública** (adecuada para esta iteración sin login) y crea
el bucket `galeria` de Storage.

### 3. Sembrar la familia fundadora
Inyecta los 12 perfiles reales de la "Familia_Lainez" (2 parejas, hijos comunes,
2 medios hermanos). Solo se siembran **nombres y relaciones**; los demás campos
quedan en blanco para completarse desde el CRUD. Elige **una** vía:

- **SQL (rápido):** SQL Editor → pega [`backend/seed.sql`](backend/seed.sql) → **Run**.
- **Node (programático):**
  ```bash
  cd backend
  npm install
  cp .env.example .env      # y rellena SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  npm run seed
  ```

### 4. Copiar las credenciales al frontend
En el panel: **Project Settings → API** (o **Data API / API Keys**). Copia:

| Valor del panel Supabase        | Dónde va                                                    |
|---------------------------------|-------------------------------------------------------------|
| **Project URL**                 | `js/config.js` → `SUPABASE_URL` **y** `backend/.env` → `SUPABASE_URL` |
| **anon / public key**           | `js/config.js` → `SUPABASE_ANON_KEY`                        |
| **service_role key** (secreta)  | solo `backend/.env` → `SUPABASE_SERVICE_ROLE_KEY`           |

Edita [`js/config.js`](js/config.js):

```js
window.ALBUM_CONFIG = {
  SUPABASE_URL: 'https://abcdxyz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',   // anon/public key
  TENANT_POR_DEFECTO: 'Familia_Lainez',
};
```

### 5. Recargar
Vuelve a abrir la app. En la consola del navegador **no** debe aparecer el aviso
de "uso semilla local": ahora los nodos vienen de Supabase.

---

## Variables / claves — resumen

| Clave                        | Pública | Dónde                       | Para qué                          |
|------------------------------|:-------:|-----------------------------|-----------------------------------|
| `SUPABASE_URL`               | sí      | `js/config.js`, `backend/.env` | Endpoint del proyecto          |
| `SUPABASE_ANON_KEY`          | sí      | `js/config.js`              | Lectura desde el navegador (con RLS) |
| `SUPABASE_SERVICE_ROLE_KEY`  | **NO**  | `backend/.env` únicamente   | Seed en tu máquina (salta RLS)    |

- La `anon key` es pública **por diseño**: lo que protege los datos es el **RLS**,
  no ocultarla.
- La `service_role key` es secreta y está en `.gitignore` vía `backend/.env`.

---

## Cómo fluyen los datos

1. `app.js` llama a `AlbumDatos.obtenerPerfiles('Familia_Lainez')`.
2. `datos.js` decide: si hay credenciales → `SupabaseServicio` consulta
   `perfiles WHERE id_familia = 'Familia_Lainez'`; si no, usa la semilla local.
3. `datos.js` calcula el **layout de grafo libre** (fuerzas: repulsión entre
   nodos + resortes en las aristas de parentesco) y `lienzo.js` dibuja los
   **hilos de luz** entre cada par, en cualquier dirección.
4. Al hacer clic en un nodo, `perfil.js` abre una **flip card 3D**: una tarjeta
   se ancla sobre el nodo, crece y gira 180° (`rotateY` + `backface-visibility`).
   El frente muestra foto + nombre; el reverso, los datos (`fechas`,
   `disciplina_artistica`, `obra_maestra`, `biografia`), un mini carrusel y los
   botones de CRUD. Clic fuera (velo) o en cerrar → gira de vuelta y se encoge
   al tamaño del nodo.

### Mantenimiento (CRUD) desde el modal

Cada perfil abierto muestra una barra de acciones:

- **Editar** — nombre, fechas, disciplina, obra, biografía y hasta 4 fotos (URL o subida directa).
- **+ Pareja / + Hijo / + Padre-Madre** — crean un nodo ya vinculado y lo abren
  en edición para nombrarlo. "+ Hijo" cuelga de la pareja si existe.
- **Eliminar** — con confirmación; limpia también las referencias de pareja.

Funciona con backend (Supabase) y en modo local (los cambios viven en memoria
durante la sesión). El `schema.sql` incluye políticas RLS de **escritura pública**
para esta fase sin login; sustitúyelas por las políticas por-usuario (comentadas
en el mismo archivo) al activar Auth.

### Medios hermanos y familias ensambladas

- Si el `id_padre` y la `id_madre` de un hijo **son pareja**, su hilo nace del
  **punto medio del lazo** (descendencia conjunta).
- Si el hijo comparte **un solo** progenitor presente (madre/padre externo, no
  registrado), el hilo nace **directo de ese progenitor**, ignorando el lazo de
  la pareja actual. Ejemplo sembrado: Guadalupe e Iris, solo del abuelo Julio Cesar.

### Parejas / matrimonios

- El campo `id_pareja` (array `text[]`, soporta varias parejas) enlaza cónyuges.
- Los miembros de una pareja se disponen **lado a lado en horizontal** (barra
  rígida en la simulación de fuerzas).
- El vínculo de pareja se dibuja distinto al de padre/hijo: **línea punteada
  ámbar** (`.lazo`) con un **nudo de luz** en el centro, frente al hilo sólido
  en gradiente frío de la filiación (`.hilo`).
- Si el `id_padre` y la `id_madre` de un hijo son pareja entre sí, su hilo
  **nace del punto medio del lazo** (descendencia conjunta), no de cada padre
  por separado.

Añadir una persona nueva en la tabla la coloca y conecta sola: la simulación de
fuerzas reacomoda el grafo. No hay coordenadas fijas en el código.

---

## Siguiente iteración (Auth)

`backend/schema.sql` ya incluye, comentadas, las políticas RLS por usuario:
cada cuenta llevará su `id_familia` en un *custom claim* del JWT y solo verá y
editará su propia familia. Al activar Auth, se sustituye la política de lectura
pública por esas dos.
