/* ══════════════════════════════════════════════════════════════
   ATLAS DE RAÍCES — mapa y línea de tiempo de la familia
   ──────────────────────────────────────────────────────────────
   Dibuja en SVG, sin servicios de mapas (cero costo y cero cuotas):

     · Vista «El Salvador»: los 14 departamentos como estrellas sobre
       un contorno aproximado del país. Brillan más donde hay más
       familia. Lo que está fuera del país se resume en una salida
       «Al exterior».
     · Vista «Mundo»: El Salvador como un solo punto y las ciudades de
       la diáspora.

   Los arcos son la migración: de dónde nació a dónde vivió o falleció
   cada persona, y del lugar de nacimiento de un padre o una madre al
   de su hijo. La línea de tiempo filtra por década de nacimiento; las
   personas sin año se ven solo en «Hoy».

   Depende de AlbumLugares (lugares.js) y AlbumDatos.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const HOY = 2030; // valor del deslizador que significa "todas las épocas"

  /* Contorno aproximado de El Salvador (lon, lat). Decorativo: da forma
     reconocible al mapa, no sirve para medir. */
  const CONTORNO_SV = [
    [-90.10, 13.73], [-90.03, 13.83], [-89.93, 13.95], [-89.80, 14.10], [-89.70, 14.22],
    [-89.57, 14.33], [-89.50, 14.41], [-89.36, 14.43], [-89.21, 14.37], [-89.10, 14.33],
    [-88.95, 14.35], [-88.75, 14.18], [-88.60, 14.05], [-88.45, 13.98], [-88.25, 13.98],
    [-88.05, 13.95], [-87.80, 13.88], [-87.73, 13.65], [-87.70, 13.40], [-87.80, 13.33],
    [-87.88, 13.20], [-88.05, 13.16], [-88.40, 13.17], [-88.70, 13.22], [-88.90, 13.27],
    [-89.20, 13.45], [-89.50, 13.50], [-89.80, 13.58],
  ];

  const VISTAS = {
    sv: { lon: [-90.25, -87.55], lat: [13.05, 14.55], ancho: 1000 },
    mundo: { lon: [-128, 22], lat: [4, 63], ancho: 1000 },
  };
  const PUNTO_SV = { lat: 13.75, lng: -88.95 }; // El Salvador en la vista Mundo

  function proyector(v) {
    const latMedia = (v.lat[0] + v.lat[1]) / 2;
    const k = Math.cos((latMedia * Math.PI) / 180);
    const anchoGrados = (v.lon[1] - v.lon[0]) * k;
    const altoGrados = v.lat[1] - v.lat[0];
    const alto = Math.round((v.ancho * altoGrados) / anchoGrados);
    return {
      ancho: v.ancho,
      alto,
      xy: (lat, lng) => [
        ((lng - v.lon[0]) * k * v.ancho) / anchoGrados,
        ((v.lat[1] - lat) * alto) / altoGrados,
      ],
    };
  }

  function el(etiqueta, atributos, padre) {
    const n = document.createElementNS(NS, etiqueta);
    for (const k in atributos) n.setAttribute(k, atributos[k]);
    if (padre) padre.appendChild(n);
    return n;
  }

  function Atlas(opciones) {
    this.o = opciones;
    this.raiz = $('atlas');
    this.svg = $('atlasMapa');
    this.lista = $('atlasLista');
    this.vacio = $('atlasVacio');
    this.rango = $('atlasDecada');
    this.textoDecada = $('atlasDecadaTexto');
    this.play = $('atlasPlay');
    this.vista = 'sv';
    this.seleccion = null; // clave del punto elegido
    this._anim = null;
    this._conectar();
  }

  Atlas.prototype.abierto = function () {
    return !this.raiz.hidden;
  };

  Atlas.prototype.abrir = function () {
    this._preparar();
    this.raiz.hidden = false;
    this.seleccion = null;
    this.rango.value = String(HOY);
    this._pintar();
    this.raiz.querySelector('.atlas__cerrar').focus();
  };

  Atlas.prototype.cerrar = function () {
    this._parar();
    this.raiz.hidden = true;
  };

  /* ── Datos: quién estuvo dónde y cuándo ────────────────────── */

  /** Agrupa cada lugar del perfil al nivel de la vista: en «El Salvador»
   *  por departamento (lo de fuera va a «exterior»); en «Mundo» todo El
   *  Salvador es un solo punto y cada ciudad el suyo. */
  function grupoDe(clave, vista) {
    const l = AlbumLugares.lugar(clave);
    if (!l || l.clave === 'XX' || l.lat == null) return null;
    if (vista === 'sv') return l.pais === 'SV' ? l.claveDepartamento : 'EXTERIOR';
    return l.pais === 'SV' ? 'SV' : l.clave;
  }

  Atlas.prototype._preparar = function () {
    const perfiles = this.o.perfiles();
    const porId = new Map(perfiles.map((p) => [p.id, p]));
    this._personas = perfiles.map((p) => ({
      perfil: p,
      anio: AlbumLugares.anio(p.fecha_nacimiento),
      lugares: AlbumLugares.lugaresDe(p),
    }));
    const conAnio = this._personas.map((x) => x.anio).filter((a) => a != null);
    const minimo = conAnio.length ? Math.floor(Math.min.apply(null, conAnio) / 10) * 10 : 1900;
    this.rango.min = String(Math.min(minimo, 2020));
    this.rango.max = String(HOY);
    this._porId = porId;
    this._hayLugares = this._personas.some((x) =>
      AlbumLugares.TIPOS.some(([t]) => grupoDe(x.lugares[t].clave, 'mundo'))
    );
  };

  /** Puntos y arcos de la vista, hasta la década elegida. */
  Atlas.prototype._calcular = function () {
    const vista = this.vista;
    const tope = Number(this.rango.value);
    const visible = (anio) => tope >= HOY || (anio != null && anio <= tope + 9);
    const puntos = new Map(); // grupo → { personas: Map(id → [tipos]) }
    const arcos = new Map(); // "a>b" → { a, b, n }

    const sumar = (grupo, persona, tipo) => {
      if (!grupo) return;
      if (!puntos.has(grupo)) puntos.set(grupo, new Map());
      const m = puntos.get(grupo);
      if (!m.has(persona.perfil.id)) m.set(persona.perfil.id, []);
      m.get(persona.perfil.id).push(tipo);
    };
    const arco = (a, b) => {
      if (!a || !b || a === b) return;
      const k = a + '>' + b;
      if (!arcos.has(k)) arcos.set(k, { a, b, n: 0 });
      arcos.get(k).n++;
    };

    for (const x of this._personas) {
      if (!visible(x.anio)) continue;
      const g = {};
      AlbumLugares.TIPOS.forEach(([tipo]) => {
        g[tipo] = grupoDe(x.lugares[tipo].clave, vista);
        sumar(g[tipo], x, tipo);
      });
      /* Su propio viaje */
      arco(g.nacimiento, g.residencia || g.fallecimiento);
      if (g.residencia) arco(g.residencia, g.fallecimiento);
      /* De la tierra de sus padres a la suya */
      for (const idProg of [x.perfil.id_padre, x.perfil.id_madre]) {
        const prog = idProg && this._porId.get(idProg);
        if (!prog) continue;
        arco(grupoDe(AlbumLugares.lugaresDe(prog).nacimiento.clave, vista), g.nacimiento);
      }
    }
    return { puntos, arcos: [...arcos.values()] };
  };

  /* ── Dibujo ────────────────────────────────────────────────── */

  Atlas.prototype._coordenadas = function (grupo, proy) {
    /* "Al exterior" arriba a la derecha, con sitio para su rótulo */
    if (this.vista === 'sv' && grupo === 'EXTERIOR') return [proy.ancho - 40 - 90 * (proy.k || 1), 46 * (proy.k || 1)];
    if (this.vista === 'mundo' && grupo === 'SV') return proy.xy(PUNTO_SV.lat, PUNTO_SV.lng);
    const l = AlbumLugares.lugar(grupo);
    return l ? proy.xy(l.lat, l.lng) : null;
  };

  Atlas.prototype._nombre = function (grupo) {
    if (grupo === 'EXTERIOR') return 'Al exterior';
    if (grupo === 'SV') return 'El Salvador';
    const l = AlbumLugares.lugar(grupo);
    return l ? l.nombre : grupo;
  };

  /** Encuadre de la vista. «Mundo» se ajusta a los lugares que hay
   *  (más El Salvador), para no dejar medio planeta vacío. */
  Atlas.prototype._encuadre = function (puntos) {
    if (this.vista === 'sv') return VISTAS.sv;
    const lats = [PUNTO_SV.lat];
    const lngs = [PUNTO_SV.lng];
    puntos.forEach((_, grupo) => {
      const l = grupo !== 'SV' && AlbumLugares.lugar(grupo);
      if (l && l.lat != null) { lats.push(l.lat); lngs.push(l.lng); }
    });
    const caja = (vals, pad, minimo, lim) => {
      let a = Math.min.apply(null, vals) - pad;
      let b = Math.max.apply(null, vals) + pad;
      if (b - a < minimo) { const c = (a + b) / 2; a = c - minimo / 2; b = c + minimo / 2; }
      return [Math.max(lim[0], a), Math.min(lim[1], b)];
    };
    return {
      lon: caja(lngs, 12, 45, [-170, 170]),
      lat: caja(lats, 7, 24, [-60, 75]),
      ancho: VISTAS.mundo.ancho,
    };
  };

  Atlas.prototype._pintar = function () {
    const { puntos, arcos } = this._calcular();
    const encuadre = this._encuadre(puntos);
    const proy = proyector(encuadre);
    const svg = this.svg;
    svg.textContent = '';
    svg.setAttribute('viewBox', '0 0 ' + proy.ancho + ' ' + proy.alto);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    /* El mapa se dibuja en 1000 unidades de ancho: en un celular eso deja
       letras de 5 px. Se compensa con la escala real en pantalla. */
    const k = Math.min(2.6, Math.max(1, proy.ancho / Math.max(1, svg.clientWidth || proy.ancho)));
    svg.style.setProperty('--atlas-letra', (13 * k).toFixed(1) + 'px');
    proy.k = k;

    const tope = Number(this.rango.value);
    this.textoDecada.textContent = tope >= HOY ? 'Hoy · todas las épocas' : 'Nacidos hasta los ' + tope + 's';
    this.vacio.hidden = this._hayLugares;

    /* Fondo: retícula tenue y, en El Salvador, el contorno */
    const fondo = el('g', { class: 'atlas__fondo' }, svg);
    const v = encuadre;
    const paso = this.vista === 'sv' ? 0.5 : 10;
    for (let lat = Math.ceil(v.lat[0] / paso) * paso; lat <= v.lat[1]; lat += paso) {
      const [, y] = proy.xy(lat, v.lon[0]);
      el('line', { x1: 0, y1: y, x2: proy.ancho, y2: y, class: 'atlas__reticula' }, fondo);
    }
    for (let lon = Math.ceil(v.lon[0] / paso) * paso; lon <= v.lon[1]; lon += paso) {
      const [x] = proy.xy(v.lat[0], lon);
      el('line', { x1: x, y1: 0, x2: x, y2: proy.alto, class: 'atlas__reticula' }, fondo);
    }
    if (this.vista === 'sv') {
      const d = CONTORNO_SV.map(([lng, lat], i) => (i ? 'L' : 'M') + proy.xy(lat, lng).map((n) => n.toFixed(1)).join(' ')).join(' ') + ' Z';
      el('path', { d, class: 'atlas__contorno' }, fondo);
    }

    /* Arcos de migración (debajo de los puntos) */
    const capaArcos = el('g', { class: 'atlas__arcos' }, svg);
    arcos.forEach(({ a, b, n }) => {
      const pa = this._coordenadas(a, proy);
      const pb = this._coordenadas(b, proy);
      if (!pa || !pb) return;
      const mx = (pa[0] + pb[0]) / 2;
      const my = (pa[1] + pb[1]) / 2;
      const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      /* curva hacia "arriba" proporcional a la distancia */
      const cx = mx + (pb[1] - pa[1]) * 0.25;
      const cy = my - dist * 0.28;
      const path = el('path', {
        d: `M${pa[0].toFixed(1)} ${pa[1].toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${pb[0].toFixed(1)} ${pb[1].toFixed(1)}`,
        class: 'atlas__arco',
        'stroke-width': Math.min(1 + n * 0.6, 5).toFixed(1),
      }, capaArcos);
      const titulo = el('title', {}, path);
      titulo.textContent = this._nombre(a) + ' → ' + this._nombre(b) + ' (' + n + ')';
    });

    /* Puntos: en El Salvador se dibujan los 14 departamentos aunque estén
       vacíos (como estrellas apagadas), para que el mapa se reconozca. */
    const grupos = new Set(puntos.keys());
    if (this.vista === 'sv') AlbumLugares.DEPARTAMENTOS.forEach(([cod]) => grupos.add('SV-' + cod));
    const capaPuntos = el('g', { class: 'atlas__puntos' }, svg);
    [...grupos].forEach((grupo) => {
      const c = this._coordenadas(grupo, proy);
      if (!c) return;
      const gente = puntos.get(grupo);
      const n = gente ? gente.size : 0;
      const r = (n ? 5 + Math.sqrt(n) * 4 : 3) * Math.sqrt(k);
      const g = el('g', {
        class: 'atlas__punto' + (n ? ' atlas__punto--vivo' : '') + (this.seleccion === grupo ? ' atlas__punto--elegido' : ''),
        transform: `translate(${c[0].toFixed(1)} ${c[1].toFixed(1)})`,
        tabindex: n ? '0' : '-1',
        role: n ? 'button' : 'presentation',
        'data-grupo': grupo,
        'aria-label': this._nombre(grupo) + (n ? ': ' + n + (n === 1 ? ' persona' : ' personas') : ''),
      }, capaPuntos);
      if (n) el('circle', { r: (r * 2.2).toFixed(1), class: 'atlas__halo' }, g);
      el('circle', { r: r.toFixed(1), class: 'atlas__estrella' }, g);
      const etiqueta = el('text', { y: (-r - 7 * k).toFixed(1), class: 'atlas__etiqueta' + (n ? '' : ' atlas__etiqueta--tenue') }, g);
      etiqueta.textContent = this._nombre(grupo) + (n ? ' · ' + n : '');
    });

    this._pintarLista(puntos);
  };

  /** Panel lateral: quién está en el punto elegido. */
  Atlas.prototype._pintarLista = function (puntos) {
    const ul = this.lista;
    ul.textContent = '';
    const gente = this.seleccion && puntos.get(this.seleccion);
    if (!gente) {
      const p = document.createElement('p');
      p.className = 'atlas__pista';
      p.textContent = this._hayLugares ? 'Toca una estrella para ver quién nació, vivió o descansa ahí.' : '';
      ul.appendChild(p);
      return;
    }
    const h = document.createElement('h3');
    h.className = 'atlas__lugar';
    h.textContent = this._nombre(this.seleccion);
    ul.appendChild(h);
    const verbos = { nacimiento: 'nació', residencia: 'vive o vivió', fallecimiento: 'falleció' };
    const lista = document.createElement('ul');
    lista.className = 'resultados';
    [...gente.entries()]
      .map(([id, tipos]) => ({ p: this._porId.get(id), tipos }))
      .filter((x) => x.p)
      .sort((a, b) => String(a.p.fecha_nacimiento || '9999').localeCompare(String(b.p.fecha_nacimiento || '9999')))
      .forEach(({ p, tipos }) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'resultado';
        const t = document.createElement('span');
        t.className = 'resultado__titulo';
        t.textContent = p.nombre_completo;
        const d = document.createElement('span');
        d.className = 'resultado__detalle';
        d.textContent = [tipos.map((x) => verbos[x]).join(', '), AlbumDatos.formatearFechas(p)].filter(Boolean).join(' · ');
        b.appendChild(t);
        b.appendChild(d);
        b.addEventListener('click', () => {
          this.cerrar();
          this.o.alElegirPersona(p);
        });
        li.appendChild(b);
        lista.appendChild(li);
      });
    ul.appendChild(lista);
  };

  /* ── Línea de tiempo ───────────────────────────────────────── */

  Atlas.prototype._parar = function () {
    clearInterval(this._anim);
    this._anim = null;
    this.play.textContent = '▶';
    this.play.setAttribute('aria-label', 'Reproducir la línea de tiempo');
  };

  Atlas.prototype._reproducir = function () {
    if (this._anim) return this._parar();
    const min = Number(this.rango.min);
    if (Number(this.rango.value) >= HOY) this.rango.value = String(min);
    this.play.textContent = '❚❚';
    this.play.setAttribute('aria-label', 'Pausar la línea de tiempo');
    this._pintar();
    this._anim = setInterval(() => {
      const siguiente = Number(this.rango.value) + 10;
      this.rango.value = String(Math.min(siguiente, HOY));
      this._pintar();
      if (siguiente >= HOY) this._parar();
    }, 900);
  };

  Atlas.prototype._conectar = function () {
    $('atlasCerrar').addEventListener('click', () => this.cerrar());
    this.raiz.querySelectorAll('[data-vista]').forEach((b) => {
      b.addEventListener('click', () => {
        this.vista = b.dataset.vista;
        this.seleccion = null;
        this.raiz.querySelectorAll('[data-vista]').forEach((x) => {
          x.classList.toggle('activo', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        this._pintar();
      });
    });
    this.rango.addEventListener('input', () => {
      if (this._anim) this._parar();
      this._pintar();
    });
    this.play.addEventListener('click', () => this._reproducir());
    /* Girar el teléfono cambia el ancho: se recalcula el tamaño de letra */
    let espera = null;
    global.addEventListener('resize', () => {
      if (!this.abierto()) return;
      clearTimeout(espera);
      espera = setTimeout(() => this._pintar(), 150);
    });

    const elegir = (objetivo) => {
      const g = objetivo.closest && objetivo.closest('.atlas__punto--vivo');
      if (!g) return;
      this.seleccion = this.seleccion === g.dataset.grupo ? null : g.dataset.grupo;
      this._pintar();
      const vuelto = this.svg.querySelector('[data-grupo="' + g.dataset.grupo + '"]');
      if (vuelto) vuelto.focus();
    };
    this.svg.addEventListener('click', (e) => elegir(e.target));
    this.svg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(e.target); }
    });
  };

  global.Atlas = Atlas;
})(window);
