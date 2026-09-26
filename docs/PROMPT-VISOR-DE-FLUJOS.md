# Prompt listo para pedir un "Visor de Flujos"

Copia **todo** lo que hay debajo de la línea y pégalo como primer mensaje en un
proyecto nuevo (carpeta vacía) de Claude Code. Está escrito para producir la
misma arquitectura visual del Álbum Familiar, pero para representar un
**proceso/flujo** en vez de una familia.

Antes de pegar, cambia solo estas tres cosas:

1. El **nombre y tema** del proyecto (donde dice `Flujo Vivo` y la paleta).
2. El **flujo de ejemplo** del paso 6 (pon uno real tuyo: 8–15 pasos).
3. Si no quieres backend, borra la sección "Fase 4".

---

# Proyecto: "Flujo Vivo" — visor interactivo de procesos

Quiero que construyas una aplicación web para **visualizar y recorrer un
proceso de negocio** como un mapa interactivo, no como una imagen estática ni
un organigrama rígido. Trabaja en fases, y al terminar cada fase deténte,
muéstrame el resultado en el navegador y espera mi confirmación.

## Restricciones técnicas (no negociables)

- **HTML + CSS + JavaScript puro (ES2019), sin build step y sin librerías**: ni
  React, ni D3, ni dagre, ni mermaid, ni jsPDF. Todo se abre con un servidor
  estático simple.
- Módulos en IIFE que exponen un global (`FlujoDatos`, `Lienzo`, `Ficha`,
  `Exportar`), un fichero por responsabilidad. Nada de `<script type=module>`.
- Comentarios en español, explicando el **por qué** de cada decisión no obvia
  (no el qué). Nombres de variables y funciones en español.
- Accesible: nodos con `role="button"`, `tabIndex`, `aria-label`, navegables
  con Tab y activables con Enter/Espacio; `prefers-reduced-motion` respetado.
- Debe funcionar igual de bien con ratón y con dedo (móvil real de 390 px).
- Incluye un `serve.py` de desarrollo que sirva la carpeta con
  `Cache-Control: no-store`, y versiona los `<script src="...?v=N">` en el
  HTML (subiendo N cada vez que cambies JS), porque si no el navegador sirve
  código viejo y perdemos horas depurando fantasmas.

## Estructura de ficheros

```
index.html            capas del lienzo, <defs> del SVG, panel de detalle
css/flujo.css         tokens de diseño, nodos, conectores, panel, responsive
js/config.js          configuración (título, tema, backend opcional)
js/datos.js           carga del flujo + MOTOR DE LAYOUT (lo más importante)
js/lienzo.js          cámara (pan/zoom/gestos) + render de nodos y conectores
js/ficha.js           panel/tarjeta de detalle de un paso
js/exportar.js        re-dibujo en <canvas> -> PNG y PDF hecho a mano
datos/flujo.json      el flujo de ejemplo
serve.py              servidor de desarrollo con no-store
README.md             cómo correrlo y cómo editar el JSON
```

## Modelo de datos (`datos/flujo.json`)

```json
{
  "id_flujo": "onboarding_cliente",
  "titulo": "Alta de cliente nuevo",
  "carriles": [
    { "id": "cliente",  "nombre": "Cliente",  "color": "#4aa3ff" },
    { "id": "ventas",   "nombre": "Ventas",   "color": "#f5b942" },
    { "id": "sistemas", "nombre": "Sistemas", "color": "#7ee0b0" }
  ],
  "pasos": [
    {
      "id": "p1",
      "titulo": "Solicitud recibida",
      "tipo": "inicio",
      "carril": "cliente",
      "responsable": "Portal web",
      "duracion": "inmediato",
      "sistema": "Web público",
      "descripcion": "Texto largo opcional, se muestra en el panel de detalle.",
      "entradas": ["Formulario completo"],
      "salidas": ["Expediente creado"],
      "riesgos": "Datos incompletos si el usuario abandona a mitad.",
      "adjuntos": []
    }
  ],
  "transiciones": [
    { "de": "p1", "a": "p2", "etiqueta": "", "tipo": "normal" },
    { "de": "p3", "a": "p4", "etiqueta": "Aprobado",  "tipo": "si" },
    { "de": "p3", "a": "p9", "etiqueta": "Rechazado", "tipo": "no" },
    { "de": "p7", "a": "p3", "etiqueta": "Reproceso", "tipo": "retorno" }
  ]
}
```

- `tipo` de paso: `inicio | tarea | decision | espera | automatico | fin`.
- `tipo` de transición: `normal | si | no | retorno | excepcion`.
- **Ninguna coordenada en el JSON ni en el código.** Todas las posiciones se
  calculan; si yo añado un paso al JSON, debe colocarse y conectarse solo.

## Fase 1 — Lienzo infinito y cámara

Construye el esqueleto visual con esta arquitectura exacta:

- Dos espacios de coordenadas y una sola fórmula:
  `pantalla = mundo * escala + desplazamiento`. La cámara son solo dos valores
  en memoria (`escala`, `desplazamiento`).
- **Una única `transform`** sobre un contenedor `#mundo`
  (`translate3d(x,y,0) scale(s)`, `transform-origin: 0 0`, `will-change:
  transform`). Todo el contenido —conectores SVG y nodos HTML— vive dentro, así
  el navegador compone en GPU y nada se desalinea nunca. Prohibido mover los
  nodos uno por uno.
- Capas: fondo del lienzo → `svg` de conectores (`pointer-events:none`) → `div`
  de nodos → cabecera y overlays (z-index superiores, `pointer-events:none` con
  los hijos en `auto`).
- El SVG de conectores se coloca en un plano amplio desplazado
  (`left:-5000px; top:-5000px; width:10000px; height:10000px; overflow:visible`)
  y se suma un `SVG_OFFSET = 5000` a cada coordenada, para poder dibujar en
  coordenadas negativas del mundo.
- Añade `[hidden] { display: none !important; }` en el CSS. Sin esa regla, un
  overlay con `display:flex` sigue presente aunque esté `hidden` e intercepta
  todos los clics del lienzo.

Gestos con **Pointer Events** (un solo camino para ratón, dedo y lápiz):

- Arrastrar con 1 puntero = pan; 2 punteros = pinza que hace zoom **anclado en
  el punto medio** entre los dedos.
- Rueda: `escala *= Math.exp(-deltaY * 0.0016)`, anclada en el cursor —
  calcula el punto del mundo bajo el cursor, cambia la escala y recoloca el
  desplazamiento para que ese punto siga exactamente bajo el cursor.
- `setPointerCapture` dentro de try/catch para no perder el gesto si el dedo
  sale del contenedor.
- **El clic sobre un nodo NO se escucha en el nodo** (la captura del contenedor
  se lo comería): resuélvelo en el `pointerup` del contenedor comparando la
  distancia recorrida, con umbral distinto por dispositivo:
  `e.pointerType === 'mouse' ? 5 : 22` px. Con el dedo siempre hay temblor de
  5–15 px y un umbral de ratón hace que muchos toques legítimos no abran nada.
- **Clamp de pan**: el centro del viewport nunca puede salir de la caja del
  contenido, así es imposible perder el diagrama arrastrando. Y al terminar un
  gesto, si no quedó ningún nodo visible, vuelve al más cercano con una
  animación breve (350 ms).
- Todo pan/zoom debe pasar por un único método `_aplicar()`, donde viven el
  clamp y el indicador de porcentaje de zoom.
- Botones "Encuadrar todo" (tecla C), zoom + / −, y en móvil (viewport
  ≤ 768 px) si encuadrar todo dejaría los nodos ilegibles (escala < 0.6),
  arranca al 70 % centrado en el centroide del flujo en vez de mostrar todo en
  miniatura: ver todo a la vez no sirve si no se distingue nada.

## Fase 2 — Motor de layout (el corazón del proyecto)

Quiero un layout **automático, determinista y con garantías duras**. Nada de
`Math.random()` ni de coordenadas a mano: el mismo JSON debe dar siempre el
mismo dibujo.

Implementa un layout por capas (estilo Sugiyama simplificado) en
`FlujoDatos.calcularDisposicion()`:

1. **Nivel de cada paso = camino más largo desde los pasos de inicio** (DFS
   memoizado sobre el grafo de transiciones).
   - Ignora para el cálculo de nivel las transiciones de `tipo: "retorno"` y
     `"excepcion"`, y **corta los ciclos** (si un nodo ya está en la pila de
     recursión, devuelve 0). Un flujo real siempre tiene reprocesos; si un
     ciclo puede romper el layout, el diagrama explota. Esto no es opcional.
2. **Anclaje duro de filas**: `y = nivel * ALTURA_NIVEL` (usa 260 px). Con las
   filas ancladas, el solape entre niveles es imposible por construcción.
3. **Orden dentro de la fila por baricentro**, recorriendo las filas de arriba
   hacia abajo: la x deseada de cada nodo es la media de las x (ya definitivas)
   de sus predecesores; los nodos sin predecesor conservan su orden de
   aparición en el JSON como desempate.
4. **Empaquetado exacto 1-D por fila**: ordena la fila por la x deseada, barre
   de izquierda a derecha imponiendo
   `x[k] >= x[k-1] + mitadAncho[k-1] + mitadAncho[k] + AIRE` y recentra la fila
   en su media original.
5. **Garantías que debes poder demostrarme** al final de la fase, midiendo con
   JS sobre el flujo de ejemplo y también sobre un flujo grande generado (60
   pasos con dos ciclos y una decisión de tres salidas):
   - ningún par de nodos se solapa (ni sus etiquetas);
   - ningún nodo queda por encima de su predecesor (salvo en transiciones de
     retorno, que por definición suben);
   - el número de cruces de conectores es el mínimo razonable — dime cuántos
     quedan y por qué son inevitables.

Si `carriles` está definido, ofrece un modo **"por carriles"** conmutable: los
carriles son bandas verticales (columnas) con su título fijo y un fondo muy
tenue con el color del carril, y la x del nodo se restringe a su banda mientras
el nivel sigue dando la y. Debe poder apagarse y volver al layout libre.

## Fase 3 — Lenguaje visual

Estética **oscura y cinematográfica**, sobria y elegante, no "corporativa
PowerPoint":

- Fondo con degradado radial (`#1e1e1e` al centro → `#000` en los bordes), más
  una capa de atmósfera fija con viñeta radial y un grano sutil generado con un
  SVG `feTurbulence` en `data:` URI (opacidad ~0.035). `pointer-events:none`.
- Tipografía: Montserrat para títulos (peso 200–400, `letter-spacing` amplio,
  mayúsculas) e Inter para texto.
- Define **tokens CSS** en `:root`: paleta, curva de animación compartida
  (`--curva: cubic-bezier(0.22,1,0.36,1)`), duraciones y geometría del nodo.

**Nodos** (HTML, no SVG — para tener `line-clamp`, sombras en capas y
accesibilidad gratis):

- Tarjeta posicionada por JS con `left`/`top` en su **centro**, corregida con
  `transform: translate(-50%,-50%)` en CSS.
- Cada `tipo` de paso tiene forma y acento propios, reconocibles de un vistazo:
  `inicio`/`fin` en cápsula, `tarea` rectangular, `decision` con esquinas
  recortadas o rombo, `automatico` con un icono/borde distinto, `espera`
  punteado. Muestra un badge pequeño con el responsable y otro con la duración.
- Barra o punto de color del carril al que pertenece.
- Entrada escalonada por CSS: `animation-delay: var(--retraso)` (el JS solo
  pasa `260 + i*90` ms) y un keyframe que va de `opacity:0; filter:blur(12px)`
  a nítido.
- Hover **solo dentro de `@media (hover: hover)`**: `scale(1.12)`,
  `z-index` elevado, sombra más amplia y halo cálido. En táctil el hover se
  queda pegado tras el toque y ensucia la interacción siguiente.

**Conectores** (SVG):

- Trazo con `stroke: url(#gradConector)` y un filtro
  `feGaussianBlur(2.5) + feMerge` con el `SourceGraphic`: el trazo nítido sobre
  su propio difuminado. Eso da la sensación de "hilo de luz".
- Ruta: curva Bézier cúbica con tangentes verticales en los anclajes (sale por
  el borde inferior del origen y entra por el borde superior del destino), de
  modo que las líneas caen limpias. Para transiciones de `retorno`, ruta
  claramente distinta: por el lateral, con arqueo mayor, punteada.
- Distingue por **lenguaje visual, no por etiqueta**: `normal` sólido frío;
  `si` verde tenue; `no` ámbar/rojizo tenue; `retorno` punteado
  (`stroke-dasharray: 1 8`); `excepcion` fino y rojizo. Flecha en punta con un
  `<marker>`.
- Etiqueta de la transición (cuando exista) centrada en la curva, con un
  rectángulo de fondo semiopaco para que se lea sobre cualquier cosa.
- Animación de aparición dibujándose: `strokeDasharray = path.getTotalLength()`
  y animar `stroke-dashoffset` desde ese largo hasta 0.
- Una **partícula que recorre el conector** en bucle, hecha con un `<circle>` y
  `<animateMotion>` sobre el mismo `d` (duración y `begin` variados por índice
  para que no vayan en manada). Es lo que hace que el flujo se sienta "vivo".
  Debe poder apagarse con un botón "Reducir movimiento" y respetar
  `prefers-reduced-motion`.

## Fase 4 — Interacción y lectura del flujo

- **Tocar/clicar un paso** debe, en un solo gesto: centrar la vista en él
  (animación de ~450 ms sin cambiar el zoom) y abrir su detalle.
- **Detalle**: tarjeta que aparece anclada y crece hasta ocupar buena parte de
  la pantalla, con el efecto flip 3D del Álbum Familiar: contenedor con
  `perspective: 2400px`, interior con `transform-style: preserve-3d` y
  `rotateY(180deg)` al abrir, dos caras con `backface-visibility: hidden` (la
  trasera pre-rotada). El JS solo alterna la clase y la escala (0.28 → 1), de
  modo que **crece y gira a la vez**. Fuerza un reflow
  (`void carta.offsetWidth`) antes de cambiar la transform en vez de usar
  `requestAnimationFrame`: el navegador frena los rAF cuando la pestaña no
  tiene foco y la animación no se reproduce.
  - Frente: número de paso, título, tipo y carril.
  - Reverso: responsable, sistema, duración, descripción, entradas, salidas,
    riesgos, y la lista de transiciones de entrada y de salida como **botones
    que navegan** al paso correspondiente (centrándolo y abriéndolo).
  - **Ningún título de sección debe mostrarse si su campo viene vacío**: pon el
    par título+valor en un bloque y hazlo `hidden` cuando el valor esté en
    blanco.
  - Cierra al clicar el velo, con Escape, o en el botón. Mientras se cierra,
    `pointer-events:none` en la capa y un guard de 450 ms sobre el botón de
    cerrar, porque si no el velo en salida se come el siguiente toque y parece
    que hay que tocar dos veces.
- **Resaltar camino**: al seleccionar un paso, atenúa (opacidad baja +
  desaturado) todo lo que no esté en su camino hacia atrás y hacia adelante.
  Botón/chip para volver a la vista completa.
- **Buscar** por título o responsable, con `datalist`: al elegir, centra y abre
  ese paso.
- **Recorrido guiado**: botones ◀ / ▶ que avanzan por el camino principal paso
  a paso, centrando y abriendo cada uno. Con teclado: flechas izquierda y
  derecha.
- `touch-action: none` en el lienzo; si añades algún carrusel o zona con
  scroll horizontal, ponle `touch-action: pan-y`, porque si no el navegador
  reclama el gesto y llega un `pointercancel` en medio del swipe.

## Fase 5 — Exportar

Botón "Descargar" con menú de dos opciones, **sin librerías externas**:

- **PNG**: vuelve a dibujar el flujo en un `<canvas>` (misma caja envolvente +
  margen de 200 px + una cabecera con el título del flujo, tope de 4000 px por
  lado, fondo radial, conectores como curvas, nodos con su forma y su texto
  ajustado a 2 líneas) y usa `canvas.toBlob()`.
- **PDF**: construye a mano un PDF de una página incrustando ese canvas como
  JPEG con `/DCTDecode`, con la tabla `xref` calculada por offsets reales.
  Nombre de fichero con el flujo y la fecha.

## Fase 6 — Datos de ejemplo

Usa este flujo real como semilla (sustitúyelo por el mío si te doy otro), y
comprueba que el layout lo resuelve bien, incluido el reproceso:

> *(pon aquí tu flujo: pasos numerados, quién hace cada uno, y las decisiones
> con sus dos salidas. Ejemplo:*
> 1. Cliente envía solicitud (Cliente / Portal web)
> 2. Validar documentación (Ventas)
> 3. ¿Documentación completa? → No: 3b Solicitar faltantes → vuelve a 2
> 4. Evaluar riesgo (Suscripción)
> 5. ¿Aprobado? → No: 9 Notificar rechazo (fin)
> 6. Emitir póliza (Sistemas / core)
> 7. Cobrar prima (Finanzas)
> 8. Entregar documentos y dar bienvenida (Ventas) — fin
> *)*

## Cómo quiero que trabajes

- Fase por fase, con una pausa al final de cada una: abre la app en el
  navegador, hazme una captura y dime qué verificaste **midiendo** (número de
  solapes, de cruces, escala inicial en 390×844, que los toques abren la ficha
  al primer intento).
- Cuando algo no se pueda garantizar con la física o con heurísticas, prefiere
  **una pasada determinista posterior** que lo imponga. La regla que aprendimos
  en el proyecto anterior: *fuerzas para el aspecto, pasada determinista para
  las invariantes*. Intentar cumplir las invariantes solo con fuerzas produce
  "casi bien" para siempre.
- No añadas dependencias sin preguntarme. No cambies el modelo de datos sin
  avisarme.
- Al final, un `README.md` que explique cómo correrlo, cómo editar el JSON y
  cuáles son las constantes de layout que puedo tocar (altura de nivel, aire
  entre nodos, ancho de nodo).
