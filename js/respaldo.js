/* ══════════════════════════════════════════════════════════════
   RESPALDO — Copia de seguridad completa del álbum (.zip)
   ──────────────────────────────────────────────────────────────
   Nace de una pérdida real: el proyecto de Supabase desapareció y
   con él todo lo que no estuviera en el repositorio. La regla que
   queda escrita aquí es simple: la nube es cómoda, no es respaldo.

   Descargar → un único .zip con:
       album.json      todos los perfiles, fechas, biografías y
                       relaciones (el árbol completo)
       fotos/…​.jpg     cada fotografía descargada de la nube

   Restaurar → vuelve a subir las fotos y reescribe los perfiles en
   la familia activa. No borra nada: lo que ya existe se actualiza
   y lo que falta se crea.

   Sin librerías: el ZIP se construye y se lee a mano (método
   "almacenado", sin compresión — las fotos ya son JPEG y no se
   encogerían, así evitamos tener que implementar deflate).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const FORMATO = 'album-familiar/respaldo';
  const VERSION = 1;

  /* ── CRC-32 (lo exige el formato ZIP) ────────────────────── */

  let _tablaCrc = null;
  function tablaCrc() {
    if (_tablaCrc) return _tablaCrc;
    _tablaCrc = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _tablaCrc[i] = c >>> 0;
    }
    return _tablaCrc;
  }

  function crc32(datos) {
    const t = tablaCrc();
    let c = 0xffffffff;
    for (let i = 0; i < datos.length; i++) c = t[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* Fecha y hora en el formato MS-DOS que guarda cada entrada. */
  function fechaHoraDOS(d) {
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      fecha: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  /* ── Escritura del ZIP ───────────────────────────────────── */

  /** entradas: [{ nombre, datos: Uint8Array }] → Blob */
  function zipCrear(entradas) {
    const codificar = new TextEncoder();
    const cuerpo = [];
    const central = [];
    const { hora, fecha } = fechaHoraDOS(new Date());
    let desplazamiento = 0;

    for (const e of entradas) {
      const nombre = codificar.encode(e.nombre);
      const crc = crc32(e.datos);
      const tam = e.datos.length;

      const cabecera = new Uint8Array(30 + nombre.length);
      const h = new DataView(cabecera.buffer);
      h.setUint32(0, 0x04034b50, true); // firma de cabecera local
      h.setUint16(4, 20, true); // versión necesaria
      h.setUint16(6, 0x0800, true); // nombres en UTF-8
      h.setUint16(8, 0, true); // método 0 = almacenado
      h.setUint16(10, hora, true);
      h.setUint16(12, fecha, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, tam, true); // tamaño comprimido
      h.setUint32(22, tam, true); // tamaño original
      h.setUint16(26, nombre.length, true);
      h.setUint16(28, 0, true); // sin campo extra
      cabecera.set(nombre, 30);

      cuerpo.push(cabecera, e.datos);

      const ficha = new Uint8Array(46 + nombre.length);
      const c = new DataView(ficha.buffer);
      c.setUint32(0, 0x02014b50, true); // firma de directorio central
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, hora, true);
      c.setUint16(14, fecha, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, tam, true);
      c.setUint32(24, tam, true);
      c.setUint16(28, nombre.length, true);
      c.setUint32(42, desplazamiento, true); // dónde empieza su cabecera local
      ficha.set(nombre, 46);
      central.push(ficha);

      desplazamiento += cabecera.length + tam;
    }

    const inicioCentral = desplazamiento;
    let tamCentral = 0;
    for (const f of central) tamCentral += f.length;

    const fin = new Uint8Array(22);
    const f = new DataView(fin.buffer);
    f.setUint32(0, 0x06054b50, true); // fin del directorio central
    f.setUint16(8, central.length, true);
    f.setUint16(10, central.length, true);
    f.setUint32(12, tamCentral, true);
    f.setUint32(16, inicioCentral, true);

    return new Blob(cuerpo.concat(central, [fin]), { type: 'application/zip' });
  }

  /* ── Lectura del ZIP ─────────────────────────────────────── */

  /** Devuelve Map(nombre → Uint8Array). Solo entradas sin comprimir. */
  async function zipLeer(archivo) {
    const bruto = new Uint8Array(await archivo.arrayBuffer());
    const v = new DataView(bruto.buffer, bruto.byteOffset, bruto.byteLength);

    /* El fin del directorio central se busca desde el final. */
    let fin = -1;
    const tope = Math.max(0, bruto.length - 22 - 65536);
    for (let i = bruto.length - 22; i >= tope; i--) {
      if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo no parece un ZIP válido.');

    const total = v.getUint16(fin + 10, true);
    let p = v.getUint32(fin + 16, true);
    const decodificar = new TextDecoder();
    const archivos = new Map();

    for (let i = 0; i < total; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('El índice del ZIP está dañado.');
      const metodo = v.getUint16(p + 10, true);
      const tam = v.getUint32(p + 20, true);
      const lenNombre = v.getUint16(p + 28, true);
      const lenExtra = v.getUint16(p + 30, true);
      const lenNota = v.getUint16(p + 32, true);
      const donde = v.getUint32(p + 42, true);
      const nombre = decodificar.decode(bruto.subarray(p + 46, p + 46 + lenNombre));
      p += 46 + lenNombre + lenExtra + lenNota;

      if (nombre.endsWith('/')) continue; // carpeta
      if (metodo !== 0) {
        throw new Error(
          'Este ZIP está comprimido y no puedo abrirlo. Usa el archivo original ' +
            'descargado del álbum, sin volver a comprimirlo.'
        );
      }
      const lnNombre = v.getUint16(donde + 26, true);
      const lnExtra = v.getUint16(donde + 28, true);
      const inicio = donde + 30 + lnNombre + lnExtra;
      archivos.set(nombre, bruto.subarray(inicio, inicio + tam));
    }
    return archivos;
  }

  /* ── Utilidades ──────────────────────────────────────────── */

  function descargarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function sello() {
    const d = new Date();
    const dd = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + dd(d.getMonth() + 1) + dd(d.getDate()) + '-' + dd(d.getHours()) + dd(d.getMinutes());
  }

  function extensionDe(url) {
    const limpio = String(url).split('?')[0].split('#')[0];
    const m = /\.([a-z0-9]{2,5})$/i.exec(limpio);
    const ext = m ? m[1].toLowerCase() : 'jpg';
    return /^(jpg|jpeg|png|webp|gif|avif)$/.test(ext) ? ext : 'jpg';
  }

  function tipoDe(ext) {
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'avif') return 'image/avif';
    return 'image/jpeg';
  }

  const AlbumRespaldo = {
    /** Arma y descarga el .zip de la familia indicada.
     *  `avisar` recibe mensajes de progreso (opcional).
     *  Devuelve { perfiles, fotos, fallidas }. */
    async descargar(perfiles, idFamilia, etiqueta, avisar) {
      const aviso = avisar || function () {};
      const lista = (perfiles || []).map((p) => Object.assign({}, p));
      const entradas = [];
      const usados = new Set();
      let fotos = 0;
      let fallidas = 0;

      for (const p of lista) {
        const galeria = Array.isArray(p.galeria) ? p.galeria.slice() : [];
        for (let i = 0; i < galeria.length; i++) {
          const url = galeria[i];
          if (!url || /^fotos\//.test(url)) continue;
          aviso('Descargando fotos… ' + (fotos + 1));
          try {
            const respuesta = await fetch(url, { mode: 'cors', cache: 'no-store' });
            if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
            const datos = new Uint8Array(await respuesta.arrayBuffer());
            let nombre = 'fotos/' + p.id + '-' + (i + 1) + '.' + extensionDe(url);
            let n = 2;
            while (usados.has(nombre)) {
              nombre = 'fotos/' + p.id + '-' + (i + 1) + '-' + n++ + '.' + extensionDe(url);
            }
            usados.add(nombre);
            entradas.push({ nombre: nombre, datos: datos });
            galeria[i] = nombre; // en el JSON queda la ruta dentro del ZIP
            fotos++;
          } catch (e) {
            /* Si una foto no se deja descargar, el respaldo sigue: en el
               JSON se conserva su URL original en lugar de la ruta. */
            console.warn('[Respaldo] No se pudo descargar una foto:', url, e);
            fallidas++;
          }
        }
        p.galeria = galeria;
      }

      aviso('Escribiendo el archivo…');
      const manifiesto = {
        formato: FORMATO,
        version: VERSION,
        generado: new Date().toISOString(),
        id_familia: idFamilia,
        etiqueta: etiqueta || idFamilia,
        total_perfiles: lista.length,
        total_fotos: fotos,
        perfiles: lista,
      };
      entradas.unshift({
        nombre: 'album.json',
        datos: new TextEncoder().encode(JSON.stringify(manifiesto, null, 2)),
      });

      const nombreZip = 'album-' + String(idFamilia).replace(/[^\w-]+/g, '_') + '-' + sello() + '.zip';
      descargarBlob(zipCrear(entradas), nombreZip);
      return { perfiles: lista.length, fotos: fotos, fallidas: fallidas };
    },

    /** Lee un .zip (o un album.json suelto) y devuelve { manifiesto, archivos }. */
    async leer(archivo) {
      if (/\.json$/i.test(archivo.name)) {
        const manifiesto = JSON.parse(await archivo.text());
        return { manifiesto: manifiesto, archivos: new Map() };
      }
      const archivos = await zipLeer(archivo);
      const json = archivos.get('album.json');
      if (!json) throw new Error('El ZIP no contiene album.json: no es una copia del álbum.');
      const manifiesto = JSON.parse(new TextDecoder().decode(json));
      if (manifiesto.formato !== FORMATO) {
        throw new Error('El archivo no es una copia de seguridad de este álbum.');
      }
      if (!Array.isArray(manifiesto.perfiles) || !manifiesto.perfiles.length) {
        throw new Error('La copia no contiene ningún perfil.');
      }
      return { manifiesto: manifiesto, archivos: archivos };
    },

    /** Vuelve a subir las fotos del ZIP y reescribe los perfiles en
     *  `idFamilia`. No borra: actualiza lo existente y crea lo que falte. */
    async restaurar(manifiesto, archivos, idFamilia, avisar) {
      const aviso = avisar || function () {};
      const hayBackend = !!(global.ALBUM_CONFIG && global.ALBUM_CONFIG.hayBackend);
      const perfiles = manifiesto.perfiles.map((p) => Object.assign({}, p, { id_familia: idFamilia }));
      let subidas = 0;
      let sinSubir = 0;

      for (const p of perfiles) {
        const galeria = Array.isArray(p.galeria) ? p.galeria.slice() : [];
        for (let i = 0; i < galeria.length; i++) {
          const ruta = galeria[i];
          if (!ruta || !/^fotos\//.test(ruta)) continue; // ya es una URL
          const datos = archivos.get(ruta);
          if (!datos || !hayBackend) {
            /* Sin nube no hay dónde alojar la imagen: el perfil se
               restaura sin esa foto en vez de guardar una ruta rota. */
            galeria[i] = '';
            sinSubir++;
            continue;
          }
          aviso('Subiendo fotos… ' + (subidas + 1));
          const ext = extensionDe(ruta);
          const blob = new Blob([datos], { type: tipoDe(ext) });
          const destino = idFamilia + '/' + p.id + '/restaurada-' + (i + 1) + '-' + Date.now() + '.' + ext;
          galeria[i] = await global.AlbumBackend.subirFoto(destino, blob);
          subidas++;
        }
        p.galeria = galeria.filter(Boolean);
      }

      aviso('Guardando los perfiles…');
      await AlbumDatos.reemplazarFamilia(idFamilia, perfiles);
      return { perfiles: perfiles.length, fotos: subidas, sinSubir: sinSubir };
    },
  };

  global.AlbumRespaldo = AlbumRespaldo;
})(window);
