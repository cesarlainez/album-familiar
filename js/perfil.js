/* ══════════════════════════════════════════════════════════════
   PERFIL — Flip Card 3D: giro del nodo para ver/editar sus datos
   ──────────────────────────────────────────────────────────────
   Al seleccionar un nodo, una tarjeta se ancla sobre su posición en
   pantalla, crece y gira 180° (rotateY) para mostrar el reverso con la
   información, el mini carrusel y los botones de CRUD. Al cerrar, gira
   de vuelta y se encoge al tamaño del nodo.

   Responsable de la VISTA. El CRUD vive en mantenimiento.js, que
   reutiliza `perfilActual`, `refrescar()` y el hook `alAbrir`.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const MAX_FOTOS = 3;

  function Perfil(refs) {
    this.refs = refs;
    this.galeria = [];
    this.indice = 0;
    this.abierto = false;
    this.perfilActual = null;
    this.alAbrir = null; // hook opcional (lo usa mantenimiento.js)
    this._cerrarTimer = null;

    this._conectarEventos();
  }

  /* ── Apertura y cierre (flip) ────────────────────────────── */

  Perfil.prototype.abrir = function (perfil) {
    clearTimeout(this._cerrarTimer);
    this._abiertaEn = Date.now();
    this.perfilActual = perfil;
    this._pintarFrente(perfil);
    this._pintarLectura(perfil);

    const r = this.refs;
    r.capa.hidden = false;

    /* Punto de partida: centrada y pequeña; luego crece a pantalla completa
       mientras gira. (La posición centrada la fija el CSS con left/top 50%.) */
    this._escalaIni = 0.28;
    r.carta.style.transform = 'translate(-50%, -50%) scale(' + this._escalaIni + ')';
    r.lienzo.classList.add('desenfocado');

    /* Reflow forzado para fijar el estado inicial y que la transición
       (expandir + girar) se reproduzca. No depende de requestAnimationFrame,
       que el navegador puede frenar cuando la pestaña no está en foco. */
    void r.carta.offsetWidth;

    r.carta.style.transform = 'translate(-50%, -50%) scale(1)';
    r.capa.classList.add('abierta');

    this.abierto = true;
    if (typeof this.alAbrir === 'function') this.alAbrir(perfil);
  };

  Perfil.prototype.cerrar = function () {
    if (!this.abierto) return;
    const r = this.refs;

    /* Gira de vuelta y se encoge hacia el tamaño del nodo. */
    r.capa.classList.remove('abierta');
    r.carta.style.transform =
      'translate(-50%, -50%) scale(' + (this._escalaIni || 0.55) + ')';
    r.lienzo.classList.remove('desenfocado');
    this.abierto = false;

    this._cerrarTimer = setTimeout(() => {
      if (!this.abierto) r.capa.hidden = true;
    }, 600);
  };

  /* ── Pintado de caras ────────────────────────────────────── */

  Perfil.prototype._pintarFrente = function (perfil) {
    const r = this.refs;
    r.frenteNombre.textContent = perfil.nombre_completo || '';
    const portada = (perfil.galeria || []).filter(Boolean)[0] || '';
    if (portada) {
      r.frenteFoto.src = portada;
      r.frenteFoto.alt = 'Retrato de ' + (perfil.nombre_completo || '');
      r.frenteFoto.hidden = false;
      r.frentePlaceholder.hidden = true;
    } else {
      r.frenteFoto.hidden = true;
      r.frentePlaceholder.hidden = false;
      r.frentePlaceholder.textContent = AlbumDatos.iniciales(perfil.nombre_completo);
    }
  };

  /** Re-pinta ambas caras con datos frescos (lo usa el CRUD tras guardar). */
  Perfil.prototype.refrescar = function (perfil) {
    this.perfilActual = perfil;
    this._pintarFrente(perfil);
    this._pintarLectura(perfil);
  };

  Perfil.prototype._pintarLectura = function (perfil) {
    const r = this.refs;

    /* Muestra el valor y oculta el campo (o su bloque título+texto) si viene
       vacío: nada de mostrar un título "Biografía" sin biografía. */
    const pintar = (el, valor) => {
      const texto = (valor == null ? '' : String(valor)).trim();
      el.textContent = texto;
      const contenedor = el.closest('.ficha-datos__bloque') || el;
      contenedor.hidden = !texto;
    };

    r.nombre.textContent = perfil.nombre_completo || '';
    pintar(r.disciplina, perfil.disciplina_artistica);
    pintar(r.fechas, AlbumDatos.formatearFechas(perfil));
    pintar(r.obra, perfil.obra_maestra);
    pintar(r.bio, perfil.biografia);

    this.galeria = (perfil.galeria || []).filter(Boolean).slice(0, MAX_FOTOS);
    this.indice = 0;
    this._cargarGaleria(perfil);
  };

  /* ── Mini carrusel ───────────────────────────────────────── */

  Perfil.prototype._cargarGaleria = function (perfil) {
    const r = this.refs;
    const hayFotos = this.galeria.length > 0;

    r.foto.hidden = !hayFotos;
    r.vacio.hidden = hayFotos;
    r.lupa.style.display = hayFotos ? '' : 'none';

    if (!hayFotos) {
      r.vacio.textContent = AlbumDatos.iniciales(perfil.nombre_completo);
      this._pintarPuntos();
      return;
    }
    this._pintarFoto(false);
    this._pintarPuntos();
  };

  Perfil.prototype.irA = function (indice) {
    if (this.galeria.length < 2) return;
    const total = this.galeria.length;
    this.indice = ((indice % total) + total) % total;
    this._pintarFoto(true);
    this._pintarPuntos();
  };

  Perfil.prototype._pintarFoto = function (conFundido) {
    const img = this.refs.foto;
    const url = this.galeria[this.indice] || '';
    const asignar = () => {
      img.src = url;
      img.alt = `Fotografía ${this.indice + 1} de ${this.galeria.length}`;
      img.classList.remove('cambiando');
    };
    if (!conFundido) return asignar();
    img.classList.add('cambiando');
    setTimeout(asignar, 220);
  };

  Perfil.prototype._pintarPuntos = function () {
    const cont = this.refs.puntos;
    cont.innerHTML = '';
    const visible = this.galeria.length > 1;
    this.refs.prev.style.visibility = visible ? 'visible' : 'hidden';
    this.refs.next.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) return;

    this.galeria.forEach((_, i) => {
      const punto = document.createElement('button');
      punto.type = 'button';
      punto.className = 'punto' + (i === this.indice ? ' activo' : '');
      punto.setAttribute('aria-label', `Ver fotografía ${i + 1}`);
      punto.addEventListener('click', () => this.irA(i));
      cont.appendChild(punto);
    });
  };

  /* ── Visor a pantalla completa ───────────────────────────── */

  Perfil.prototype.abrirVisor = function () {
    const url = this.galeria[this.indice];
    if (!url) return;
    const r = this.refs;
    r.visorFoto.src = url;
    r.visorFoto.alt = this.refs.foto.alt;
    r.visor.hidden = false;
    requestAnimationFrame(() => r.visor.classList.add('abierto'));
  };

  Perfil.prototype.cerrarVisor = function () {
    const r = this.refs;
    r.visor.classList.remove('abierto');
    setTimeout(() => { r.visor.hidden = true; }, 450);
  };

  Perfil.prototype.visorAbierto = function () {
    return !this.refs.visor.hidden;
  };

  /* ── Eventos ─────────────────────────────────────────────── */

  Perfil.prototype._conectarEventos = function () {
    const r = this.refs;

    r.capa.querySelectorAll('[data-cerrar]').forEach((el) =>
      el.addEventListener('click', () => {
        /* Ignora el "clic fantasma" que algunos navegadores móviles
           sintetizan justo después del toque que abrió la ficha. */
        if (Date.now() - (this._abiertaEn || 0) < 450) return;
        this.cerrar();
      })
    );

    r.prev.addEventListener('click', () => this.irA(this.indice - 1));
    r.next.addEventListener('click', () => this.irA(this.indice + 1));
    r.lupa.addEventListener('click', () => this.abrirVisor());
    r.foto.addEventListener('click', () => {
      if (Date.now() - (this._swipeEn || 0) < 400) return; // fue un deslizamiento
      this.abrirVisor();
    });
    r.visorCerrar.addEventListener('click', () => this.cerrarVisor());
    r.visor.addEventListener('click', (e) => {
      if (Date.now() - (this._swipeEn || 0) < 400) return;
      if (e.target === r.visor) this.cerrarVisor();
    });

    /* ── Deslizar (swipe) para cambiar de foto en táctil ─────────
       Horizontal, ≥40px y más horizontal que vertical. Funciona en el
       carrusel de la ficha y en el visor a pantalla completa. */
    const conectarSwipe = (superficie, alDeslizar) => {
      let inicio = null;
      superficie.addEventListener('pointerdown', (e) => {
        inicio = { x: e.clientX, y: e.clientY };
      });
      superficie.addEventListener('pointerup', (e) => {
        if (!inicio) return;
        const dx = e.clientX - inicio.x;
        const dy = e.clientY - inicio.y;
        inicio = null;
        if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          this._swipeEn = Date.now();
          alDeslizar(dx < 0 ? 1 : -1);
        }
      });
      superficie.addEventListener('pointercancel', () => { inicio = null; });
    };

    if (r.marco) conectarSwipe(r.marco, (dir) => this.irA(this.indice + dir));
    conectarSwipe(r.visor, (dir) => {
      this.irA(this.indice + dir);
      this.abrirVisor(); // refresca la foto grande
    });

    window.addEventListener('keydown', (e) => {
      if (this.visorAbierto()) {
        if (e.key === 'Escape') this.cerrarVisor();
        if (e.key === 'ArrowLeft') { this.irA(this.indice - 1); this.abrirVisor(); }
        if (e.key === 'ArrowRight') { this.irA(this.indice + 1); this.abrirVisor(); }
        return;
      }
      if (!this.abierto) return;
      /* Con el editor abierto, dejar que el teclado escriba en los campos */
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') this.cerrar();
      if (e.key === 'ArrowLeft') this.irA(this.indice - 1);
      if (e.key === 'ArrowRight') this.irA(this.indice + 1);
    });

    window.addEventListener('resize', () => {
      /* La carta se centra por CSS; solo reafirmamos la escala abierta. */
      if (this.abierto) this.refs.carta.style.transform = 'translate(-50%, -50%) scale(1)';
    });
  };

  global.Perfil = Perfil;
})(window);
