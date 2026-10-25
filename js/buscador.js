/* ══════════════════════════════════════════════════════════════
   BUSCADOR — personas, lugares, años y familias
   ──────────────────────────────────────────────────────────────
   Una sola caja: cada palabra debe encajar con el nombre (también por
   cómo suena), con un lugar o con un año/década. Las personas salen de
   la familia que ya está en memoria (cero lecturas extra); las otras
   familias se buscan por su RESUMEN (apellidos y lugares guardados en
   el documento de la familia), sin leer a nadie de dentro.

   Depende de AlbumLugares (lugares.js).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function Buscador(opciones) {
    this.o = opciones;
    this.panel = $('panelBuscar');
    this.entrada = $('buscarTexto');
    this.listaPersonas = $('buscarPersonas');
    this.listaFamilias = $('buscarFamilias');
    this._resumenes = null; // se piden al abrir, una vez por apertura
    this._timer = null;
    this._conectar();
  }

  Buscador.prototype.abrir = function () {
    this.panel.hidden = false;
    this.entrada.focus();
    this.entrada.select();
    this._resumenes = null;
    this.o.resumenes()
      .then((r) => { this._resumenes = r; this._pintarFamilias(); })
      .catch((e) => { console.warn('[Buscador] Sin resúmenes de familias', e); this._resumenes = []; this._pintarFamilias(); });
    this._pintar();
  };

  Buscador.prototype.cerrar = function () {
    this.panel.hidden = true;
  };

  Buscador.prototype._pintar = function () {
    this._pintarPersonas();
    this._pintarFamilias();
  };

  /** Fila de resultado accesible: un botón dentro de un <li>. */
  function fila(titulo, detalle, alElegir) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'resultado';
    const t = document.createElement('span');
    t.className = 'resultado__titulo';
    t.textContent = titulo;
    b.appendChild(t);
    if (detalle) {
      const d = document.createElement('span');
      d.className = 'resultado__detalle';
      d.textContent = detalle;
      b.appendChild(d);
    }
    b.addEventListener('click', alElegir);
    li.appendChild(b);
    return li;
  }

  function vacio(texto) {
    const li = document.createElement('li');
    li.className = 'resultados__vacio';
    li.textContent = texto;
    return li;
  }

  Buscador.prototype._pintarPersonas = function () {
    const consulta = this.entrada.value;
    const ul = this.listaPersonas;
    ul.textContent = '';
    if (!AlbumLugares.normalizar(consulta)) {
      ul.appendChild(vacio('Escribe un nombre, un apellido, un lugar o un año.'));
      return;
    }
    const hallados = AlbumLugares.buscarPersonas(this.o.perfiles(), consulta, 30);
    if (!hallados.length) {
      ul.appendChild(vacio('Nadie en esta familia coincide con «' + consulta.trim() + '».'));
      return;
    }
    hallados.forEach(({ perfil }) => {
      const ls = AlbumLugares.lugaresDe(perfil);
      const lugar = AlbumLugares.describir(ls.nacimiento) || AlbumLugares.describir(ls.residencia);
      const detalle = [AlbumDatos.formatearFechas(perfil), lugar].filter(Boolean).join(' · ');
      ul.appendChild(fila(perfil.nombre_completo, detalle, () => {
        this.cerrar();
        this.o.alElegirPersona(perfil);
      }));
    });
  };

  Buscador.prototype._pintarFamilias = function () {
    const consulta = this.entrada.value;
    const ul = this.listaFamilias;
    ul.textContent = '';
    if (!AlbumLugares.normalizar(consulta)) return;
    if (this._resumenes === null) {
      ul.appendChild(vacio('Buscando familias…'));
      return;
    }
    const actual = this.o.familiaActual();
    const hallados = this._resumenes.filter((f) =>
      f.id !== actual && AlbumLugares.familiaEncaja(f.resumen, this.o.etiqueta(f.id), consulta)
    );
    if (!hallados.length) {
      ul.appendChild(vacio('Ninguna otra familia registrada coincide.'));
      return;
    }
    hallados.slice(0, 20).forEach((f) => {
      const r = f.resumen || {};
      const detalle = [
        r.personas ? r.personas + ' personas' : '',
        (r.nombresLugar || []).slice(0, 3).join(', '),
      ].filter(Boolean).join(' · ');
      ul.appendChild(fila(this.o.etiqueta(f.id), detalle, () => {
        this.cerrar();
        this.o.alElegirFamilia(f.id);
      }));
    });
  };

  Buscador.prototype._conectar = function () {
    this.entrada.addEventListener('input', () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._pintar(), 120);
    });
    /* Enter abre el primer resultado: lo normal al buscar a alguien */
    this.entrada.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(this._timer);
      this._pintar();
      const primero = this.panel.querySelector('.resultado');
      if (primero) primero.click();
    });
  };

  global.Buscador = Buscador;
})(window);
