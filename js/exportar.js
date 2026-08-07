/* ══════════════════════════════════════════════════════════════
   EXPORTAR — El árbol como imagen (PNG) o documento (PDF)
   ──────────────────────────────────────────────────────────────
   Dibuja la constelación en un <canvas> con la estética de la
   Galería Nocturna (fondo oscuro, hilos de luz, lazos punteados,
   retratos con sombra) y lo descarga:

     · PNG — canvas.toBlob directo.
     · PDF — se construye el archivo a mano (sin librerías): una
       página con la imagen JPEG incrustada vía DCTDecode.

   Las fotos se cargan con crossOrigin='anonymous'; si alguna no
   permite CORS, ese retrato sale como placeholder con iniciales
   (el canvas nunca se "contamina" y la exportación no falla).
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const NODO_W = 168;
  const NODO_H = 228;
  const ANCLA_Y = -27; // mismo ancla que los hilos del lienzo
  const MARGEN = 200;
  const CABECERA = 150; // franja superior para el título
  const LADO_MAX = 4000; // tope de canvas (memoria/compatibilidad)

  /* ── utilidades ──────────────────────────────────────────── */

  function cargarImagen(url) {
    return new Promise((resolver) => {
      if (!url) return resolver(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolver(null), 12000);
      img.onload = () => { clearTimeout(timer); resolver(img); };
      img.onerror = () => { clearTimeout(timer); resolver(null); };
      img.src = url;
    });
  }

  function iniciales(nombre) {
    const p = (nombre || '?').trim().split(/\s+/).filter(Boolean);
    return ((p[0] ? p[0][0] : '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  function partirEnLineas(ctx, texto, anchoMax, maxLineas) {
    const palabras = (texto || '').split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = '';
    for (const pal of palabras) {
      const intento = actual ? actual + ' ' + pal : pal;
      if (ctx.measureText(intento).width <= anchoMax || !actual) {
        actual = intento;
      } else {
        lineas.push(actual);
        actual = pal;
        if (lineas.length === maxLineas - 1) break;
      }
    }
    if (actual && lineas.length < maxLineas) lineas.push(actual);
    if (lineas.length === maxLineas && palabras.join(' ') !== lineas.join(' ')) {
      let ult = lineas[maxLineas - 1];
      while (ctx.measureText(ult + '…').width > anchoMax && ult.length > 1) ult = ult.slice(0, -1);
      lineas[maxLineas - 1] = ult + '…';
    }
    return lineas;
  }

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

  function fechasDe(p) {
    const anio = (f) => (f ? String(f).slice(0, 4) : null);
    const n = anio(p.fecha_nacimiento);
    const d = anio(p.fecha_fallecimiento);
    if (n && d) return n + ' — ' + d;
    return n || '';
  }

  /* ── render principal ────────────────────────────────────── */

  async function generarCanvas(perfiles, titulo) {
    if (!perfiles || !perfiles.length) throw new Error('No hay perfiles que exportar.');
    try { await document.fonts.ready; } catch (e) {}

    /* caja del contenido en coords de mundo */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of perfiles) {
      const pos = AlbumDatos.posicionDe(p.id);
      minX = Math.min(minX, pos.x - NODO_W / 2);
      maxX = Math.max(maxX, pos.x + NODO_W / 2);
      minY = Math.min(minY, pos.y - NODO_H / 2);
      maxY = Math.max(maxY, pos.y + NODO_H / 2 + 76);
    }

    const anchoMundo = maxX - minX + MARGEN * 2;
    const altoMundo = maxY - minY + MARGEN * 2 + CABECERA;
    const escala = Math.min(1.25, LADO_MAX / anchoMundo, LADO_MAX / altoMundo);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(anchoMundo * escala);
    canvas.height = Math.round(altoMundo * escala);
    const ctx = canvas.getContext('2d');
    ctx.scale(escala, escala);

    /* mundo → canvas */
    const X = (wx) => wx - minX + MARGEN;
    const Y = (wy) => wy - minY + MARGEN + CABECERA;

    /* fondo: gradiente radial de la galería */
    const g = ctx.createRadialGradient(
      anchoMundo / 2, altoMundo * 0.42, 60,
      anchoMundo / 2, altoMundo * 0.42, Math.max(anchoMundo, altoMundo) * 0.75
    );
    g.addColorStop(0, '#232323');
    g.addColorStop(0.45, '#1a1a1a');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, anchoMundo, altoMundo);

    /* título */
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '200 46px Montserrat, sans-serif';
    ctx.fillText('Á L B U M   F A M I L I A R', anchoMundo / 2, 88);
    ctx.fillStyle = '#8a8a8a';
    ctx.font = '300 22px Inter, sans-serif';
    const fecha = new Date().toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.fillText((titulo || '') + '   ·   ' + fecha, anchoMundo / 2, 126);

    /* relaciones (misma geometría que el lienzo) */
    const rel = AlbumDatos.calcularRelaciones(perfiles);
    const ancla = (id) => {
      const p = AlbumDatos.posicionDe(id);
      return { x: X(p.x), y: Y(p.y + ANCLA_Y) };
    };

    /* lazos de pareja: punteado ámbar + nudo */
    for (const c of rel.parejas) {
      const A = ancla(c.a), B = ancla(c.b);
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 230, 200, 0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([2, 8]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 248, 231, 0.95)';
      ctx.beginPath(); ctx.arc((A.x + B.x) / 2, (A.y + B.y) / 2, 3.4, 0, Math.PI * 2); ctx.fill();
    }

    /* hilos de filiación: curva con arqueo, como en el lienzo */
    ctx.strokeStyle = 'rgba(255, 248, 231, 0.45)';
    ctx.lineWidth = 1.3;
    for (const f of rel.filiaciones) {
      let o;
      if (f.tipo === 'conjunta') {
        const A = ancla(f.padres[0]), B = ancla(f.padres[1]);
        o = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      } else {
        o = ancla(f.progenitor);
      }
      const d = ancla(f.hijo);
      const mx = (o.x + d.x) / 2, my = (o.y + d.y) / 2;
      const dx = d.x - o.x, dy = d.y - o.y;
      const largo = Math.hypot(dx, dy) || 1;
      const arq = Math.min(46, largo * 0.12);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.quadraticCurveTo(mx + (-dy / largo) * arq, my + (dx / largo) * arq, d.x, d.y);
      ctx.stroke();
    }

    /* fotos (en paralelo) */
    const imagenes = await Promise.all(
      perfiles.map((p) => cargarImagen((p.galeria || []).filter(Boolean)[0]))
    );

    /* nodos */
    perfiles.forEach((p, i) => {
      const pos = AlbumDatos.posicionDe(p.id);
      const x = X(pos.x) - NODO_W / 2;
      const y = Y(pos.y) - NODO_H / 2;
      const img = imagenes[i];

      /* sombra proyectada */
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 46;
      ctx.shadowOffsetY = 26;
      ctx.fillStyle = '#161616';
      ctx.fillRect(x, y, NODO_W, NODO_H);
      ctx.restore();

      if (img) {
        /* recorte tipo cover */
        const esc = Math.max(NODO_W / img.naturalWidth, NODO_H / img.naturalHeight);
        const sw = NODO_W / esc, sh = NODO_H / esc;
        const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, x, y, NODO_W, NODO_H);
        /* velo suave para integrarla a la atmósfera */
        ctx.fillStyle = 'rgba(10,10,10,0.14)';
        ctx.fillRect(x, y, NODO_W, NODO_H);
      } else {
        const gp = ctx.createRadialGradient(
          x + NODO_W / 2, y + NODO_H * 0.35, 10,
          x + NODO_W / 2, y + NODO_H * 0.35, NODO_H * 0.85
        );
        gp.addColorStop(0, '#2a2a2a');
        gp.addColorStop(1, '#0d0d0d');
        ctx.fillStyle = gp;
        ctx.fillRect(x, y, NODO_W, NODO_H);
        ctx.fillStyle = '#6b6b6b';
        ctx.font = '200 46px Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(iniciales(p.nombre_completo), x + NODO_W / 2, y + NODO_H / 2 + 16);
      }

      /* marco sutil */
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, NODO_W - 1, NODO_H - 1);

      /* nombre + disciplina/fechas */
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '400 14px Montserrat, sans-serif';
      const lineas = partirEnLineas(ctx, (p.nombre_completo || '').toUpperCase(), 205, 2);
      lineas.forEach((ln, k) => ctx.fillText(ln, x + NODO_W / 2, y + NODO_H + 22 + k * 18));
      const sub = [p.disciplina_artistica, fechasDe(p)].filter(Boolean).join('  ·  ');
      if (sub) {
        ctx.fillStyle = '#9a9a9a';
        ctx.font = '300 11px Inter, sans-serif';
        ctx.fillText(sub.toUpperCase(), x + NODO_W / 2, y + NODO_H + 24 + lineas.length * 18);
      }
    });

    return canvas;
  }

  /* ── PDF construido a mano (una página, JPEG incrustado) ─── */

  function construirPdf(jpegBytes, wPx, hPx) {
    const W = (wPx * 0.75).toFixed(2); // px → puntos (72/96)
    const H = (hPx * 0.75).toFixed(2);
    const enc = new TextEncoder();
    const partes = [];
    let offset = 0;
    const offsets = [];
    const push = (dato) => {
      const b = typeof dato === 'string' ? enc.encode(dato) : dato;
      partes.push(b);
      offset += b.length;
    };
    const obj = (n, cuerpo) => {
      offsets[n] = offset;
      push(n + ' 0 obj\n' + cuerpo + '\nendobj\n');
    };

    push('%PDF-1.4\n');
    obj(1, '<</Type/Catalog/Pages 2 0 R>>');
    obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
    obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + W + ' ' + H + ']' +
      '/Resources<</XObject<</Im1 4 0 R>>>>/Contents 5 0 R>>');

    offsets[4] = offset;
    push('4 0 obj\n<</Type/XObject/Subtype/Image/Width ' + wPx + '/Height ' + hPx +
      '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpegBytes.length + '>>\nstream\n');
    push(jpegBytes);
    push('\nendstream\nendobj\n');

    const contenido = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im1 Do Q';
    obj(5, '<</Length ' + contenido.length + '>>\nstream\n' + contenido + '\nendstream');

    const xrefPos = offset;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(xref + 'trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + xrefPos + '\n%%EOF');

    return new Blob(partes, { type: 'application/pdf' });
  }

  function nombreArchivo(titulo, ext) {
    const limpio = (titulo || 'album-familiar')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const f = new Date();
    const fecha = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    return 'arbol-' + limpio + '-' + fecha + '.' + ext;
  }

  /* ── API pública ─────────────────────────────────────────── */

  const AlbumExportar = {
    async png(perfiles, titulo) {
      const canvas = await generarCanvas(perfiles, titulo);
      const blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), 'image/png')
      );
      descargarBlob(blob, nombreArchivo(titulo, 'png'));
      return blob.size;
    },

    async pdf(perfiles, titulo) {
      const canvas = await generarCanvas(perfiles, titulo);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const b64 = dataUrl.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = construirPdf(bytes, canvas.width, canvas.height);
      descargarBlob(blob, nombreArchivo(titulo, 'pdf'));
      return blob.size;
    },
  };

  global.AlbumExportar = AlbumExportar;
})(window);
