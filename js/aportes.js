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
    this._llenarRamas();
    await Promise.all([this._pintarEnlaces(), this._pintarBandeja()]);
  };

  Aportes.prototype.cerrar = function () {
    this.panel.hidden = true;
  };

  /** «Enlace para la rama de…»: un enlace por primo o por familia. */
  Aportes.prototype._llenarRamas = function () {
    const sel = $('aporteRama');
    const antes = sel.value;
    sel.textContent = '';
    sel.appendChild(new Option('— Toda la familia (cada quien elige quién es) —', ''));
    this.o.perfiles()
      .slice()
      .sort((a, b) => (a.nombre_completo || '').localeCompare(b.nombre_completo || ''))
      .forEach((p) => sel.appendChild(new Option(p.nombre_completo, p.id)));
    sel.value = antes;
    if (sel.value !== antes) sel.value = '';
  };

  Aportes.prototype.urlDe = function (token) {
    const u = new URL('aportar.html', location.href);
    u.search = '';
    u.searchParams.set('f', this.o.familiaActual());
    u.searchParams.set('t', token);
    if (/[?&]modo=local(&|$)/.test(location.search)) u.searchParams.set('modo', 'local');
    return u.toString();
  };

  Aportes.prototype._nombreDe = function (id) {
    const p = this.o.perfiles().find((x) => x.id === id);
    return p ? p.nombre_completo : '';
  };

  /** Mensaje para WhatsApp: personal si el enlace es para alguien. */
  Aportes.prototype._mensaje = function (e, url) {
    const familia = this.o.etiqueta(this.o.familiaActual());
    const quien = e.rama && this._nombreDe(e.rama);
    return (quien
      ? '¡Hola! Estamos armando el álbum de la ' + familia + ' y nos falta tu rama (' + quien + '). '
      : '¡Hola! Estamos armando el álbum de la ' + familia + '. ') +
      'En este enlace puedes completar fechas, lugares y fotos de tu familia, agregar a hijos, nietos y parejas, ' +
      'o dejar una nota de voz. No hace falta registrarse: ' + url;
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
      const quien = e.rama && this._nombreDe(e.rama);
      li.appendChild(crear('span', 'enlace__estado',
        (quien ? 'Para ' + quien + ' · ' : 'Toda la familia · ') +
        (vigente ? 'vigente hasta el ' + fechaCorta(e.vence) : 'venció el ' + fechaCorta(e.vence)) +
        (e.usos ? ' · ' + e.usos + (e.usos === 1 ? ' aporte' : ' aportes') : '')));
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
        wa.href = 'https://wa.me/?text=' + encodeURIComponent(this._mensaje(e, url));
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
      /* El árbol viaja en el enlace en forma mínima (nombres, relaciones,
         año y lugar, sin fotos): así la página de aportes muestra la
         familia cercana de cada quien sin leer el álbum. */
      const personas = this.o.perfiles()
        .map((p) => {
          const ls = AlbumLugares.lugaresDe(p);
          const x = { id: p.id, nombre: p.nombre_completo };
          if (p.id_padre) x.p = p.id_padre;
          if (p.id_madre) x.m = p.id_madre;
          if (Array.isArray(p.id_pareja) && p.id_pareja.length) x.c = p.id_pareja;
          const n = AlbumLugares.anio(p.fecha_nacimiento);
          const f = AlbumLugares.anio(p.fecha_fallecimiento);
          if (n) x.n = String(n);
          if (f) x.f = String(f);
          if (ls.nacimiento.clave) x.l = ls.nacimiento.clave;
          return x;
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      const rama = $('aporteRama').value;
      const r = await AlbumDatos.aportes.crearEnlace(this.o.familiaActual(), {
        etiqueta: this.o.etiqueta(this.o.familiaActual()),
        personas,
        rama,
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
    this._pendientes = lista;
    this.insignia.textContent = lista.length ? String(lista.length) : '';
    this.insignia.hidden = !lista.length;
    $('aporteAprobarTodo').hidden = lista.length < 2;
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

  const VINCULO_TEXTO = { hijo: 'hijo/a de', pareja: 'pareja de', padre: 'padre de', madre: 'madre de' };

  /** "n. 1962 · ✝ 2015 · Chalatenango Norte · Docente" */
  function describirPropuesta(pr) {
    const partes = [];
    if (pr.nacimiento) partes.push('n. ' + pr.nacimiento);
    if (pr.fallecimiento) partes.push('✝ ' + pr.fallecimiento);
    const ln = AlbumLugares.describir({ clave: pr.lugar_nacimiento || '', detalle: pr.lugar_nacimiento_detalle || '' });
    if (ln) partes.push('nació en ' + ln);
    const lr = AlbumLugares.describir({ clave: pr.lugar_residencia || '', detalle: pr.lugar_residencia_detalle || '' });
    if (lr) partes.push('vive o vivió en ' + lr);
    if (pr.ocupacion) partes.push(pr.ocupacion);
    return partes.join(' · ');
  }

  Aportes.prototype._itemBandeja = function (a, perfiles) {
    const li = crear('li', 'aporte');
    const pr = a.propuesta || {};
    const quien = firma(a) + (a.creado ? ' · ' + fechaCorta(a.creado) : '');
    const anclaPendiente = /^aporte:/.test(a.persona_id || '');

    if (a.tipo === 'persona') {
      li.appendChild(crear('p', 'aporte__cabeza', 'Persona nueva, de ' + quien));
      li.appendChild(crear('p', 'aporte__persona',
        pr.nombre + ' — ' + VINCULO_TEXTO[a.vinculo] + ' ' + (a.persona_nombre || '…') +
        (anclaPendiente ? ' (también nueva, se aprueba junto)' : '')));
    } else if (a.tipo === 'datos') {
      li.appendChild(crear('p', 'aporte__cabeza', 'Datos de ' + (a.persona_nombre || '…') + ', de ' + quien));
    } else {
      const tipos = { voz: 'Nota de voz', foto: 'Fotografía', recuerdo: 'Recuerdo' };
      li.appendChild(crear('p', 'aporte__cabeza', tipos[a.tipo] + ' de ' + quien));
    }
    if (a.tipo === 'persona' || a.tipo === 'datos') {
      const d = describirPropuesta(pr);
      if (d) li.appendChild(crear('p', 'resultado__detalle', d));
      if (a.tipo === 'datos') {
        const actual = this.o.perfiles().find((x) => x.id === a.persona_id);
        const cambios = actual ? this._diferencias(actual, pr) : [];
        if (cambios.length) li.appendChild(crear('p', 'aporte__nota', 'Cambia: ' + cambios.join(' · ')));
      }
    }

    /* El audio o la foto se bajan al pedirlos: la bandeja se lista
       solo con los datos ligeros. */
    if (a.tipo === 'voz' || a.tipo === 'foto' || a.adjunto) {
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

    /* ¿A quién se pega? Se propone lo que eligió quien aportó. Una persona
       nueva cuelga de la persona que eligió quien aportó (no se cambia). */
    let sel = null;
    if (a.tipo !== 'persona') {
      const fila = crear('label', 'aporte__para');
      fila.appendChild(crear('span', 'campo__etiqueta', 'Para la ficha de'));
      sel = crear('select', 'campo__input');
      sel.appendChild(new Option('— Elige a la persona —', ''));
      perfiles.forEach((p) => sel.appendChild(new Option(p.nombre_completo, p.id)));
      sel.value = a.persona_id || '';
      if (sel.value !== (a.persona_id || '')) sel.value = '';
      fila.appendChild(sel);
      if (a.persona_nombre && !sel.value) {
        fila.appendChild(crear('span', 'aporte__nota', 'Dijo: «' + a.persona_nombre + '»'));
      }
      li.appendChild(fila);
    }

    const acciones = crear('div', 'aporte__acciones');
    const aprobar = crear('button', 'btn-crud btn-crud--primario btn-crud--mini', 'Aprobar y publicar');
    aprobar.type = 'button';
    const descartar = crear('button', 'btn-crud btn-crud--peligro btn-crud--mini', 'Descartar');
    descartar.type = 'button';
    aprobar.addEventListener('click', async () => {
      aprobar.disabled = true;
      descartar.disabled = true;
      const ok = await this._publicar([a], sel ? { [a.id]: sel.value } : {});
      if (!ok) { aprobar.disabled = false; descartar.disabled = false; }
    });
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

  /** Qué cambiaría en la ficha: "nacimiento 1938 → 1939". */
  Aportes.prototype._diferencias = function (p, pr) {
    const salida = [];
    const ver = (rotulo, antes, despues) => {
      if (despues && String(antes || '') !== String(despues)) salida.push(rotulo + ' ' + (antes || '(vacío)') + ' → ' + despues);
    };
    ver('nacimiento', p.fecha_nacimiento, pr.nacimiento);
    ver('fallecimiento', p.fecha_fallecimiento, pr.fallecimiento);
    ver('ocupación', p.disciplina_artistica, pr.ocupacion);
    const ls = AlbumLugares.lugaresDe(p);
    const nom = (c) => (AlbumLugares.lugar(c) || {}).nombre || c;
    if (pr.lugar_nacimiento) ver('lugar de nacimiento', nom(ls.nacimiento.clave), nom(pr.lugar_nacimiento));
    if (pr.lugar_residencia) ver('residencia', nom(ls.residencia.clave), nom(pr.lugar_residencia));
    return salida;
  };

  /* ── Publicar ───────────────────────────────────────────────
     Aprueba uno o varios aportes. Una persona nueva puede colgar de
     otra persona nueva ("aporte:<id>"): esa se aprueba primero. Los
     perfiles creados se llaman "ap-<id del aporte>", así aprobar dos
     veces (o tras un corte) nunca duplica a nadie. */

  const idPerfilDe = (idAporte) => 'ap-' + idAporte;

  Aportes.prototype._publicar = async function (lista, elegidos) {
    const fid = this.o.familiaActual();
    const ctx = {
      fid,
      pendientes: new Map((this._pendientes || []).map((x) => [x.id, x])),
      hechos: new Set(),
      perfiles: new Map(this.o.perfiles().map((p) => [p.id, p])),
      avisos: [],
    };
    let n = 0;
    try {
      for (const a of lista) {
        if (ctx.hechos.has(a.id)) continue;
        await this._publicarUno(a, ctx, elegidos[a.id]);
        n++;
      }
    } catch (e) {
      console.error('[Aportes]', e);
      global.alert('No se pudo aprobar: ' + e.message + (ctx.hechos.size ? '\n\nLo anterior sí quedó publicado.' : ''));
      await this._despues(ctx);
      return false;
    }
    await this._despues(ctx);
    this.o.toast(ctx.hechos.size > 1 ? 'Publicados ' + ctx.hechos.size + ' aportes' : 'Publicado');
    if (ctx.avisos.length) global.alert(ctx.avisos.join('\n'));
    return n > 0;
  };

  Aportes.prototype._despues = async function (ctx) {
    if (!ctx.hechos.size) return;
    try {
      await this.o.recargar({ recentrar: false });
    } catch (e) {
      global.alert('Se publicó, pero no se pudo volver a cargar el álbum: ' + e.message);
    }
    await this._pintarBandeja();
  };

  /** Id de perfil real para una referencia (existente o "aporte:<id>"). */
  Aportes.prototype._resolver = async function (ref, ctx) {
    if (!/^aporte:/.test(ref || '')) {
      if (!ctx.perfiles.has(ref)) throw new Error('La persona elegida ya no está en el árbol.');
      return ref;
    }
    const idAporte = ref.slice('aporte:'.length);
    const id = idPerfilDe(idAporte);
    if (ctx.perfiles.has(id)) return id;
    const pendiente = ctx.pendientes.get(idAporte);
    if (!pendiente) throw new Error('Se unía a una persona nueva que ya fue descartada. Descarta también este aporte o pídelo de nuevo.');
    await this._publicarUno(pendiente, ctx);
    return id;
  };

  Aportes.prototype._publicarUno = async function (a, ctx, elegido) {
    const fid = ctx.fid;
    const sello = { autor: a.autor, relacion: a.relacion || '', fecha: new Date().toISOString(), aporte: a.id };
    const yaEsta = (lista) => (lista || []).some((x) => x && x.aporte === a.id);
    const carga = async () => {
      if (a.tipo === 'voz' || a.tipo === 'foto') return AlbumDatos.aportes.leerCarga(fid, a.id);
      if (!a.adjunto) return '';
      /* La foto de una persona o de una corrección es opcional: si no
         llegó, se publica lo demás y se avisa. */
      try {
        return await AlbumDatos.aportes.leerCarga(fid, a.id);
      } catch (e) {
        ctx.avisos.push('No se encontró la foto que acompañaba a ' + ((a.propuesta || {}).nombre || a.persona_nombre || 'un aporte') + '.');
        return '';
      }
    };

    if (a.tipo === 'persona') {
      await this._publicarPersona(a, ctx, sello, await carga());
    } else {
      const idPersona = await this._resolver(elegido || a.persona_id, ctx);
      const p = ctx.perfiles.get(idPersona);
      if (a.tipo === 'datos') {
        await this._publicarDatos(a, p, ctx, await carga());
      } else if (a.tipo === 'voz' && !yaEsta(p.voces)) {
        const datos = await carga();
        const ref = await AlbumDatos.aportes.guardarAudio(fid, datos, p.id);
        try {
          await AlbumDatos.agregarALista(fid, p.id, 'voces', Object.assign({ ref, duracion: a.duracion || 0 }, sello));
        } catch (e) {
          await AlbumDatos.aportes.borrarAudio(fid, ref).catch((err) => console.warn('[Aportes] Grabación sin borrar', err));
          throw e;
        }
      } else if (a.tipo === 'foto') {
        if ((p.galeria || []).filter(Boolean).length >= MAX_FOTOS) {
          throw new Error(p.nombre_completo + ' ya tiene ' + MAX_FOTOS + ' fotos. Quita una en «Editar» y vuelve a aprobar.');
        }
        await this._sumarFoto(p, await carga(), ctx);
      }
      if (a.texto && a.tipo !== 'datos' && !yaEsta(p.recuerdos)) {
        await AlbumDatos.agregarALista(fid, p.id, 'recuerdos', Object.assign({ texto: a.texto }, sello));
      }
    }
    await AlbumDatos.aportes.descartar(fid, a.id);
    ctx.hechos.add(a.id);
    ctx.pendientes.delete(a.id);
  };

  /** Foto a la galería (en la nube, como documento propio). */
  Aportes.prototype._sumarFoto = async function (p, datos, ctx) {
    const be = global.AlbumBackend;
    const cfg = global.ALBUM_CONFIG || {};
    let url = datos;
    if (cfg.hayBackend && be && be.subirFoto) {
      const blob = await (await fetch(datos)).blob();
      url = await be.subirFoto(ctx.fid + '/' + p.id + '/aporte-' + Date.now() + '.jpg', blob);
    }
    const galeria = (p.galeria || []).filter(Boolean).concat([url]);
    await AlbumDatos.actualizar(ctx.fid, p.id, { galeria });
    ctx.perfiles.set(p.id, Object.assign({}, p, { galeria }));
  };

  function lugaresDePropuesta(pr, base) {
    const ls = base ? AlbumLugares.lugaresDe(base) : AlbumLugares.lugaresDe({});
    if (pr.lugar_nacimiento || pr.lugar_nacimiento_detalle) {
      ls.nacimiento = { clave: pr.lugar_nacimiento || ls.nacimiento.clave, detalle: pr.lugar_nacimiento_detalle || ls.nacimiento.detalle };
    }
    if (pr.lugar_residencia || pr.lugar_residencia_detalle) {
      ls.residencia = { clave: pr.lugar_residencia || ls.residencia.clave, detalle: pr.lugar_residencia_detalle || ls.residencia.detalle };
    }
    const hay = AlbumLugares.TIPOS.some(([t]) => ls[t].clave || ls[t].detalle);
    return hay ? ls : null;
  }

  Aportes.prototype._publicarPersona = async function (a, ctx, sello, foto) {
    const fid = ctx.fid;
    const pr = a.propuesta || {};
    const ancla = ctx.perfiles.get(await this._resolver(a.persona_id, ctx));
    const id = idPerfilDe(a.id);
    let nuevo = ctx.perfiles.get(id);
    if (!nuevo) {
      const datos = {
        id,
        id_familia: fid,
        nombre_completo: pr.nombre,
        fecha_nacimiento: pr.nacimiento || null,
        fecha_fallecimiento: pr.fallecimiento || null,
        disciplina_artistica: pr.ocupacion || '',
        lugares: lugaresDePropuesta(pr, null),
        galeria: foto ? [foto] : [],
        recuerdos: a.texto ? [Object.assign({ texto: a.texto }, sello)] : [],
      };
      if (a.vinculo === 'hijo') {
        /* El ancla va en el hueco que ya ocupa con otros hijos (madre o
           padre); el otro, su pareja si la tiene. */
        const esMadre = [...ctx.perfiles.values()].some((x) => x.id_madre === ancla.id);
        const pareja = (Array.isArray(ancla.id_pareja) ? ancla.id_pareja : [])[0] || null;
        datos.id_padre = esMadre ? pareja : ancla.id;
        datos.id_madre = esMadre ? ancla.id : pareja;
      } else if (a.vinculo === 'pareja') {
        datos.id_pareja = [ancla.id];
      }
      nuevo = await AlbumDatos.crear(datos);
      nuevo = Object.assign({}, datos, nuevo);
      ctx.perfiles.set(id, nuevo);
    }
    /* Del otro lado del vínculo */
    if (a.vinculo === 'pareja') {
      const lista = Array.isArray(ancla.id_pareja) ? ancla.id_pareja : [];
      if (lista.indexOf(id) === -1) {
        await AlbumDatos.agregarALista(fid, ancla.id, 'id_pareja', id);
        ctx.perfiles.set(ancla.id, Object.assign({}, ancla, { id_pareja: lista.concat([id]) }));
      }
    } else if (a.vinculo === 'padre' || a.vinculo === 'madre') {
      const hueco = a.vinculo === 'padre' ? 'id_padre' : 'id_madre';
      if (!ancla[hueco]) {
        const cambio = {};
        cambio[hueco] = id;
        await AlbumDatos.actualizar(fid, ancla.id, cambio);
        ctx.perfiles.set(ancla.id, Object.assign({}, ancla, cambio));
      } else if (ancla[hueco] !== id) {
        ctx.avisos.push(pr.nombre + ' se agregó, pero ' + ancla.nombre_completo + ' ya tenía ' + a.vinculo +
          ' en el árbol: revisa en «Editar» cuál es el correcto.');
      }
    }
  };

  Aportes.prototype._publicarDatos = async function (a, p, ctx, foto) {
    const pr = a.propuesta || {};
    const cambios = {};
    if (pr.nacimiento) cambios.fecha_nacimiento = pr.nacimiento;
    if (pr.fallecimiento) cambios.fecha_fallecimiento = pr.fallecimiento;
    if (pr.ocupacion) cambios.disciplina_artistica = pr.ocupacion;
    const ls = lugaresDePropuesta(pr, p);
    if (ls && (pr.lugar_nacimiento || pr.lugar_nacimiento_detalle || pr.lugar_residencia || pr.lugar_residencia_detalle)) cambios.lugares = ls;
    if (Object.keys(cambios).length) {
      await AlbumDatos.actualizar(ctx.fid, p.id, cambios);
      p = Object.assign({}, p, cambios);
      ctx.perfiles.set(p.id, p);
    }
    if (foto) {
      if ((p.galeria || []).filter(Boolean).length >= MAX_FOTOS) {
        ctx.avisos.push('La foto para ' + p.nombre_completo + ' no se agregó: ya tiene ' + MAX_FOTOS + '.');
      } else {
        await this._sumarFoto(p, foto, ctx);
      }
    }
    if (a.texto && !(p.recuerdos || []).some((x) => x && x.aporte === a.id)) {
      await AlbumDatos.agregarALista(ctx.fid, p.id, 'recuerdos',
        { texto: a.texto, autor: a.autor, relacion: a.relacion || '', fecha: new Date().toISOString(), aporte: a.id });
    }
  };

  Aportes.prototype._conectar = function () {
    const boton = $('aporteNuevoEnlace');
    boton.addEventListener('click', () => this._crearEnlace(boton));
    const todo = $('aporteAprobarTodo');
    todo.addEventListener('click', async () => {
      const lista = this._pendientes || [];
      if (!lista.length) return;
      if (!global.confirm('¿Publicar los ' + lista.length + ' aportes tal como están? Revisa antes los que dudes.')) return;
      todo.disabled = true;
      /* Solo los que ya saben a quién van (o son personas nuevas) */
      const listos = lista.filter((a) => a.tipo === 'persona' || a.persona_id);
      await this._publicar(listos, {});
      if (listos.length < lista.length) global.alert('Quedaron ' + (lista.length - listos.length) + ' aportes sin persona elegida: revísalos uno por uno.');
      todo.disabled = false;
    });
  };

  global.Aportes = Aportes;
})(window);
