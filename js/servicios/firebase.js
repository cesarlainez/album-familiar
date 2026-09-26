/* ══════════════════════════════════════════════════════════════
   SERVICIO FIREBASE — Firestore + Auth (plan gratuito, sin tarjeta)
   ──────────────────────────────────────────────────────────────
   Sustituye a Supabase tras perder aquel proyecto por inactividad:
   los proyectos de Firebase NO se pausan ni se borran por estar
   quietos, que era exactamente el riesgo que nos costó el álbum.

   Estructura en Firestore:

     familias/{id_familia}/perfiles/{id}   ← una persona
     familias/{id_familia}/fotos/{fotoId}  ← una imagen (data URL)

   ¿Por qué las fotos en Firestore y no en Storage? Porque Cloud
   Storage exige plan de pago (Blaze) en los proyectos nuevos, y este
   álbum tiene que poder vivir en el plan gratuito para siempre. Cada
   foto va en su PROPIO documento: el límite de Firestore es 1 MiB por
   documento, así que meter cuatro fotos dentro del perfil lo reventaría.

   El resto de la app no sabe nada de esto: pide perfiles con `galeria`
   llena de cadenas que sirven como `src`, y aquí se traducen.

   Requiere los SDK "compat" cargados antes (index.html los trae del
   CDN y exponen `window.firebase`).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* Tope por documento: Firestore corta en 1 MiB. Un data URL infla la
     imagen un 37 % al pasarla a base64, así que nos quedamos holgados. */
  const MAX_FOTO_BYTES = 650 * 1024;

  let _app = null;

  function app() {
    if (_app) return _app;
    const cfg = (global.ALBUM_CONFIG || {}).FIREBASE;
    if (!global.firebase || !global.firebase.initializeApp) {
      throw new Error('El SDK de Firebase no está cargado.');
    }
    _app = global.firebase.apps && global.firebase.apps.length
      ? global.firebase.app()
      : global.firebase.initializeApp(cfg);
    return _app;
  }

  const bd = () => (app(), global.firebase.firestore());
  const auth = () => (app(), global.firebase.auth());

  const colPerfiles = (idFamilia) => bd().collection('familias').doc(idFamilia).collection('perfiles');
  const colFotos = (idFamilia) => bd().collection('familias').doc(idFamilia).collection('fotos');

  /* ── Fotos: traducción entre documento y data URL ──────────
     La app guarda en `galeria` cadenas que pone tal cual en un <img>.
     En Firestore guardamos el id del documento; al leer lo cambiamos
     por su data URL y recordamos la equivalencia para el camino de
     vuelta (así editar un perfil no reescribe las fotos). */

  const _urlDeFoto = new Map(); // fotoId  → data URL
  const _fotoDeUrl = new Map(); // data URL → fotoId

  function recordar(fotoId, url) {
    _urlDeFoto.set(fotoId, url);
    _fotoDeUrl.set(url, fotoId);
  }

  /** Cambia los ids guardados por sus data URL (lectura). */
  async function hidratar(idFamilia, perfiles) {
    const pendientes = new Set();
    for (const p of perfiles) {
      for (const g of p.galeria || []) {
        if (esRefFoto(g) && !_urlDeFoto.has(idFoto(g))) pendientes.add(idFoto(g));
      }
    }
    /* Las fotos se piden en paralelo: son documentos independientes y
       esperarlas en fila haría el arranque tan lento como fotos haya. */
    await Promise.all(
      [...pendientes].map(async (fotoId) => {
        try {
          const doc = await colFotos(idFamilia).doc(fotoId).get();
          if (doc.exists && doc.data().datos) recordar(fotoId, doc.data().datos);
        } catch (e) {
          console.warn('[Firebase] No se pudo leer una foto:', fotoId, e);
        }
      })
    );

    return perfiles.map((p) => {
      const galeria = (p.galeria || [])
        .map((g) => (esRefFoto(g) ? _urlDeFoto.get(idFoto(g)) || '' : g))
        .filter(Boolean);
      return Object.assign({}, p, { galeria: galeria });
    });
  }

  const PREFIJO = 'foto:';
  const esRefFoto = (v) => typeof v === 'string' && v.indexOf(PREFIJO) === 0;
  const idFoto = (v) => v.slice(PREFIJO.length);

  /** Cambia las data URL por sus ids (escritura). Una imagen que no
   *  conocemos se guarda como documento nuevo en el acto. */
  async function deshidratar(idFamilia, galeria, idPerfil) {
    const salida = [];
    for (const g of galeria || []) {
      if (!g) continue;
      if (esRefFoto(g)) { salida.push(g); continue; }
      const conocida = _fotoDeUrl.get(g);
      if (conocida) { salida.push(PREFIJO + conocida); continue; }
      if (/^data:/.test(g)) {
        salida.push(PREFIJO + (await guardarFoto(idFamilia, g, idPerfil)));
        continue;
      }
      salida.push(g); // una URL externa: se guarda tal cual
    }
    return salida;
  }

  async function guardarFoto(idFamilia, dataUrl, idPerfil) {
    const ref = colFotos(idFamilia).doc();
    await ref.set({
      datos: dataUrl,
      perfil: idPerfil || null,
      creado: new Date().toISOString(),
    });
    recordar(ref.id, dataUrl);
    return ref.id;
  }

  /* ── Utilidades ──────────────────────────────────────────── */

  function aDataUrl(blob) {
    return new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(new Error('No se pudo leer la imagen'));
      lector.readAsDataURL(blob);
    });
  }

  /** Reduce la imagen hasta que entre en un documento de Firestore.
   *  Baja primero la calidad y, si aún no cabe, el tamaño. */
  async function encoger(blob) {
    if (blob.size <= MAX_FOTO_BYTES) return blob;
    const bitmap = await createImageBitmap(blob);
    let lado = Math.max(bitmap.width, bitmap.height);
    for (const calidad of [0.8, 0.7, 0.6, 0.5]) {
      for (const tope of [lado, 1400, 1100, 900, 700]) {
        if (tope > lado) continue;
        const factor = tope / lado;
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(bitmap.width * factor);
        lienzo.height = Math.round(bitmap.height * factor);
        lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
        const nuevo = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', calidad));
        if (nuevo && nuevo.size <= MAX_FOTO_BYTES) return nuevo;
      }
    }
    throw new Error('La imagen es demasiado pesada aunque se reduzca. Prueba con otra.');
  }

  /** Quita los campos que Firestore no admite (undefined) y fuerza la
   *  forma de la fila: el resto de la app espera siempre estas claves. */
  function fila(p) {
    return {
      id_familia: p.id_familia,
      id: p.id,
      nombre_completo: p.nombre_completo || '',
      fecha_nacimiento: p.fecha_nacimiento || null,
      fecha_fallecimiento: p.fecha_fallecimiento || null,
      disciplina_artistica: p.disciplina_artistica || '',
      obra_maestra: p.obra_maestra || '',
      biografia: p.biografia || '',
      galeria: Array.isArray(p.galeria) ? p.galeria : [],
      id_padre: p.id_padre || null,
      id_madre: p.id_madre || null,
      id_pareja: Array.isArray(p.id_pareja) ? p.id_pareja : [],
    };
  }

  const FirebaseServicio = {
    nombre: 'firebase',

    /* ── Clave familiar (Auth con una cuenta compartida) ────── */

    /** Sesión activa en este dispositivo, o null. Firebase la resuelve
     *  de forma asíncrona al arrancar; por eso se espera al primer aviso
     *  en vez de leer currentUser, que al principio siempre es null. */
    sesion() {
      return new Promise((resolver) => {
        const quitar = auth().onAuthStateChanged((usuario) => {
          quitar();
          resolver(usuario || null);
        });
      });
    },

    async entrarConClave(clave) {
      const cfg = global.ALBUM_CONFIG;
      const cred = await auth().signInWithEmailAndPassword(cfg.AUTH_EMAIL, clave);
      return cred.user;
    },

    async salir() {
      await auth().signOut();
    },

    /* ── Fotografías ───────────────────────────────────────── */

    /** Guarda la imagen y devuelve algo que sirva de `src`.
     *  `ruta` se ignora (viene del diseño de Storage); se conserva en la
     *  firma para que el resto de la app no cambie. */
    async subirFoto(ruta, blob) {
      const idFamilia = String(ruta || '').split('/')[0] ||
        (global.ALBUM_CONFIG || {}).TENANT_POR_DEFECTO;
      const dataUrl = await aDataUrl(await encoger(blob));
      await guardarFoto(idFamilia, dataUrl, String(ruta || '').split('/')[1] || null);
      return dataUrl;
    },

    /* ── Perfiles ──────────────────────────────────────────── */

    async obtenerPerfiles(idFamilia) {
      const captura = await colPerfiles(idFamilia).get();
      const perfiles = captura.docs.map((d) => fila(Object.assign({ id: d.id, id_familia: idFamilia }, d.data())));
      perfiles.sort((a, b) => String(a.fecha_nacimiento || '').localeCompare(String(b.fecha_nacimiento || '')));
      return await hidratar(idFamilia, perfiles);
    },

    /** Familias existentes. Requiere poder listar la colección raíz;
     *  si las reglas no lo permiten, se devuelve la familia por defecto. */
    async listarFamilias() {
      try {
        const captura = await bd().collection('familias').get();
        const ids = captura.docs.map((d) => d.id);
        return ids.length ? ids.sort() : [(global.ALBUM_CONFIG || {}).TENANT_POR_DEFECTO];
      } catch (e) {
        console.warn('[Firebase] No se pudieron listar las familias:', e);
        return [(global.ALBUM_CONFIG || {}).TENANT_POR_DEFECTO];
      }
    },

    async crear(perfil) {
      const idFamilia = perfil.id_familia;
      const datos = fila(perfil);
      datos.galeria = await deshidratar(idFamilia, datos.galeria, perfil.id);
      /* El documento padre de la subcolección no existe por sí solo:
         se marca para que la familia aparezca al listar. */
      await bd().collection('familias').doc(idFamilia).set({ id: idFamilia }, { merge: true });
      await colPerfiles(idFamilia).doc(perfil.id).set(datos);
      return Object.assign({}, perfil, { galeria: perfil.galeria || [] });
    },

    async actualizar(idFamilia, id, cambios) {
      const datos = Object.assign({}, cambios);
      if ('galeria' in datos) datos.galeria = await deshidratar(idFamilia, datos.galeria, id);
      delete datos.id;
      delete datos.id_familia;
      await colPerfiles(idFamilia).doc(id).set(datos, { merge: true });
    },

    /** Borra el perfil y lo desengancha de quienes lo señalaban: padre,
     *  madre y pareja son referencias por id, nadie las limpia solo. */
    async eliminar(idFamilia, id) {
      const captura = await colPerfiles(idFamilia).get();
      const lote = bd().batch();
      captura.docs.forEach((d) => {
        const p = d.data();
        const arreglo = {};
        if (p.id_padre === id) arreglo.id_padre = null;
        if (p.id_madre === id) arreglo.id_madre = null;
        if (Array.isArray(p.id_pareja) && p.id_pareja.indexOf(id) !== -1) {
          arreglo.id_pareja = p.id_pareja.filter((x) => x !== id);
        }
        if (Object.keys(arreglo).length) lote.set(d.ref, arreglo, { merge: true });
      });
      lote.delete(colPerfiles(idFamilia).doc(id));

      /* Sus fotos se van con el perfil: si no, quedan documentos huérfanos
         ocupando la cuota para siempre, sin nadie que los muestre. */
      const fotos = await colFotos(idFamilia).get();
      fotos.docs.forEach((d) => {
        if (d.data().perfil === id) {
          lote.delete(d.ref);
          const url = _urlDeFoto.get(d.id);
          if (url) { _urlDeFoto.delete(d.id); _fotoDeUrl.delete(url); }
        }
      });

      await lote.commit();
    },

    /** Inserta o actualiza varios perfiles de golpe (restaurar copia).
     *  Firestore admite 500 operaciones por lote, así que se trocea. */
    async guardarVarios(perfiles) {
      if (!perfiles.length) return;
      const idFamilia = perfiles[0].id_familia;
      await bd().collection('familias').doc(idFamilia).set({ id: idFamilia }, { merge: true });

      const preparados = [];
      for (const p of perfiles) {
        const datos = fila(p);
        datos.galeria = await deshidratar(p.id_familia, datos.galeria, p.id);
        preparados.push(datos);
      }
      for (let i = 0; i < preparados.length; i += 400) {
        const lote = bd().batch();
        for (const datos of preparados.slice(i, i + 400)) {
          lote.set(colPerfiles(datos.id_familia).doc(datos.id), datos, { merge: true });
        }
        await lote.commit();
      }
    },
  };

  /* Se registra como backend activo solo si es el elegido y el SDK está.
     Así convivir con el servicio de Supabase no cuesta nada. */
  const cfg = global.ALBUM_CONFIG || {};
  if ((cfg.BACKEND || 'firebase') === 'firebase' && global.firebase && global.firebase.initializeApp) {
    global.FirebaseServicio = FirebaseServicio;
    global.AlbumBackend = FirebaseServicio;
  }
})(window);
