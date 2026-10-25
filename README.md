# Álbum Familiar — "La Galería Nocturna"

Plataforma SaaS multi-tenant para árboles genealógicos visuales. Frontend en
HTML/CSS/JS puro (sin build step); backend en **Firebase** (Firestore + Auth).

El lienzo no es un organigrama jerárquico: es un **grafo libre (force-directed)**
en espacio infinito. La familia crece hacia arriba (ancestros), a los lados
(tíos/primos) y hacia abajo (descendientes). Las posiciones se derivan por
simulación física de las relaciones `id_padre` / `id_madre`; no hay coordenadas
en el código.

```
Album Familiar/
├─ index.html            Lienzo, modal y visor
├─ aportar.html          Página para aportar sin cuenta (voz, foto, recuerdo)
├─ css/galeria.css       Estilo "Galería Nocturna"
├─ js/
│  ├─ config.js          ← credenciales de Firebase (RELLENAR)
│  ├─ servicios/
│  │  ├─ firebase.js     Backend activo: Firestore + Auth
│  │  └─ supabase.js     Backend anterior (dormido)
│  ├─ datos.js           Capa de datos + layout + semilla de respaldo
│  ├─ lienzo.js          Pan / zoom / nodos / hilos de luz
│  ├─ perfil.js          Modal, carrusel (máx. 4), pantalla completa
│  ├─ respaldo.js        Copia de seguridad .zip (escribe y lee a mano)
│  ├─ lugares.js         Catálogo de lugares + fonética en español + búsqueda
│  ├─ buscador.js        Buscar personas, lugares, años y familias
│  ├─ atlas.js           Atlas de raíces: mapa y línea de tiempo
│  ├─ aportes.js         Enlaces de aportes y bandeja de revisión
│  ├─ aportar.js         La página aportar.html
│  ├─ puentes.js         Puentes con otras familias
│  └─ app.js             Arranque
└─ backend/
   ├─ firestore.rules    Reglas de seguridad (pegar en la consola)
   ├─ semilla-familia-lainez.json  Semilla restaurable desde la app
   ├─ schema.sql         (Supabase) Tabla, índices, RLS y bucket
   ├─ seed.sql           (Supabase) Semilla en SQL puro
   ├─ seed.mjs           (Supabase) Semilla vía SDK (Node)
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

## Conectar el backend (Firebase) — 5 pasos

> **Por qué Firebase.** El proyecto gratuito de Supabase se pausa por
> inactividad y, si sigue pausado, se borra. Así se perdió el álbum una vez.
> Los proyectos de Firebase no se pausan por estar quietos. El servicio viejo
> sigue en `js/servicios/supabase.js` por si algún día hay que volver.

### 1. Crear el proyecto
[console.firebase.google.com](https://console.firebase.google.com) -> **Agregar
proyecto**. Google Analytics no hace falta: dile que no.

### 2. Crear la base de datos
**Compilacion -> Firestore Database -> Crear base de datos**. Elige el modo de
**producción** (las reglas de verdad las pegas en el paso 4) y la región más
cercana (`nam5` o `us-central` sirven).

No hace falta activar Cloud Storage: las fotos se guardan dentro de Firestore,
cada una en su documento. Es a propósito — Storage exige plan de pago en los
proyectos nuevos y este álbum tiene que vivir gratis.

### 3. Crear la clave familiar
**Compilacion -> Authentication -> Comenzar -> Correo electrónico/contraseña**:
actívalo y guarda. Luego, pestaña **Users -> Agregar usuario**, con el correo de
`AUTH_EMAIL` (por defecto `cesarlainez@hotmail.com`) y la contraseña que será la
clave que teclea la familia.

### 4. Publicar las reglas de seguridad
**Firestore Database -> pestaña Reglas** -> pega el contenido de
[`backend/firestore.rules`](backend/firestore.rules) -> **Publicar**.

**Cada vez que cambie `firestore.rules` hay que volver a publicarlo.** Sin las
reglas de octubre de 2026, el Atlas y el buscador funcionan, pero los Aportes y
los Puentes responden «permiso denegado».

Sin esto el álbum queda abierto de par en par: la configuración de `config.js`
es pública por diseño, y son las reglas las que impiden que un desconocido
borre el árbol.

### 5. Copiar las credenciales al frontend
**Configuración del proyecto (rueda dentada) -> Tus apps -> icono web `</>`** ->
registra la app (sin hosting) y copia el objeto `firebaseConfig`. Pégalo en el
bloque `FIREBASE` de [`js/config.js`](js/config.js).

Recarga la página. Si los valores siguen en `TU_...`, la app arranca en modo
local con la semilla de prueba y no toca la nube.

### Sembrar la familia
Con la base vacía, entra en **modo edición** (botón *Iniciar*, clave del paso 3)
y usa **Descargar -> Restaurar copia...** con
[`backend/semilla-familia-lainez.json`](backend/semilla-familia-lainez.json):
son los 12 nombres y sus relaciones, sin fotos ni fechas. Si ya tienes una copia
de seguridad de verdad (`.zip`), restaura esa en su lugar.

---

## Copia de seguridad — hazla

**La nube no es un respaldo.** El proyecto gratuito de Supabase que alojaba el
álbum se pausó por inactividad y acabó borrándose: con él se fue todo lo que no
estaba en este repositorio. Firebase no se pausa, pero una cuenta se puede
perder, un borrado es un clic y ningún plan gratuito promete nada. Descarga la
copia.

En el menú **Descargar** hay dos entradas para esto:

- **Copia de seguridad (.zip)** — un único archivo con `album.json` (todos los
  perfiles, fechas, biografías y relaciones) y la carpeta `fotos/` con cada
  imagen descargada de la nube. Respalda siempre la familia completa, aunque
  estés viendo una rama filtrada.
- **Restaurar copia…** (solo en modo edición) — vuelve a guardar las fotos y
  reescribe los perfiles. No borra a nadie: actualiza lo que existe
  y crea lo que falta, así que sirve tanto para recuperar como para mudarse a
  un proyecto nuevo.

El ZIP se escribe y se lee a mano en `js/respaldo.js`, sin librerías y sin
comprimir (las fotos ya son JPEG). Se abre con cualquier descompresor, y las
fotos quedan ahí como archivos normales aunque el código desaparezca.

Guarda el .zip fuera de la máquina: correo, Drive, un disco externo. Hazlo cada
vez que agregues fotos o personas.

## Variables / claves — resumen

| Clave                     | Pública | Dónde           | Para qué                             |
|---------------------------|:-------:|-----------------|--------------------------------------|
| `FIREBASE.apiKey`         | sí      | `js/config.js`  | Identifica al proyecto desde el navegador |
| `FIREBASE.projectId`      | sí      | `js/config.js`  | Base de datos a la que se habla      |
| Clave familiar            | **NO**  | en la cabeza    | Contraseña del usuario de Auth: abre el modo edición |

- La configuración de Firebase es pública **por diseño** — viaja en el código de
  cualquier web que use Firebase. Lo que protege los datos son las **reglas** de
  `backend/firestore.rules`, no esconderla.
- La clave familiar no se guarda en ningún archivo del repositorio. Si se filtra,
  se cambia en Authentication → Users → ⋮ → Restablecer contraseña.

---

## Cómo fluyen los datos

1. `app.js` llama a `AlbumDatos.obtenerPerfiles('Familia_Lainez')`.
2. `datos.js` decide: si hay credenciales → `AlbumBackend` (hoy el servicio de
   Firebase) lee `familias/Familia_Lainez/perfiles`; si no, usa la semilla local.
   Las fotos viven en `familias/{familia}/fotos`, un documento por imagen, y el
   servicio las cambia por su `data URL` al leer; el resto de la app solo ve
   cadenas que puede poner en un `<img>`.
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

Funciona con backend (Firebase) y en modo local (los cambios se guardan en
`localStorage`). Quien no tiene la clave ve el álbum pero no lo edita: la barra
de acciones se oculta, y `backend/firestore.rules` lo impide de verdad en el
servidor — lectura abierta, escritura solo con sesión.

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

## Atlas, buscador, aportes y puentes

Las tres propuestas de [`docs/PLAN-SAAS.md`](docs/PLAN-SAAS.md), funcionando con
el backend de hoy (sin servidores ni costos extra).

### Atlas de raíces y buscador
- En **Editar**, cada persona tiene tres lugares (nacimiento, residencia,
  fallecimiento): un catálogo con los 14 departamentos y los 44 municipios de la
  reorganización de 2024, más las ciudades de la diáspora, y un campo libre para
  el distrito, el cantón o el caserío.
- **Atlas** dibuja en SVG (sin Google Maps ni cuotas) la familia sobre El
  Salvador o el mundo, con arcos de migración y una línea de tiempo por décadas.
- **Buscar** (o la tecla `/`) busca por nombre *según cómo suena* (Laínez =
  Lainez = Lainés; Vásquez = Vázquez), por lugar y por año o década (`1930s`).
  También encuentra otras familias registradas por apellido y lugar, usando un
  **resumen** que se guarda en el documento de cada familia al editarla.

### Aportes sin cuenta
- **Aportes → Crear enlace** genera un enlace con token aleatorio de 192 bits,
  vigente 14 días y con un tope de 40 aportes (lo imponen las reglas: un enlace
  filtrado no puede llenar la base), para compartir por WhatsApp.
- Quien lo abre (`aportar.html`) graba una nota de voz (hasta 3 min, Opus
  24 kbps), sube una foto (se reduce en el teléfono) o escribe un recuerdo.
- Todo cae en la **bandeja**: nada se publica hasta aprobarlo y elegir a qué
  persona va. Los enlaces se pueden revocar; lo publicado se puede quitar.
- La bandeja lista solo datos ligeros; la grabación o la foto de cada aporte
  vive aparte (`aportes/{id}/carga/datos`) y se baja al pulsar «Escuchar».
- Las voces viven en `familias/{id}/audios` y entran en la copia `.zip`
  (carpeta `voces/`), y se restauran con ella.

### Puentes con otras familias
- **Puentes → Buscar coincidencias** compara este árbol con las familias que
  comparten apellidos (según el resumen de cada familia, que se guarda cuando
  alguien con la clave la abre; una familia que nadie ha abierto todavía no
  aparece). Solo propone un puente si coinciden el nombre de pila y un
  apellido, la época (±10 años, si se sabe) **y además** un padre, una madre o un
  cónyuge en el mismo papel. Como mucho 5 propuestas por búsqueda.
- La otra familia ve la propuesta sin saber quién la hizo; al aceptar las dos, la
  tarjeta lleva un sello dorado y la ficha enlaza al otro árbol («Ver allí»).
- Límite conocido: con la clave compartida de hoy, quien tiene la clave puede
  aceptar por los dos lados. Se resuelve con las cuentas por familia del plan.

### Fechas con solo el año
Muchas fechas reales se conocen solo por el año (`1938`). El selector de fecha no
puede mostrarlas; antes, guardar la ficha borraba ese año. Ahora se conserva
mientras nadie toque el campo, y el editor lo avisa debajo.

---

## Siguiente iteración (multi-familia)

Hoy todas las personas cuelgan de `familias/{id_familia}`, y la clave familiar es
una sola cuenta compartida: quien entra puede editar cualquier familia. Para
alojar varias familias de verdad hace falta una cuenta por familia y reglas que
comparen `request.auth` con el `id_familia` del documento. La estructura de
Firestore ya está preparada para eso; solo faltan las reglas y el registro.
