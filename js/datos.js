/* ══════════════════════════════════════════════════════════════
   DATOS — Acceso, layout de grafo libre, CRUD y semilla real
   ──────────────────────────────────────────────────────────────
   AlbumDatos es la ÚNICA puerta de datos de la app. Decide en tiempo
   de ejecución de dónde vienen los perfiles:

     · ALBUM_CONFIG.hayBackend === true  → Supabase (lee y escribe).
     · en otro caso                      → copia local en memoria,
                                           partiendo de la SEMILLA.

   El resto de módulos (lienzo, perfil) consumen siempre la misma API,
   así que conectar/desconectar el backend no toca ni una línea suya.
   El CRUD (crear/actualizar/eliminar) funciona en ambos modos.

   LAYOUT: grafo libre (force-directed) en espacio infinito. Crece en
   todas direcciones según id_padre / id_madre. Las parejas (id_pareja,
   ARRAY) se disponen lado a lado. Ver calcularDisposicion().

   ESQUEMA (tabla `perfiles`) — ver backend/schema.sql
   ─────────────────────────────────────────────────────────────
   id_familia · id · nombre_completo · fecha_nacimiento ·
   fecha_fallecimiento · disciplina_artistica · obra_maestra ·
   biografia · galeria(text[]) · id_padre · id_madre · id_pareja(text[])
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const TENANT_ACTIVO =
    (global.ALBUM_CONFIG && global.ALBUM_CONFIG.TENANT_POR_DEFECTO) || 'Familia_Lainez';

  /* ── Semilla real: familia fundadora "Familia_Lainez" ────────────
     Se siembran NOMBRES y RELACIONES exactos. Los campos de contenido
     (fechas, disciplina, obra, biografía, fotos) quedan en blanco a
     propósito: son personas reales y se completan con el CRUD (Editar).

     Estructura:
       Pareja 1: Julio Cesar Lainez × Maria Atanasia Otilia Alvarez Somoza
         hijos: Carlos Alfredo, Julio Cesar (hijo), Cesar Mauricio, Pepe, Lourdes
       Solo del abuelo Julio Cesar (madre externa → medios hermanos):
         Guadalupe, Iris (nombre temporal, para probar la edición)
       Pareja 2: Carlos Alfredo Lainez × Yolanda del Carmen Jimenez Benitez
         hijos: Carlos G. Lainez Jimenez, Cesar Alberto Lainez Jimenez        */
  const persona = (o) =>
    Object.assign(
      {
        id_familia: 'Familia_Lainez',
        fecha_nacimiento: null,
        fecha_fallecimiento: null,
        disciplina_artistica: '',
        obra_maestra: '',
        biografia: '',
        galeria: [],
        id_padre: null,
        id_madre: null,
        id_pareja: [],
        lugares: null, // { nacimiento|residencia|fallecimiento: {clave, detalle} } — ver lugares.js
        voces: [], // notas de voz aprobadas: [{ref, autor, fecha, duracion}] — ver aportes.js
        recuerdos: [], // recuerdos escritos aprobados: [{texto, autor, fecha}]
      },
      o
    );

  const SEMILLA = [
    /* Pareja 1 — abuelos paternos */
    persona({ id: 'julio-cesar', nombre_completo: 'Julio Cesar Lainez', id_pareja: ['maria-atanasia'] }),
    persona({ id: 'maria-atanasia', nombre_completo: 'Maria Atanasia Otilia Alvarez Somoza', id_pareja: ['julio-cesar'] }),

    /* Pareja 2 — padres del usuario (Carlos Alfredo es también hijo de Pareja 1) */
    persona({ id: 'yolanda', nombre_completo: 'Yolanda del Carmen Jimenez Benitez de Lainez', id_pareja: ['carlos-alfredo'] }),

    /* Hijos de Pareja 1 */
    persona({ id: 'carlos-alfredo', nombre_completo: 'Carlos Alfredo Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia', id_pareja: ['yolanda'] }),
    persona({ id: 'julio-cesar-hijo', nombre_completo: 'Julio Cesar Lainez (hijo)', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
    persona({ id: 'cesar-mauricio', nombre_completo: 'Cesar Mauricio Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
    persona({ id: 'pepe', nombre_completo: 'Pepe Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),
    persona({ id: 'lourdes', nombre_completo: 'Lourdes Lainez', id_padre: 'julio-cesar', id_madre: 'maria-atanasia' }),

    /* Hijas SOLO del abuelo Julio Cesar (madre externa) → medios hermanos.
       El hilo nace directo de Julio Cesar, ignorando el lazo con Maria. */
    persona({ id: 'guadalupe', nombre_completo: 'Guadalupe Lainez', id_padre: 'julio-cesar' }),
    persona({ id: 'iris', nombre_completo: 'Iris Lainez', id_padre: 'julio-cesar' }),

    /* Hijos de Pareja 2 */
    persona({ id: 'carlos-g', nombre_completo: 'Carlos G. Lainez Jimenez', id_padre: 'carlos-alfredo', id_madre: 'yolanda' }),
    persona({ id: 'cesar-alberto', nombre_completo: 'Cesar Alberto Lainez Jimenez', id_padre: 'carlos-alfredo', id_madre: 'yolanda' }),
  ];

  /* ── Persistencia local (modo sin backend) ──────────────────────
     Sin Supabase, el CRUD trabajaría solo en memoria y se perdería al
     recargar. Para que las ediciones SOBREVIVAN al refresco, guardamos
     una copia en localStorage. Cuando hay backend, esto no se usa
     (la nube es la fuente de verdad). */
  const CLAVE_LS = 'albumFamiliar:datos:v1';

  const copiaSemilla = () =>
    SEMILLA.map((p) => Object.assign({}, p, { galeria: p.galeria.slice(), id_pareja: p.id_pareja.slice() }));

  function cargarLocal() {
    try {
      const crudo = global.localStorage && localStorage.getItem(CLAVE_LS);
      if (crudo) {
        const arr = JSON.parse(crudo);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) {
      console.warn('[AlbumDatos] No se pudo leer localStorage:', e);
    }
    return null;
  }

  function guardarLocal() {
    try {
      if (global.localStorage) localStorage.setItem(CLAVE_LS, JSON.stringify(datosLocales));
    } catch (e) {
      console.warn('[AlbumDatos] No se pudo guardar en localStorage:', e);
    }
  }

  /* Copia mutable para el modo local. Arranca de lo guardado (tus ediciones)
     o, la primera vez, de la semilla. */
  let datosLocales = cargarLocal() || copiaSemilla();

  /* Disposición calculada (id -> {x, y}). Se rellena en cada dibujo. */
  let _posiciones = new Map();
  let _huella = null; // estructura del último layout calculado
  let _memo = null; // sus posiciones

  /* ── Aportes sin cuenta en modo local ───────────────────────
     Enlaces, aportes pendientes y notas de voz aprobadas, en su propia
     clave de localStorage. Es para maquetar y para las pruebas: las
     notas de voz pesan cientos de KB y localStorage da unos 5 MB. */
  const CLAVE_APORTES = 'albumFamiliar:aportes:v1';

  function almacenAportes() {
    try {
      const crudo = global.localStorage && localStorage.getItem(CLAVE_APORTES);
      const a = crudo ? JSON.parse(crudo) : null;
      if (a && typeof a === 'object') {
        return { enlaces: a.enlaces || {}, aportes: a.aportes || {}, audios: a.audios || {} };
      }
    } catch (e) {
      console.warn('[AlbumDatos] No se pudieron leer los aportes locales:', e);
    }
    return { enlaces: {}, aportes: {}, audios: {} };
  }

  function guardarAportes(a) {
    try {
      localStorage.setItem(CLAVE_APORTES, JSON.stringify(a));
    } catch (e) {
      /* Lleno: se avisa arriba, no se pierde nada a escondidas */
      throw new Error('No cabe en el almacenamiento de este navegador (' + (e && e.name) + ').');
    }
  }

  /** Token largo y aleatorio: quien lo tiene puede aportar, así que no
   *  debe poder adivinarse (24 bytes = 192 bits). */
  function tokenAleatorio() {
    const b = new Uint8Array(24);
    global.crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Lo que la nube también comprueba en sus reglas; aquí se valida antes
   *  de enviar para dar un mensaje claro en vez de un "permiso denegado". */
  const LIMITES_APORTE = { autor: 60, relacion: 40, texto: 4000, datos: 900000 };
  const MAX_USOS_ENLACE = 40; // aportes por enlace (también en las reglas)

  function validarAporte(a) {
    if (['voz', 'foto', 'recuerdo'].indexOf(a.tipo) === -1) throw new Error('Tipo de aporte desconocido.');
    if (!String(a.autor || '').trim()) throw new Error('Escribe tu nombre para que la familia sepa quién aporta.');
    if (String(a.autor).length > LIMITES_APORTE.autor) throw new Error('El nombre es demasiado largo.');
    if (String(a.relacion || '').length > LIMITES_APORTE.relacion) throw new Error('El parentesco es demasiado largo.');
    if (String(a.texto || '').length > LIMITES_APORTE.texto) throw new Error('El recuerdo pasa de 4 000 letras.');
    if (a.tipo === 'recuerdo' && !String(a.texto || '').trim()) throw new Error('Escribe el recuerdo antes de enviarlo.');
    if (a.tipo !== 'recuerdo') {
      if (!/^data:(audio|image)\//.test(String(a.datos || ''))) throw new Error('Falta la grabación o la foto.');
      if (String(a.datos).length > LIMITES_APORTE.datos) throw new Error('El archivo es demasiado pesado.');
    }
  }

  /** Forma única de un aporte, la misma en local y en la nube. */
  function filaAporte(a) {
    return {
      tipo: a.tipo,
      autor: String(a.autor || '').trim().slice(0, LIMITES_APORTE.autor),
      relacion: String(a.relacion || '').trim().slice(0, LIMITES_APORTE.relacion),
      persona_id: a.persona_id || '',
      persona_nombre: String(a.persona_nombre || '').slice(0, 120),
      texto: String(a.texto || '').trim().slice(0, LIMITES_APORTE.texto),
      datos: a.tipo === 'recuerdo' ? '' : String(a.datos || ''),
      duracion: Math.max(0, Math.round(Number(a.duracion) || 0)),
    };
  }

  const aportesLocales = {
    async crearEnlace(fid, info) {
      const a = almacenAportes();
      const token = tokenAleatorio();
      const creado = Date.now();
      const vence = creado + (info.dias || 14) * 86400000;
      a.enlaces[fid] = a.enlaces[fid] || {};
      a.enlaces[fid][token] = { etiqueta: info.etiqueta || fid, personas: info.personas || [], creado, vence, usos: 0 };
      guardarAportes(a);
      return { token, creado, vence, usos: 0 };
    },
    async listarEnlaces(fid) {
      const e = almacenAportes().enlaces[fid] || {};
      return Object.keys(e).map((token) => ({ token, creado: e[token].creado, vence: e[token].vence, usos: e[token].usos || 0 }))
        .sort((x, y) => y.creado - x.creado);
    },
    async revocarEnlace(fid, token) {
      const a = almacenAportes();
      if (a.enlaces[fid]) delete a.enlaces[fid][token];
      guardarAportes(a);
    },
    async leerEnlace(fid, token) {
      const e = (almacenAportes().enlaces[fid] || {})[token];
      if (!e || e.vence < Date.now()) return null;
      return { etiqueta: e.etiqueta, personas: e.personas || [], vence: e.vence, usos: e.usos || 0 };
    },
    async enviar(fid, token, aporte) {
      const a = almacenAportes();
      const e = (a.enlaces[fid] || {})[token];
      if (!e || e.vence < Date.now()) throw new Error('El enlace ya no es válido. Pide uno nuevo a tu familia.');
      /* Mismo tope que imponen las reglas de la nube */
      const n = (e.usos || 0) + 1;
      if (n > MAX_USOS_ENLACE) throw new Error('Este enlace ya recibió muchos aportes. Pide uno nuevo a tu familia.');
      e.usos = n;
      a.aportes[fid] = a.aportes[fid] || [];
      a.aportes[fid].push(Object.assign({}, aporte, { id: token + '_' + n, token, creado: Date.now() }));
      guardarAportes(a);
    },
    async listar(fid) {
      return (almacenAportes().aportes[fid] || []).slice().sort((x, y) => x.creado - y.creado);
    },
    async leerCarga(fid, id) {
      const x = (almacenAportes().aportes[fid] || []).find((y) => y.id === id);
      if (!x || !x.datos) throw new Error('No se encontró el archivo del aporte.');
      return x.datos;
    },
    async descartar(fid, id) {
      const a = almacenAportes();
      a.aportes[fid] = (a.aportes[fid] || []).filter((x) => x.id !== id);
      guardarAportes(a);
    },
    async guardarAudio(fid, dataUrl, idPerfil) {
      const a = almacenAportes();
      const id = nuevoId();
      a.audios[fid] = a.audios[fid] || {};
      a.audios[fid][id] = { datos: dataUrl, perfil: idPerfil || null };
      guardarAportes(a);
      return 'audio:' + id;
    },
    async leerAudio(fid, ref) {
      const v = (almacenAportes().audios[fid] || {})[String(ref).replace(/^audio:/, '')];
      if (!v) throw new Error('No se encontró la grabación.');
      return v.datos;
    },
    async borrarAudio(fid, ref) {
      const a = almacenAportes();
      if (a.audios[fid]) delete a.audios[fid][String(ref).replace(/^audio:/, '')];
      guardarAportes(a);
    },
    async borrarAudiosDe(fid, idPerfil) {
      const a = almacenAportes();
      const m = a.audios[fid] || {};
      Object.keys(m).forEach((k) => { if (m[k].perfil === idPerfil) delete m[k]; });
      guardarAportes(a);
    },
  };

  /* ── Puentes entre familias en modo local ───────────────────
     Un puente une a una persona de la familia A con una de la B. Cada
     lado lo acepta por separado; con los dos, queda «aceptado». El id es
     determinista (A siempre la familia menor) para no duplicar. */
  const CLAVE_PUENTES = 'albumFamiliar:puentes:v1';

  function almacenPuentes() {
    try {
      const crudo = global.localStorage && localStorage.getItem(CLAVE_PUENTES);
      const a = crudo ? JSON.parse(crudo) : null;
      if (a && typeof a === 'object') return a;
    } catch (e) {
      console.warn('[AlbumDatos] No se pudieron leer los puentes locales:', e);
    }
    return {};
  }

  function guardarPuentes(a) {
    try {
      localStorage.setItem(CLAVE_PUENTES, JSON.stringify(a));
    } catch (e) {
      throw new Error('No cabe en el almacenamiento de este navegador (' + (e && e.name) + ').');
    }
  }

  /** Estado que corresponde a las dos respuestas. */
  function estadoPuente(p) {
    if (p.aceptaA === false || p.aceptaB === false) return 'rechazado';
    if (p.aceptaA === true && p.aceptaB === true) return 'aceptado';
    return 'propuesto';
  }

  /** Normaliza una propuesta: A es la familia de id menor. */
  function filaPuente(x) {
    const invertir = String(x.fidA) > String(x.fidB);
    const lado = (f, p, n, acepta) => ({ fid: f, pid: p, nombre: String(n || '').slice(0, 120), acepta });
    const a = lado(x.fidA, x.pidA, x.nombreA, x.aceptaA);
    const b = lado(x.fidB, x.pidB, x.nombreB, x.aceptaB);
    const [p, q] = invertir ? [b, a] : [a, b];
    const fila = {
      fidA: p.fid, pidA: p.pid, nombreA: p.nombre, aceptaA: p.acepta === true ? true : null,
      fidB: q.fid, pidB: q.pid, nombreB: q.nombre, aceptaB: q.acepta === true ? true : null,
      puntaje: Math.round(Number(x.puntaje) || 0),
      motivos: (x.motivos || []).slice(0, 8).map((m) => String(m).slice(0, 80)),
    };
    fila.estado = estadoPuente(fila);
    return fila;
  }

  /* Cada parte se codifica: así "Peña" y "Pe_a" nunca dan el mismo id */
  const idPuente = (f) => [f.fidA, f.pidA, f.fidB, f.pidB].map((x) => encodeURIComponent(String(x))).join('|');

  const puentesLocales = {
    async listar(fid) {
      const a = almacenPuentes();
      return Object.keys(a).map((id) => Object.assign({ id }, a[id]))
        .filter((p) => p.fidA === fid || p.fidB === fid);
    },
    async proponer(id, fila) {
      const a = almacenPuentes();
      if (a[id]) return Object.assign({ id }, a[id]); // ya existía: no se reabre
      a[id] = Object.assign({}, fila, { creado: Date.now() });
      guardarPuentes(a);
      return Object.assign({ id }, a[id]);
    },
    async responder(id, lado, acepta) {
      const a = almacenPuentes();
      if (!a[id]) throw new Error('El puente ya no existe.');
      a[id]['acepta' + lado] = !!acepta;
      a[id].estado = estadoPuente(a[id]);
      guardarPuentes(a);
    },
    async retirar(id) {
      const a = almacenPuentes();
      delete a[id];
      guardarPuentes(a);
    },
  };

  /* ── Utilidades internas ─────────────────────────────────── */

  function conBackend() {
    const cfg = global.ALBUM_CONFIG || {};
    return cfg.hayBackend && global.AlbumBackend ? global.AlbumBackend : null;
  }

  function implAportes() {
    const svc = conBackend();
    return svc && svc.aportes ? svc.aportes : aportesLocales;
  }

  function implPuentes() {
    const svc = conBackend();
    return svc && svc.puentes ? svc.puentes : puentesLocales;
  }

  function nuevoId() {
    if (global.crypto && global.crypto.randomUUID) return 'n_' + global.crypto.randomUUID().slice(0, 8);
    return 'n_' + Math.random().toString(36).slice(2, 10);
  }

  /* ── API pública ─────────────────────────────────────────── */

  const AlbumDatos = {
    TENANT_ACTIVO,

    /** Aportes sin cuenta (enlaces, bandeja y notas de voz). Misma API en
     *  local y en la nube; la valida `validarAporte` antes de enviar. */
    aportes: {
      crearEnlace: (fid, info) => implAportes().crearEnlace(fid, info),
      listarEnlaces: (fid) => implAportes().listarEnlaces(fid),
      revocarEnlace: (fid, token) => implAportes().revocarEnlace(fid, token),
      leerEnlace: (fid, token) => implAportes().leerEnlace(fid, token),
      async enviar(fid, token, aporte) {
        validarAporte(aporte);
        return implAportes().enviar(fid, token, filaAporte(aporte));
      },
      listar: (fid) => implAportes().listar(fid),
      leerCarga: (fid, id) => implAportes().leerCarga(fid, id),
      descartar: (fid, id) => implAportes().descartar(fid, id),
      guardarAudio: (fid, dataUrl, idPerfil) => implAportes().guardarAudio(fid, dataUrl, idPerfil),
      leerAudio: (fid, ref) => implAportes().leerAudio(fid, ref),
      borrarAudio: (fid, ref) => implAportes().borrarAudio(fid, ref),
    },

    /** Puentes con otras familias (ver puentes.js). */
    puentes: {
      listar: (fid) => implPuentes().listar(fid),
      proponer(propuesta) {
        const fila = filaPuente(propuesta);
        return implPuentes().proponer(idPuente(fila), fila);
      },
      responder: (id, lado, acepta) => implPuentes().responder(id, lado, acepta),
      retirar: (id) => implPuentes().retirar(id),
      id: (propuesta) => idPuente(filaPuente(propuesta)),
    },

    /** Origen único de perfiles. Backend si está configurado; si falla o no
     *  lo está, cae a la copia local para no dejar el lienzo vacío. */
    async obtenerPerfiles(idFamilia = TENANT_ACTIVO) {
      const svc = conBackend();
      if (svc) {
        /* Con backend configurado, la nube es la ÚNICA verdad: si viene
           vacía o falla, se muestra vacío. Caer a la semilla local aquí
           enseñaría datos ficticios como si fueran reales (p. ej. a un
           visitante sin clave si el RLS no le deja leer). */
        return await svc.obtenerPerfiles(idFamilia);
      }
      return datosLocales.filter((p) => p.id_familia === idFamilia);
    },

    /* ── CRUD ──────────────────────────────────────────────── */

    /** Crea un perfil (rellena valores por defecto). Devuelve el creado. */
    async crear(parcial) {
      const completo = persona(
        Object.assign({ id: nuevoId(), nombre_completo: 'Nuevo perfil' }, parcial)
      );
      const svc = conBackend();
      if (svc) return await svc.crear(completo);
      datosLocales.push(completo);
      guardarLocal();
      return completo;
    },

    /** Actualiza campos de un perfil. */
    async actualizar(idFamilia, id, cambios) {
      const svc = conBackend();
      if (svc) return await svc.actualizar(idFamilia, id, cambios);
      const p = datosLocales.find((x) => x.id === id && x.id_familia === idFamilia);
      if (p) Object.assign(p, cambios);
      guardarLocal();
    },

    /** Añade un elemento a una lista del perfil (voces, recuerdos) sin
     *  reescribir la lista entera: dos personas aprobando a la vez no se
     *  pisan. En la nube es un arrayUnion. */
    async agregarALista(idFamilia, id, campo, item) {
      const svc = conBackend();
      if (svc) return await svc.agregarALista(idFamilia, id, campo, item);
      const p = datosLocales.find((x) => x.id === id && x.id_familia === idFamilia);
      if (!p) throw new Error('Esa persona ya no está en el árbol.');
      p[campo] = (Array.isArray(p[campo]) ? p[campo] : []).concat([item]);
      guardarLocal();
    },

    /** Quita ese elemento exacto (no "el de tal posición"). */
    async quitarDeLista(idFamilia, id, campo, item) {
      const svc = conBackend();
      if (svc) return await svc.quitarDeLista(idFamilia, id, campo, item);
      const p = datosLocales.find((x) => x.id === id && x.id_familia === idFamilia);
      if (!p) return;
      const clave = JSON.stringify(item);
      p[campo] = (Array.isArray(p[campo]) ? p[campo] : []).filter((x) => JSON.stringify(x) !== clave);
      guardarLocal();
    },

    /** Elimina un perfil y limpia las referencias que otros le hacían. */
    async eliminar(idFamilia, id) {
      /* Sus puentes con otras familias dejan de tener sentido */
      try {
        const propios = (await implPuentes().listar(idFamilia))
          .filter((p) => (p.fidA === idFamilia && p.pidA === id) || (p.fidB === idFamilia && p.pidB === id));
        for (const p of propios) await implPuentes().retirar(p.id);
      } catch (e) {
        console.warn('[AlbumDatos] No se pudieron retirar sus puentes:', e);
      }
      const svc = conBackend();
      if (svc) return await svc.eliminar(idFamilia, id);
      try {
        await aportesLocales.borrarAudiosDe(idFamilia, id);
      } catch (e) {
        console.warn('[AlbumDatos] No se pudieron borrar sus grabaciones locales:', e);
      }
      datosLocales = datosLocales.filter((x) => !(x.id === id && x.id_familia === idFamilia));
      for (const p of datosLocales) {
        if (p.id_padre === id) p.id_padre = null;
        if (p.id_madre === id) p.id_madre = null;
        if (Array.isArray(p.id_pareja)) p.id_pareja = p.id_pareja.filter((q) => q !== id);
      }
      guardarLocal();
    },

    /** Reinicia los datos locales a la semilla original (borra lo guardado
     *  en localStorage). Útil para empezar de cero en modo sin backend. */
    reiniciarLocal() {
      try {
        if (global.localStorage) localStorage.removeItem(CLAVE_LS);
      } catch (e) {}
      datosLocales = copiaSemilla();
    },

    /** Reescribe una familia completa a partir de una copia de seguridad.
     *  No borra a nadie: actualiza los perfiles que ya existen y crea los
     *  que faltan. Va en dos pasadas porque padre/madre son claves foráneas
     *  y una fila no puede apuntar a otra que aún no se ha insertado. */
    async reemplazarFamilia(idFamilia, perfiles) {
      const completos = perfiles.map((p) =>
        persona(Object.assign({}, p, { id_familia: idFamilia }))
      );
      const svc = conBackend();

      if (svc) {
        const sinLazos = completos.map((p) =>
          Object.assign({}, p, { id_padre: null, id_madre: null, id_pareja: [] })
        );
        await svc.guardarVarios(sinLazos); // 1) todas las personas
        await svc.guardarVarios(completos); // 2) ya con sus relaciones
        return completos.length;
      }

      const ajenos = datosLocales.filter((x) => x.id_familia !== idFamilia);
      datosLocales = ajenos.concat(completos);
      guardarLocal();
      return completos.length;
    },

    /** Lista los id_familia que ya existen en el sistema (para autocompletar).
     *  Local: familias con al menos un perfil. Backend: delega en el servicio. */
    async listarFamilias() {
      const svc = conBackend();
      if (svc && svc.listarFamilias) {
        try {
          const fams = await svc.listarFamilias();
          if (fams && fams.length) return fams;
        } catch (e) {
          console.error('[AlbumDatos] Error listando familias en el backend.', e);
        }
      }
      const set = new Set(datosLocales.map((p) => p.id_familia));
      set.add(TENANT_ACTIVO); // el tenant por defecto siempre aparece
      return [...set].sort();
    },

    /** Familias con su resumen (apellidos, lugares, cuántos son), para
     *  buscarlas sin leer a sus personas: [{ id, resumen }].
     *  Local: se calcula al vuelo. Nube: lo guardado en cada familia. */
    async listarResumenes() {
      const svc = conBackend();
      if (svc && svc.listarResumenes) return await svc.listarResumenes();
      const ids = [...new Set(datosLocales.map((p) => p.id_familia))].sort();
      return ids.map((id) => ({
        id,
        resumen: global.AlbumLugares
          ? AlbumLugares.resumirFamilia(datosLocales.filter((p) => p.id_familia === id))
          : null,
      }));
    },

    /** Guarda el resumen de una familia (solo con sesión, en la nube). */
    async guardarResumen(idFamilia, resumen) {
      const svc = conBackend();
      if (svc && svc.guardarResumen) await svc.guardarResumen(idFamilia, resumen);
    },

    /** ¿Se puede persistir en este entorno? En backend, siempre. En local,
     *  depende de que localStorage funcione (falla en file:// o si está
     *  bloqueado). Sirve para avisar al usuario. */
    puedePersistir() {
      if (conBackend()) return true;
      try {
        const k = '__album_probe__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch (e) {
        return false;
      }
    },

    /* ── CRUD: altas rápidas de relación ───────────────────── */

    /** Crea una pareja del nodo base y enlaza en ambos sentidos. */
    async agregarPareja(base) {
      const nuevo = await this.crear({
        id_familia: base.id_familia,
        id_pareja: [base.id],
        nombre_completo: 'Nueva pareja',
      });
      const parejas = Array.isArray(base.id_pareja) ? base.id_pareja.slice() : [];
      parejas.push(nuevo.id);
      await this.actualizar(base.id_familia, base.id, { id_pareja: parejas });
      return nuevo;
    },

    /** Crea un hijo del nodo base. Si base tiene pareja, el hijo cuelga de
     *  ambos (descendencia conjunta); si no, solo del base. */
    async agregarHijo(base) {
      const otro = Array.isArray(base.id_pareja) && base.id_pareja[0] ? base.id_pareja[0] : null;
      return await this.crear({
        id_familia: base.id_familia,
        id_padre: base.id,
        id_madre: otro,
        nombre_completo: 'Nuevo hijo/a',
      });
    },

    /** Crea un progenitor del nodo base en el primer hueco libre
     *  (id_padre, luego id_madre). Devuelve null si ya tiene ambos. */
    async agregarProgenitor(base) {
      let hueco = null;
      if (!base.id_padre) hueco = 'id_padre';
      else if (!base.id_madre) hueco = 'id_madre';
      if (!hueco) return null;
      const nuevo = await this.crear({ id_familia: base.id_familia, nombre_completo: 'Nuevo padre/madre' });
      const cambios = {};
      cambios[hueco] = nuevo.id;
      await this.actualizar(base.id_familia, base.id, cambios);
      return nuevo;
    },

    /* ── Layout de grafo libre (force-directed) ────────────── */

    calcularDisposicion(entrada) {
      /* Orden canónico por id: la física depende del orden de entrada, y
         ese orden venía de la consulta (por fecha de nacimiento). Poner una
         fecha a una sola persona reacomodaba hasta 60 de 62 tarjetas. Así,
         solo un cambio de ESTRUCTURA (personas o lazos) mueve el árbol. */
      const perfiles = (entrada || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      /* Misma estructura → mismas posiciones: editar un nombre, una fecha o
         una foto no vuelve a correr la simulación. */
      const huella = perfiles
        .map((p) => p.id + '|' + (p.id_padre || '') + '|' + (p.id_madre || '') + '|' +
          (Array.isArray(p.id_pareja) ? p.id_pareja.slice().sort().join(',') : ''))
        .join(';');
      if (huella === _huella && _memo) {
        _posiciones = _memo;
        return _memo;
      }

      const N = perfiles.length;
      const pos = new Map();
      if (N === 0) {
        _posiciones = pos;
        return pos;
      }

      const LARGO_IDEAL = 480;
      const K_RESORTE = 0.035;
      const K_REPULSION = 420000;
      const K_CENTRO = 0.004;
      const AMORTIGUA = 0.86;
      const ITERACIONES = 900;
      const COUPLE_GAP = 300; // separación centro-a-centro de una pareja
      const ALTURA_NIVEL = 380; // separación vertical entre generaciones
      const K_NIVEL = 0.07; // fuerza que ordena por generación (arriba = raíz)

      const idx = new Map(perfiles.map((p, i) => [p.id, i]));
      const px = new Float64Array(N);
      const py = new Float64Array(N);
      const vx = new Float64Array(N);
      const vy = new Float64Array(N);

      /* Bloques horizontales = parejas ∪ co-padres (índices, a = izquierda).
         Deben quedar lado a lado y al mismo eje Y.

         Partición para ser robustos si un nodo pertenece a varios bloques
         (p. ej. hijos con dos parejas distintas): los bloques DISJUNTOS se
         alinean de forma EXACTA (snap rígido); los que comparten un nodo ya
         usado se atraen con un resorte fuerte + alineación de Y (blandos),
         degradando con elegancia en vez de oscilar. */
      const bloques = this._bloquesHorizontales(perfiles)
        .map((c) => [idx.get(c.a), idx.get(c.b)])
        .filter(([a, b]) => a != null && b != null);

      const usado = new Set();
      const rigidos = [];
      const blandos = [];
      for (const [a, b] of bloques) {
        if (!usado.has(a) && !usado.has(b)) {
          rigidos.push([a, b]);
          usado.add(a);
          usado.add(b);
        } else {
          blandos.push([a, b]);
        }
      }
      /* Ningún par del bloque se repele: deben poder tocarse. */
      /* Matriz N×N en vez de un Set de claves de texto: la comprobación
         está en el bucle interno de la repulsión (N²/2 × 900 veces) y
         construir el string 'i_j' en cada vuelta se llevaba el 64 % del
         tiempo del layout. Misma semántica exacta: solo la celda [a][b]. */
      const sinRepulsion = new Uint8Array(N * N);
      for (const [a, b] of bloques) sinRepulsion[a * N + b] = 1;
      const K_BLOQUE = 0.22; // atracción fuerte para los bloques blandos

      /* Colocación inicial en espiral áurea (determinista, sin azar). */
      const AUREO = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const a = i * AUREO;
        const r = 70 * Math.sqrt(i + 1);
        px[i] = Math.cos(a) * r;
        py[i] = Math.sin(a) * r;
      }

      /* Aristas de parentesco (no dirigidas para la física) */
      const aristas = [];
      perfiles.forEach((p, i) => {
        for (const pid of [p.id_padre, p.id_madre]) {
          if (pid && idx.has(pid)) aristas.push([idx.get(pid), i]);
        }
      });

      /* GENERACIONES a prueba de datos imperfectos:
         1) los miembros de un bloque (pareja/co-padres) se funden en un
            GRUPO que comparte nivel (union-find);
         2) el nivel de cada grupo es el camino más largo desde las raíces
            (DFS memoizado);
         3) las aristas CONTRADICTORIAS se ignoran para el nivel: si alguien
            quedó como padre de su propia pareja (error de captura) o hay un
            ciclo entre grupos, esa arista no cuenta — antes, este caso hacía
            oscilar la relajación y el árbol explotaba a miles de píxeles. */
      const raizUF = Array.from({ length: N }, (_, i) => i);
      const find = (i) => {
        while (raizUF[i] !== i) { raizUF[i] = raizUF[raizUF[i]]; i = raizUF[i]; }
        return i;
      };
      for (const [a, b] of bloques) {
        const ra = find(a), rb = find(b);
        if (ra !== rb) raizUF[ra] = rb;
      }

      /* aristas padre→hijo entre grupos; las intra-grupo se descartan */
      const padresDeGrupo = new Map();
      for (const [p, c] of aristas) {
        const gp = find(p), gc = find(c);
        if (gp === gc) continue; // contradicción: p e hijo comparten grupo
        if (!padresDeGrupo.has(gc)) padresDeGrupo.set(gc, new Set());
        padresDeGrupo.get(gc).add(gp);
      }

      const nivelGrupo = new Map();
      const enPila = new Set();
      const nivelDe = (g) => {
        if (nivelGrupo.has(g)) return nivelGrupo.get(g);
        if (enPila.has(g)) return 0; // ciclo entre grupos: se corta aquí
        enPila.add(g);
        let n = 0;
        const padres = padresDeGrupo.get(g);
        if (padres) for (const gp of padres) n = Math.max(n, nivelDe(gp) + 1);
        enPila.delete(g);
        nivelGrupo.set(g, n);
        return n;
      };
      const nivel = new Array(N);
      for (let i = 0; i < N; i++) nivel[i] = nivelDe(find(i));
      let maxNivel = 0;
      for (let i = 0; i < N; i++) if (nivel[i] > maxNivel) maxNivel = nivel[i];
      /* Y objetivo de cada nivel, centrado en el origen (nivel 0 = arriba). */
      const objetivoY = (i) => (nivel[i] - maxNivel / 2) * ALTURA_NIVEL;

      for (let paso = 0; paso < ITERACIONES; paso++) {
        const enfriado = 1 - paso / ITERACIONES;

        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            if (sinRepulsion[i * N + j]) continue;
            let dx = px[i] - px[j];
            let dy = py[i] - py[j];
            let d2 = dx * dx + dy * dy || 0.01;
            let d = Math.sqrt(d2);
            const f = K_REPULSION / d2;
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            vx[i] += fx; vy[i] += fy;
            vx[j] -= fx; vy[j] -= fy;
          }
        }

        for (const [a, b] of aristas) {
          let dx = px[b] - px[a];
          let dy = py[b] - py[a];
          let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = K_RESORTE * (d - LARGO_IDEAL);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          vx[a] += fx; vy[a] += fy;
          vx[b] -= fx; vy[b] -= fy;
        }

        /* Bloques blandos: resorte fuerte a COUPLE_GAP + igualar la Y. */
        for (const [a, b] of blandos) {
          let dx = px[b] - px[a];
          let dy = py[b] - py[a];
          let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = K_BLOQUE * (d - COUPLE_GAP);
          vx[a] += (dx / d) * f; vy[a] += (dy / d) * f;
          vx[b] -= (dx / d) * f; vy[b] -= (dy / d) * f;
          const ay = (py[a] + py[b]) / 2;
          vy[a] += (ay - py[a]) * K_BLOQUE;
          vy[b] += (ay - py[b]) * K_BLOQUE;
        }

        for (let i = 0; i < N; i++) {
          /* Centrado solo HORIZONTAL (que el árbol no derive de lado). */
          vx[i] -= px[i] * K_CENTRO;
          /* Vertical: cada quien busca la altura de su generación. */
          vy[i] += (objetivoY(i) - py[i]) * K_NIVEL;
          vx[i] *= AMORTIGUA;
          vy[i] *= AMORTIGUA;
          px[i] += vx[i] * enfriado;
          py[i] += vy[i] * enfriado;
        }

        /* Snap rígido de bloques disjuntos: lado a lado, misma Y, COUPLE_GAP.
           El punto medio conserva todas las fuerzas (hijos, terceros), así que
           el bloque se traslada como una unidad pero no rota ni se estira. */
        for (const [a, b] of rigidos) {
          const cx = (px[a] + px[b]) / 2;
          const cy = (py[a] + py[b]) / 2;
          px[a] = cx - COUPLE_GAP / 2; py[a] = cy;
          px[b] = cx + COUPLE_GAP / 2; py[b] = cy;
          const avx = (vx[a] + vx[b]) / 2;
          const avy = (vy[a] + vy[b]) / 2;
          vx[a] = vx[b] = avx;
          vy[a] = vy[b] = avy;
        }
      }

      /* ── ORDEN FINAL GARANTIZADO ──────────────────────────────
         1) Cada persona se ANCLA exactamente a la banda de su
            generación: la gravedad de nivel es blanda y los resortes
            podían comprimir las filas hasta encimar tarjetas de
            niveles vecinos o incluso invertir padre/hijo. Con el
            anclaje, las generaciones quedan en filas limpias a 380px
            y eso es imposible.
         2) Dentro de cada fila, separación horizontal hasta que
            ninguna tarjeta (foto + etiqueta) toque a otra. */
      for (let i = 0; i < N; i++) py[i] = objetivoY(i);

      /* Con las filas ancladas (380px > alto de tarjeta+pie), los choques
         solo pueden ocurrir DENTRO de una fila. Se resuelven con un
         empaquetado exacto en 1-D: cada fila se ordena por x, se barre de
         izquierda a derecha imponiendo la separación mínima (las parejas
         rígidas viajan como una sola unidad) y se recentra para conservar
         su posición media. Exacto y sin oscilaciones. */
      const SEP_W = 235; // 168 de tarjeta + etiqueta de 210 + aire
      const compa = new Array(N).fill(-1);
      for (const [a, b] of rigidos) { compa[a] = b; compa[b] = a; }

      const unidadesPorFila = new Map();
      const hecho = new Set();
      for (let i = 0; i < N; i++) {
        if (hecho.has(i)) continue;
        const c = compa[i];
        let unidad;
        if (c >= 0) {
          hecho.add(i); hecho.add(c);
          unidad = { miembros: [i, c], cx: (px[i] + px[c]) / 2, mitad: COUPLE_GAP / 2 + SEP_W / 2 };
        } else {
          hecho.add(i);
          unidad = { miembros: [i], cx: px[i], mitad: SEP_W / 2 };
        }
        const fila = nivel[i];
        if (!unidadesPorFila.has(fila)) unidadesPorFila.set(fila, []);
        unidadesPorFila.get(fila).push(unidad);
      }

      /* Filas de arriba hacia abajo: cada unidad busca colocarse BAJO el
         origen de su hilo (baricentro de sus padres, ya empacados en la
         fila superior). Con eso los hilos caen casi verticales y los
         cruces se minimizan — p. ej., dos primos ya no se dibujan
         intercambiados respecto a sus padres. Quien no tiene padres en
         el árbol conserva su posición de la física. */
      const filasOrdenadas = [...unidadesPorFila.keys()].sort((a, b) => a - b);
      for (const claveFila of filasOrdenadas) {
        const fila = unidadesPorFila.get(claveFila);

        for (const u of fila) {
          u.fx = u.cx; // posición de la física, como desempate
          let suma = 0, cuenta = 0;
          for (const m of u.miembros) {
            const per = perfiles[m];
            const xs = [];
            if (per.id_padre && idx.has(per.id_padre)) xs.push(px[idx.get(per.id_padre)]);
            if (per.id_madre && idx.has(per.id_madre)) xs.push(px[idx.get(per.id_madre)]);
            if (xs.length) {
              suma += xs.reduce((s, v) => s + v, 0) / xs.length;
              cuenta++;
            }
          }
          if (cuenta) u.cx = suma / cuenta;
        }

        fila.sort((u, v) => (u.cx - v.cx) || (u.fx - v.fx));
        const mediaAntes = fila.reduce((s, u) => s + u.cx, 0) / fila.length;
        for (let k = 1; k < fila.length; k++) {
          const minimo = fila[k - 1].cx + fila[k - 1].mitad + fila[k].mitad;
          if (fila[k].cx < minimo) fila[k].cx = minimo;
        }
        const mediaDespues = fila.reduce((s, u) => s + u.cx, 0) / fila.length;
        const correccion = mediaAntes - mediaDespues;
        for (const u of fila) {
          u.cx += correccion;
          if (u.miembros.length === 2) {
            const [a, b] = u.miembros;
            const izq = px[a] <= px[b] ? a : b;
            const der = izq === a ? b : a;
            px[izq] = u.cx - COUPLE_GAP / 2;
            px[der] = u.cx + COUPLE_GAP / 2;
          } else {
            px[u.miembros[0]] = u.cx;
          }
        }
      }

      perfiles.forEach((p, i) => pos.set(p.id, { x: px[i], y: py[i] }));
      _posiciones = pos;
      _huella = huella;
      _memo = pos;
      return pos;
    },

    posicionDe(id) {
      return _posiciones.get(id) || { x: 0, y: 0 };
    },

    /* ── Presentación ──────────────────────────────────────── */

    formatearFechas(perfil) {
      const anio = (f) => (f ? String(f).slice(0, 4) : null);
      const n = anio(perfil.fecha_nacimiento);
      const d = anio(perfil.fecha_fallecimiento);
      if (n && d) return `${n} — ${d}`;
      if (n) return n;
      return '';
    },

    /** Iniciales para el marcador de posición cuando no hay fotografía. */
    iniciales(nombre) {
      const palabras = (nombre || '?').trim().split(/\s+/).filter(Boolean);
      const a = palabras[0] ? palabras[0][0] : '?';
      const b = palabras.length > 1 ? palabras[palabras.length - 1][0] : '';
      return (a + b).toUpperCase();
    },

    /* ── Relaciones para dibujar ───────────────────────────── */

    /** Parejas presentes, sin duplicar y con orden estable (a = izquierda).
     *  id_pareja puede ser array o valor suelto. */
    _parejas(perfiles) {
      const idx = new Map(perfiles.map((p, i) => [p.id, i]));
      const vistos = new Set();
      const parejas = [];
      for (const p of perfiles) {
        const lista = Array.isArray(p.id_pareja)
          ? p.id_pareja
          : p.id_pareja
          ? [p.id_pareja]
          : [];
        for (const q of lista) {
          if (!idx.has(q) || q === p.id) continue;
          const clave = [p.id, q].sort().join('::');
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          const i = idx.get(p.id);
          const j = idx.get(q);
          parejas.push(i < j ? { a: p.id, b: q } : { a: q, b: p.id });
        }
      }
      return parejas;
    },

    /** BLOQUES HORIZONTALES: pares que la física debe alinear al mismo eje Y,
     *  uno junto al otro. Es la UNIÓN de dos relaciones:
     *    · id_pareja  — cónyuges/parejas (relación actual o pasada), y
     *    · co-padres  — dos nodos que figuran como id_padre e id_madre de un
     *                   mismo hijo (aunque su relación no esté en id_pareja).
     *  Deduplicado y con orden estable (a = índice menor → izquierda). */
    _bloquesHorizontales(perfiles) {
      const idx = new Map(perfiles.map((p, i) => [p.id, i]));
      const vistos = new Set();
      const bloques = [];
      const agregar = (x, y) => {
        if (!idx.has(x) || !idx.has(y) || x === y) return;
        const clave = [x, y].sort().join('::');
        if (vistos.has(clave)) return;
        vistos.add(clave);
        const i = idx.get(x);
        const j = idx.get(y);
        bloques.push(i < j ? { a: x, b: y } : { a: y, b: x });
      };

      for (const p of perfiles) {
        const lista = Array.isArray(p.id_pareja)
          ? p.id_pareja
          : p.id_pareja
          ? [p.id_pareja]
          : [];
        for (const q of lista) agregar(p.id, q); // parejas
        if (p.id_padre && p.id_madre) agregar(p.id_padre, p.id_madre); // co-padres
      }
      return bloques;
    },

    /** Ancestros de una persona (por id_padre / id_madre), como Set de ids. */
    ancestrosDe(perfiles, id) {
      const porId = new Map(perfiles.map((p) => [p.id, p]));
      const ids = new Set();
      const pila = [id];
      while (pila.length) {
        const p = porId.get(pila.pop());
        if (!p) continue;
        for (const prog of [p.id_padre, p.id_madre]) {
          if (prog && porId.has(prog) && !ids.has(prog)) {
            ids.add(prog);
            pila.push(prog);
          }
        }
      }
      return ids;
    },

    /** Descendientes de una persona (todos los niveles), como Set de ids. */
    descendientesDe(perfiles, id) {
      const ids = new Set([id]);
      let cambio = true;
      while (cambio) {
        cambio = false;
        for (const p of perfiles) {
          if (ids.has(p.id)) continue;
          if ((p.id_padre && ids.has(p.id_padre)) || (p.id_madre && ids.has(p.id_madre))) {
            ids.add(p.id);
            cambio = true;
          }
        }
      }
      ids.delete(id);
      return ids;
    },

    /** La "rama" de una persona: su línea directa hacia arriba (ancestros),
     *  su descendencia completa hacia abajo, y las parejas de todos ellos.
     *  NO incluye hermanos de los ancestros (tíos) ni la familia política
     *  de las parejas: es el hilo propio de esa persona. */
    calcularRama(perfiles, id) {
      const porId = new Map(perfiles.map((p) => [p.id, p]));
      const ids = new Set();
      if (!porId.has(id)) return ids;
      ids.add(id);

      /* ancestros: subir por id_padre / id_madre */
      const porSubir = [id];
      while (porSubir.length) {
        const p = porId.get(porSubir.pop());
        if (!p) continue;
        for (const prog of [p.id_padre, p.id_madre]) {
          if (prog && porId.has(prog) && !ids.has(prog)) {
            ids.add(prog);
            porSubir.push(prog);
          }
        }
      }

      /* descendientes: SOLO desde la persona hacia abajo (no de los
         ancestros, para no arrastrar tíos y primos) */
      const desc = new Set([id]);
      let cambio = true;
      while (cambio) {
        cambio = false;
        for (const p of perfiles) {
          if (desc.has(p.id)) continue;
          if ((p.id_padre && desc.has(p.id_padre)) || (p.id_madre && desc.has(p.id_madre))) {
            desc.add(p.id);
            cambio = true;
          }
        }
      }
      desc.forEach((d) => ids.add(d));

      /* parejas de cada miembro (para que las parejas se vean junto a ellos) */
      for (const mid of [...ids]) {
        const p = porId.get(mid);
        if (p && Array.isArray(p.id_pareja)) {
          for (const q of p.id_pareja) if (porId.has(q)) ids.add(q);
        }
      }
      return ids;
    },

    /** Relaciones a dibujar:
     *  · parejas     — lazo romántico (id_pareja): línea punteada + nudo.
     *  · filiaciones — descendencia:
     *      'conjunta' si el hijo tiene AMBOS progenitores presentes (co-padres)
     *                 → el hilo nace del punto medio EXACTO entre ambos.
     *      'simple'   si solo comparte un progenitor presente (el otro es
     *                 externo/ausente) → el hilo nace directo de ese progenitor.
     *                 Este es el caso de los MEDIOS HERMANOS. */
    calcularRelaciones(perfiles) {
      const parejas = this._parejas(perfiles);
      const presente = new Set(perfiles.map((p) => p.id));
      const filiaciones = [];

      for (const p of perfiles) {
        const padre = p.id_padre && presente.has(p.id_padre) ? p.id_padre : null;
        const madre = p.id_madre && presente.has(p.id_madre) ? p.id_madre : null;

        if (padre && madre) {
          filiaciones.push({ tipo: 'conjunta', padres: [padre, madre], hijo: p.id });
        } else {
          if (padre) filiaciones.push({ tipo: 'simple', progenitor: padre, hijo: p.id });
          if (madre) filiaciones.push({ tipo: 'simple', progenitor: madre, hijo: p.id });
        }
      }
      return { parejas, filiaciones };
    },
  };

  global.AlbumDatos = AlbumDatos;
})(window);
