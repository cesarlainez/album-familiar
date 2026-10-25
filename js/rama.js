/* ══════════════════════════════════════════════════════════════
   RAMA — «Mi familia» en la página de aportes (aportar.html)
   ──────────────────────────────────────────────────────────────
   El primo elige quién es y ve a su familia cercana: su pareja, sus
   padres, sus hijos y los hijos de sus hijos. De cada uno puede
   COMPLETAR datos (año, lugar, ocupación, una foto, algo que contar)
   o AGREGAR a quien falte (hijo/a, pareja, padre, madre).

   Cada envío es un aporte que la familia revisa en su bandeja:
     · tipo 'datos'   → corrección de una persona que ya está
     · tipo 'persona' → alguien nuevo, unido a otra persona por un
                        vínculo; esa otra puede ser también nueva
                        ('aporte:<id>'), así se agrega una rama entera
                        de un tirón: el hijo, y luego los nietos.

   El árbol que se ve sale de la lista que viaja en el enlace (nombres
   y relaciones, sin fotos) más lo que esta persona ya envió, que se
   recuerda en el teléfono para poder seguir otro día.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const PROFUNDIDAD = 3; // tú → hijos → nietos → bisnietos

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  /** Llena un <select> con el catálogo de lugares (mismo orden que el editor). */
  function llenarLugares(sel) {
    sel.appendChild(new Option('— No sé / sin indicar —', ''));
    AlbumLugares.DEPARTAMENTOS.forEach(([cod, nombre, , , municipios]) => {
      const g = document.createElement('optgroup');
      g.label = nombre + ' (El Salvador)';
      g.appendChild(new Option(nombre + ' — todo el departamento', 'SV-' + cod));
      municipios.forEach((punto) => g.appendChild(new Option(nombre + ' ' + punto, 'SV-' + cod + '-' + punto[0])));
      sel.appendChild(g);
    });
    AlbumLugares.MUNDO.forEach(([region, ciudades]) => {
      const g = document.createElement('optgroup');
      g.label = region;
      ciudades.forEach(([clave, nombre]) => g.appendChild(new Option(nombre, clave)));
      sel.appendChild(g);
    });
  }

  /**
   * opciones: { fid, token, enlace, firma: () => {autor, relacion},
   *             reducirFoto: (archivo) => dataURL }
   */
  function Rama(opciones) {
    this.o = opciones;
    this.claveLocal = 'albumFamiliar:rama:' + opciones.fid + ':' + opciones.token;
    /* Nodos: los del enlace + los nuevos que esta persona ya envió */
    this.nodos = new Map();
    (opciones.enlace.personas || []).forEach((p) => {
      this.nodos.set(p.id, {
        id: p.id, nombre: p.nombre, p: p.p || '', m: p.m || '', c: (p.c || []).slice(),
        n: p.n || '', f: p.f || '', l: p.l || '', r: p.r || '', nuevo: false,
      });
    });
    this.enviados = new Set(); // ids con algún dato ya enviado
    this.yo = '';
    this.formulario = null; // { modo: 'completar'|'agregar', id, vinculo }
    this.foto = null;
    this._recordar();
    this._conectar();
  }

  /* ── Lo enviado se recuerda en este teléfono ───────────────── */

  Rama.prototype._recordar = function () {
    try {
      const g = JSON.parse(localStorage.getItem(this.claveLocal) || 'null');
      if (!g) return;
      (g.nuevos || []).forEach((x) => this._sumarNuevo(x));
      (g.enviados || []).forEach((id) => this.enviados.add(id));
      if (g.yo && this.nodos.has(g.yo)) this.yo = g.yo;
    } catch (e) { /* sin almacenamiento: se empieza de cero */ }
  };

  Rama.prototype._guardar = function () {
    try {
      const nuevos = [...this.nodos.values()].filter((x) => x.nuevo).map((x) => x.registro);
      localStorage.setItem(this.claveLocal, JSON.stringify({ yo: this.yo, nuevos, enviados: [...this.enviados] }));
    } catch (e) { /* opcional */ }
  };

  /** Mete en el árbol visible a una persona recién enviada. */
  Rama.prototype._sumarNuevo = function (x) {
    const nodo = { id: x.id, nombre: x.nombre, p: '', m: '', c: [], n: x.n || '', f: x.f || '', l: '', r: '', nuevo: true, registro: x };
    const base = this.nodos.get(x.de);
    if (x.vinculo === 'hijo') {
      nodo.p = x.de;
    } else if (x.vinculo === 'pareja') {
      nodo.c = [x.de];
      if (base) base.c.push(x.id);
    } else if (base && x.vinculo === 'padre') {
      base.p = x.id;
    } else if (base && x.vinculo === 'madre') {
      base.m = x.id;
    }
    this.nodos.set(x.id, nodo);
  };

  /* ── Relaciones ────────────────────────────────────────────── */

  Rama.prototype._parejas = function (id) {
    const n = this.nodos.get(id);
    const ids = new Set(n ? n.c : []);
    this.nodos.forEach((x) => { if (x.c.indexOf(id) !== -1) ids.add(x.id); });
    ids.delete(id);
    return [...ids].map((x) => this.nodos.get(x)).filter(Boolean);
  };

  Rama.prototype._hijos = function (id) {
    return [...this.nodos.values()]
      .filter((x) => x.p === id || x.m === id)
      .sort((a, b) => String(a.n || '9999').localeCompare(String(b.n || '9999')));
  };

  /* ── Dibujo ────────────────────────────────────────────────── */

  Rama.prototype.iniciar = function () {
    const sel = $('ramaYo');
    sel.textContent = '';
    sel.appendChild(new Option('— Elige tu nombre —', ''));
    [...this.nodos.values()]
      .filter((x) => !x.nuevo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .forEach((x) => sel.appendChild(new Option(x.nombre, x.id)));
    /* Enlace hecho para alguien: ya viene elegido */
    if (!this.yo && this.o.enlace.rama && this.nodos.has(this.o.enlace.rama)) this.yo = this.o.enlace.rama;
    sel.value = this.yo;
    llenarLugares($('ramaLugarNac'));
    llenarLugares($('ramaLugarRes'));
    this.pintar();
  };

  /** "n. 1962 · Chalatenango" o, si falta, qué falta (en ámbar). */
  Rama.prototype._resumen = function (x) {
    const partes = [];
    if (x.n) partes.push('n. ' + x.n + (x.f ? ' — ✝ ' + x.f : ''));
    const lugar = AlbumLugares.lugar(x.l);
    if (lugar && lugar.clave !== 'XX') partes.push(lugar.departamento || lugar.nombre);
    return partes.join(' · ');
  };

  Rama.prototype._tarjeta = function (x, rotulo, acciones) {
    const t = crear('div', 'rama__tarjeta' + (x.nuevo ? ' rama__tarjeta--nueva' : ''));
    t.dataset.id = x.id;
    const cab = crear('div', 'rama__cabeza');
    if (rotulo) cab.appendChild(crear('span', 'rama__rotulo', rotulo));
    cab.appendChild(crear('span', 'rama__nombre', x.nombre));
    t.appendChild(cab);
    const resumen = this._resumen(x);
    const falta = [];
    if (!x.n) falta.push('año de nacimiento');
    if (!x.l) falta.push('lugar');
    t.appendChild(crear('span', 'rama__datos' + (resumen ? '' : ' rama__datos--falta'),
      resumen || 'Falta: ' + falta.join(' y ')));
    if (x.nuevo || this.enviados.has(x.id)) {
      t.appendChild(crear('span', 'rama__enviado', x.nuevo ? 'Agregado ✓ (la familia lo revisará)' : 'Datos enviados ✓'));
    }
    const fila = crear('div', 'rama__acciones');
    acciones.forEach(([texto, fn, principal]) => {
      const b = crear('button', 'btn-crud btn-crud--mini' + (principal ? ' btn-crud--primario' : ''), texto);
      b.type = 'button';
      b.addEventListener('click', fn);
      fila.appendChild(b);
    });
    t.appendChild(fila);
    return t;
  };

  Rama.prototype._grupo = function (titulo) {
    const g = crear('div', 'rama__grupo');
    g.appendChild(crear('p', 'rama__titulo', titulo));
    return g;
  };

  Rama.prototype.pintar = function () {
    const lista = $('ramaLista');
    lista.textContent = '';
    const yo = this.nodos.get(this.yo);
    $('ramaAyuda').hidden = !!yo;
    if (!yo) return;

    const completar = (x) => () => this.abrirFormulario('completar', x.id);
    const agregar = (x, vinculo) => () => this.abrirFormulario('agregar', x.id, vinculo);

    /* Tú */
    const tu = this._grupo('Tú');
    tu.appendChild(this._tarjeta(yo, '', [
      ['Completar mis datos', completar(yo), true],
      ['+ Mi pareja', agregar(yo, 'pareja')],
      ['+ Un hijo/a', agregar(yo, 'hijo')],
    ]));
    this._parejas(yo.id).forEach((x) => tu.appendChild(this._tarjeta(x, 'Pareja', [['Completar', completar(x)]])));
    lista.appendChild(tu);

    /* Tus padres */
    const padres = this._grupo('Tus padres');
    const padre = this.nodos.get(yo.p);
    const madre = this.nodos.get(yo.m);
    if (padre) padres.appendChild(this._tarjeta(padre, 'Padre', [['Completar', completar(padre)]]));
    if (madre) padres.appendChild(this._tarjeta(madre, 'Madre', [['Completar', completar(madre)]]));
    const faltan = crear('div', 'rama__acciones');
    if (!padre) faltan.appendChild(this._boton('+ Agregar a mi padre', agregar(yo, 'padre')));
    if (!madre) faltan.appendChild(this._boton('+ Agregar a mi madre', agregar(yo, 'madre')));
    if (faltan.children.length) padres.appendChild(faltan);
    lista.appendChild(padres);

    /* Hijos, nietos… */
    const hijos = this._hijos(yo.id);
    if (hijos.length) {
      const g = this._grupo('Tus hijos y su familia');
      hijos.forEach((h) => this._pintarDescendiente(g, h, 1));
      lista.appendChild(g);
    }
  };

  Rama.prototype._boton = function (texto, fn) {
    const b = crear('button', 'btn-crud btn-crud--mini', texto);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  Rama.prototype._pintarDescendiente = function (contenedor, x, nivel) {
    const caja = crear('div', 'rama__rama');
    caja.style.setProperty('--nivel', String(nivel - 1));
    caja.appendChild(this._tarjeta(x, nivel === 1 ? 'Hijo/a' : nivel === 2 ? 'Nieto/a' : 'Bisnieto/a', [
      ['Completar', () => this.abrirFormulario('completar', x.id)],
      ['+ Pareja', () => this.abrirFormulario('agregar', x.id, 'pareja')],
      ['+ Hijo/a', () => this.abrirFormulario('agregar', x.id, 'hijo')],
    ]));
    this._parejas(x.id).forEach((y) => caja.appendChild(this._tarjeta(y, 'Su pareja', [['Completar', () => this.abrirFormulario('completar', y.id)]])));
    contenedor.appendChild(caja);
    if (nivel < PROFUNDIDAD) this._hijos(x.id).forEach((h) => this._pintarDescendiente(contenedor, h, nivel + 1));
  };

  /* ── Formulario ────────────────────────────────────────────── */

  const TITULOS = {
    hijo: 'Agregar un hijo o hija de ',
    pareja: 'Agregar la pareja de ',
    padre: 'Agregar al padre de ',
    madre: 'Agregar a la madre de ',
  };

  Rama.prototype.abrirFormulario = function (modo, id, vinculo) {
    const x = this.nodos.get(id);
    if (!x) return;
    this.formulario = { modo, id, vinculo: vinculo || '' };
    this.foto = null;
    const f = $('ramaForm');
    $('ramaFormTitulo').textContent = modo === 'completar'
      ? 'Completar los datos de ' + x.nombre
      : TITULOS[vinculo] + x.nombre;
    $('ramaNombreFila').hidden = modo === 'completar';
    ['ramaNombre', 'ramaNacimiento', 'ramaFallecimiento', 'ramaDetalle', 'ramaOcupacion', 'ramaNota'].forEach((k) => { $(k).value = ''; });
    $('ramaLugarNac').value = '';
    $('ramaLugarRes').value = '';
    $('ramaFallecio').checked = false;
    $('ramaFallecimientoFila').hidden = true;
    $('ramaFotoVista').hidden = true;
    $('ramaFotoTexto').textContent = 'Agregar una foto (opcional)';
    /* Al completar se muestra lo que ya se sabe, para no repetirlo */
    if (modo === 'completar') {
      $('ramaNacimiento').placeholder = x.n ? 'Ya está: ' + x.n : '1962 o 3/5/1962';
      if (x.f) { $('ramaFallecio').checked = true; $('ramaFallecimientoFila').hidden = false; $('ramaFallecimiento').placeholder = 'Ya está: ' + x.f; }
    } else {
      $('ramaNacimiento').placeholder = '1962 o 3/5/1962';
      $('ramaFallecimiento').placeholder = '2015 o 20/8/2015';
    }
    this._error('');
    f.hidden = false;
    /* El formulario se abre junto a la tarjeta tocada */
    const tarjeta = $('ramaLista').querySelector('.rama__tarjeta[data-id="' + CSS.escape(id) + '"]');
    if (tarjeta) tarjeta.insertAdjacentElement('afterend', f);
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (modo === 'completar' ? $('ramaNacimiento') : $('ramaNombre')).focus({ preventScroll: true });
  };

  Rama.prototype.cerrarFormulario = function () {
    const f = $('ramaForm');
    f.hidden = true;
    $('ramaLista').insertAdjacentElement('afterend', f); // vuelve a su sitio
    this.formulario = null;
  };

  Rama.prototype._error = function (texto) {
    const el = $('ramaError');
    el.textContent = texto || '';
    el.hidden = !texto;
  };

  Rama.prototype.enviar = async function () {
    const fo = this.formulario;
    if (!fo) return;
    const x = this.nodos.get(fo.id);
    const firma = this.o.firma();
    const lugarNac = $('ramaLugarNac').value;
    const lugarRes = $('ramaLugarRes').value;
    const detalle = $('ramaDetalle').value.trim();
    const propuesta = {
      nombre: fo.modo === 'agregar' ? $('ramaNombre').value : '',
      nacimiento: $('ramaNacimiento').value,
      fallecimiento: $('ramaFallecio').checked ? $('ramaFallecimiento').value : '',
      lugar_nacimiento: lugarNac,
      lugar_residencia: lugarRes,
      ocupacion: $('ramaOcupacion').value,
    };
    /* El detalle libre va con el lugar que se haya elegido (o con el de
       nacimiento si no se eligió ninguno) */
    if (detalle) {
      if (lugarRes && !lugarNac) propuesta.lugar_residencia_detalle = detalle;
      else propuesta.lugar_nacimiento_detalle = detalle;
    }
    const aporte = {
      tipo: fo.modo === 'agregar' ? 'persona' : 'datos',
      autor: firma.autor,
      relacion: firma.relacion,
      persona_id: fo.id,
      persona_nombre: x ? x.nombre : '',
      vinculo: fo.vinculo,
      propuesta,
      texto: $('ramaNota').value,
      datos: this.foto || '',
    };
    const boton = $('ramaGuardar');
    boton.disabled = true;
    boton.textContent = 'Enviando…';
    this._error('');
    try {
      const id = await AlbumDatos.aportes.enviar(this.o.fid, this.o.token, aporte);
      if (fo.modo === 'agregar') {
        this._sumarNuevo({
          id: 'aporte:' + id, nombre: propuesta.nombre.trim(), vinculo: fo.vinculo, de: fo.id,
          n: (/^\d{4}/.exec(propuesta.nacimiento.trim()) || [''])[0],
        });
      } else {
        this.enviados.add(fo.id);
        const n = /^\d{4}/.exec(propuesta.nacimiento.trim());
        if (n && x) x.n = n[0];
        if (lugarNac && x) x.l = lugarNac;
      }
      this._guardar();
      this.cerrarFormulario();
      this.pintar();
      this.o.aviso(fo.modo === 'agregar' ? '¡Listo! ' + propuesta.nombre.trim() + ' quedó agregado. Puedes seguir.' : '¡Gracias! Datos enviados.');
    } catch (e) {
      if (e.code) console.warn('[Rama]', e);
      this._error(/permission/i.test(String(e.code || e.message))
        ? 'El enlace ya no es válido. Pide uno nuevo a tu familia.'
        : e.message);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Enviar';
    }
  };

  Rama.prototype._conectar = function () {
    $('ramaYo').addEventListener('change', (e) => {
      this.yo = e.target.value;
      this._guardar();
      if (this.formulario) this.cerrarFormulario();
      this.pintar();
    });
    $('ramaFallecio').addEventListener('change', (e) => { $('ramaFallecimientoFila').hidden = !e.target.checked; });
    $('ramaCancelar').addEventListener('click', () => this.cerrarFormulario());
    $('ramaGuardar').addEventListener('click', () => this.enviar());
    $('ramaFoto').addEventListener('change', async (e) => {
      const archivo = e.target.files && e.target.files[0];
      if (!archivo) return;
      this._error('');
      try {
        this.foto = await this.o.reducirFoto(archivo);
        $('ramaFotoVista').src = this.foto;
        $('ramaFotoVista').hidden = false;
        $('ramaFotoTexto').textContent = 'Cambiar la foto';
      } catch (err) {
        this.foto = null;
        this._error(err.message);
      }
    });
  };

  global.AportarRama = Rama;
})(window);
