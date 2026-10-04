# Informe final: cómo hacer el Álbum Familiar más ágil y eficiente

## 1. Resumen

Hoy el problema está en la CPU del celular, no en la red. Producción tiene 60 perfiles y ninguna foto, así que una visita cuesta unas 61–63 lecturas y 68 KB (3,6 KB con gzip). En un celular de gama media (emulado con CPU ×4) pasa esto:

- `dibujar()` tarda 3,3–4,7 s, y 2,1–2,5 s de ese tiempo son del layout.
- La animación de entrada tarda unos 11 s en terminar.
- En reposo, las 48 chispas SMIL ocupan el 83–91 % del hilo principal.

Las fotos todavía no pesan, pero el diseño actual descarga todas antes de pintar. A escala de 4 fotos por persona serían 311 lecturas y unos 130 MB serializados por visita. Con eso, los 10 GiB/mes del plan Spark alcanzarían para solo 80–105 visitas al mes (proyección).

Con las victorias rápidas, el layout baja a 20–25 ms en escritorio (posiciones idénticas bit a bit) y el hilo en reposo a ~1 %. El árbol completo se vería en ~2 s en vez de 11 s. Con la carga diferida de fotos y la miniatura dentro del perfil, una visita quedaría en 63 lecturas y unos 0,83 MB, es decir, unas 8.900 visitas al mes. Conviene hacer esto **antes** de que la familia empiece a subir fotos, porque así no habrá datos que migrar.

## 2. Mediciones

| Dato | Valor | Cómo se midió |
|---|---|---|
| Producción hoy | 60 perfiles, 0 referencias de foto, colección `fotos` vacía; perfiles = 68.390 B (3.604 B gzip) | Solo lectura REST pública con `mask.fieldPaths` |
| Publicado frente al repo | Idéntico byte a byte | sha1 tras normalizar CRLF→LF |
| `calcularDisposicion`, 62 perfiles reales | Caliente 117–161 ms (mediana); frío 150–375 ms | Node 22, i5-10400, `datos.js` sin modificar |
| Peso de la línea `datos.js:427` | 63,7 % del tiempo propio; repulsión = 96,5 % del layout | `node --cpu-prof` |
| Variante con `Uint8Array` | 20–24,5 ms (62 p.), 127 ms (150 p.), 516 ms (300 p.); posiciones idénticas | Object.is + sha1 de todas las posiciones |
| Crecimiento del original | 150 p.: 652–831 ms; 300 p.: 2,6–3,5 s (∝ N²) | Familias sintéticas |
| `dibujar()` completo | 290–392 ms sin throttling; 3,3–4,7 s a ×4 | Chrome 154 headless, 390×844 DPR3, CDP |
| Hilo principal en reposo (×4) | 83–91 % con SMIL activo frente a 0,1–0,6 % pausado; con ficha abierta 96 % | `Performance.getMetrics`, ventanas de 5 s |
| Pan de 3,5 s (×4) | p95 33,3 ms con 31 frames largos, frente a 16,8 ms y 1 frame largo con chispas pausadas | Tracing CDP, 219 touchmove |
| Capas compuestas | 184 hoy; 79 sin `forwards`; 5–10 sin `forwards` ni latido | CDP LayerTree |
| Cascada de entrada | Último nodo a 10.920 ms y último hilo a 10.720 ms | Fórmulas de `lienzo.js:116/236` con N reales; delay medido |
| Memoria GPU | 184–189 MB con 62 portadas frente a 35–37 MB sin fotos | memory-infra, móvil emulado |
| Foto de 1600 px frente a miniatura 336×456 | Data URL de 480–727 KB frente a 28–34 KB (con fotos reales, 18,3 KB); decodificada 7,32 frente a 0,57 MiB | PIL + 23 JPEG reales |
| `innerHTML` con 62 data URLs grandes | 722 ms + 1.129 ms de decodificación, frente a 2 + 598 ms con blob y 15 + 12 ms con miniatura | Chrome escritorio |
| Estáticos de una visita en frío | 299 KB transferidos: SDK 53 %, fuentes 28 %, código propio 19 % | curl con gzip |
| Cadena de Auth en móvil | +135 KB gz (gapi + iframe) sobre los 41,5 KB del SDK de Auth, y se espera antes de la primera lectura | curl con UA de Android + lectura del SDK 12.4.0 |
| Regiones de filtro SVG | 30,03 Mpx en total; 29,95 Mpx en los hilos | `getBBox` en el sitio publicado, solo lectura |
| Lecturas por visita en frío (62 p.) | 63 / 125 / 187 / 311 con 0 / 1 / 2 / 4 fotos | Análisis de `firebase.js` |
| Sensibilidad del layout al orden | 1 fecha nueva mueve 37–62 tarjetas más de 100 px (máx. 3,2–3,6 km de px); con orden por id, 0 px | Node, 62 perfiles reales |
| Exportar PNG (×4, fotos sintéticas) | 9,7 s (toBlob 7,3 s); en JPEG 0,64 s | Banco CDP |
| Cuotas Spark | 1 GiB, 50.000 lecturas/día, 20.000 escrituras/día, 10 GiB/mes de salida sobre el mensaje serializado (sin gzip) | Documentación de Firebase |

Las cifras de móvil son emulación de CPU ×4, no un teléfono real. Todo lo relacionado con fotos es proyección.

## 3. Victorias rápidas (esfuerzo S)

| Id | Cambio | Archivo:línea | Ganancia esperada |
|---|---|---|---|
| H04 | `sinRepulsion` pasa de `Set` de strings a `Uint8Array(N*N)` con escritura simétrica | `js/datos.js:354, 427` | Layout de 117–161 a 20–24,5 ms en escritorio; a ×4, de 2,1–2,5 s a 0,2–0,67 s. Resultado idéntico bit a bit |
| H05 | Pausar el SMIL con un `Set` de motivos (`gesto`, `rueda`, `ficha`, `oculto`) más `repeatCount` finito (3) y `begin=(i%8)*0.7s` | `js/lienzo.js:238-248, 411-478`; `js/perfil.js:46, 68`; `js/app.js` | Hilo en reposo de 83–91 % a ~1 % (×4); p95 del pan de 33 a 17 ms. Con motivos, el orden pointerup→soltar deja de importar |
| H06 + H20 | Estado final en el estilo base con `backwards`; `revelar` termina en `filter:none`; latido del nudo finito, que además arregla que el nudo aparezca antes que su lazo | `css/galeria.css:492-530, 534-546, 552-581` | 184 → 5–10 capas (cota de raster de ~303 a ~16 MB); en zoom, Commit de 129 a 42 ms. H06 solo deja 79 capas |
| H21 | En reduced-motion: `animation-iteration-count:1`, `animation-delay:0s` y `.grano{animation:none}`; no crear chispas si `matchMedia(reduce)` | `css/galeria.css:1432-1437`; `js/lienzo.js:242-247` | Compositor de 264 a 10 frames en 5 s; se acaba la espera de 10 s con nodos invisibles |
| H14 | Retraso por fila (`200 + fila*150 ms`); `revelar` solo con opacidad; clase `.sin-entrada` con reglas explícitas (**no** `animation:none`, porque deja el árbol invisible) | `js/lienzo.js:116, 181, 190, 236`; `css/galeria.css:578-581` | Árbol visible en ~2 s en vez de 10,9 s; sin cascada tras cada guardado (redibujo de 799 a ~224 ms/s, orden de magnitud) |
| H09 (fase 1) | `<img>` creado con `createElement`, `img.src` por propiedad y `decoding='async'`; `pathLength=1` en vez de `getTotalLength()`; `DocumentFragment` | `js/lienzo.js:122-140, 233` | Se eliminan los ~700 ms de parseo con fotos grandes y 78–484 ms de `getTotalLength` a ×4 |
| C2 | Quitar `filter:url(#brilloHilo)` de `.hilo` y `.lazo`; halo con un segundo trazo sin filtro (ancho 4, opacidad 0,12) | `index.html:122-128`; `css/galeria.css:492-525`; `js/lienzo.js:227-230` | Región de desenfoque de 30 Mpx a 0,02 Mpx por rasterizado (coste en fps no medido). Acerca la pantalla al PNG |
| H03(c) | Propagar el error de lectura en vez de `return []` y mostrar «No se pudo cargar el álbum» | `js/datos.js:150-155`; `js/app.js:205` | Con la cuota agotada ya no se invita a «Agregar primera persona» sobre un árbol que existe |
| H16 (a, b) | Login y logout solo llaman a `aplicarModo`; la rama filtra `ultimosPerfiles` en memoria | `js/app.js:169, 176, 308, 341` | −63 lecturas y −3 a 5 s de redibujo y recentrado (×4) por acción |
| H10 | Auth compat diferido: `cargarAuth()` memoizado, solo al pulsar «Iniciar» o con la marca `album:edicion`; `cargarAlbum()` sin esperar a `sesion()` | `index.html:315-317`; `js/app.js:336-359`; `js/servicios/firebase.js:48, 188-205` | −177 KB gz y ~552 KB de JS para cada visitante móvil; +1,2–2,5 s en 4G (estimado). Un fallo de Auth ya no deja el álbum en blanco |
| H11 | `colFotos().where('perfil','==',id).get()` en lugar de leer la colección entera | `js/servicios/firebase.js:280` | Borrar pasa de 18,5–74 MB (proyección) a ≤2,6 MB, sin índices nuevos |
| H08 + H07 | Ordenar una copia por id (por unidades de código) dentro de `calcularDisposicion`; memoizar por huella ahí mismo, con `VERSION_LAYOUT` = `?v` de `datos.js` y el árbol persistido en `localStorage` | `js/datos.js:305` | Editar fechas mueve 0 px (hoy 37–62 tarjetas); en visitas repetidas no corre la física |
| — | Poner `?v=N` en el `<link>` de la hoja de estilos | `index.html:32` | Los cambios de CSS de esta lista llegan junto con su JS |

Otros cambios S de impacto bajo:

- **H18**, salida temprana: menos de 0,25 px durante 5 pasos, con un mínimo de 150 pasos. Detrás de H04 ahorra unos 16 ms.
- **H23**, versión mejorada: exportar en serie, PDF con `toBlob` sin base64 y opción JPG (0,64 s frente a 7,3 s). Hay que mantener `LADO_MAX=4000`.
- **H27**: anclar el nodo al centro de la foto. Ver la sección 5.

## 4. Mejoras de fondo (esfuerzo M/L)

**H01. Pintar sin esperar a las fotos (M, impacto alto)**
- **Problema:** `obtenerPerfiles` termina en `await hidratar(...)` (`firebase.js:68-94, 222-226`), que espera todas las fotos de todas las galerías aunque el lienzo solo usa `galeria[0]`. Con 4 fotos por persona son 311 lecturas y unos 90–98 MB por la red (~75 s a 10 Mbit/s) con la pantalla vacía.
- **Propuesta:**
  - `hidratar()` deja de esperar: sustituye solo lo que ya está en caché y deja el resto como `foto:{id}`.
  - Exponer `AlbumBackend.resolverFoto(ref)` (con caché y ~6 peticiones a la vez) y `resolverPerfiles(perfiles, {soloPortada})`.
  - El lienzo pinta las iniciales y asigna `img.src` al resolver, empezando por las portadas más cercanas a la cámara.
  - `Perfil.abrir`, el frente de la ficha y el carrusel resuelven bajo demanda (como máximo 4 lecturas).
  - Antes de `AlbumRespaldo.descargar`: `await resolverPerfiles(...)`. Antes de exportar: lo mismo con `{soloPortada:true}`.
- **Ganancia:** primer dibujo inmediato. Pasa a 125 lecturas por visita (~400 visitas/día) y deja de bajar las fotos 2–4, que son el 75 % de los bytes.
- **Riesgo:** que un `foto:x` llegue a un `src`, o que la exportación salga sin fotos sin ningún aviso, o que el .zip pierda su contenido (`respaldo.js:216-241`). Se mitiga con las resoluciones explícitas anteriores. El .zip v1 y los datos no cambian.

**H02. Miniatura dentro del perfil (M, impacto alto, requiere H01)**
- **Problema:** una tarjeta de 168×228 usa el JPEG de 1600 px. Son 7,3 MiB decodificados por foto y 184–189 MB de GPU con 62 portadas, cuando solo se ven 11.
- **Propuesta:**
  - Al elegir la portada, generar un recorte cover de 336×456 en JPEG 0,75 (~20–30 KB) y guardarlo en el campo `miniatura`, añadido a `fila()` (`firebase.js:163-178`).
  - Recalcular `miniatura` (o ponerla a null) siempre que llegue `galeria` en `cambios`.
  - Lienzo y exportar usan `miniatura || galeria[0]`.
  - En `descargar`, `delete p.miniatura` para que album.json siga siendo v1, y regenerarla al restaurar.
- **Ganancia:** junto con H01, 63 lecturas y ~0,83 MB por visita (≈8.900 visitas/mes); `perfiles.get()` crece de 68 KB a ~1,1–2,1 MB.
- **Riesgo:** una portada vieja si no se recalcula, y algo de blandura con zoom de 3×. Hoy no hay fotos, así que no hace falta migrar.

**H03. Caché entre visitas (M, impacto alto, requiere H01)**
- **Problema:** solo hay `Map` en memoria. Las fotos son inmutables por id y se vuelven a bajar en cada visita, y la salida de red se agota mucho antes que las lecturas.
- **Propuesta:**
  - Guardar las fotos en IndexedDB **como la misma data URL** con clave `fotoId`, consultarlo antes de Firestore y llamar a `recordar(fotoId, url)`. Nunca exponer `blob:` como src, porque `deshidratar` lo guardaría como URL externa.
  - Campo `version` en `familias/{id}` con `FieldValue.increment(1)` en `crear`, `actualizar`, `eliminar` y `guardarVarios`. Si coincide con la copia en `localStorage` y esta tiene menos de 24 h, se pinta sin `perfiles.get()`.
- **Ganancia:** una visita repetida desde el mismo dispositivo cuesta ~1 lectura. La primera visita de cada dispositivo sigue pagando el total, y por eso hace falta H02.
- **Riesgo:** algún camino de escritura que no suba la versión, o ediciones hechas a mano en la consola; lo mitiga la caducidad de 24 h. Safari purga el almacenamiento a los 7 días y entonces se vuelve a la red, como hoy. Las reglas no cambian.

**C1. Restauración por persona, reanudable (M, impacto alto)**
- **Problema:** `restaurar()` sube 248 fotos en serie (unos 4 min estimados) y escribe los perfiles al final, y además dos veces (`sinLazos`, un requisito heredado de SQL). Si la pestaña se congela, quedan fotos huérfanas y cero perfiles. Pico de memoria estimado de 300–400 MB.
- **Propuesta:**
  - Por cada persona, subir sus ≤4 fotos con un pool de 4 y escribir su perfil enseguida, con relaciones y en una sola pasada.
  - Usar como id de foto el SHA-256 del contenido, con un `get()` previo para no volver a subir lo que ya existe, así un reintento solo sube lo que falta.
  - Mantener en memoria solo la foto en curso.
  - Mostrar «persona k de 62» y pedir Wake Lock opcionalmente.
- **Ganancia:** la restauración se puede reanudar, ahorra 62 escrituras y ~1 min, y no deja la ventana de «árbol sin vínculos».
- **Riesgo:** con ids por contenido, dos perfiles pueden compartir una foto, así que cualquier borrado debe comprobar antes las referencias. El formato .zip v1 no cambia.

**H09, fases 2–3. Redibujo incremental (M, impacto medio)**
- **Problema:** cada guardado destruye y reconstruye 62 nodos y 118 elementos SVG.
- **Propuesta:** comparar la clave estructural (0,017 ms). Si no cambió, actualizar solo el texto y la portada del nodo editado a través de `elementosNodo`. El `keydown` debe leer el perfil por `dataset.id`. A los nodos nuevos, `--retraso: 0`.
- **Ganancia:** evita entre 126 y 208 ms (0,8–2,5 s a ×4) en cada edición de contenido.
- **Riesgo:** que `elementosNodo` y `this.perfiles` se desincronicen. Solo se toma el atajo cuando la estructura es idéntica.

**H16 (d). Escrituras en lote (M, impacto medio)**
- **Problema:** `agregarPareja` hace 3 escrituras en serie y `guardar` hace 1+k.
- **Propuesta:** `WriteBatch` para el alta con su enlace y para la actualización con `_sincronizarParejas`, y escribir el marcador de familia solo en la primera alta. Hay que mantener la relectura tras cada CRUD.
- **Ganancia:** 2–3 idas y vueltas menos (0,2–0,6 s estimados) y atomicidad. No ahorra cuota.
- **Riesgo:** cambia la API del servicio, nada más.

**H19. Altas sin desorientar (M, impacto bajo)**
- **Problema:** un alta reacomoda todo el árbol y la cámara se queda quieta.
- **Propuesta:** con H08 y H04 ya aplicados, mantener el cálculo en frío y determinista, animar la transición con FLIP (solo `transform` por nodo, sin tocar la transform de `#mundo`) y centrar la cámara en el nodo nuevo. Para «Ver rama», sembrar desde las posiciones del árbol completo.
- **Ganancia:** experiencia de uso; en CPU, casi nada.
- **Riesgo:** bajo. El arranque en caliente persistido queda solo como último recurso, porque arrastra historial y añade lecturas y escrituras.

## 5. Agilidad del código

- **Orden canónico (H08) y memo dentro de `calcularDisposicion` (H07):** el layout pasa a ser una función estable de la estructura. Facilita depurar («mismo árbol, mismas posiciones») y que `VERSION_LAYOUT = ?v` invalide la caché sin pensarlo.
- **Una sola puerta para las fotos (`resolverFoto`/`resolverPerfiles`, H01):** solo el lienzo y la ficha conocen el prefijo `foto:`. Los olvidos que hoy romperían el respaldo o la exportación quedan en un sitio.
- **Pausa por motivos (H05):** un `Set` en lugar de pares pausa/reanuda. Elimina errores de orden de eventos.
- **Geometría compartida (H27, impacto visual bajo):** la curva de filiación está duplicada (`lienzo.js:209-218` y `exportar.js:171-176`) y 168×228 aparece en 3 sitios. Exponer `Lienzo.curvaFiliacion` y reutilizarla en exportar. Anclar el nodo al centro de la foto (`ANCLA_Y=0`, `.nodo__disciplina` limitada a 2 líneas y `_bbox` de +60 a +110) corrige hilos descentrados hasta 26 px y fotos desalineadas hasta 33,5 px.

Higiene de bajo coste. No mejora el rendimiento y se descartó por eso, pero ahorra tiempo y evita errores:

- **Pruebas con `node --test`, sin npm (H12):** ya se probó que funciona. Comprueban cero solapes, 7 filas, determinismo y el .zip v1 de ida y vuelta (exponiendo `AlbumRespaldo._zip`), y detectan `:hover` fuera de `@media (hover:hover)`, que hoy son 12 reglas. El fixture debe ser sintético, porque Pages publica todo el repo.
- **Entorno de desarrollo (H13):** que `config.js` detecte localhost para no trabajar contra la Firestore de producción por defecto. Reemplazar la semilla de 12 personas, copiada 4 veces, por `recuperado-2026-08-25.json` (`.perfiles`) y corregir el README (`npx serve`).
- **Fallo del SDK (H28):** si `AlbumBackend` no existe, mostrar un aviso. **No** caer en silencio al modo local, porque se perderían ediciones.
- **Limpieza (H29, H33):** borrar los restos de Supabase (499 líneas) y el CSS muerto (`.modal*`, `.carrusel`, `.ficha-datos`, ~95 líneas), conservando `touch-action:pan-y` de `.carrusel__marco` y `.lienzo.desenfocado`. Unificar `descargarBlob`, `iniciales` y `fechasDe`. Ojo con el margen: 650 KiB en base64 dejan solo un 1,4 % hasta el límite de 900.000 caracteres de `firestore.rules`.

## 6. Lo que NO conviene hacer

- **`enablePersistence` (H03 alt.):** con `get()` por defecto va al servidor igual, no ahorra lecturas ni salida y además cachea fotos hasta 40 MiB.
- **`blob:` URLs como `src` (H03a, H17):** `deshidratar` las escribiría en Firestore como referencias rotas.
- **Guardar las fotos como `Bytes` (H17):** viajan igual en base64 por WebChannel. Ahorran ~25 % de almacenamiento, que no hace falta, y añaden riesgo.
- **Chispas con WAAPI/transform:** medido, deja 129 capas y empeora el pan.
- **Reducir el número de chispas:** con 1 sola ya se ocupa el 73 % del hilo; hay que pausar.
- **Recortar `ITERACIONES` a un número fijo (100–600):** 0 de 7 filas conservan su orden.
- **Sembrar la espiral por hash del id:** sigue moviendo 44–60 de 62 tarjetas.
- **`animation:none` en `.sin-entrada`:** deja el árbol invisible, porque la opacidad base es 0.
- **`onSnapshot` de perfiles (H16):** con un layout tan sensible al orden, las tarjetas saltarían por las ediciones de otros.
- **Parche local en vez de releer tras cada CRUD:** `_sincronizarParejas` podría pisar cambios ajenos.
- **Firestore Lite / ESM (H24):** −54 KB gz solo en la primera visita, a cambio de reescribir Auth y perder `onSnapshot` y la persistencia.
- **Service worker (H25):** ahorra ~1 RTT y arriesga JS nuevo con CSS viejo en celulares de los que cuesta retirarlo.
- **Hash por archivo y hook para `?v` (H26):** el ETag de Pages cambia en todos los archivos a cada despliegue; basta con poner `?v` a la hoja de estilos.
- **Web Worker para el layout (H31):** tras H04 el cálculo queda en 20–25 ms; solo tendría sentido con 150–300 personas, y nunca enviando perfiles con fotos.
- **Fuentes asíncronas o alojadas en el repo (H32):** el CSS de 941 B no es el cuello de botella; `display=swap` ya está.
- **Quitar el `backdrop-filter` de la ficha (H22):** tras H05 el desenfoque se calcula una sola vez; el ahorro es marginal.
- **Quitar la capa de grano (H30):** son ~9–10 MB de GPU; lo que importa es el bucle con reduced-motion, que ya cubre H21.
- **Barrido de fotos huérfanas (H15):** hoy no hay fotos, `eliminar()` ya borra las huérfanas por `perfil` y C1 evita duplicados.
- **`LADO_MAX` a 2800 o `createImageBitmap` con las dos dimensiones fijas (H23):** baja la calidad de impresión y deforma las fotos que no son 3:4.

## 7. Orden de implementación recomendado

1. **H04 (+ H18 opcional)** en `datos.js`, con `?v` nuevo. Es el mayor ahorro de CPU, sin riesgo y con resultado idéntico. Ninguna dependencia.
2. **Bloque de animación y pintado:** H05, H06 + H20, H21, C2 y `?v` en la hoja de estilos (`index.html:32`), en un solo commit. Comprobar a ojo el estado final de opacidades y `dashoffset`. Ninguna dependencia.
3. **H14** (cascada por fila, `revelar` sin blur, `.sin-entrada` con reglas explícitas). Va después del paso 2 porque toca las mismas reglas de `galeria.css`.
4. **H09 fase 1** (`img.src` por propiedad, `decoding`, `pathLength`). Probar `pathLength` en iOS Safari.
5. **H03(c) y H16 (a, b):** mensaje de error en lugar de familia vacía; login, logout y rama sin red.
6. **H10**, Auth diferido. Probar en Android e iOS que la primera escritura tras la carga diferida va autenticada y que un editor con sesión no vuelve a ver el candado.
7. **H08 y después H07**, con huella y `VERSION_LAYOUT` ligado a `?v`. Avisar a la familia del cambio visual único.
8. **H11**, borrado acotado. Una línea, independiente.
9. **H01**, pintar sin esperar a las fotos. Hacerlo **antes de que se suban fotos**. Es requisito de 10, 11 y de la parte de portadas de H23.
10. **H02**, miniatura en el perfil (requiere 9).
11. **H03 (a, b)**, caché de fotos en IndexedDB y versión de familia (requiere 9; mejor después de 10).
12. **C1**, restauración por persona y reanudable. Independiente, pero conviene tenerla antes de necesitar un respaldo con fotos.
13. **Opcionales:** H09 fases 2–3, H16 (d), H23 mejorada, H27, H19 (FLIP) y la higiene de la sección 5, empezando por las pruebas `node --test` para blindar los pasos 1, 7 y 12.