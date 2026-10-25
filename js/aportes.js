/* ══════════════════════════════════════════════════════════════
   APORTES — enlaces para familiares sin cuenta y bandeja de revisión
   ──────────────────────────────────────────────────────────────
   Quien edita crea un ENLACE (token aleatorio, vence a los 14 días) y
   lo comparte por WhatsApp. El familiar abre aportar.html, graba una
   nota de voz, sube una foto o escribe un recuerdo, sin registrarse.
   Todo cae en la BANDEJA; nada se publica hasta que alguien con la
   clave lo aprueba y lo pega a una persona:

     · voz      → perfil.voces     [{ref:'audio:id', autor, relacion, fecha, duracion}]
     · foto     → perfil.galeria   (si tiene menos de 4)
     · recuerdo → perfil.recuerdos [{texto, autor, relacion, fecha}]

   También pinta las voces y los recuerdos en la ficha de la persona.
   Los datos van por AlbumDatos.aportes (local o nube, misma API).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_FOTOS = 4;

  function duracionTexto(seg) {
    const s = Math.max(0, Math.round(seg || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function fechaCorta(v) {
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  /** "Ana (nieta)" o solo "Ana". */
  function firma(x) {
    return x.autor + (x.relacion ? ' (' + x.relacion + ')' : '');
  }

  function Aportes(opciones) {
    this.o = opciones; // { perfil, familiaActual, etiqueta, perfiles, recargar, toast }
    this.panel = $('panelAportes');
    this.listaEnlaces = $('aporteEnlaces');
    this.bandeja = $('aporteBandeja');
    this.insignia = $('insigniaAportes');
    this._conectar();
  }

  /* ── Ficha: voces y recuerdos ──────────────────────────────── */

  Aportes.prototype.pintarFicha = function (perfil) {
    const caja = $('modalVoces');
    caja.textContent = '';
    (perfil.voces || []).forEach((v) => {
      const fila = crear('div', 'voz');
      const boton = crear('button', 'btn-crud voz__escuchar', '▶ Escuchar');
      boton.type = 'button';
      boton.addEventListener('click', async () => {
        boton.disabled = true;
        boton.textContent = 'Cargando…';
        try {
          const datos = await AlbumDatos.aportes.leerAudio(perfil.id_familia, v.ref);
          const audio = crear('audio', 'voz__audio');
          audio.controls = true;
          audio.src = datos;
          boton.replaceWith(audio);
          audio.play().catch(() => {}); // si el navegador no deja, queda el control
        } catch (e) {
          console.warn('[Aportes] No se pudo cargar la voz', e);
          boton.disabled = false;
          boton.textContent = '▶ Reintentar';
          this.o.toast('No se pudo cargar la grabación');
        }
      });
      fila.appendChild(boton);
      fila.appendChild(crear('span', 'voz__detalle',
        'Grabado por ' + firma(v) + ' · ' + duracionTexto(v.duracion) + (v.fecha ? ' · ' + fechaCorta(v.fecha) : '')));
      fila.appendChild(this._botonQuitar(perfil, 'voces', v));
      caja.appendChild(fila);
    });
    caja.closest('.ficha-datos__bloque').hidden = !caja.children.length;

    const rec = $('modalRecuerdos');
    rec.textContent = '';
    (perfil.recuerdos || []).forEach((r) => {
      const fig = crear('figure', 'recuerdo');
      fig.appendChild(crear('blockquote', 'recuerdo__texto', r.texto));
      const pie = crear('figcaption', 'recuerdo__autor', '— ' + firma(r) + (r.fecha ? ', ' + fechaCorta(r.fecha) : ''));
      pie.appendChild(this._botonQuitar(perfil, 'recuerdos', r));
      fig.appendChild(pie);
      rec.appendChild(fig);
    });
    rec.closest('.ficha-datos__bloque').hidden = !rec.children.length;
  };

  /** "Quitar" (solo en modo edición): retirar algo ya publicado es parte
   *  de moderar; borra también la grabación para no dejar huérfanos. */
  Aportes.prototype._botonQuitar = function (perfil, campo, quitado) {
    const b = crear('button', 'btn-crud btn-crud--mini solo-edicion', 'Quitar');
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (!global.confirm('¿Quitar esto de la ficha de ' + perfil.nombre_completo + '? No se puede deshacer.')) return;
      try {
        /* Se quita ESE elemento, no "el de tal posición": si otra persona
           añadió algo mientras tanto, no se borra lo suyo. */
        await AlbumDatos.quitarDeLista(perfil.id_familia, perfil.id, campo, quitado);
        if (quitado && quitado.ref) {
          await AlbumDatos.aportes.borrarAudio(perfil.id_familia, quitado.ref).catch((e) => console.warn('[Aportes] Grabación sin borrar', e));
        }
        const perfiles = await this.o.recargar({ recentrar: false });
        const fresco = perfiles.find((x) => x.id === perfil.id);
        if (fresco) this.o.perfil.refrescar(fresco);
        this.o.toast('Quitado');
      } catch (e) {
        console.error('[Aportes]', e);
        global.alert('No se pudo quitar: ' + e.message);
      }
    });
    return b;
  };

  /* ── Panel: enlaces ────────────────────────────────────────── */

  Aportes.prototype.abrir = async function () {
    this.panel.hidden = false;
    await Promise.all([this._pintarEnlaces(), this._pintarBandeja()]);
  };

  Aportes.prototype.cerrar = function () {
    this.panel.hidden = true;
  };

  Aportes.prototype.urlDe = function (token) {
    const u = new URL('aportar.html', location.href);
    u.search = '';
    u.searchParams.set('f', this.o.familiaActual());
    u.searchParams.set('t', token);
    if (/[?&]modo=local(&|$)/.test(location.search)) u.searchParams.set('modo', 'local');
    return u.toString();
  };

  Aportes.prototype._pintarEnlaces = async function () {
    const ul = this.listaEnlaces;
    let enlaces;
    try {
      enlaces = await AlbumDatos.aportes.listarEnlaces(this.o.familiaActual());
    } catch (e) {
      console.error('[Aportes]', e);
      ul.textContent = '';
      ul.appendChild(crear('li', 'resultados__vacio', 'No se pudieron leer los enlaces: ' + e.message));
      return;
    }
    ul.textContent = '';
    const ahora = Date.now();
    enlaces.forEach((e) => {
      const vigente = e.vence > ahora;
      const li = crear('li', 'enlace' + (vigente ? '' : ' enlace--vencido'));
      li.appendChild(crear('span', 'enlace__estado',
        vigente ? 'Vigente hasta el ' + fechaCorta(e.vence) : 'Venció el ' + fechaCorta(e.vence)));
      const acciones = crear('span', 'enlace__acciones');
      if (vigente) {
        const url = this.urlDe(e.token);
        const copiar = crear('button', 'btn-crud btn-crud--mini', 'Copiar');
        copiar.type = 'button';
        copiar.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(url);
            this.o.toast('Enlace copiado');
          } catch (err) {
            global.prompt('Copia el enlace:', url);
          }
        });
        const wa = crear('a', 'btn-crud btn-crud--mini', 'WhatsApp');
        wa.href = 'https://wa.me/?text=' + encodeURIComponent(
          'Ayúdanos a completar el álbum de la ' + this.o.etiqueta(this.o.familiaActual()) +
          ': graba una nota de voz, sube una foto o escribe un recuerdo. No hace falta registrarse. ' + url
        );
        wa.target = '_blank';
        wa.rel = 'noopener';
        acciones.appendChild(copiar);
        acciones.appendChild(wa);
      }
      const revocar = crear('button', 'btn-crud btn-crud--mini btn-crud--peligro', vigente ? 'Revocar' : 'Borrar');
      revocar.type = 'button';
      revocar.addEventListener('click', async () => {
        if (vigente && !global.confirm('¿Revocar este enlace? Quien lo tenga ya no podrá aportar.')) return;
        try {
          await AlbumDatos.aportes.revocarEnlace(this.o.familiaActual(), e.token);
          this._pintarEnlaces();
        } catch (err) {
          global.alert('No se pudo revocar: ' + err.message);
        }
      });
      acciones.appendChild(revocar);
      li.appendChild(acciones);
      ul.appendChild(li);
    });
  };

  Aportes.prototype._crearEnlace = async function (boton) {
    boton.disabled = true;
    try {
      /* La lista de nombres viaja en el enlace: la página de aportes no
         necesita leer el árbol para ofrecer «¿de quién trata?». */
      const personas = this.o.perfiles()
        .map((p) => ({ id: p.id, nombre: p.nombre_completo }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      const r = await AlbumDatos.aportes.crearEnlace(this.o.familiaActual(), {
        etiqueta: this.o.etiqueta(this.o.familiaActual()),
        personas,
        dias: 14,
      });
      await this._pintarEnlaces();
      try {
        await navigator.clipboard.writeText(this.urlDe(r.token));
        this.o.toast('Enlace creado y copiado');
      } catch (e) {
        this.o.toast('Enlace creado');
      }
    } catch (e) {
      console.error('[Aportes]', e);
      global.alert('No se pudo crear el enlace: ' + e.message);
    } finally {
      boton.disabled = false;
    }
  };

  /* ── Panel: bandeja ────────────────────────────────────────── */

  Aportes.prototype.contarPendientes = async function () {
    try {
      const n = (await AlbumDatos.aportes.listar(this.o.familiaActual())).length;
      this.insignia.textContent = n ? String(n) : '';
      this.insignia.hidden = !n;
      return n;
    } catch (e) {
      console.warn('[Aportes] No se pudo contar la bandeja', e);
      this.insignia.hidden = true;
      return 0;
    }
  };

  Aportes.prototype._pintarBandeja = async function () {
    const ul = this.bandeja;
    let lista;
    try {
      lista = await AlbumDatos.aportes.listar(this.o.familiaActual());
    } catch (e) {
      console.error('[Aportes]', e);
      ul.textContent = '';
      ul.appendChild(crear('li', 'resultados__vacio', 'No se pudo leer la bandeja: ' + e.message));
      return;
    }
    this.insignia.textContent = lista.length ? String(lista.length) : '';
    this.insignia.hidden = !lista.length;
    ul.textContent = '';
    if (!lista.length) {
      ul.appendChild(crear('li', 'resultados__vacio', 'No hay aportes por revisar.'));
      return;
    }
    const perfiles = this.o.perfiles()
      .slice()
      .sort((a, b) => (a.nombre_completo || '').localeCompare(b.nombre_completo || ''));
    lista.forEach((a) => ul.appendChild(this._itemBandeja(a, perfiles)));
  };

  Aportes.prototype._itemBandeja = function (a, perfiles) {
    const li = crear('li', 'aporte');
    const tipos = { voz: 'Nota de voz', foto: 'Fotografía', recuerdo: 'Recuerdo' };
    li.appendChild(crear('p', 'aporte__cabeza',
      tipos[a.tipo] + ' de ' + firma(a) + (a.creado ? ' · ' + fechaCorta(a.creado) : '')));

    /* El audio o la foto se bajan al pedirlos: la bandeja se lista
       solo con los datos ligeros. */
    if (a.tipo === 'voz' || a.tipo === 'foto') {
      const ver = crear('button', 'btn-crud btn-crud--mini aporte__ver', a.tipo === 'voz' ? '▶ Escuchar' : 'Ver la foto');
      ver.type = 'button';
      ver.addEventListener('click', async () => {
        ver.disabled = true;
        ver.textContent = 'Cargando…';
        try {
          const datos = await AlbumDatos.aportes.leerCarga(this.o.familiaActual(), a.id);
          let medio;
          if (a.tipo === 'voz') {
            medio = crear('audio', 'voz__audio');
            medio.controls = true;
            medio.src = datos;
          } else {
            medio = crear('img', 'aporte__foto');
            medio.alt = 'Foto enviada por ' + a.autor;
            medio.src = datos;
          }
          ver.replaceWith(medio);
          if (a.tipo === 'voz') medio.play().catch(() => {});
        } catch (e) {
          console.warn('[Aportes] No se pudo cargar el archivo', e);
          ver.disabled = false;
          ver.textContent = 'Reintentar';
        }
      });
      li.appendChild(ver);
    }
    if (a.texto) li.appendChild(crear('blockquote', 'recuerdo__texto', a.texto));

    /* ¿A quién se pega? Se propone lo que eligió quien aportó. */
    const fila = crear('label', 'aporte__para');
    fila.appendChild(crear('span', 'campo__etiqueta', 'Para la ficha de'));
    const sel = crear('select', 'campo__input');
    sel.appendChild(new Option('— Elige a la persona —', ''));
    perfiles.forEach((p) => sel.appendChild(new Option(p.nombre_completo, p.id)));
    sel.value = a.persona_id || '';
    if (sel.value !== (a.persona_id || '')) sel.value = '';
    fila.appendChild(sel);
    if (a.persona_nombre && !sel.value) {
      fila.appendChild(crear('span', 'aporte__nota', 'Dijo: «' + a.persona_nombre + '»'));
    }
    li.appendChild(fila);

    const acciones = crear('div', 'aporte__acciones');
    const aprobar = crear('button', 'btn-crud btn-crud--primario btn-crud--mini', 'Aprobar y publicar');
    aprobar.type = 'button';
    const descartar = crear('button', 'btn-crud btn-crud--peligro btn-crud--mini', 'Descartar');
    descartar.type = 'button';
    aprobar.addEventListener('click', () => this._aprobar(a, sel.value, [aprobar, descartar]));
    descartar.addEventListener('click', async () => {
      if (!global.confirm('¿Descartar este aporte? Se borra para siempre.')) return;
      try {
        await AlbumDatos.aportes.descartar(this.o.familiaActual(), a.id);
        this._pintarBandeja();
      } catch (e) {
        global.alert('No se pudo descartar: ' + e.message);
      }
    });
    acciones.appendChild(aprobar);
    acciones.appendChild(descartar);
    li.appendChild(acciones);
    return li;
  };

  Aportes.prototype._aprobar = async function (a, idPersona, botones) {
    if (!idPersona) {
      global.alert('Elige primero a qué persona pertenece este aporte.');
      return;
    }
    const fid = this.o.familiaActual();
    const p = this.o.perfiles().find((x) => x.id === idPersona);
    if (!p) return global.alert('Esa persona ya no está en el árbol.');
    if (a.tipo === 'foto' && (p.galeria || []).filter(Boolean).length >= MAX_FOTOS) {
      return global.alert(p.nombre_completo + ' ya tiene ' + MAX_FOTOS + ' fotos. Quita una en «Editar» y vuelve a aprobar.');
    }
    botones.forEach((b) => { b.disabled = true; });
    /* Cada elemento publicado recuerda de qué aporte vino: si un intento
       anterior se cortó después de publicar, no se publica dos veces. */
    const sello = { autor: a.autor, relacion: a.relacion || '', fecha: new Date().toISOString(), aporte: a.id };
    const yaEsta = (lista) => (lista || []).some((x) => x && x.aporte === a.id);
    let refAudio = null;
    try {
      if (a.tipo === 'voz' && !yaEsta(p.voces)) {
        const datos = await AlbumDatos.aportes.leerCarga(fid, a.id);
        refAudio = await AlbumDatos.aportes.guardarAudio(fid, datos, p.id);
        await AlbumDatos.agregarALista(fid, p.id, 'voces', Object.assign({ ref: refAudio, duracion: a.duracion || 0 }, sello));
        refAudio = null; // ya está enlazada: no es huérfana
      } else if (a.tipo === 'foto') {
        const datos = await AlbumDatos.aportes.leerCarga(fid, a.id);
        const be = global.AlbumBackend;
        const cfg = global.ALBUM_CONFIG || {};
        let url = datos;
        if (cfg.hayBackend && be && be.subirFoto) {
          const blob = await (await fetch(datos)).blob();
          url = await be.subirFoto(fid + '/' + p.id + '/aporte-' + Date.now() + '.jpg', blob);
        }
        await AlbumDatos.actualizar(fid, p.id, { galeria: (p.galeria || []).filter(Boolean).concat([url]) });
      }
      if (a.texto && !yaEsta(p.recuerdos)) {
        await AlbumDatos.agregarALista(fid, p.id, 'recuerdos', Object.assign({ texto: a.texto }, sello));
      }
      await AlbumDatos.aportes.descartar(fid, a.id);
    } catch (e) {
      console.error('[Aportes]', e);
      if (refAudio) {
        await AlbumDatos.aportes.borrarAudio(fid, refAudio).catch((err) => console.warn('[Aportes] Grabación sin borrar', err));
      }
      global.alert('No se pudo aprobar: ' + e.message);
      botones.forEach((b) => { b.disabled = false; });
      return;
    }
    this.o.toast('Publicado en la ficha de ' + p.nombre_completo);
    try {
      await this.o.recargar({ recentrar: false });
    } catch (e) {
      global.alert('Se publicó, pero no se pudo volver a cargar el álbum: ' + e.message);
    }
    this._pintarBandeja();
  };

  Aportes.prototype._conectar = function () {
    const boton = $('aporteNuevoEnlace');
    boton.addEventListener('click', () => this._crearEnlace(boton));
  };

  global.Aportes = Aportes;
})(window);
