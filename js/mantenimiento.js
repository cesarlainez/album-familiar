/* ══════════════════════════════════════════════════════════════
   MANTENIMIENTO — CRUD de perfiles desde el modal
   ──────────────────────────────────────────────────────────────
   Conecta la barra de acciones y el formulario de edición del modal
   con AlbumDatos (crear/actualizar/eliminar/altas de relación).

   Depende de:
     · perfil     — instancia de Perfil (vista). Usa perfilActual,
                    refrescar(), abrir() y el hook alAbrir.
     · recargar   — async (opciones) => perfiles.  Vuelve a leer la BD
                    y redibuja el lienzo; devuelve los perfiles frescos.
   Escribe siempre en la misma familia del perfil abierto.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function Mantenimiento(opciones) {
    this.perfil = opciones.perfil;
    this.recargar = opciones.recargar;
    this.toast = opciones.toast || function () {};

    this.refs = {
      lectura: $('fichaLectura'),
      editor: $('fichaEditor'),
      nombre: $('editNombre'),
      nacimiento: $('editNacimiento'),
      fallecimiento: $('editFallecimiento'),
      disciplina: $('editDisciplina'),
      obra: $('editObra'),
      bio: $('editBio'),
      foto1: $('editFoto1'),
      foto2: $('editFoto2'),
      foto3: $('editFoto3'),
      cancelar: $('editCancelar'),
      archivoFoto: $('archivoFoto'),
    };

    /* Al abrir cualquier perfil, volver siempre a modo lectura. */
    this.perfil.alAbrir = () => this.modoLectura();

    this._conectar();
  }

  /* ── Alternancia lectura / edición ───────────────────────── */

  Mantenimiento.prototype.modoLectura = function () {
    this.refs.editor.hidden = true;
    this.refs.lectura.hidden = false;
  };

  Mantenimiento.prototype.modoEdicion = function () {
    const p = this.perfil.perfilActual;
    if (!p) return;
    const r = this.refs;
    r.nombre.value = p.nombre_completo || '';
    r.nacimiento.value = p.fecha_nacimiento || '';
    r.fallecimiento.value = p.fecha_fallecimiento || '';
    r.disciplina.value = p.disciplina_artistica || '';
    r.obra.value = p.obra_maestra || '';
    r.bio.value = p.biografia || '';
    const g = p.galeria || [];
    r.foto1.value = g[0] || '';
    r.foto2.value = g[1] || '';
    r.foto3.value = g[2] || '';

    r.lectura.hidden = true;
    r.editor.hidden = false;
    r.nombre.focus();
    r.nombre.select();
  };

  /* ── Operaciones ─────────────────────────────────────────── */

  Mantenimiento.prototype.guardar = async function () {
    const p = this.perfil.perfilActual;
    if (!p) return;
    const r = this.refs;

    const cambios = {
      nombre_completo: r.nombre.value.trim() || 'Sin nombre',
      fecha_nacimiento: r.nacimiento.value || null,
      fecha_fallecimiento: r.fallecimiento.value || null,
      disciplina_artistica: r.disciplina.value.trim(),
      obra_maestra: r.obra.value.trim(),
      biografia: r.bio.value.trim(),
      galeria: [r.foto1.value, r.foto2.value, r.foto3.value]
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3),
    };

    try {
      await AlbumDatos.actualizar(p.id_familia, p.id, cambios);
      const perfiles = await this.recargar({ recentrar: false });
      const fresco = perfiles.find((x) => x.id === p.id) || Object.assign({}, p, cambios);
      this.perfil.refrescar(fresco);
      this.modoLectura();
      this.toast('Guardado');
    } catch (e) {
      this._error('No se pudo guardar', e);
    }
  };

  Mantenimiento.prototype.eliminar = async function () {
    const p = this.perfil.perfilActual;
    if (!p) return;
    const ok = global.confirm(
      `¿Eliminar a "${p.nombre_completo}"?\n\nSe borrará el nodo y sus conexiones ` +
        `de pareja. Los hijos que dependían de esta persona perderán ese vínculo.\n\n` +
        `Esta acción no se puede deshacer.`
    );
    if (!ok) return;

    try {
      await AlbumDatos.eliminar(p.id_familia, p.id);
      await this.recargar({ recentrar: false });
      this.perfil.cerrar();
      this.toast('Eliminado');
    } catch (e) {
      this._error('No se pudo eliminar', e);
    }
  };

  /** tipo: 'pareja' | 'hijo' | 'progenitor'. Crea el nodo vinculado,
   *  recarga, abre el nuevo perfil y entra directo en edición para nombrarlo. */
  Mantenimiento.prototype.agregar = async function (tipo) {
    const base = this.perfil.perfilActual;
    if (!base) return;

    try {
      let nuevo = null;
      if (tipo === 'pareja') nuevo = await AlbumDatos.agregarPareja(base);
      else if (tipo === 'hijo') nuevo = await AlbumDatos.agregarHijo(base);
      else if (tipo === 'progenitor') {
        nuevo = await AlbumDatos.agregarProgenitor(base);
        if (!nuevo) {
          global.alert('Este perfil ya tiene padre y madre asignados.');
          return;
        }
      }
      if (!nuevo) return;

      const perfiles = await this.recargar({ recentrar: false });
      const fresco = perfiles.find((x) => x.id === nuevo.id) || nuevo;
      this.perfil.abrir(fresco);   // alAbrir → modoLectura
      this.modoEdicion();          // y saltamos directo a nombrar al nuevo
    } catch (e) {
      this._error('No se pudo crear el nodo', e);
    }
  };

  Mantenimiento.prototype._error = function (mensaje, e) {
    console.error('[Mantenimiento]', mensaje, e);
    global.alert(mensaje + (e && e.message ? ': ' + e.message : '.'));
  };

  /* ── Subida de fotografías ───────────────────────────────── */

  /** Redimensiona la imagen en el navegador (máx. 1600 px, JPEG 0.85):
   *  las fotos de celular pesan 5–10 MB y no tiene sentido subirlas así. */
  Mantenimiento.prototype._redimensionar = function (archivo) {
    return new Promise((resolver, rechazar) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        const factor = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * factor);
        const h = Math.round(img.height * factor);
        const lienzo = document.createElement('canvas');
        lienzo.width = w;
        lienzo.height = h;
        lienzo.getContext('2d').drawImage(img, 0, 0, w, h);
        lienzo.toBlob(
          (blob) => (blob ? resolver(blob) : rechazar(new Error('No se pudo procesar la imagen'))),
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        rechazar(new Error('El archivo no es una imagen válida'));
      };
      img.src = url;
    });
  };

  /** Abre el selector de archivo para el slot indicado (1–3), sube la
   *  imagen al Storage y deja la URL pública en el input correspondiente. */
  Mantenimiento.prototype._subirFoto = function (slot, boton) {
    const selector = this.refs.archivoFoto;
    selector.value = ''; // permite volver a elegir el mismo archivo
    selector.onchange = async () => {
      const archivo = selector.files && selector.files[0];
      if (!archivo) return;
      const p = this.perfil.perfilActual;
      if (!p) return;
      boton.classList.add('subiendo');
      boton.textContent = 'Subiendo…';
      try {
        const blob = await this._redimensionar(archivo);
        const ruta = `${p.id_familia}/${p.id}/foto-${slot}-${Date.now()}.jpg`;
        const url = await SupabaseServicio.subirFoto(ruta, blob);
        this.refs['foto' + slot].value = url;
        this.toast('Foto subida');
      } catch (e) {
        this._error('No se pudo subir la foto', e);
      } finally {
        boton.classList.remove('subiendo');
        boton.textContent = 'Subir';
      }
    };
    selector.click();
  };

  /* ── Cableado de la UI ───────────────────────────────────── */

  Mantenimiento.prototype._conectar = function () {
    this.refs.lectura.querySelectorAll('[data-accion]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const accion = btn.dataset.accion;
        if (accion === 'editar') this.modoEdicion();
        else if (accion === 'eliminar') this.eliminar();
        else this.agregar(accion); // pareja | hijo | progenitor
      });
    });

    this.refs.editor.addEventListener('submit', (e) => {
      e.preventDefault();
      this.guardar();
    });
    this.refs.cancelar.addEventListener('click', () => this.modoLectura());

    /* Botones "Subir" de los 3 slots de foto. Sin backend no hay Storage:
       se ocultan y quedan solo los campos de URL. */
    const cfg = global.ALBUM_CONFIG || {};
    this.refs.editor.querySelectorAll('[data-subir]').forEach((btn) => {
      if (!cfg.hayBackend) {
        btn.hidden = true;
        return;
      }
      btn.addEventListener('click', () => this._subirFoto(btn.dataset.subir, btn));
    });
  };

  global.Mantenimiento = Mantenimiento;
})(window);
