# Anatomía de la capa visual del Álbum Familiar

Documento técnico de referencia: cómo está construida la parte visual (lienzo
infinito, nodos, hilos, layout automático, gestos y tarjeta 3D), para poder
reutilizar el patrón en otro proyecto — por ejemplo, un visor de flujos.

Todo es HTML + CSS + JS de navegador, sin build step y **sin librerías**
(ni D3, ni dagre, ni React). Ficheros implicados:

| Fichero | Responsabilidad visual |
|---|---|
| `index.html` | esqueleto de capas + `<defs>` del SVG (gradiente y filtro de brillo) |
| `css/galeria.css` | tokens, atmósfera, nodo, hilos, tarjeta 3D, responsive |
| `js/datos.js` → `calcularDisposicion()` | **motor de layout**: de relaciones a coordenadas |
| `js/lienzo.js` | cámara (pan/zoom), render de nodos e hilos, gestos |
| `js/perfil.js` | tarjeta flip 3D |
| `js/exportar.js` | re-dibujo del grafo en `<canvas>` → PNG / PDF |

---

## 1. Sistema de coordenadas: "mundo" y "pantalla"

Hay dos espacios y **una sola** fórmula de conversión:

```
pantalla = mundo * escala + desplazamiento
```

- **mundo**: plano infinito con origen `(0,0)` en el centro del grafo. Cada
  nodo tiene ahí su `{x, y}` en píxeles lógicos.
- **pantalla**: píxeles del viewport.

La cámara son solo dos valores en memoria: `this.escala` y
`this.desplazamiento {x,y}`. Nada más. Y se materializa en **una única
transform** sobre el contenedor `#mundo`:

```js
mundo.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${escala})`;
```

Esta es la decisión de arquitectura más importante de todo el visual:

- El navegador compone la capa entera en GPU → pan y zoom fluidos aunque
  haya cientos de nodos.
- Los hilos (SVG) y los nodos (HTML) **nunca se desalinean**, porque no se
  mueven: se mueve su padre común.
- No hay recálculo de layout al arrastrar. Cero JS por frame más allá de
  escribir la transform.

`#mundo` es un punto sin tamaño (`width:0; height:0; transform-origin:0 0`);
los hijos se posicionan en absoluto alrededor del origen, con coordenadas
negativas incluidas.

## 2. Pila de capas (z-index)

```
z 50  .flip-capa      tarjeta 3D + velo con backdrop-filter
z 40  .atmosfera      viñeta radial + grano animado (pointer-events:none)
z 30  .cabecera       marca y botones (pointer-events:none, hijos auto)
z 20  .zoom-hud
 --   .lienzo         fondo radial #232323 -> #000, cursor grab, touch-action:none
        |- .mundo     <-- la única capa transformada
             |- svg.hilos   conexiones (pointer-events:none)
             |- div.nodos   tarjetas HTML
```

Dos detalles que costaron sangre y conviene copiar tal cual:

```css
/* El atributo hidden SIEMPRE gana sobre un display del autor. Sin esto, un
   overlay con display:flex sigue presente (invisible) y se come el ratón. */
[hidden] { display: none !important; }

/* Los estilos hover SOLO con puntero real. En táctil el hover se queda
   "pegado" tras el toque y ensucia la interacción siguiente. */
@media (hover: hover) { .nodo:hover { /* ... */ } }
```

## 3. Los nodos son HTML, no SVG

Cada nodo es un `<article class="nodo">` inyectado por JS:

```js
nodo.style.left = pos.x + 'px';
nodo.style.top  = pos.y + 'px';
nodo.style.setProperty('--retraso', 260 + i * 160 + 'ms');
```

- El JS posiciona el **centro**; el CSS corrige con
  `transform: translate(-50%, -50%)`.
- La entrada es escalonada por CSS: `animation: revelar var(--lento)` con
  `animation-delay: var(--retraso)`, y `revelar` va de
  `opacity:0; filter:blur(12px)` a nítido. El JS solo pasa el retraso.
- Hover: `scale(1.22)` + `z-index:20` + halo radial + la foto pasa de
  `grayscale(.75) brightness(.62)` a color casi pleno. Todo en CSS, con la
  curva `cubic-bezier(0.22,1,0.36,1)` compartida en una variable.

Ventaja de HTML sobre SVG para los nodos: texto con `-webkit-line-clamp`,
`object-fit: cover` en las fotos, `box-shadow` en capas y accesibilidad
(`role="button"`, `tabIndex`, `aria-label`) prácticamente gratis.

## 4. Los hilos son SVG en un plano desplazado

El SVG no admite coordenadas negativas cómodamente, así que se coloca un
lienzo grande centrado en el origen del mundo y se suma un offset constante:

```css
.hilos { position:absolute; left:-5000px; top:-5000px;
         width:10000px; height:10000px; overflow:visible;
         pointer-events:none; }
```

```js
const SVG_OFFSET = 5000;
const ANCLA_Y = -27;               // sube el ancla al centro de la foto
const ancla = (id) => { const p = posicionDe(id);
  return { x: p.x + SVG_OFFSET, y: p.y + SVG_OFFSET + ANCLA_Y }; };
```

**Curva orgánica**: en vez de una recta, una cuadrática con arqueo
perpendicular proporcional a la distancia (tope 46 px), así ningún hilo
privilegia una dirección:

```js
const dx = x2-x1, dy = y2-y1, L = Math.hypot(dx,dy) || 1;
const arqueo = Math.min(46, L * 0.12);
const cx = (x1+x2)/2 + (-dy/L)*arqueo;
const cy = (y1+y2)/2 + ( dx/L)*arqueo;
path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
```

**Se "enciende" dibujándose** — el truco clásico de longitud de trazo:

```js
const largo = path.getTotalLength();
path.style.strokeDasharray = largo;
path.style.setProperty('--largo', largo);
```

```css
@keyframes encender { from { stroke-dashoffset: var(--largo); opacity:0 }
                      to   { stroke-dashoffset: 0;            opacity:1 } }
```

**Chispa viajera** sin una línea de JS de animación: un `<circle>` con
`<animateMotion>` sobre el mismo `d`, con duración y `begin` variados por
índice para que las partículas no vayan en manada.

**Brillo y color** vienen de `<defs>` en el HTML: un `linearGradient`
(transparente → cálido → transparente) y un filtro
`feGaussianBlur(2.5)` + `feMerge` con el `SourceGraphic` — es decir, el trazo
nítido montado sobre su propio difuminado. Eso es todo el "hilo de luz".

Los dos tipos de arista se distinguen **por lenguaje visual, no por etiqueta**:
filiación = trazo sólido en gradiente frío; pareja = punteado ámbar
(`stroke-dasharray: 1 8`) con un nudo (`<circle>`) que late en bucle. El nudo
es además el punto de origen de los hilos hacia los hijos.

## 5. Motor de layout: física primero, garantías después

`AlbumDatos.calcularDisposicion(perfiles)` convierte relaciones en
coordenadas. **No hay ninguna coordenada escrita a mano en el proyecto**:
añadir una persona a la base la coloca y la conecta sola.

### Fase A — simulación de fuerzas (estética)

900 iteraciones, determinista (siembra en espiral áurea, sin `Math.random`):

| Fuerza | Fórmula | Para qué |
|---|---|---|
| Repulsión | `K/d²`, `K=420000` | que nadie se apelotone |
| Resorte de parentesco | `k(d-480)`, `k=0.035` | familiares cerca |
| Centrado horizontal | `-x * 0.004` | que el grafo no derive de lado |
| Gravedad de nivel | `(objetivoY - y) * 0.07` | generaciones en bandas |
| Amortiguación | `v *= 0.86`, `enfriado = 1 - paso/N` | converge, no vibra |

Las parejas y co-padres se tratan como **bloques rígidos**: tras cada
iteración se hace un snap `px = cx ∓ 150`, `py = cy`, promediando la
velocidad, así el bloque se traslada como una unidad pero no rota ni se
estira.

### Fase B — garantías deterministas (corrección)

La física sola da vida pero **no garantiza nada**. Encima se aplican cuatro
pasadas que sí:

1. **Agrupación (union-find)**: los miembros de un bloque comparten grupo, es
   decir comparten nivel.
2. **Nivel = camino más largo desde las raíces** (DFS memoizado sobre grupos),
   con **corte de ciclo** (`enPila → return 0`) e ignorando las aristas
   intra-grupo. Esto es lo que salvó el proyecto: un dato contradictorio
   (alguien registrado como padre de su propia pareja) hacía oscilar la
   relajación y el árbol explotaba a 13 000 px de alto.
3. **Anclaje duro de filas**: `py[i] = (nivel[i] - maxNivel/2) * 380`. Las
   generaciones quedan en bandas limpias; el solape entre filas se vuelve
   imposible por construcción.
4. **Empaquetado exacto 1-D por fila** + **orden por baricentro**. Recorriendo
   las filas de arriba hacia abajo, cada unidad se coloca en el baricentro de
   sus padres (ya definitivos), se ordena la fila por esa x, se barre de
   izquierda a derecha imponiendo `x[k] ≥ x[k-1] + mitad + mitad` y se
   recentra la fila en su media original. Resultado: **cero solapes, cero
   inversiones padre/hijo y cruces de hilos mínimos**, sin oscilaciones.

Esa combinación —*fuerzas para el aspecto, pasada determinista para las
invariantes*— es el patrón exportable. Intentar cumplir las invariantes solo
con fuerzas produce "casi bien" para siempre.

## 6. Cámara y gestos (Pointer Events, un solo camino)

Un único juego de handlers sirve ratón, dedo y lápiz:

- **Pan**: `pointerdown` guarda `origen = client - desplazamiento`;
  `pointermove` escribe `desplazamiento = client - origen`.
- **Pinza**: con 2 punteros, `escala *= d/dPrevia` anclando en el punto medio.
- **Rueda**: `escala *= Math.exp(-deltaY * 0.0016)` (exponencial = zoom
  perceptualmente uniforme) anclado en el cursor. El anclaje es álgebra pura:
  se calcula el punto del mundo bajo el cursor, se cambia la escala y se
  recoloca el desplazamiento para que ese punto siga bajo el cursor.
- **`setPointerCapture`** (en try/catch) para no perder el gesto si el dedo
  sale del elemento.
- **Toque vs arrastre**: el clic **no** se escucha en el nodo (la captura del
  contenedor se lo comería). Se resuelve por distancia del gesto, con umbral
  distinto por dispositivo: `e.pointerType === 'mouse' ? 5 : 22` px — el dedo
  siempre tiembla 5–15 px y con umbral de ratón muchos toques legítimos se
  perdían.
- **Clamp de pan**: el *centro* del viewport nunca sale de la caja del
  contenido (`_limitarPan`, despejando `d` de `minX ≤ (centro-d)/s ≤ maxX`).
  Es imposible "perder" el grafo arrastrando.
- **Red de seguridad**: al terminar un gesto, si ningún nodo quedó visible, se
  vuelve al más cercano con una animación de 350 ms.
- **Arranque adaptativo**: si encuadrar todo dejaría las tarjetas ilegibles
  (`escala < 0.6` en viewport ≤ 768 px), se arranca al 70 % sobre el centroide
  y el usuario recorre con gestos. Ver todo a la vez no sirve si no se
  distingue nada.

Todo pan/zoom pasa por `_aplicar()` — **un solo punto de control** donde viven
el clamp y el HUD de porcentaje.

## 7. Tarjeta flip 3D

Overlay fijo; el efecto es CSS puro:

```css
.carta       { perspective: 2400px; transform: translate(-50%,-50%) scale(.28);
               transition: transform .55s var(--curva); }
.carta__flip { transform-style: preserve-3d; transition: transform .65s; }
.abierta .carta__flip { transform: rotateY(180deg); }
.carta__cara { backface-visibility: hidden; }   /* la trasera va pre-rotada 180° */
```

El JS solo alterna la clase y la escala (0.28 → 1), de modo que **crece y gira
a la vez**. Dos detalles:

- Se fuerza un reflow (`void carta.offsetWidth`) en vez de usar
  `requestAnimationFrame`, porque el navegador frena los rAF cuando la
  pestaña no tiene foco y la animación no se reproducía.
- Al cerrar, `.flip-capa:not(.abierta){pointer-events:none}` más un guard de
  450 ms evitan que el velo en salida se coma el siguiente toque (el clásico
  "hay que tocar dos veces").

Y los campos vacíos no dejan títulos huérfanos:
`contenedor.hidden = !texto` sobre el bloque título+valor.

## 8. Export PNG/PDF sin librerías

`js/exportar.js` **vuelve a dibujar** el grafo en un `<canvas>` (mismo bbox +
margen + cabecera, tope 4000 px, fondo radial, hilos cuadráticos, fotos
recortadas *cover* con `crossOrigin='anonymous'` y respaldo de iniciales si
falla la carga) y luego:

- PNG: `canvas.toBlob()`.
- PDF: se construye a mano un PDF de una página con 5 objetos y la tabla
  `xref` calculada por offsets, incrustando el JPEG con `/DCTDecode`.

Son ~300 líneas y evitan cargar jsPDF/html2canvas.

## 9. Detalles operativos que afectan al visual

- Scripts versionados `?v=N` en el HTML: sin eso, el navegador y el CDN
  sirven JS viejo tras cada despliegue. **Subir N en cada cambio de JS.**
- Servidor de desarrollo con `Cache-Control: no-store` (`serve.py`, :8777).
- `touch-action`: `none` en el lienzo y el visor, `pan-y` en el carrusel — si
  no, el navegador reclama el gesto horizontal para hacer scroll y llega
  `pointercancel` en medio del swipe.
- `will-change: transform` en `#mundo`; nada más lo necesita.
