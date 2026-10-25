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
  const colEnlaces = (idFamilia) => bd().collection('familias').doc(idFamilia).collection('enlaces');
  const colAportes = (idFamilia) => bd().collection('familias').doc(idFamilia).collection('aportes');
  const colAudios = (idFamilia) => bd().collection('familias').doc(idFamilia).collection('audios');
  const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : Number(v) || 0);

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

  /** Cambia por su data URL solo las fotos que YA están en memoria y deja
   *  el resto como "foto:{id}". El árbol se pinta sin esperar a ninguna
   *  foto: antes se descargaban TODAS (hasta 4 por persona, ~0,5 MB cada
   *  una) antes del primer dibujo, aunque la tarjeta usa una miniatura. */
  function hidratarDeMemoria(perfiles) {
    return perfiles.map((p) => {
      const galeria = (p.galeria || [])
        .filter(Boolean)
        .map((g) => (esRefFoto(g) && _urlDeFoto.has(idFoto(g)) ? _urlDeFoto.get(idFoto(g)) : g));
      return Object.assign({}, p, { galeria: galeria });
    });
  }

  /** Descarga las fotos que falten (en paralelo) y las deja en memoria. */
  async function traerFotos(idFamilia, refs) {
    const faltan = [...new Set(refs.filter(esRefFoto).map(idFoto))].filter((f) => !_urlDeFoto.has(f));
    await Promise.all(
      faltan.map(async (fotoId) => {
        try {
          const doc = await colFotos(idFamilia).doc(fotoId).get();
          if (doc.exists && doc.data().datos) recordar(fotoId, doc.data().datos);
        } catch (e) {
          console.warn('[Firebase] No se pudo leer una foto:', fotoId, e);
        }
      })
    );
  }

  /* ── Miniatura de la tarjeta ────────────────────────────────
     Recorte "cover" de 336×456 (el doble de la tarjeta, nítido en
     pantallas densas) en JPEG: ~20–30 KB frente a ~500–700 KB de la foto.
     Vive dentro del propio perfil, así que pintar el árbol completo no
     cuesta ni una lectura extra. */
  const MINI_W = 336;
  const MINI_H = 456;

  function cargarImagenDe(url) {
    return new Promise((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rechazar(new Error('No se pudo leer la foto para la miniatura'));
      img.src = url;
    });
  }

  async function crearMiniatura(dataUrl) {
    const img = await cargarImagenDe(dataUrl);
    const escala = Math.max(MINI_W / img.naturalWidth, MINI_H / img.naturalHeight);
    const w = img.naturalWidth * escala;
    const h = img.naturalHeight * escala;
    const lienzo = document.createElement('canvas');
    lienzo.width = MINI_W;
    lienzo.height = MINI_H;
    lienzo.getContext('2d').drawImage(img, (MINI_W - w) / 2, (MINI_H - h) / 2, w, h);
    return lienzo.toDataURL('image/jpeg', 0.75);
  }

  /** Campos de miniatura para una galería ya deshidratada ("foto:id").
   *  Solo se recalcula si cambió la portada (miniatura_de). */
  async function camposMiniatura(idFamilia, galeria, anterior) {
    const portada = (galeria || []).filter(Boolean)[0] || null;
    if (!portada) return { miniatura: null, miniatura_de: null };
    if (anterior && anterior.miniatura && anterior.miniatura_de === portada) {
      return { miniatura: anterior.miniatura, miniatura_de: portada };
    }
    let url = portada;
    if (esRefFoto(portada)) {
      await traerFotos(idFamilia, [portada]);
      url = _urlDeFoto.get(idFoto(portada));
    }
    if (!url || !/^data:/.test(url)) return { miniatura: null, miniatura_de: null };
    try {
      return { miniatura: await crearMiniatura(url), miniatura_de: portada };
    } catch (e) {
      console.warn('[Firebase] No se pudo crear la miniatura:', e);
      return { miniatura: null, miniatura_de: null };
    }
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
      miniatura: p.miniatura || null,
      miniatura_de: p.miniatura_de || null,
      lugares: p.lugares && typeof p.lugares === 'object' ? p.lugares : null,
      voces: Array.isArray(p.voces) ? p.voces : [],
      recuerdos: Array.isArray(p.recuerdos) ? p.recuerdos : [],
    };
  }

  /* ── Aportes sin cuenta ─────────────────────────────────────
     familias/{f}/enlaces/{token}         quien conoce el token puede leerlo
                                          (get, nunca list) y aportar. Lleva
                                          `usos`: cada aporte lo sube en 1.
     familias/{f}/aportes/{token_n}       el aporte n-ésimo de ese enlace,
                                          solo metadatos (pesa poco: la
                                          bandeja se lista sin bajar audios).
     familias/{f}/aportes/{id}/carga/datos  la grabación o la foto.
     familias/{f}/audios/{id}             notas de voz aprobadas, una por
                                          documento, como las fotos.
     Las reglas (backend/firestore.rules) exigen que aporte, carga y usos
     se escriban juntos y topan cada enlace en MAX_USOS aportes: un enlace
     filtrado no puede llenar la base. */
  const MAX_USOS = 80;
  const aportes = {
    MAX_USOS,
    async crearEnlace(fid, info) {
      const b = new Uint8Array(24);
      global.crypto.getRandomValues(b);
      const token = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const ahora = Date.now();
      const vence = ahora + (info.dias || 14) * 86400000;
      const T = global.firebase.firestore.Timestamp;
      await colEnlaces(fid).doc(token).set({
        etiqueta: String(info.etiqueta || fid).slice(0, 80),
        personas: (info.personas || []).slice(0, 2000),
        rama: String(info.rama || '').slice(0, 100),
        creado: T.fromMillis(ahora),
        vence: T.fromMillis(vence),
        usos: 0,
      });
      return { token, creado: ahora, vence, usos: 0 };
    },
    async listarEnlaces(fid) {
      const c = await colEnlaces(fid).get();
      return c.docs.map((d) => ({ token: d.id, creado: ms(d.data().creado), vence: ms(d.data().vence), usos: d.data().usos || 0, rama: d.data().rama || '' }))
        .sort((x, y) => y.creado - x.creado);
    },
    async revocarEnlace(fid, token) {
      await colEnlaces(fid).doc(token).delete();
    },
    async leerEnlace(fid, token) {
      let d;
      try {
        d = await colEnlaces(fid).doc(token).get();
      } catch (e) {
        if (/permission/i.test(String(e && (e.code || e.message)))) return null;
        throw e;
      }
      if (!d.exists) return null;
      const e = d.data();
      if (ms(e.vence) < Date.now()) return null;
      return { etiqueta: e.etiqueta, personas: e.personas || [], rama: e.rama || '', vence: ms(e.vence), usos: e.usos || 0 };
    },
    /** Aporte + carga + usos del enlace, en una transacción (las reglas
     *  rechazan cualquiera de las tres por separado). */
    async enviar(fid, token, aporte) {
      const refEnlace = colEnlaces(fid).doc(token);
      let id = '';
      await bd().runTransaction(async (tx) => {
        const e = await tx.get(refEnlace);
        if (!e.exists || ms(e.data().vence) < Date.now()) throw new Error('El enlace ya no es válido. Pide uno nuevo a tu familia.');
        const n = (e.data().usos || 0) + 1;
        if (n > MAX_USOS) throw new Error('Este enlace ya recibió muchos aportes. Pide uno nuevo a tu familia.');
        id = token + '_' + n;
        const refAporte = colAportes(fid).doc(id);
        const meta = Object.assign({}, aporte, {
          token,
          creado: global.firebase.firestore.FieldValue.serverTimestamp(),
        });
        delete meta.datos;
        tx.set(refAporte, meta);
        if (aporte.datos) tx.set(refAporte.collection('carga').doc('datos'), { datos: aporte.datos });
        tx.update(refEnlace, { usos: n });
      });
      return id;
    },
    /** La bandeja: solo metadatos (la carga se pide con leerCarga). */
    async listar(fid) {
      const c = await colAportes(fid).get();
      return c.docs.map((d) => Object.assign({}, d.data(), { id: d.id, creado: ms(d.data().creado) }))
        .sort((x, y) => x.creado - y.creado);
    },
    async leerCarga(fid, id) {
      const d = await colAportes(fid).doc(id).collection('carga').doc('datos').get();
      if (!d.exists || !d.data().datos) throw new Error('No se encontró el archivo del aporte.');
      return d.data().datos;
    },
    async descartar(fid, id) {
      const lote = bd().batch();
      const ref = colAportes(fid).doc(id);
      lote.delete(ref.collection('carga').doc('datos'));
      lote.delete(ref);
      await lote.commit();
    },
    async guardarAudio(fid, dataUrl, idPerfil) {
      const ref = colAudios(fid).doc();
      await ref.set({ datos: dataUrl, perfil: idPerfil || null, creado: new Date().toISOString() });
      return 'audio:' + ref.id;
    },
    async leerAudio(fid, ref) {
      const d = await colAudios(fid).doc(String(ref).replace(/^audio:/, '')).get();
      if (!d.exists || !d.data().datos) throw new Error('No se encontró la grabación.');
      return d.data().datos;
    },
    async borrarAudio(fid, ref) {
      await colAudios(fid).doc(String(ref).replace(/^audio:/, '')).delete();
    },
  };

  /* ── Puentes entre familias ─────────────────────────────────
     puentes/{id}: ver js/puentes.js. Sin sesión solo se pueden leer los
     ACEPTADOS (las reglas lo exigen), así que la consulta lo pide. */
  const colPuentes = () => bd().collection('puentes');
  const puentes = {
    async listar(fid) {
      const conSesion = !!(global.firebase.auth && auth().currentUser);
      const consulta = (campo) => {
        let q = colPuentes().where(campo, '==', fid);
        if (!conSesion) q = q.where('estado', '==', 'aceptado');
        return q.get();
      };
      const [a, b] = await Promise.all([consulta('fidA'), consulta('fidB')]);
      const vistos = new Map();
      a.docs.concat(b.docs).forEach((d) => vistos.set(d.id, Object.assign({ id: d.id }, d.data())));
      return [...vistos.values()];
    },
    async proponer(id, fila) {
      const ref = colPuentes().doc(id);
      const previo = await ref.get();
      if (previo.exists) return Object.assign({ id }, previo.data()); // no se reabre
      await ref.set(Object.assign({}, fila, { creado: new Date().toISOString() }));
      return Object.assign({ id }, fila);
    },
    async responder(id, lado, acepta) {
      const ref = colPuentes().doc(id);
      await bd().runTransaction(async (tx) => {
        const d = await tx.get(ref);
        if (!d.exists) throw new Error('El puente ya no existe.');
        const p = Object.assign({}, d.data());
        p['acepta' + lado] = !!acepta;
        const estado = p.aceptaA === false || p.aceptaB === false ? 'rechazado'
          : p.aceptaA === true && p.aceptaB === true ? 'aceptado' : 'propuesto';
        const cambios = { estado };
        cambios['acepta' + lado] = !!acepta;
        tx.update(ref, cambios);
      });
    },
    async retirar(id) {
      await colPuentes().doc(id).delete();
    },
  };

  const FirebaseServicio = {
    nombre: 'firebase',
    aportes,
    puentes,

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
      return hidratarDeMemoria(perfiles);
    },

    /** Devuelve una copia del perfil con TODAS sus fotos como data URL.
     *  Se usa al abrir la ficha (máximo 4 lecturas, solo de esa persona). */
    async resolverPerfil(perfil) {
      await traerFotos(perfil.id_familia, perfil.galeria || []);
      return hidratarDeMemoria([perfil])[0];
    },

    /** Lo mismo para muchos perfiles a la vez (copia de seguridad). */
    async resolverPerfiles(perfiles) {
      if (!perfiles.length) return [];
      const idFamilia = perfiles[0].id_familia;
      await traerFotos(idFamilia, [].concat(...perfiles.map((p) => p.galeria || [])));
      return hidratarDeMemoria(perfiles);
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

    /** Cada familia con el resumen que guardó (puede faltar si nadie la
     *  editó desde que existe el buscador). */
    async listarResumenes() {
      const captura = await bd().collection('familias').get();
      return captura.docs.map((d) => ({ id: d.id, resumen: d.data().resumen || null }));
    },

    async guardarResumen(idFamilia, resumen) {
      await bd().collection('familias').doc(idFamilia).set(
        { id: idFamilia, resumen: Object.assign({}, resumen, { actualizado: new Date().toISOString() }) },
        { merge: true }
      );
    },

    async crear(perfil) {
      const idFamilia = perfil.id_familia;
      const datos = fila(perfil);
      datos.galeria = await deshidratar(idFamilia, datos.galeria, perfil.id);
      Object.assign(datos, await camposMiniatura(idFamilia, datos.galeria, null));
      /* El documento padre de la subcolección no existe por sí solo:
         se marca para que la familia aparezca al listar. */
      await bd().collection('familias').doc(idFamilia).set({ id: idFamilia }, { merge: true });
      await colPerfiles(idFamilia).doc(perfil.id).set(datos);
      return Object.assign({}, perfil, { galeria: perfil.galeria || [] });
    },

    async actualizar(idFamilia, id, cambios) {
      const datos = Object.assign({}, cambios);
      if ('galeria' in datos) {
        datos.galeria = await deshidratar(idFamilia, datos.galeria, id);
        const actual = await colPerfiles(idFamilia).doc(id).get();
        Object.assign(datos, await camposMiniatura(idFamilia, datos.galeria, actual.exists ? actual.data() : null));
      }
      delete datos.id;
      delete datos.id_familia;
      await colPerfiles(idFamilia).doc(id).set(datos, { merge: true });
    },

    async agregarALista(idFamilia, id, campo, item) {
      const cambio = {};
      cambio[campo] = global.firebase.firestore.FieldValue.arrayUnion(item);
      await colPerfiles(idFamilia).doc(id).update(cambio);
    },

    async quitarDeLista(idFamilia, id, campo, item) {
      const cambio = {};
      cambio[campo] = global.firebase.firestore.FieldValue.arrayRemove(item);
      await colPerfiles(idFamilia).doc(id).update(cambio);
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
         ocupando la cuota para siempre, sin nadie que los muestre. Se piden
         SOLO las suyas: leer la colección entera eran decenas de MB. */
      const fotos = await colFotos(idFamilia).where('perfil', '==', id).get();
      fotos.docs.forEach((d) => {
        lote.delete(d.ref);
        const url = _urlDeFoto.get(d.id);
        if (url) { _urlDeFoto.delete(d.id); _fotoDeUrl.delete(url); }
      });
      /* Y sus notas de voz, por la misma razón */
      const audios = await colAudios(idFamilia).where('perfil', '==', id).get();
      audios.docs.forEach((d) => lote.delete(d.ref));

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
        Object.assign(datos, await camposMiniatura(p.id_familia, datos.galeria, null));
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
