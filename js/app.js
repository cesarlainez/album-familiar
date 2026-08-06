/* ══════════════════════════════════════════════════════════════
   APP — Arranque: tenant activo, lienzo, flip card y CRUD
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* Tenant activo. Mutable: el selector del encabezado puede cambiarlo.
     Al conectar Auth saldrá del JWT del usuario, no de la URL. */
  let familiaActual =
    new URLSearchParams(location.search).get('familia') || AlbumDatos.TENANT_ACTIVO;

  /* ── Notificación breve (toast) ─────────────────────────────── */
  let toastTimer = null;
  function toast(mensaje) {
    const t = $('toast');
    if (!t) return;
    t.textContent = mensaje;
    t.hidden = false;
    void t.offsetWidth; // reflow para que la transición se reproduzca
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('visible');
      setTimeout(() => { t.hidden = true; }, 450);
    }, 1700);
  }
  global.AlbumUI = { toast };

  document.addEventListener('DOMContentLoaded', async () => {
    const etiquetaTenant = (id) => id.replace(/_/g, ' ');
    $('tenantLabel').textContent = etiquetaTenant(familiaActual);

    const perfil = new Perfil({
      lienzo: $('lienzo'),
      capa: $('flipCapa'),
      velo: $('flipVelo'),
      carta: $('flipCarta'),
      inner: $('flipInner'),
      frenteFoto: $('frenteFoto'),
      frentePlaceholder: $('frentePlaceholder'),
      frenteNombre: $('frenteNombre'),
      disciplina: $('modalDisciplina'),
      nombre: $('modalNombre'),
      fechas: $('modalFechas'),
      obra: $('modalObra'),
      bio: $('modalBio'),
      foto: $('carruselFoto'),
      vacio: $('carruselVacio'),
      puntos: $('carruselPuntos'),
      prev: $('fotoPrev'),
      next: $('fotoNext'),
      lupa: $('btnPantallaCompleta'),
      visor: $('visor'),
      visorFoto: $('visorFoto'),
      visorCerrar: $('visorCerrar'),
    });

    const lienzo = new Lienzo({
      contenedor: $('lienzo'),
      mundo: $('mundo'),
      capaNodos: $('nodos'),
      capaHilos: $('capaHilos'),
      hud: $('zoomHud'),
      alSeleccionar: (p) => perfil.abrir(p),
    });

    $('btnCentrar').addEventListener('click', () => lienzo.centrar());

    /* Relee la familia activa y redibuja. Alterna el estado vacío.
       Devuelve los perfiles frescos para localizar nodos nuevos/editados. */
    const recargar = async (opciones) => {
      const perfiles = await AlbumDatos.obtenerPerfiles(familiaActual);
      lienzo.dibujar(perfiles, opciones);
      $('lienzoVacio').hidden = perfiles.length !== 0;
      return perfiles;
    };

    const mantenimiento = new Mantenimiento({ perfil, recargar, toast });

    /* ── Selector de familia (autocompletado) ─────────────────── */
    async function rellenarFamilias() {
      const fams = await AlbumDatos.listarFamilias();
      const dl = $('familias');
      dl.innerHTML = '';
      fams.forEach((id) => {
        const op = document.createElement('option');
        op.value = etiquetaTenant(id); // se muestra con espacios
        dl.appendChild(op);
      });
    }

    async function cambiarFamilia(texto) {
      const id = (texto || '').trim().replace(/\s+/g, '_');
      if (!id || id === familiaActual) return;
      familiaActual = id;
      $('tenantLabel').textContent = etiquetaTenant(id);
      if (perfil.abierto) perfil.cerrar();
      await recargar();
      await rellenarFamilias();
    }

    $('buscarFamilia').addEventListener('change', (e) => {
      cambiarFamilia(e.target.value);
      e.target.blur();
    });

    /* ── Estado vacío: crear la primera persona de la familia ─── */
    $('btnPrimeraPersona').addEventListener('click', async () => {
      const nuevo = await AlbumDatos.crear({
        id_familia: familiaActual,
        nombre_completo: 'Nueva persona',
      });
      const perfiles = await recargar();
      await rellenarFamilias();
      const fresco = perfiles.find((p) => p.id === nuevo.id) || nuevo;
      perfil.abrir(fresco);
      mantenimiento.modoEdicion();
      toast('Perfil creado');
    });

    /* ── Aviso solo si NO se puede guardar de verdad ──────────── */
    const cfg = global.ALBUM_CONFIG || {};
    if (!cfg.hayBackend && (location.protocol === 'file:' || !AlbumDatos.puedePersistir())) {
      const aviso = $('avisoPersistencia');
      aviso.innerHTML =
        '<strong>No se están guardando los cambios.</strong> ' +
        'Abriste el archivo directamente y el navegador bloquea el guardado. ' +
        'Ábrelo desde un servidor (http://localhost) o conecta la base de datos para publicar.';
      aviso.hidden = false;
    }

    await recargar();
    await rellenarFamilias();
  });
})(window);
