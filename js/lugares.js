/* ══════════════════════════════════════════════════════════════
   LUGARES — Catálogo, fonética y búsqueda (Atlas de raíces)
   ──────────────────────────────────────────────────────────────
   Cada persona puede tener tres lugares: dónde nació, dónde vive o
   vivió, y dónde falleció. Se guardan en el perfil así:

     lugares: {
       nacimiento:   { clave: 'SV-CH-N', detalle: 'cantón El Carrizal' },
       residencia:   { clave: 'US-LA',   detalle: '' },
       fallecimiento:{ clave: '',        detalle: '' },
     }

   La `clave` sale de este catálogo (departamento → municipio de la
   reorganización de 2024, más las ciudades de la diáspora); el
   `detalle` es texto libre para lo que el catálogo no alcanza: el
   distrito (los 262 municipios de antes), el cantón o el caserío.

   Las coordenadas son aproximadas (centro del departamento o de la
   ciudad): sirven para el mapa, no para navegar.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /* ── El Salvador: 14 departamentos y sus 44 municipios (2024) ── */
  const DEPARTAMENTOS = [
    ['AH', 'Ahuachapán', 13.92, -89.85, ['Norte', 'Centro', 'Sur']],
    ['SA', 'Santa Ana', 14.08, -89.52, ['Norte', 'Centro', 'Este', 'Oeste']],
    ['SO', 'Sonsonate', 13.70, -89.72, ['Norte', 'Centro', 'Este', 'Oeste']],
    ['CH', 'Chalatenango', 14.12, -89.00, ['Norte', 'Centro', 'Sur']],
    ['LI', 'La Libertad', 13.62, -89.37, ['Norte', 'Centro', 'Oeste', 'Este', 'Costa', 'Sur']],
    ['SS', 'San Salvador', 13.74, -89.18, ['Norte', 'Oeste', 'Este', 'Centro', 'Sur']],
    ['CU', 'Cuscatlán', 13.85, -88.95, ['Norte', 'Sur']],
    ['PA', 'La Paz', 13.50, -88.97, ['Oeste', 'Centro', 'Este']],
    ['CA', 'Cabañas', 13.87, -88.73, ['Este', 'Oeste']],
    ['SV', 'San Vicente', 13.60, -88.72, ['Norte', 'Sur']],
    ['US', 'Usulután', 13.43, -88.45, ['Norte', 'Este', 'Oeste']],
    ['SM', 'San Miguel', 13.50, -88.20, ['Norte', 'Centro', 'Oeste']],
    ['MO', 'Morazán', 13.78, -88.12, ['Norte', 'Sur']],
    ['UN', 'La Unión', 13.45, -87.88, ['Norte', 'Sur']],
  ];

  /* ── La diáspora y los vecinos ──────────────────────────────── */
  const MUNDO = [
    ['Estados Unidos', [
      ['US-LA', 'Los Ángeles', 34.05, -118.24],
      ['US-SF', 'San Francisco', 37.77, -122.42],
      ['US-HO', 'Houston', 29.76, -95.37],
      ['US-DA', 'Dallas', 32.78, -96.80],
      ['US-DC', 'Washington D. C.', 38.90, -77.04],
      ['US-NY', 'Nueva York', 40.71, -74.01],
      ['US-LI', 'Long Island', 40.79, -73.13],
      ['US-BO', 'Boston', 42.36, -71.06],
      ['US-MI', 'Miami', 25.76, -80.19],
      ['US-CH', 'Charlotte', 35.23, -80.84],
      ['US-AT', 'Atlanta', 33.75, -84.39],
      ['US-LV', 'Las Vegas', 36.17, -115.14],
      ['US-XX', 'Otro lugar de Estados Unidos', 39.5, -98.35],
    ]],
    ['Canadá', [
      ['CA-TO', 'Toronto', 43.65, -79.38],
      ['CA-MO', 'Montreal', 45.50, -73.57],
      ['CA-VA', 'Vancouver', 49.28, -123.12],
    ]],
    ['México y Centroamérica', [
      ['MX-CM', 'Ciudad de México', 19.43, -99.13],
      ['GT-GU', 'Ciudad de Guatemala', 14.63, -90.51],
      ['HN-TE', 'Tegucigalpa', 14.07, -87.19],
      ['HN-SP', 'San Pedro Sula', 15.50, -88.03],
      ['NI-MA', 'Managua', 12.11, -86.24],
      ['CR-SJ', 'San José (Costa Rica)', 9.93, -84.08],
      ['PA-PA', 'Ciudad de Panamá', 8.98, -79.52],
    ]],
    ['Europa', [
      ['ES-MA', 'Madrid', 40.42, -3.70],
      ['ES-BA', 'Barcelona', 41.39, 2.17],
      ['IT-MI', 'Milán', 45.46, 9.19],
      ['SE-ES', 'Estocolmo', 59.33, 18.07],
    ]],
    ['Otro', [
      ['XX', 'Otro lugar (escríbelo en el detalle)', null, null],
    ]],
  ];

  /* ── Índice plano: clave → lugar ────────────────────────────── */
  const PORCLAVE = new Map();

  DEPARTAMENTOS.forEach(([cod, nombre, lat, lng, municipios]) => {
    const claveDep = 'SV-' + cod;
    PORCLAVE.set(claveDep, {
      clave: claveDep, nombre, region: 'El Salvador', departamento: nombre,
      claveDepartamento: claveDep, pais: 'SV', lat, lng, tipo: 'departamento',
    });
    municipios.forEach((punto) => {
      const clave = claveDep + '-' + punto[0];
      PORCLAVE.set(clave, {
        clave, nombre: nombre + ' ' + punto, region: 'El Salvador', departamento: nombre,
        claveDepartamento: claveDep, pais: 'SV', lat, lng, tipo: 'municipio',
      });
    });
  });

  MUNDO.forEach(([region, ciudades]) => {
    ciudades.forEach(([clave, nombre, lat, lng]) => {
      PORCLAVE.set(clave, {
        clave, nombre, region, departamento: null, claveDepartamento: null,
        pais: clave.slice(0, 2), lat, lng, tipo: 'ciudad',
      });
    });
  });

  /* ── Texto: normalizar y fonética del español ───────────────── */

  /** minúsculas, sin tildes ni signos: "Laínez" → "lainez" */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9ñ\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Clave fonética de UNA palabra, pensada para apellidos en español:
   *  Laínez / Lainez / Lainés → "lainis"; Vásquez / Vázquez /
   *  Basquez → "baskis". Iguala lo que suena igual, no lo que se parece. */
  function fonetica(palabra) {
    let s = normalizar(palabra).replace(/\s|-/g, '');
    if (!s) return '';
    s = s
      .replace(/ñ/g, 'ni')
      .replace(/ch/g, '1')            // ch se protege hasta el final
      .replace(/h/g, '')              // h muda
      .replace(/^x(?=[aeiou])/, 'j')  // Ximénez, Xavier: la x antigua suena a j
      .replace(/c([ei])/g, 's$1')     // primero c/g suaves…
      .replace(/g([ei])/g, 'j$1')
      .replace(/qu([ei])/g, 'k$1')    // …después qu/gu (la u es muda)
      .replace(/gu([ei])/g, 'g$1')
      .replace(/[cq]/g, 'k')
      .replace(/z/g, 's')
      .replace(/x/g, 'ks')
      .replace(/v/g, 'b')
      .replace(/w/g, 'gu')
      .replace(/ll/g, 'y')
      .replace(/i(?=[aeou])/g, 'y')   // diptongos: "Mario"/"Maryo"
      .replace(/e(?=s$)/g, 'i')       // -ez / -es / -is finales suenan parecido
      .replace(/(.)\1+/g, '$1')       // letras dobles
      .replace(/1/g, 'ch');
    return s;
  }

  /** Palabras que no distinguen a nadie y no cuentan como apellido. */
  const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'hijo', 'hija', 'jr', 'sr', 'viuda', 'vda']);

  /** Fonéticas de las palabras significativas de un nombre completo. */
  function foneticasDe(nombre) {
    return normalizar(nombre)
      .split(' ')
      .filter((w) => w && !VACIAS.has(w) && w.length > 1)
      .map(fonetica)
      .filter(Boolean);
  }

  /** Apellidos probables de un nombre completo en el uso salvadoreño:
   *  las dos últimas palabras significativas (o la última, si solo hay
   *  dos). "Yolanda del Carmen Jimenez Benitez de Lainez" → jimenez,
   *  benitez y lainez (el "de Lainez" de casada también cuenta). */
  function apellidosDe(nombre) {
    const crudo = normalizar(String(nombre || '').replace(/\(.*?\)/g, ' ')).split(' ').filter(Boolean);
    const salida = new Set();
    const idxDe = crudo.lastIndexOf('de');
    if (idxDe > 0 && idxDe === crudo.length - 2) salida.add(fonetica(crudo[crudo.length - 1]));
    const utiles = (idxDe > 0 && idxDe === crudo.length - 2 ? crudo.slice(0, idxDe) : crudo)
      .filter((w) => !VACIAS.has(w) && w.length > 1 && !/^[a-z]\.?$/.test(w));
    if (utiles.length >= 3) { salida.add(fonetica(utiles[utiles.length - 1])); salida.add(fonetica(utiles[utiles.length - 2])); }
    else if (utiles.length === 2) salida.add(fonetica(utiles[1]));
    salida.delete('');
    return [...salida];
  }

  /* ── Perfil ↔ lugares ───────────────────────────────────────── */

  const TIPOS = [
    ['nacimiento', 'Nació en'],
    ['residencia', 'Vive o vivió en'],
    ['fallecimiento', 'Falleció en'],
  ];

  /** Siempre devuelve los tres tipos, aunque el perfil no traiga nada. */
  function lugaresDe(perfil) {
    const l = (perfil && perfil.lugares) || {};
    const salida = {};
    TIPOS.forEach(([tipo]) => {
      const v = l[tipo] || {};
      salida[tipo] = { clave: String(v.clave || ''), detalle: String(v.detalle || '').trim() };
    });
    return salida;
  }

  /** "Chalatenango Norte, Chalatenango · cantón El Carrizal" */
  function describir(lugar) {
    if (!lugar) return '';
    const l = PORCLAVE.get(lugar.clave);
    const partes = [];
    if (l && l.clave !== 'XX') {
      if (l.tipo === 'municipio') partes.push(l.nombre + ', ' + l.departamento);
      else if (l.tipo === 'ciudad') partes.push(l.nombre + (l.region !== 'Otro' ? ' (' + l.region + ')' : ''));
      else partes.push(l.nombre + ', El Salvador');
    }
    if (lugar.detalle) partes.push(lugar.detalle);
    return partes.join(' · ');
  }

  /** Año de una fecha ISO ("1934-05-02" → 1934), o null. */
  function anio(fecha) {
    const m = /^(\d{4})/.exec(String(fecha || ''));
    return m ? Number(m[1]) : null;
  }

  /* ── Búsqueda ───────────────────────────────────────────────── */

  /** Lo que se puede buscar de una persona, ya normalizado. */
  function huellaDe(perfil) {
    const ls = lugaresDe(perfil);
    const textosLugar = [];
    const clavesLugar = new Set();
    TIPOS.forEach(([tipo]) => {
      const v = ls[tipo];
      const l = PORCLAVE.get(v.clave);
      if (l) {
        clavesLugar.add(l.clave);
        if (l.claveDepartamento) clavesLugar.add(l.claveDepartamento);
        textosLugar.push(normalizar(l.nombre + ' ' + (l.departamento || '') + ' ' + l.region));
      }
      if (v.detalle) textosLugar.push(normalizar(v.detalle));
    });
    return {
      nombre: normalizar(perfil.nombre_completo),
      fonNombre: foneticasDe(perfil.nombre_completo),
      lugares: textosLugar.join(' '),
      clavesLugar,
      nacio: anio(perfil.fecha_nacimiento),
      murio: anio(perfil.fecha_fallecimiento),
    };
  }

  /** ¿Una palabra de la consulta encaja con la persona? Devuelve el
   *  motivo ('nombre' | 'lugar' | 'año') o null. */
  function encaja(token, h) {
    if (/^\d{4}s?$/.test(token)) {
      const n = Number(token.slice(0, 4));
      const decada = /s$/.test(token) || n % 10 === 0;
      const dentro = (a) => a != null && (decada ? Math.floor(a / 10) * 10 === n : a === n);
      return dentro(h.nacio) || dentro(h.murio) ? 'año' : null;
    }
    if (h.nombre.indexOf(token) !== -1) return 'nombre';
    const f = fonetica(token);
    if (f && f.length >= 3 && h.fonNombre.some((x) => x === f || (f.length >= 4 && x.indexOf(f) === 0))) return 'nombre';
    if (token.length >= 3 && h.lugares.indexOf(token) !== -1) return 'lugar';
    return null;
  }

  /** Busca personas: cada palabra debe encajar (en nombre, lugar o año).
   *  "lainez chalatenango 1930s" → los Laínez nacidos o fallecidos en
   *  los años 30 con algún lugar en Chalatenango. */
  function buscarPersonas(perfiles, consulta, limite) {
    const tokens = normalizar(consulta).split(' ').filter((t) => t && !VACIAS.has(t));
    if (!tokens.length) return [];
    const salida = [];
    for (const p of perfiles) {
      const h = huellaDe(p);
      const motivos = [];
      let ok = true;
      for (const t of tokens) {
        const m = encaja(t, h);
        if (!m) { ok = false; break; }
        motivos.push(m);
      }
      if (!ok) continue;
      /* Coincidencia exacta en el nombre puntúa más que la fonética */
      const puntos = motivos.length + (h.nombre.indexOf(normalizar(consulta)) !== -1 ? 2 : 0);
      salida.push({ perfil: p, motivos: [...new Set(motivos)], puntos });
    }
    salida.sort((a, b) => b.puntos - a.puntos || a.perfil.nombre_completo.localeCompare(b.perfil.nombre_completo));
    return salida.slice(0, limite || 30);
  }

  /** Resumen de una familia para buscarla sin leer a sus personas:
   *  apellidos fonéticos, departamentos/ciudades y cuántos son. Se
   *  guarda en el documento de la familia (lo usan el buscador de
   *  familias y los Puentes para elegir candidatas). */
  function resumirFamilia(perfiles) {
    const conteo = new Map();
    const lugares = new Set();
    const nombresLugar = new Set();
    /* "Julio Cesar Lainez" no dice si Cesar es nombre o apellido; si esa
       palabra es el nombre de pila de alguien de la familia, no cuenta. */
    const pilas = new Set(perfiles.map((p) => foneticasDe(p.nombre_completo)[0]).filter(Boolean));
    perfiles.forEach((p) => {
      apellidosDe(p.nombre_completo)
        .filter((a) => !pilas.has(a))
        .forEach((a) => conteo.set(a, (conteo.get(a) || 0) + 1));
      const ls = lugaresDe(p);
      TIPOS.forEach(([tipo]) => {
        const l = PORCLAVE.get(ls[tipo].clave);
        if (!l || l.clave === 'XX') return;
        const raiz = l.claveDepartamento || l.clave;
        lugares.add(raiz);
        nombresLugar.add(PORCLAVE.get(raiz).nombre);
      });
    });
    const apellidos = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((e) => e[0]);
    return {
      apellidos,
      lugares: [...lugares].sort(),
      nombresLugar: [...nombresLugar].sort(),
      personas: perfiles.length,
    };
  }

  /** ¿Encaja una familia (por su resumen) con la consulta? */
  function familiaEncaja(resumen, etiqueta, consulta) {
    const tokens = normalizar(consulta).split(' ').filter((t) => t && !VACIAS.has(t));
    if (!tokens.length || !resumen) return false;
    const textoLugares = normalizar((resumen.nombresLugar || []).join(' '));
    const textoEtiqueta = normalizar(etiqueta);
    return tokens.every((t) => {
      if (textoEtiqueta.indexOf(t) !== -1) return true;
      if (t.length >= 3 && textoLugares.indexOf(t) !== -1) return true;
      const f = fonetica(t);
      return f.length >= 3 && (resumen.apellidos || []).indexOf(f) !== -1;
    });
  }

  global.AlbumLugares = {
    DEPARTAMENTOS,
    MUNDO,
    TIPOS,
    lugar: (clave) => PORCLAVE.get(clave) || null,
    todos: () => [...PORCLAVE.values()],
    normalizar,
    fonetica,
    foneticasDe,
    apellidosDe,
    lugaresDe,
    describir,
    anio,
    buscarPersonas,
    resumirFamilia,
    familiaEncaja,
  };
})(window);
