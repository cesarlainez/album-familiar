/* ══════════════════════════════════════════════════════════════
   LIENZO — Constelación familiar: pan, zoom, nodos e hilos de luz
   ──────────────────────────────────────────────────────────────
   Sistema de coordenadas
   ──────────────────────
   · "mundo": plano infinito donde vive cada perfil, con origen (0,0)
     en el centro de la constelación.
   · "pantalla": píxeles del viewport.
   · Conversión:  pantalla = mundo * escala + desplazamiento

   El plano se mueve como un bloque con una sola transform sobre #mundo,
   así el navegador compone en GPU y los hilos SVG nunca se desalinean
   de los nodos HTML.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const ESCALA_MIN = 0.25; // piso de zoom en escritorio
  const ESCALA_MIN_MOVIL = 0.35; // en táctil no tiene sentido alejarse más
  const ESCALA_MAX = 3.0;
  const SENSIBILIDAD_RUEDA = 0.0016;

  /* Móvil: umbral de ancho de viewport y zoom de arranque legible.
     A 0.7, una tarjeta de 168px ocupa ~118px de pantalla: se ve la foto
     y se lee el nombre; el usuario navega con gestos en vez de ver todo
     el árbol en miniatura. */
  const UMBRAL_MOVIL = 768;
  const ESCALA_ARRANQUE_MOVIL = 0.7;


  /* Desfase del SVG de hilos respecto al origen del mundo (ver .hilos en CSS) */
  const SVG_OFFSET = 5000;

  /* Alto del marco de la fotografía; el ancla del hilo sale de su borde */
  const NODO_ALTO = 228;
  const NODO_ANCHO = 168;
  const ALTURA_FILA = 380; // separación entre generaciones (= ALTURA_NIVEL del layout)

  function Lienzo(opciones) {
    this.contenedor = opciones.contenedor;
    this.mundo = opciones.mundo;
    this.capaNodos = opciones.capaNodos;
    this.capaHilos = opciones.capaHilos;
    this.hud = opciones.hud || null;
    this.alSeleccionar = opciones.alSeleccionar || function () {};

    this.escala = 1;
    this.desplazamiento = { x: 0, y: 0 };

    this.perfiles = [];
    this.relaciones = { parejas: [], filiaciones: [] };
    this.elementosNodo = new Map();
    this._bbox = null; // caja del contenido en coords de mundo (se cachea al dibujar)

    this._arrastre = null;
    this._gesto = null;
    this._pausas = new Set();
    this._punteros = new Map();
    this._distanciaPinza = 0;

    this._conectarEventos();
  }

  /* ── Render ──────────────────────────────────────────────── */

  Lienzo.prototype.dibujar = function (perfiles, opciones) {
    const op = opciones || {};
    this.perfiles = perfiles;
    this.relaciones = AlbumDatos.calcularRelaciones(perfiles);
    /* Deriva las posiciones de las relaciones (padre/madre/pareja) de los datos.
       Cualquier perfil nuevo en la BD se coloca solo, sin tocar código. */
    AlbumDatos.calcularDisposicion(perfiles);
    this._bbox = this._calcularBBox();
    /* La cascada de entrada solo en el primer dibujo: tras cada guardado
       el árbol debe estar ahí al instante, no volver a encenderse. */
    this.contenedor.classList.toggle('sin-entrada', this._yaDibujado === true);
    /* Momento (ms) en que termina la cascada de entrada: 200 ms de base,
       150 por generación y 900 de la propia animación. */
    const filas = this._bbox ? Math.round((this._bbox.maxY - 60 - this._bbox.minY - NODO_ALTO) / ALTURA_FILA) + 1 : 1;
    this._finEntrada = this._yaDibujado ? 0 : 200 + filas * 150 + 900;
    this._yaDibujado = true;
    this._dibujarNodos();
    this._dibujarConexiones();
    /* recentrar por defecto; tras un cambio del CRUD se conserva la vista
       actual para no desorientar al usuario. */
    if (op.recentrar === false) this._aplicar();
    else this.centrar(false);
  };

  /** Caja envolvente del contenido (coords de mundo), incluyendo el tamaño
   *  de las tarjetas y su pie de texto. null si no hay perfiles. */
  Lienzo.prototype._calcularBBox = function () {
    if (!this.perfiles.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.perfiles) {
      const { x, y } = AlbumDatos.posicionDe(p.id);
      minX = Math.min(minX, x - NODO_ANCHO / 2);
      maxX = Math.max(maxX, x + NODO_ANCHO / 2);
      minY = Math.min(minY, y - NODO_ALTO / 2);
      maxY = Math.max(maxY, y + NODO_ALTO / 2 + 60); /* +60: el pie de texto */
    }
    return { minX, maxX, minY, maxY };
  };

  Lienzo.prototype._esMovil = function () {
    /* Inclusivo: 768 (tablet vertical) también arranca legible. */
    return this.contenedor.getBoundingClientRect().width <= UMBRAL_MOVIL;
  };

  Lienzo.prototype._escalaMinima = function () {
    return this._esMovil() ? ESCALA_MIN_MOVIL : ESCALA_MIN;
  };

  /** Retraso de entrada por GENERACIÓN, no por persona: con 62 personas
   *  el retraso por nodo hacía aparecer el último a los 11 s. */
  Lienzo.prototype._retrasoFila = function (y, base) {
    const fila = this._bbox ? Math.round((y - this._bbox.minY - NODO_ALTO / 2) / ALTURA_FILA) : 0;
    return base + Math.max(0, fila) * 150;
  };

  Lienzo.prototype._dibujarNodos = function () {
    this.capaNodos.textContent = '';
    this.elementosNodo.clear();
    const lote = document.createDocumentFragment();

    const crear = (etiqueta, clase, texto) => {
      const el = document.createElement(etiqueta);
      el.className = clase;
      if (texto != null) el.textContent = texto;
      return el;
    };

    this.perfiles.forEach((perfil) => {
      const pos = AlbumDatos.posicionDe(perfil.id);

      const nodo = document.createElement('article');
      nodo.className = 'nodo';
      nodo.style.left = pos.x + 'px';
      nodo.style.top = pos.y + 'px';
      nodo.style.setProperty('--retraso', this._retrasoFila(pos.y, 200) + 'ms');
      nodo.tabIndex = 0;
      nodo.setAttribute('role', 'button');
      nodo.setAttribute('aria-label', `Abrir el perfil de ${perfil.nombre_completo}`);
      nodo.dataset.id = perfil.id;

      /* Elementos creados por propiedades, no con innerHTML: una foto en
         data URL son ~700 KB de texto que el parser HTML tenía que leer
         entero; asignada a img.src no pasa por él. La tarjeta usa la
         miniatura si existe; una foto aún sin resolver ("foto:id") se
         muestra con iniciales hasta que llegue. */
      const marco = crear('div', 'nodo__marco');
      const portada = perfil.miniatura || (perfil.galeria && perfil.galeria[0]) || '';
      if (portada && portada.indexOf('foto:') !== 0) {
        const img = crear('img', 'nodo__foto');
        img.alt = 'Retrato de ' + perfil.nombre_completo;
        img.draggable = false;
        img.decoding = 'async';
        img.src = portada;
        marco.appendChild(img);
      } else {
        marco.appendChild(crear('div', 'nodo__placeholder', AlbumDatos.iniciales(perfil.nombre_completo)));
      }
      marco.appendChild(crear('div', 'nodo__halo'));
      const pie = crear('div', 'nodo__pie');
      pie.appendChild(crear('h2', 'nodo__nombre', perfil.nombre_completo));
      pie.appendChild(crear('p', 'nodo__disciplina', perfil.disciplina_artistica || ''));
      nodo.appendChild(marco);
      nodo.appendChild(pie);

      /* El clic no se escucha aquí: el contenedor captura el puntero al
         arrastrar y el pointerup nunca llegaría al nodo. Se resuelve en
         _conectarEventos, que sí ve el gesto completo. */
      nodo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.alSeleccionar(perfil);
        }
      });

      lote.appendChild(nodo);
      this.elementosNodo.set(perfil.id, nodo);
    });
    this.capaNodos.appendChild(lote);
  };

  Lienzo.prototype._dibujarConexiones = function () {
    const NS = 'http://www.w3.org/2000/svg';
    this.capaHilos.textContent = '';
    const lote = document.createDocumentFragment();
    /* Con "reducir movimiento" no hay chispas: son animación pura. */
    const conChispas = !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    /* El "begin" del SMIL cuenta desde que el svg empezó a existir, no desde
       este dibujo: si los datos tardaban en llegar, las chispas arrancaban a
       medias o ya habían terminado. Se ancla al reloj actual del svg. Solo
       en el primer dibujo: guardar una edición no vuelve a lanzarlas. */
    const svg = this.capaHilos.ownerSVGElement;
    const arranque = this._finEntrada && svg && svg.getCurrentTime
      ? svg.getCurrentTime() + this._finEntrada / 1000
      : null;

    /* Ancla en coordenadas del SVG. ANCLA_Y sube el punto hasta el centro
       de la fotografía (el nodo está centrado incluyendo su pie de texto). */
    const ANCLA_Y = -27;
    const ancla = (id) => {
      const p = AlbumDatos.posicionDe(id);
      return { x: p.x + SVG_OFFSET, y: p.y + SVG_OFFSET + ANCLA_Y };
    };

    /* ── 1) Lazos de pareja: línea punteada ámbar + punto de unión ──
       Estilo deliberadamente distinto al hilo de filiación (sólido, en
       gradiente frío). Solo para parejas románticas (id_pareja). */
    this.relaciones.parejas.forEach((c, i) => {
      const A = ancla(c.a);
      const B = ancla(c.b);
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2;

      const lazo = document.createElementNS(NS, 'path');
      lazo.setAttribute('class', 'lazo');
      lazo.setAttribute('d', `M ${A.x} ${A.y} L ${B.x} ${B.y}`);
      lazo.style.animationDelay = this._retrasoFila(A.y - SVG_OFFSET - ANCLA_Y, 500) + 'ms';
      lote.appendChild(lazo);

      /* Punto de unión: nudo de luz en el centro del matrimonio */
      const nudo = document.createElementNS(NS, 'circle');
      nudo.setAttribute('class', 'lazo-union');
      nudo.setAttribute('cx', mx);
      nudo.setAttribute('cy', my);
      nudo.setAttribute('r', '3.4');
      nudo.style.animationDelay = this._retrasoFila(A.y - SVG_OFFSET - ANCLA_Y, 700) + 'ms';
      lote.appendChild(nudo);
    });

    /* ── 2) Filiaciones: hilo de luz sólido hacia cada hijo ──────────
       'conjunta' → nace del punto medio EXACTO entre ambos progenitores
                    (co-padres; la física los mantiene lado a lado y al mismo
                    eje Y, tengan o no lazo romántico).
       'simple'   → nace del centro del único progenitor (medios hermanos). */
    this.relaciones.filiaciones.forEach((f, i) => {
      let origen;
      if (f.tipo === 'conjunta') {
        const A = ancla(f.padres[0]);
        const B = ancla(f.padres[1]);
        origen = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      } else {
        origen = ancla(f.progenitor);
      }
      const destino = ancla(f.hijo);

      const x1 = origen.x;
      const y1 = origen.y;
      const x2 = destino.x;
      const y2 = destino.y;

      /* Curva cuadrática con leve arqueo perpendicular: orgánica y sin
         dirección privilegiada (grafo libre). */
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const largoRecta = Math.hypot(dx, dy) || 1;
      const arqueo = Math.min(46, largoRecta * 0.12);
      const cx = mx + (-dy / largoRecta) * arqueo;
      const cy = my + (dx / largoRecta) * arqueo;
      const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

      /* Halo: un segundo trazo ancho y tenue. Sustituye al filtro de
         desenfoque, que obligaba a rasterizar ~30 Mpx en cada cuadro. */
      const retraso = this._retrasoFila(destino.y - SVG_OFFSET - ANCLA_Y, 50) + 'ms';
      const halo = document.createElementNS(NS, 'path');
      halo.setAttribute('class', 'hilo-halo');
      halo.setAttribute('d', d);
      halo.setAttribute('pathLength', '1');
      halo.style.animationDelay = retraso;
      lote.appendChild(halo);

      /* El hilo se "enciende" dibujándose de progenitor a descendiente.
         pathLength=1 normaliza el largo: sin getTotalLength(), que forzaba
         a calcular la geometría de cada curva en pleno dibujo. */
      const trazo = document.createElementNS(NS, 'path');
      trazo.setAttribute('class', 'hilo');
      trazo.setAttribute('d', d);
      trazo.setAttribute('pathLength', '1');
      trazo.style.animationDelay = retraso;
      lote.appendChild(trazo);

      /* Chispa que recorre el hilo: la luz viajando entre generaciones.
         Un solo recorrido: cualquier animación SMIL en marcha obliga a
         repintar el svg entero en cada cuadro (medido: ~45 puntos de CPU en
         un celular, con 1 chispa o con 46), así que se limita en el tiempo,
         no en cantidad, y se pausa en cuanto la persona toca el lienzo. */
      if (conChispas && arranque != null) {
        const chispa = document.createElementNS(NS, 'circle');
        chispa.setAttribute('class', 'chispa');
        chispa.setAttribute('r', '1.9');
        const motion = document.createElementNS(NS, 'animateMotion');
        motion.setAttribute('dur', 5 + (i % 3) + 's');
        motion.setAttribute('repeatCount', '1');
        motion.setAttribute('path', d);
        /* Arrancan cuando la entrada del árbol ya terminó: compitiendo con
           ella saturaban el procesador de un celular los primeros segundos. */
        motion.setAttribute('begin', (arranque + (i % 8) * 0.7).toFixed(2) + 's');
        chispa.appendChild(motion);
        lote.appendChild(chispa);
      }
    });
    this.capaHilos.appendChild(lote);
  };

  /* ── Pausa de las chispas ───────────────────────────────────
     Un conjunto de MOTIVOS en vez de pares pausa/reanuda: mientras haya
     uno (gesto, rueda, ficha abierta, pestaña oculta) las animaciones SMIL
     quedan congeladas; así el pan y el zoom no compiten con ellas por el
     hilo principal, y el orden de los eventos deja de importar. */
  Lienzo.prototype.pausar = function (motivo, activo) {
    if (activo) this._pausas.add(motivo);
    else this._pausas.delete(motivo);
    const svg = this.capaHilos.ownerSVGElement;
    if (!svg || !svg.pauseAnimations) return;
    if (this._pausas.size) svg.pauseAnimations();
    else svg.unpauseAnimations();
  };

  /* ── Transform ───────────────────────────────────────────── */

  Lienzo.prototype._aplicar = function () {
    this._limitarPan();
    const { x, y } = this.desplazamiento;
    this.mundo.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${this.escala})`;
    if (this.hud) this.hud.textContent = Math.round(this.escala * 100) + '%';
  };

  /** Acota el desplazamiento: el CENTRO del viewport nunca sale del área
   *  del árbol. Así es imposible "perderlo" arrastrando — siempre estás
   *  mirando hacia la constelación. Único punto de control: todo pan/zoom
   *  pasa por _aplicar(). */
  Lienzo.prototype._limitarPan = function () {
    const b = this._bbox;
    if (!b) return;
    const r = this.contenedor.getBoundingClientRect();
    const s = this.escala;

    /* punto del mundo bajo el centro de la pantalla: w = (centro - d) / s
       exigimos  minX ≤ w ≤ maxX  →  despejando d: */
    const dxA = r.width / 2 - b.maxX * s;
    const dxB = r.width / 2 - b.minX * s;
    const dyA = r.height / 2 - b.maxY * s;
    const dyB = r.height / 2 - b.minY * s;

    this.desplazamiento.x = Math.min(Math.max(this.desplazamiento.x, Math.min(dxA, dxB)), Math.max(dxA, dxB));
    this.desplazamiento.y = Math.min(Math.max(this.desplazamiento.y, Math.min(dyA, dyB)), Math.max(dyA, dyB));
  };

  /** Red de seguridad al terminar un gesto: si la vista quedó sobre una zona
   *  vacía (las esquinas del área del árbol pueden no tener nodos), vuelve
   *  con una animación breve hasta el nodo más cercano. */
  Lienzo.prototype._asegurarContenidoVisible = function () {
    if (!this.perfiles.length) return;
    const r = this.contenedor.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;

    let mejor = null;
    let mejorDist = Infinity;
    for (const p of this.perfiles) {
      const pos = AlbumDatos.posicionDe(p.id);
      const sx = pos.x * this.escala + this.desplazamiento.x;
      const sy = pos.y * this.escala + this.desplazamiento.y;
      if (sx > -40 && sx < r.width + 40 && sy > -40 && sy < r.height + 40) {
        return; // hay al menos un nodo a la vista: nada que hacer
      }
      const d = (sx - cx) * (sx - cx) + (sy - cy) * (sy - cy);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = pos;
      }
    }
    if (!mejor) return;

    this.mundo.style.transition = 'transform 350ms cubic-bezier(0.22,1,0.36,1)';
    this.desplazamiento.x = cx - mejor.x * this.escala;
    this.desplazamiento.y = cy - mejor.y * this.escala;
    this._aplicar();
    setTimeout(() => { this.mundo.style.transition = 'none'; }, 380);
  };

  /** Zoom manteniendo fijo el punto de pantalla indicado (por defecto, el centro). */
  Lienzo.prototype.zoomEn = function (nuevaEscala, puntoPantalla) {
    const escala = Math.min(ESCALA_MAX, Math.max(this._escalaMinima(), nuevaEscala));
    const r = this.contenedor.getBoundingClientRect();
    const px = puntoPantalla ? puntoPantalla.x - r.left : r.width / 2;
    const py = puntoPantalla ? puntoPantalla.y - r.top : r.height / 2;

    /* Punto del mundo bajo el cursor antes del zoom */
    const mx = (px - this.desplazamiento.x) / this.escala;
    const my = (py - this.desplazamiento.y) / this.escala;

    this.escala = escala;
    this.desplazamiento.x = px - mx * escala;
    this.desplazamiento.y = py - my * escala;
    this._aplicar();
  };

  /** Encuadra toda la constelación con margen. */
  Lienzo.prototype.centrar = function (animado = true) {
    const r = this.contenedor.getBoundingClientRect();

    if (!this.perfiles.length) {
      this.escala = 1;
      this.desplazamiento = { x: r.width / 2, y: r.height / 2 };
      this._aplicar();
      return;
    }

    const b = this._bbox || this._calcularBBox();
    const { minX, maxX, minY, maxY } = b;
    const esMovil = this._esMovil();

    /* Margen proporcional en pantallas chicas: 140px fijos se comen
       el 72% de un viewport de 390px. */
    const margen = esMovil ? Math.max(24, r.width * 0.08) : 140;

    let escala = Math.min(
      ESCALA_MAX,
      Math.max(
        this._escalaMinima(),
        Math.min(
          (r.width - margen * 2) / (maxX - minX),
          (r.height - margen * 2) / (maxY - minY)
        )
      )
    );

    let centroX = (minX + maxX) / 2;
    let centroY = (minY + maxY) / 2;

    /* MÓVIL: si encuadrar todo deja las tarjetas ilegibles, mejor arrancar
       ampliado sobre el corazón del árbol (centroide de las personas) y que
       el usuario recorra con gestos. Ver todo-a-la-vez no sirve de nada si
       no se distingue a nadie. */
    if (esMovil && escala < 0.6) {
      escala = ESCALA_ARRANQUE_MOVIL;
      let sx = 0, sy = 0;
      for (const p of this.perfiles) {
        const pos = AlbumDatos.posicionDe(p.id);
        sx += pos.x;
        sy += pos.y;
      }
      centroX = sx / this.perfiles.length;
      centroY = sy / this.perfiles.length;
    }

    this.mundo.style.transition = animado ? 'transform 700ms cubic-bezier(0.22,1,0.36,1)' : 'none';
    this.escala = escala;
    this.desplazamiento.x = r.width / 2 - centroX * escala;
    this.desplazamiento.y = r.height / 2 - centroY * escala;
    this._aplicar();

    if (animado) {
      setTimeout(() => { this.mundo.style.transition = 'none'; }, 720);
    } else {
      requestAnimationFrame(() => { this.mundo.style.transition = 'none'; });
    }
  };

  /** Centra suavemente la vista sobre una persona (sin cambiar el zoom).
   *  Se usa al abrir su ficha: la foto queda de fondo, protagonista. */
  Lienzo.prototype.centrarEn = function (id) {
    const pos = AlbumDatos.posicionDe(id);
    const r = this.contenedor.getBoundingClientRect();
    this.mundo.style.transition = 'transform 450ms cubic-bezier(0.22,1,0.36,1)';
    this.desplazamiento.x = r.width / 2 - pos.x * this.escala;
    this.desplazamiento.y = r.height / 2 - pos.y * this.escala;
    this._aplicar();
    setTimeout(() => { this.mundo.style.transition = 'none'; }, 470);
  };

  /* ── Entrada: arrastre, rueda, pinza, teclado ────────────── */

  Lienzo.prototype._conectarEventos = function () {
    const c = this.contenedor;

    c.addEventListener('pointerdown', (e) => {
      /* Sobre un control (p. ej. "Agregar primera persona") no hay gesto:
         capturar el puntero desviaba su clic al lienzo y no respondía. */
      if (e.target.closest && e.target.closest('button, a, input, select, textarea, label')) return;
      /* La captura garantiza recibir move/up aunque el dedo salga del
         lienzo. Si el navegador no la soporta para este puntero, los
         gestos siguen funcionando mientras el dedo esté encima. */
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      this._punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._punteros.size === 1) {
        this._arrastre = {
          x: e.clientX - this.desplazamiento.x,
          y: e.clientY - this.desplazamiento.y,
        };
        /* Candidato a selección: solo cuenta si el gesto no acaba en arrastre */
        const nodo = e.target.closest ? e.target.closest('.nodo') : null;
        this._gesto = { nodo, x: e.clientX, y: e.clientY };
        c.classList.add('arrastrando');
        this.pausar('gesto', true);
      } else if (this._punteros.size === 2) {
        this._gesto = null;
        this._arrastre = null;
        this._distanciaPinza = this._distanciaEntrePunteros();
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!this._punteros.has(e.pointerId)) return;
      this._punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._punteros.size === 2) {
        const d = this._distanciaEntrePunteros();
        if (this._distanciaPinza > 0) {
          const centro = this._centroPunteros();
          this.zoomEn(this.escala * (d / this._distanciaPinza), centro);
        }
        this._distanciaPinza = d;
        return;
      }

      if (!this._arrastre) return;
      this.desplazamiento.x = e.clientX - this._arrastre.x;
      this.desplazamiento.y = e.clientY - this._arrastre.y;
      this._aplicar();
    });

    c.addEventListener('pointerup', (e) => {
      const g = this._gesto;
      this._gesto = null;
      if (!g || !g.nodo) return;
      /* Umbral que separa un toque de un arrastre. Con mouse los clics son
         precisos (5px); con el dedo SIEMPRE hay temblor de 5–15px, así que
         un umbral de mouse hacía que muchos toques legítimos no abrieran
         la ficha. 16px ≈ el "touch slop" estándar de las plataformas. */
      const umbral = e.pointerType === 'mouse' ? 5 : 22;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) >= umbral) return;
      const perfil = this.perfiles.find((p) => p.id === g.nodo.dataset.id);
      if (perfil) this.alSeleccionar(perfil);
    });

    const soltar = (e) => {
      this._punteros.delete(e.pointerId);
      if (this._punteros.size < 2) this._distanciaPinza = 0;
      /* Tras un pellizco, el dedo que sigue apoyado continúa arrastrando
         desde donde está (antes quedaba muerto hasta levantarlo). */
      if (this._punteros.size === 1) {
        const [p] = this._punteros.values();
        this._arrastre = { x: p.x - this.desplazamiento.x, y: p.y - this.desplazamiento.y };
        this._gesto = null;
      }
      if (this._punteros.size === 0) {
        this._arrastre = null;
        c.classList.remove('arrastrando');
        this.pausar('gesto', false);
        this._asegurarContenidoVisible();
      }
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);

    let ruedaTimer = null;
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * SENSIBILIDAD_RUEDA);
        this.pausar('rueda', true);
        this.zoomEn(this.escala * factor, { x: e.clientX, y: e.clientY });
        clearTimeout(ruedaTimer);
        ruedaTimer = setTimeout(() => {
          this.pausar('rueda', false);
          this._asegurarContenidoVisible();
        }, 250);
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      /* Funcionan con el foco en el lienzo o en una tarjeta; no mientras se
         escribe en un campo ni con una ventana encima. */
      const t = e.target;
      if (t.closest && t.closest('input, textarea, select, [contenteditable], .flip-capa, .candado, .visor')) return;
      if (document.querySelector('.flip-capa.abierta, .visor:not([hidden]), .candado:not([hidden])')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') this.zoomEn(this.escala * 1.2);
      if (e.key === '-' || e.key === '_') this.zoomEn(this.escala / 1.2);
      if (e.key === 'c' || e.key === 'C') this.centrar();
    });

    /* Al redimensionar (o girar el teléfono) se conserva la vista: el punto
       del mundo que estaba en el centro sigue en el centro, con el mismo zoom. */
    const medir = () => { const r = this.contenedor.getBoundingClientRect(); return { w: r.width, h: r.height }; };
    let tam = medir();
    window.addEventListener('resize', () => {
      const ahora = medir();
      if (!tam || !this._bbox) { tam = ahora; this.centrar(false); return; }
      this.desplazamiento.x += (ahora.w - tam.w) / 2;
      this.desplazamiento.y += (ahora.h - tam.h) / 2;
      tam = ahora;
      this._aplicar();
    });
    document.addEventListener('visibilitychange', () => this.pausar('oculto', document.hidden));
  };

  Lienzo.prototype._distanciaEntrePunteros = function () {
    const [a, b] = [...this._punteros.values()];
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  Lienzo.prototype._centroPunteros = function () {
    const [a, b] = [...this._punteros.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  global.Lienzo = Lienzo;
})(window);
