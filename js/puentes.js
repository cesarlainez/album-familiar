/* ══════════════════════════════════════════════════════════════
   PUENTES — conectar a la misma persona entre dos árboles
   ──────────────────────────────────────────────────────────────
   Dos familias registradas pueden tener a la misma persona (la abuela
   que aparece en el árbol de su hijo y en el de su hermana). Se propone
   un puente SOLO si coinciden:

     · el nombre de pila y al menos un apellido (por cómo suenan),
     · la época, si las dos fichas tienen año (±10 años como máximo),
     · y ADEMÁS un padre, una madre o un cónyuge (por nombre).

   Lo último es lo que separa a "la misma persona" de "otro Hernández de
   San Salvador de los años 50". Cada familia acepta por su lado; con
   las dos, la persona lleva un sello dorado y su ficha enlaza al otro
   árbol. No se copian datos.

   Hoy la comparación corre en el navegador de quien edita, porque los
   árboles ya son de lectura pública; con cuentas por familia pasará a
   un proceso de servidor (docs/PLAN-SAAS.md, 2.3).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const UMBRAL = 7;
  const MAX_PROPUESTAS = 5;
  const MAX_FAMILIAS = 10;

  /* ── Coincidencias ─────────────────────────────────────────── */

  function pila(nombre) {
    const f = AlbumLugares.foneticasDe(nombre);
    return f.length ? f[0] : '';
  }

  /** ¿Dos nombres completos parecen la misma persona? Pila igual y un
   *  apellido en común (si alguno no tiene apellido, con la pila basta
   *  solo si los dos nombres son de una sola palabra). */
  function mismoNombre(a, b) {
    if (!a || !b || pila(a) !== pila(b) || !pila(a)) return false;
    const ap = AlbumLugares.apellidosDe(a);
    const bp = AlbumLugares.apellidosDe(b);
    if (!ap.length || !bp.length) return !ap.length && !bp.length;
    return ap.some((x) => bp.indexOf(x) !== -1);
  }

  function departamentos(p) {
    const ls = AlbumLugares.lugaresDe(p);
    const s = new Set();
    AlbumLugares.TIPOS.forEach(([t]) => {
      const l = AlbumLugares.lugar(ls[t].clave);
      if (l && l.clave !== 'XX') s.add(l.claveDepartamento || l.clave);
    });
    return s;
  }

  /** Padres y parejas de una persona, por nombre y con su papel. El papel
   *  importa: la madre de uno no puede ser la esposa del otro (así un
   *  hijo con el nombre de su padre no se confunde con él). */
  function allegados(p, porId) {
    const de = (ids, rol) => ids.map((id) => porId.get(id)).filter(Boolean).map((x) => ({ rol, nombre: x.nombre_completo }));
    return de([p.id_padre, p.id_madre], 'progenitor')
      .concat(de(Array.isArray(p.id_pareja) ? p.id_pareja : [], 'pareja'));
  }

  /** Compara dos familias y devuelve las coincidencias que pasan el
   *  umbral, de mayor a menor puntaje: [{a, b, puntaje, motivos}]. */
  function coincidencias(perfilesA, perfilesB) {
    const porIdA = new Map(perfilesA.map((p) => [p.id, p]));
    const porIdB = new Map(perfilesB.map((p) => [p.id, p]));
    /* Índice por nombre de pila: evita comparar todos contra todos */
    const porPila = new Map();
    perfilesB.forEach((p) => {
      const k = pila(p.nombre_completo);
      if (!k) return;
      if (!porPila.has(k)) porPila.set(k, []);
      porPila.get(k).push(p);
    });

    const salida = [];
    for (const a of perfilesA) {
      for (const b of porPila.get(pila(a.nombre_completo)) || []) {
        if (!mismoNombre(a.nombre_completo, b.nombre_completo)) continue;
        let puntaje = 4;
        const motivos = ['mismo nombre y apellido'];

        const ya = AlbumLugares.anio(a.fecha_nacimiento);
        const yb = AlbumLugares.anio(b.fecha_nacimiento);
        if (ya != null && yb != null) {
          const d = Math.abs(ya - yb);
          if (d > 10) continue; // otra época: otra persona
          puntaje += d <= 2 ? 2 : 1;
          motivos.push(d === 0 ? 'nació el mismo año (' + ya + ')' : 'nacieron con ' + d + ' años de diferencia');
        }

        const da = departamentos(a);
        const db = departamentos(b);
        const lugarComun = [...da].find((x) => db.has(x));
        if (lugarComun) {
          puntaje += 1;
          motivos.push('mismo lugar: ' + AlbumLugares.lugar(lugarComun).nombre);
        }

        const ra = allegados(a, porIdA);
        const rb = allegados(b, porIdB);
        let parientes = 0;
        ra.forEach((x) => {
          const igual = rb.find((y) => y.rol === x.rol && mismoNombre(x.nombre, y.nombre));
          if (igual) {
            parientes++;
            motivos.push((x.rol === 'pareja' ? 'mismo cónyuge: ' : 'mismo padre o madre: ') + x.nombre);
          }
        });
        if (!parientes) continue; // requisito: un padre, madre o cónyuge en común
        puntaje += 3 * parientes;

        if (puntaje >= UMBRAL) salida.push({ a, b, puntaje, motivos });
      }
    }
    salida.sort((x, y) => y.puntaje - x.puntaje);
    return salida;
  }

  /* ── Panel y marcas ────────────────────────────────────────── */

  function crear(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function Puentes(opciones) {
    this.o = opciones; // { familiaActual, etiqueta, perfiles, toast, alAbrirEn(fid, pid), alCambiar() }
    this.panel = $('panelPuentes');
    this.lista = $('puenteLista');
    this.estado = $('puenteEstado');
    this.insignia = $('insigniaPuentes');
    this.todos = []; // puentes de la familia actual
    this.candidatas = [];
    $('puenteBuscar').addEventListener('click', (e) => this.buscar(e.currentTarget));
  }

  /** Lado de la familia actual en un puente ('A' o 'B'). */
  Puentes.prototype._lado = function (p) {
    return p.fidA === this.o.familiaActual() ? 'A' : 'B';
  };

  /** Lo nuestro y lo del otro lado, sin importar si somos A o B. */
  Puentes.prototype._vista = function (p) {
    const nosotros = this._lado(p);
    const otro = nosotros === 'A' ? 'B' : 'A';
    return {
      lado: nosotros,
      pid: p['pid' + nosotros],
      nombre: p['nombre' + nosotros],
      acepto: p['acepta' + nosotros],
      otroFid: p['fid' + otro],
      otroPid: p['pid' + otro],
      otroNombre: p['nombre' + otro],
      otroAcepto: p['acepta' + otro],
    };
  };

  /** Relee los puentes de la familia actual. Nunca rompe el álbum. */
  Puentes.prototype.cargar = async function () {
    try {
      this.todos = await AlbumDatos.puentes.listar(this.o.familiaActual());
    } catch (e) {
      console.warn('[Puentes] No se pudieron leer', e);
      this.todos = [];
    }
    const recibidas = this.todos.filter((p) => p.estado === 'propuesto' && this._vista(p).acepto !== true).length;
    this.insignia.textContent = recibidas ? String(recibidas) : '';
    this.insignia.hidden = !recibidas;
    return this.todos;
  };

  /** pid → [{fid, pid, nombre}] de los puentes aceptados (para el lienzo). */
  Puentes.prototype.aceptadosPorPersona = function () {
    const m = new Map();
    this.todos.filter((p) => p.estado === 'aceptado').forEach((p) => {
      const v = this._vista(p);
      if (!m.has(v.pid)) m.set(v.pid, []);
      m.get(v.pid).push({ fid: v.otroFid, pid: v.otroPid, nombre: v.otroNombre });
    });
    return m;
  };

  /** Bloque «Puentes con otras familias» de la ficha. */
  Puentes.prototype.pintarFicha = function (perfil) {
    const caja = $('modalPuentes');
    caja.textContent = '';
    (this.aceptadosPorPersona().get(perfil.id) || []).forEach((x) => {
      const fila = crear('p', 'puente-ficha');
      fila.appendChild(document.createTextNode('También en la ' + this.o.etiqueta(x.fid) + ' como ' + x.nombre + ' '));
      const ver = crear('button', 'btn-crud btn-crud--mini', 'Ver allí');
      ver.type = 'button';
      ver.addEventListener('click', () => this.o.alAbrirEn(x.fid, x.pid));
      fila.appendChild(ver);
      caja.appendChild(fila);
    });
    caja.closest('.ficha-datos__bloque').hidden = !caja.children.length;
  };

  Puentes.prototype.abrir = async function () {
    this.panel.hidden = false;
    this.candidatas = [];
    this.estado.textContent = '';
    await this.cargar();
    this._pintar();
  };

  Puentes.prototype.cerrar = function () {
    this.panel.hidden = true;
  };

  /** Busca candidatas en las familias que comparten algún apellido. */
  Puentes.prototype.buscar = async function (boton) {
    boton.disabled = true;
    this.estado.textContent = 'Buscando familias con apellidos en común…';
    try {
      const actual = this.o.familiaActual();
      const propios = this.o.perfiles();
      const mios = new Set(AlbumLugares.resumirFamilia(propios).apellidos);
      const resumenes = await AlbumDatos.listarResumenes();
      const familias = resumenes
        .filter((f) => f.id !== actual && f.resumen && (f.resumen.apellidos || []).some((x) => mios.has(x)))
        .slice(0, MAX_FAMILIAS);
      if (!familias.length) {
        this.candidatas = [];
        this.estado.textContent = 'Ninguna otra familia registrada comparte apellidos con esta todavía.';
        this._pintar();
        return;
      }
      await this.cargar();
      const yaVistos = new Set(this.todos.map((p) => p.id));
      const halladas = [];
      for (const f of familias) {
        this.estado.textContent = 'Comparando con la ' + this.o.etiqueta(f.id) + '…';
        const ajenos = await AlbumDatos.obtenerPerfiles(f.id);
        coincidencias(propios, ajenos).forEach((c) => {
          const propuesta = {
            fidA: actual, pidA: c.a.id, nombreA: c.a.nombre_completo,
            fidB: f.id, pidB: c.b.id, nombreB: c.b.nombre_completo,
            puntaje: c.puntaje, motivos: c.motivos,
          };
          if (!yaVistos.has(AlbumDatos.puentes.id(propuesta))) halladas.push(propuesta);
        });
      }
      halladas.sort((x, y) => y.puntaje - x.puntaje);
      this.candidatas = halladas.slice(0, MAX_PROPUESTAS);
      this.estado.textContent = this.candidatas.length
        ? 'Revisa cada coincidencia: solo propón las que reconozcas.'
        : 'Se revisaron ' + familias.length + (familias.length === 1 ? ' familia' : ' familias') + ' y no hay coincidencias seguras.';
      this._pintar();
    } catch (e) {
      console.error('[Puentes]', e);
      this.estado.textContent = 'No se pudo buscar: ' + e.message;
    } finally {
      boton.disabled = false;
    }
  };

  Puentes.prototype._seccion = function (titulo) {
    const h = crear('li', 'puentes__seccion', titulo);
    this.lista.appendChild(h);
  };

  Puentes.prototype._tarjeta = function (texto, motivos, botones) {
    const li = crear('li', 'puente');
    li.appendChild(crear('p', 'puente__texto', texto));
    if (motivos && motivos.length) li.appendChild(crear('p', 'resultado__detalle', motivos.join(' · ')));
    const acciones = crear('div', 'aporte__acciones');
    botones.forEach(([etiqueta, clase, accion]) => {
      const b = crear('button', 'btn-crud btn-crud--mini ' + (clase || ''), etiqueta);
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await accion();
        } catch (e) {
          console.error('[Puentes]', e);
          global.alert('No se pudo: ' + e.message);
        }
        b.disabled = false;
      });
      acciones.appendChild(b);
    });
    li.appendChild(acciones);
    this.lista.appendChild(li);
  };

  Puentes.prototype._pintar = function () {
    this.lista.textContent = '';
    const tras = async (mensaje) => {
      await this.cargar();
      this._pintar();
      this.o.alCambiar();
      this.o.toast(mensaje);
    };

    if (this.candidatas.length) {
      this._seccion('Coincidencias encontradas');
      this.candidatas.forEach((c) => {
        this._tarjeta(
          c.nombreA + ' podría ser ' + c.nombreB + ', de la ' + this.o.etiqueta(c.fidB) + '.',
          c.motivos,
          [['Proponer puente', 'btn-crud--primario', async () => {
            const p = Object.assign({}, c, { aceptaA: true });
            await AlbumDatos.puentes.proponer(p);
            this.candidatas = this.candidatas.filter((x) => x !== c);
            await tras('Puente propuesto: falta que la otra familia acepte');
          }], ['Descartar', '', async () => {
            this.candidatas = this.candidatas.filter((x) => x !== c);
            this._pintar();
          }]]
        );
      });
    }

    const grupos = { recibidas: [], enviadas: [], activos: [], rechazados: [] };
    this.todos.forEach((p) => {
      const v = this._vista(p);
      if (p.estado === 'aceptado') grupos.activos.push([p, v]);
      else if (p.estado === 'rechazado') grupos.rechazados.push([p, v]);
      else if (p.estado === 'propuesto' && v.acepto !== true) grupos.recibidas.push([p, v]);
      else if (p.estado === 'propuesto') grupos.enviadas.push([p, v]);
    });

    if (grupos.recibidas.length) {
      this._seccion('Propuestas recibidas');
      grupos.recibidas.forEach(([p, v]) => {
        /* El nombre de la otra familia se revela al aceptar las dos */
        this._tarjeta(
          'Otra familia registrada cree que ' + v.nombre + ' está también en su árbol (allí: ' + v.otroNombre + ').',
          p.motivos,
          [['Aceptar', 'btn-crud--primario', () => AlbumDatos.puentes.responder(p.id, v.lado, true).then(() => tras('Puente aceptado'))],
           ['Rechazar', 'btn-crud--peligro', () => AlbumDatos.puentes.responder(p.id, v.lado, false).then(() => tras('Propuesta rechazada'))]]
        );
      });
    }
    if (grupos.enviadas.length) {
      this._seccion('Esperando a la otra familia');
      grupos.enviadas.forEach(([p, v]) => {
        this._tarjeta(v.nombre + ' ↔ ' + v.otroNombre + ' (' + this.o.etiqueta(v.otroFid) + ')', p.motivos,
          [['Retirar', 'btn-crud--peligro', () => AlbumDatos.puentes.retirar(p.id).then(() => tras('Propuesta retirada'))]]);
      });
    }
    if (grupos.activos.length) {
      this._seccion('Puentes activos');
      grupos.activos.forEach(([p, v]) => {
        this._tarjeta(v.nombre + ' ↔ ' + v.otroNombre + ' (' + this.o.etiqueta(v.otroFid) + ')', null, [
          ['Ver allí', '', async () => { this.cerrar(); this.o.alAbrirEn(v.otroFid, v.otroPid); }],
          ['Retirar puente', 'btn-crud--peligro', async () => {
            if (!global.confirm('¿Retirar el puente? Las dos familias dejarán de verlo.')) return;
            await AlbumDatos.puentes.retirar(p.id);
            await tras('Puente retirado');
          }],
        ]);
      });
    }
    if (grupos.rechazados.length) {
      /* Se ven para saber qué pasó; borrarlos permite volver a proponer */
      this._seccion('Rechazados');
      grupos.rechazados.forEach(([p, v]) => {
        const quien = v.acepto === false ? 'Esta familia lo rechazó' : 'La otra familia lo rechazó';
        this._tarjeta(v.nombre + ' ↔ ' + v.otroNombre + ' · ' + quien + '.', null,
          [['Borrar', 'btn-crud--peligro', () => AlbumDatos.puentes.retirar(p.id).then(() => tras('Borrado: se podrá volver a proponer'))]]);
      });
    }
    if (!this.lista.children.length) {
      this.lista.appendChild(crear('li', 'resultados__vacio',
        'Aún no hay puentes. Pulsa «Buscar coincidencias» para revisar las familias registradas.'));
    }
  };

  global.Puentes = Puentes;
  global.AlbumPuentes = { coincidencias, mismoNombre };
})(window);
