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

  const ESCALA_MIN = 0.25;
  const ESCALA_MAX = 3.0;
  const SENSIBILIDAD_RUEDA = 0.0016;

  /* Desfase del SVG de hilos respecto al origen del mundo (ver .hilos en CSS) */
  const SVG_OFFSET = 5000;

  /* Alto del marco de la fotografía; el ancla del hilo sale de su borde */
  const NODO_ALTO = 228;
  const NODO_ANCHO = 168;

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

    this._arrastre = null;
    this._gesto = null;
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
    this._dibujarNodos();
    this._dibujarConexiones();
    /* recentrar por defecto; tras un cambio del CRUD se conserva la vista
       actual para no desorientar al usuario. */
    if (op.recentrar === false) this._aplicar();
    else this.centrar(false);
  };

  Lienzo.prototype._dibujarNodos = function () {
    this.capaNodos.innerHTML = '';
    this.elementosNodo.clear();

    this.perfiles.forEach((perfil, i) => {
      const pos = AlbumDatos.posicionDe(perfil.id);

      const nodo = document.createElement('article');
      nodo.className = 'nodo';
      nodo.style.left = pos.x + 'px';
      nodo.style.top = pos.y + 'px';
      nodo.style.setProperty('--retraso', 260 + i * 160 + 'ms');
      nodo.tabIndex = 0;
      nodo.setAttribute('role', 'button');
      nodo.setAttribute('aria-label', `Abrir el perfil de ${perfil.nombre_completo}`);
      nodo.dataset.id = perfil.id;

      const esc = (s) =>
        String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
        );
      const portada = (perfil.galeria && perfil.galeria[0]) || '';
      const nombre = esc(perfil.nombre_completo);
      const visual = portada
        ? `<img class="nodo__foto" src="${esc(portada)}" alt="Retrato de ${nombre}" draggable="false" />`
        : `<div class="nodo__placeholder">${esc(AlbumDatos.iniciales(perfil.nombre_completo))}</div>`;

      nodo.innerHTML = `
        <div class="nodo__marco">
          ${visual}
          <div class="nodo__halo"></div>
        </div>
        <div class="nodo__pie">
          <h2 class="nodo__nombre">${nombre}</h2>
          <p class="nodo__disciplina">${esc(perfil.disciplina_artistica || '')}</p>
        </div>`;

      /* El clic no se escucha aquí: el contenedor captura el puntero al
         arrastrar y el pointerup nunca llegaría al nodo. Se resuelve en
         _conectarEventos, que sí ve el gesto completo. */
      nodo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.alSeleccionar(perfil);
        }
      });

      this.capaNodos.appendChild(nodo);
      this.elementosNodo.set(perfil.id, nodo);
    });
  };

  Lienzo.prototype._dibujarConexiones = function () {
    const NS = 'http://www.w3.org/2000/svg';
    this.capaHilos.innerHTML = '';

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
      lazo.style.animationDelay = 700 + i * 160 + 'ms';
      this.capaHilos.appendChild(lazo);

      /* Punto de unión: nudo de luz en el centro del matrimonio */
      const nudo = document.createElementNS(NS, 'circle');
      nudo.setAttribute('class', 'lazo-union');
      nudo.setAttribute('cx', mx);
      nudo.setAttribute('cy', my);
      nudo.setAttribute('r', '3.4');
      nudo.style.animationDelay = 900 + i * 160 + 'ms';
      this.capaHilos.appendChild(nudo);
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

      const trazo = document.createElementNS(NS, 'path');
      trazo.setAttribute('class', 'hilo');
      trazo.setAttribute('d', d);
      this.capaHilos.appendChild(trazo);

      /* El hilo se "enciende" dibujándose de progenitor a descendiente */
      const largo = trazo.getTotalLength();
      trazo.style.strokeDasharray = largo;
      trazo.style.setProperty('--largo', largo);
      trazo.style.animationDelay = 420 + i * 200 + 'ms';

      /* Chispa que recorre el hilo: la luz viajando entre generaciones */
      const chispa = document.createElementNS(NS, 'circle');
      chispa.setAttribute('class', 'chispa');
      chispa.setAttribute('r', '1.9');
      const motion = document.createElementNS(NS, 'animateMotion');
      motion.setAttribute('dur', 5 + (i % 3) + 's');
      motion.setAttribute('repeatCount', 'indefinite');
      motion.setAttribute('path', d);
      motion.setAttribute('begin', i * 1.3 + 's');
      chispa.appendChild(motion);
      this.capaHilos.appendChild(chispa);
    });
  };

  /* ── Transform ───────────────────────────────────────────── */

  Lienzo.prototype._aplicar = function () {
    const { x, y } = this.desplazamiento;
    this.mundo.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${this.escala})`;
    if (this.hud) this.hud.textContent = Math.round(this.escala * 100) + '%';
  };

  /** Zoom manteniendo fijo el punto de pantalla indicado (por defecto, el centro). */
  Lienzo.prototype.zoomEn = function (nuevaEscala, puntoPantalla) {
    const escala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, nuevaEscala));
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

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.perfiles) {
      const { x, y } = AlbumDatos.posicionDe(p.id);
      minX = Math.min(minX, x - NODO_ANCHO / 2);
      maxX = Math.max(maxX, x + NODO_ANCHO / 2);
      minY = Math.min(minY, y - NODO_ALTO / 2);
      maxY = Math.max(maxY, y + NODO_ALTO / 2 + 60); /* +60: el pie de texto */
    }

    const margen = 140;
    const escala = Math.min(
      ESCALA_MAX,
      Math.max(
        ESCALA_MIN,
        Math.min(
          (r.width - margen * 2) / (maxX - minX),
          (r.height - margen * 2) / (maxY - minY)
        )
      )
    );

    const centroX = (minX + maxX) / 2;
    const centroY = (minY + maxY) / 2;

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

  /* ── Entrada: arrastre, rueda, pinza, teclado ────────────── */

  Lienzo.prototype._conectarEventos = function () {
    const c = this.contenedor;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
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
      /* Umbral de 5 px: separa un clic de un micro-arrastre */
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) >= 5) return;
      const perfil = this.perfiles.find((p) => p.id === g.nodo.dataset.id);
      if (perfil) this.alSeleccionar(perfil);
    });

    const soltar = (e) => {
      this._punteros.delete(e.pointerId);
      if (this._punteros.size < 2) this._distanciaPinza = 0;
      if (this._punteros.size === 0) {
        this._arrastre = null;
        c.classList.remove('arrastrando');
      }
    };
    c.addEventListener('pointerup', soltar);
    c.addEventListener('pointercancel', soltar);

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * SENSIBILIDAD_RUEDA);
        this.zoomEn(this.escala * factor, { x: e.clientX, y: e.clientY });
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      if (e.target !== document.body && e.target.tagName !== 'MAIN') return;
      if (e.key === '+' || e.key === '=') this.zoomEn(this.escala * 1.2);
      if (e.key === '-' || e.key === '_') this.zoomEn(this.escala / 1.2);
      if (e.key === 'c' || e.key === 'C') this.centrar();
    });

    window.addEventListener('resize', () => this.centrar(false));
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
