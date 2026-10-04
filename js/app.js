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
      marco: $('carruselMarco'),
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
      /* Al tocar una foto: la vista se centra en esa persona y la ficha
         abre de inmediato — clave en móvil, donde el nodo puede estar
         mal encuadrado en el borde de la pantalla. */
      alSeleccionar: (p) => {
        lienzo.centrarEn(p.id);
        perfil.abrir(p);
        resolverFicha(p);
      },
    });

    /* Las fotos grandes de una persona se piden al abrir SU ficha (como
       mucho 4 lecturas), no al cargar el árbol. Si mientras tanto se cerró
       o se abrió otra persona, el resultado se descarta. */
    function resolverFicha(p) {
      const be = global.AlbumBackend;
      if (!be || !be.resolverPerfil || !(p.galeria || []).some((g) => /^foto:/.test(g))) return;
      be.resolverPerfil(p).then((completo) => {
        if (perfil.abierto && perfil.perfilActual && perfil.perfilActual.id === completo.id) {
          perfil.refrescar(completo);
        }
      }).catch((e) => console.warn('[Fotos]', e));
    }

    /* Con la ficha abierta, las chispas del fondo se congelan: no se ven
       tras el velo y competían por el procesador con la animación 3D. */
    perfil.alCambiarEstado = (abierta) => lienzo.pausar('ficha', abierta);

    $('btnCentrar').addEventListener('click', () => lienzo.centrar());

    /* ── Descargar el árbol (PNG / PDF) ─────────────────────── */
    const menuDescargar = $('descargarMenu');
    $('btnDescargar').addEventListener('click', (e) => {
      e.stopPropagation();
      menuDescargar.hidden = !menuDescargar.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!menuDescargar.hidden && !e.target.closest('.descargar')) menuDescargar.hidden = true;
    });

    const exportarArbol = async (formato) => {
      menuDescargar.hidden = true;
      toast(formato === 'png' ? 'Generando imagen…' : 'Generando PDF…');
      try {
        /* exporta lo que está en el lienzo: árbol completo o la rama activa */
        if (formato === 'png') await AlbumExportar.png(perfilesDibujados, etiquetaTenant(familiaActual));
        else await AlbumExportar.pdf(perfilesDibujados, etiquetaTenant(familiaActual));
        toast('Descarga lista');
      } catch (err) {
        console.error('[Exportar]', err);
        global.alert('No se pudo generar la descarga: ' + err.message);
      }
    };
    $('descargarPNG').addEventListener('click', () => exportarArbol('png'));
    $('descargarPDF').addEventListener('click', () => exportarArbol('pdf'));

    /* ── Copia de seguridad ─────────────────────────────────────
       El PNG y el PDF son recuerdos; esto es el seguro. Se respalda
       SIEMPRE la familia completa (ultimosPerfiles), nunca la rama
       filtrada: una copia parcial da una falsa sensación de refugio. */
    $('descargarRespaldo').addEventListener('click', async () => {
      menuDescargar.hidden = true;
      if (!ultimosPerfiles.length) return toast('No hay nada que respaldar todavía');
      toast('Preparando la copia…');
      try {
        /* Las fotos ya no viajan con el árbol: se traen todas aquí, para
           que la copia nunca salga sin ellas. */
        const be = global.AlbumBackend;
        const completos = be && be.resolverPerfiles && cfg.hayBackend
          ? await be.resolverPerfiles(ultimosPerfiles)
          : ultimosPerfiles;
        const r = await AlbumRespaldo.descargar(
          completos, familiaActual, etiquetaTenant(familiaActual), toast
        );
        toast(
          'Copia lista: ' + r.perfiles + ' perfiles y ' + r.fotos + ' fotos' +
          (r.fallidas ? ' (' + r.fallidas + ' fotos no se pudieron descargar)' : '')
        );
      } catch (err) {
        console.error('[Respaldo]', err);
        global.alert('No se pudo crear la copia: ' + err.message);
      }
    });

    const selectorRespaldo = $('archivoRespaldo');
    $('restaurarRespaldo').addEventListener('click', () => {
      menuDescargar.hidden = true;
      selectorRespaldo.value = ''; // permite reelegir el mismo archivo
      selectorRespaldo.click();
    });

    selectorRespaldo.addEventListener('change', async () => {
      const archivo = selectorRespaldo.files && selectorRespaldo.files[0];
      if (!archivo) return;
      try {
        const { manifiesto, archivos } = await AlbumRespaldo.leer(archivo);
        const cuando = new Date(manifiesto.generado).toLocaleString();
        const seguir = global.confirm(
          'Copia del ' + cuando + ': ' + manifiesto.perfiles.length + ' perfiles y ' +
          (manifiesto.total_fotos || 0) + ' fotos.\n\n' +
          'Se restaurarán sobre la familia "' + etiquetaTenant(familiaActual) + '".\n' +
          'Los perfiles que ya existan se sobrescribirán con los de la copia. ' +
          'Nadie será eliminado.\n\n¿Continuar?'
        );
        if (!seguir) return;
        toast('Restaurando…');
        const r = await AlbumRespaldo.restaurar(manifiesto, archivos, familiaActual, toast);
        await recargar();
        toast(
          'Restaurados ' + r.perfiles + ' perfiles y ' + r.fotos + ' fotos' +
          (r.sinSubir ? ' (' + r.sinSubir + ' fotos necesitan la nube)' : '')
        );
      } catch (err) {
        console.error('[Restaurar]', err);
        global.alert('No se pudo restaurar: ' + err.message);
      }
    });

    /* ── Filtro de rama: ver solo la línea de una persona ────── */
    /* La rama se filtra de lo que ya está en memoria: no hace falta
       volver a leer la familia entera de la nube. */
    $('btnVerRama').addEventListener('click', () => {
      const p = perfil.perfilActual;
      if (!p) return;
      ramaDe = p.id;
      $('chipRamaTexto').textContent = 'Rama de ' + p.nombre_completo;
      $('chipRama').hidden = false;
      perfil.cerrar();
      pintar();
      toast('Mostrando solo su rama');
    });

    $('chipRamaQuitar').addEventListener('click', () => {
      ramaDe = null;
      $('chipRama').hidden = true;
      pintar();
      toast('Árbol completo');
    });

    /* Relee la familia activa y redibuja. Alterna el estado vacío.
       Devuelve los perfiles frescos para localizar nodos nuevos/editados.
       Si hay una rama activa, dibuja solo esa rama (el CRUD y los
       selectores siguen viendo a toda la familia). */
    let ultimosPerfiles = []; // toda la familia (para CRUD y selectores)
    let perfilesDibujados = []; // lo que está en el lienzo (para exportar)
    let ramaDe = null; // id de la persona cuya rama se está viendo

    const recargar = async (opciones) => {
      let todos;
      try {
        todos = await AlbumDatos.obtenerPerfiles(familiaActual);
      } catch (err) {
        /* Sin datos no se dibuja un árbol vacío invitando a "agregar la
           primera persona": el árbol existe, solo no se pudo leer. */
        console.error('[Cargar]', err);
        $('lienzoVacioTitulo').textContent = 'No se pudo cargar el álbum. Revisa tu conexión y recarga la página.';
        document.body.classList.add('error-carga');
        $('lienzoVacio').hidden = ultimosPerfiles.length !== 0;
        toast('No se pudo cargar el álbum');
        return ultimosPerfiles;
      }
      document.body.classList.remove('error-carga');
      $('lienzoVacioTitulo').textContent = 'Esta familia aún no tiene perfiles';
      ultimosPerfiles = todos;
      pintar(opciones);
      return todos;
    };

    function pintar(opciones) {
      const todos = ultimosPerfiles;
      let lista = todos;
      if (ramaDe) {
        const ids = AlbumDatos.calcularRama(todos, ramaDe);
        lista = todos.filter((p) => ids.has(p.id));
        if (lista.length <= 1) {
          /* la persona ya no existe o quedó sola: volver al árbol completo */
          ramaDe = null;
          lista = todos;
          $('chipRama').hidden = true;
        }
      }
      perfilesDibujados = lista;
      lienzo.dibujar(lista, opciones);
      $('lienzoVacio').hidden = lista.length !== 0;
    }

    const mantenimiento = new Mantenimiento({
      perfil,
      recargar,
      toast,
      /* Lista actual de la familia: alimenta los selectores de relaciones */
      perfiles: () => ultimosPerfiles,
    });

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

    const cargarAlbum = async () => {
      await recargar();
      await rellenarFamilias();
    };

    /* ── Modo lectura / edición ─────────────────────────────────
       El álbum se ve SIN clave (solo lectura). La clave familiar
       desbloquea la edición: activa `modo-edicion` en <body>, que es
       lo que revela los botones de CRUD y de subida de fotos.
       El candado es opcional y se abre desde el botón del encabezado. */
    const aplicarModo = (hayS) => {
      document.body.classList.toggle('modo-edicion', !!hayS);
      const btn = $('btnSesion');
      btn.textContent = hayS ? 'Salir' : 'Iniciar';
      btn.title = hayS
        ? 'Salir del modo edición en este dispositivo'
        : 'Ingresar la clave para editar';
      btn.hidden = false;
    };

    const cerrarCandado = () => {
      $('candado').hidden = true;
      $('candadoError').hidden = true;
      $('candadoClave').value = '';
    };

    /* El árbol se pide YA, en paralelo con la comprobación de sesión:
       antes esperaba a Auth y eso retrasaba el primer dibujo. */
    const carga = cargarAlbum();

    if (cfg.hayBackend && cfg.PROTEGER_CON_CLAVE) {
      $('candado')
        .querySelectorAll('[data-cerrar-candado]')
        .forEach((el) => el.addEventListener('click', cerrarCandado));

      $('candadoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const boton = e.target.querySelector('button[type="submit"]');
        boton.disabled = true;
        try {
          await AlbumBackend.entrarConClave($('candadoClave').value);
          cerrarCandado();
          aplicarModo(true); // la lectura es pública: no hace falta releer
          toast('Modo edición activado');
        } catch (err) {
          console.error('[Candado] Fallo de inicio de sesión:', err);
          const codigo = String((err && err.code) || '');
          const msg = String((err && err.message) || '');
          const el = $('candadoError');
          if (/wrong-password|invalid-credential|user-not-found|invalid-email/.test(codigo)) {
            el.textContent = 'Clave incorrecta. Intenta de nuevo.';
          } else if (/too-many-requests/.test(codigo)) {
            el.textContent = 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.';
          } else if (/network-request-failed/.test(codigo)) {
            el.textContent = 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
          } else if (/configuration-not-found|operation-not-allowed/.test(codigo)) {
            el.textContent =
              'Falta activar el acceso por correo y contraseña en la consola de Firebase (Authentication -> Sign-in method).';
          } else if (/api-key-not-valid|invalid-api-key/.test(codigo + msg)) {
            el.textContent = 'Las credenciales de js/config.js no son válidas para este proyecto.';
          } else {
            el.textContent = 'No se pudo entrar: ' + (msg || 'error desconocido');
          }
          el.hidden = false;
          $('candadoClave').select();
        } finally {
          boton.disabled = false;
        }
      });

      $('btnSesion').addEventListener('click', async () => {
        if (document.body.classList.contains('modo-edicion')) {
          await AlbumBackend.salir();
          if (perfil.abierto) perfil.cerrar();
          aplicarModo(false);
          toast('Modo solo lectura');
        } else {
          $('candado').hidden = false;
          $('candadoClave').focus();
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('candado').hidden) cerrarCandado();
      });

      aplicarModo(!!(await AlbumBackend.sesion()));
    } else {
      /* Sin backend (modo maqueta local): todo editable, sin candado. */
      document.body.classList.add('modo-edicion');
    }

    await carga;
  });
})(window);
