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
     una copia en localStorage. Cuando se conecta Supabase, esto no se usa
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

  /* ── Utilidades internas ─────────────────────────────────── */

  function conBackend() {
    const cfg = global.ALBUM_CONFIG || {};
    return cfg.hayBackend && global.SupabaseServicio ? global.SupabaseServicio : null;
  }

  function nuevoId() {
    if (global.crypto && global.crypto.randomUUID) return 'n_' + global.crypto.randomUUID().slice(0, 8);
    return 'n_' + Math.random().toString(36).slice(2, 10);
  }

  /* ── API pública ─────────────────────────────────────────── */

  const AlbumDatos = {
    TENANT_ACTIVO,

    /** Origen único de perfiles. Backend si está configurado; si falla o no
     *  lo está, cae a la copia local para no dejar el lienzo vacío. */
    async obtenerPerfiles(idFamilia = TENANT_ACTIVO) {
      const svc = conBackend();
      if (svc) {
        /* Con backend configurado, la nube es la ÚNICA verdad: si viene
           vacía o falla, se muestra vacío. Caer a la semilla local aquí
           enseñaría datos ficticios como si fueran reales (p. ej. a un
           visitante sin clave si el RLS no le deja leer). */
        try {
          return await svc.obtenerPerfiles(idFamilia);
        } catch (e) {
          console.error('[AlbumDatos] Error consultando Supabase.', e);
          return [];
        }
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

    /** Elimina un perfil y limpia las referencias que otros le hacían. */
    async eliminar(idFamilia, id) {
      const svc = conBackend();
      if (svc) return await svc.eliminar(idFamilia, id);
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

    /** Lista los id_familia que ya existen en el sistema (para autocompletar).
     *  Local: familias con al menos un perfil. Backend: delega en el servicio. */
    async listarFamilias() {
      const svc = conBackend();
      if (svc && svc.listarFamilias) {
        try {
          const fams = await svc.listarFamilias();
          if (fams && fams.length) return fams;
        } catch (e) {
          console.error('[AlbumDatos] Error listando familias en Supabase.', e);
        }
      }
      const set = new Set(datosLocales.map((p) => p.id_familia));
      set.add(TENANT_ACTIVO); // el tenant por defecto siempre aparece
      return [...set].sort();
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

    calcularDisposicion(perfiles) {
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
      const sinRepulsion = new Set(bloques.map(([a, b]) => a + '_' + b));
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

      /* GENERACIONES: los fundadores (sin padres) quedan arriba y cada
         descendiente baja un nivel. Relajación: hijo = padre + 1, y los
         miembros de un bloque (pareja/co-padres) comparten nivel — así el
         cónyuge "que se casó" no queda a la altura de los fundadores. */
      const nivel = new Array(N).fill(0);
      for (let it = 0; it < N; it++) {
        let cambio = false;
        for (const [p, c] of aristas) {
          if (nivel[c] < nivel[p] + 1) { nivel[c] = nivel[p] + 1; cambio = true; }
        }
        for (const [a, b] of bloques) {
          const m = Math.max(nivel[a], nivel[b]);
          if (nivel[a] !== m || nivel[b] !== m) { nivel[a] = nivel[b] = m; cambio = true; }
        }
        if (!cambio) break;
      }
      let maxNivel = 0;
      for (let i = 0; i < N; i++) if (nivel[i] > maxNivel) maxNivel = nivel[i];
      /* Y objetivo de cada nivel, centrado en el origen (nivel 0 = arriba). */
      const objetivoY = (i) => (nivel[i] - maxNivel / 2) * ALTURA_NIVEL;

      for (let paso = 0; paso < ITERACIONES; paso++) {
        const enfriado = 1 - paso / ITERACIONES;

        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            if (sinRepulsion.has(i + '_' + j)) continue;
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

      perfiles.forEach((p, i) => pos.set(p.id, { x: px[i], y: py[i] }));
      _posiciones = pos;
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
