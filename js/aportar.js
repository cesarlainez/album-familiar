/* ══════════════════════════════════════════════════════════════
   APORTAR — página para familiares sin cuenta (aportar.html)
   ──────────────────────────────────────────────────────────────
   Llega con ?f=<familia>&t=<token>. Si el enlace vale, deja grabar una
   nota de voz, subir una foto o escribir un recuerdo y lo envía a la
   bandeja de la familia (AlbumDatos.aportes.enviar). Pensada para un
   abuelo con el celular: botones grandes y nada que configurar.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_SEGUNDOS = 180;
  /* 900 000 letras de base64 (lo que aceptan las reglas) son ~675 000
     bytes; se corta antes, con margen para el encabezado del data URL. */
  const MAX_BYTES_AUDIO = 640 * 1024;
  const TOPE_BYTES_AUDIO = 670000;
  const MAX_BYTES_FOTO = 640 * 1024;
  const CLAVE_AUTOR = 'albumFamiliar:aportar:autor';

  const parametros = new URLSearchParams(location.search);
  const fid = parametros.get('f') || '';
  const token = parametros.get('t') || '';

  let tipo = 'voz';
  let grabacion = null; // { datos, duracion }
  let foto = null; // data URL

  function aDataUrl(blob) {
    return new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(blob);
    });
  }

  function error(texto) {
    const el = $('aportarError');
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  /* ── Voz ───────────────────────────────────────────────────── */

  let grabador = null;
  let inicio = 0;
  let reloj = null;

  function tipoAudio() {
    /* MP4 primero: lo reproducen también los iPhone antiguos; si el
       navegador no lo graba, Opus en WebM/Ogg. */
    const opciones = ['audio/mp4;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
    return opciones.find((t) => global.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }

  function textoReloj(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  async function empezarGrabacion() {
    const aviso = $('aportarVozAviso');
    aviso.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !global.MediaRecorder) {
      aviso.textContent = 'Este navegador no permite grabar. Prueba con Chrome, o escribe el recuerdo.';
      aviso.hidden = false;
      return;
    }
    let flujo;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      aviso.textContent = 'No se pudo usar el micrófono. Revisa que le diste permiso a esta página.';
      aviso.hidden = false;
      return;
    }
    const mime = tipoAudio();
    grabador = new MediaRecorder(flujo, Object.assign({ audioBitsPerSecond: 24000 }, mime ? { mimeType: mime } : {}));
    const trozos = [];
    let bytes = 0;
    let cortePorTamano = false;
    grabador.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      trozos.push(e.data);
      bytes += e.data.size;
      /* Algunos teléfonos ignoran la tasa pedida: se corta por tamaño */
      if (bytes >= MAX_BYTES_AUDIO && grabador && grabador.state === 'recording') {
        cortePorTamano = true;
        grabador.stop();
      }
    };
    grabador.onstop = async () => {
      clearInterval(reloj);
      flujo.getTracks().forEach((t) => t.stop());
      const duracion = (Date.now() - inicio) / 1000;
      const blob = new Blob(trozos, { type: grabador.mimeType || mime || 'audio/webm' });
      grabador = null;
      $('aportarGrabar').textContent = '● Volver a grabar';
      $('aportarGrabar').classList.remove('grabando');
      if (blob.size > TOPE_BYTES_AUDIO) {
        aviso.textContent = 'La grabación quedó demasiado pesada. Graba un poco menos.';
        aviso.hidden = false;
        return;
      }
      grabacion = { datos: await aDataUrl(blob), duracion };
      const audio = $('aportarAudio');
      audio.src = grabacion.datos;
      audio.hidden = false;
      $('aportarReloj').textContent = (cortePorTamano
        ? 'Se llegó al máximo que cabe y la grabación se detuvo sola: '
        : 'Grabado: ') + textoReloj(duracion) + '. Escúchalo antes de enviar.';
    };
    grabacion = null;
    $('aportarAudio').hidden = true;
    inicio = Date.now();
    grabador.start(1000);
    $('aportarGrabar').textContent = '■ Detener';
    $('aportarGrabar').classList.add('grabando');
    reloj = setInterval(() => {
      const s = (Date.now() - inicio) / 1000;
      $('aportarReloj').textContent = 'Grabando… ' + textoReloj(s) + ' de 3:00';
      if (s >= MAX_SEGUNDOS && grabador && grabador.state === 'recording') grabador.stop();
    }, 250);
  }

  /* ── Foto: se reduce en el teléfono antes de enviar ─────────── */

  async function reducirFoto(archivo) {
    const bitmap = await createImageBitmap(archivo);
    const lado = Math.max(bitmap.width, bitmap.height);
    for (const tope of [1600, 1300, 1000, 800]) {
      for (const calidad of [0.85, 0.75, 0.65]) {
        const factor = Math.min(1, tope / lado);
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(bitmap.width * factor);
        lienzo.height = Math.round(bitmap.height * factor);
        lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
        const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', calidad));
        if (blob && blob.size <= MAX_BYTES_FOTO) return aDataUrl(blob);
      }
    }
    throw new Error('La foto es demasiado pesada. Prueba con otra.');
  }

  /* ── Cambiar de tipo de aporte ─────────────────────────────── */

  function elegirTipo(nuevo) {
    tipo = nuevo;
    document.querySelectorAll('.aportar__tipo').forEach((b) => {
      const activo = b.dataset.tipo === nuevo;
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    document.querySelectorAll('[data-seccion]').forEach((s) => { s.hidden = s.dataset.seccion !== nuevo; });
    $('aportarTextoEtiqueta').textContent = nuevo === 'recuerdo'
      ? 'Tu recuerdo'
      : '¿Quieres contar algo más? (opcional)';
    error('');
  }

  /* ── Arranque ──────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', async () => {
    let enlace = null;
    try {
      if (fid && token) enlace = await AlbumDatos.aportes.leerEnlace(fid, token);
    } catch (e) {
      console.error('[Aportar]', e);
    }
    if (!enlace) {
      $('aportarFamilia').textContent = 'Aportar al álbum';
      $('aportarInvalido').hidden = false;
      return;
    }
    $('aportarFamilia').textContent = 'Álbum de la ' + enlace.etiqueta;
    document.title = 'Aportar al álbum de la ' + enlace.etiqueta;

    const sel = $('aportarPersona');
    sel.appendChild(new Option('— No sé / de la familia en general —', ''));
    enlace.personas.forEach((p) => sel.appendChild(new Option(p.nombre, p.id)));
    sel.appendChild(new Option('Otra persona (escribir su nombre)', '__otra'));
    sel.addEventListener('change', () => { $('aportarOtraFila').hidden = sel.value !== '__otra'; });

    try {
      $('aportarAutor').value = localStorage.getItem(CLAVE_AUTOR) || '';
    } catch (e) { /* sin almacenamiento: se escribe cada vez */ }

    document.querySelectorAll('.aportar__tipo').forEach((b) => b.addEventListener('click', () => elegirTipo(b.dataset.tipo)));

    $('aportarGrabar').addEventListener('click', () => {
      if (grabador && grabador.state === 'recording') grabador.stop();
      else empezarGrabacion();
    });

    $('aportarArchivo').addEventListener('change', async (e) => {
      const archivo = e.target.files && e.target.files[0];
      if (!archivo) return;
      error('');
      try {
        foto = await reducirFoto(archivo);
        const vista = $('aportarVista');
        vista.src = foto;
        vista.hidden = false;
      } catch (err) {
        foto = null;
        error(err.message);
      }
    });

    $('aportarForm').hidden = false;
    $('aportarForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      error('');
      const persona = sel.value;
      const aporte = {
        tipo,
        autor: $('aportarAutor').value,
        relacion: $('aportarRelacion').value,
        persona_id: persona && persona !== '__otra' ? persona : '',
        persona_nombre: persona === '__otra'
          ? $('aportarOtra').value.trim()
          : (persona ? sel.options[sel.selectedIndex].text : ''),
        texto: $('aportarTexto').value,
      };
      if (tipo === 'voz') {
        if (grabador) return error('Termina la grabación antes de enviar.');
        if (!grabacion) return error('Graba tu voz antes de enviar.');
        aporte.datos = grabacion.datos;
        aporte.duracion = grabacion.duracion;
      } else if (tipo === 'foto') {
        if (!foto) return error('Elige una foto antes de enviar.');
        aporte.datos = foto;
      }
      const boton = $('aportarEnviar');
      boton.disabled = true;
      boton.textContent = 'Enviando…';
      try {
        await AlbumDatos.aportes.enviar(fid, token, aporte);
        try { localStorage.setItem(CLAVE_AUTOR, aporte.autor.trim()); } catch (err) { /* opcional */ }
        $('aportarForm').hidden = true;
        $('aportarGracias').hidden = false;
        global.scrollTo(0, 0);
      } catch (err) {
        /* Los avisos de validación son para quien aporta, no un fallo */
        if (err.code) console.warn('[Aportar]', err);
        error(/permission/i.test(String(err.code || err.message))
          ? 'El enlace ya no es válido o el archivo no se aceptó. Pide uno nuevo a tu familia.'
          : err.message);
      } finally {
        boton.disabled = false;
        boton.textContent = 'Enviar a la familia';
      }
    });

    $('aportarOtro').addEventListener('click', () => {
      grabacion = null;
      foto = null;
      $('aportarAudio').hidden = true;
      $('aportarVista').hidden = true;
      $('aportarTexto').value = '';
      $('aportarReloj').textContent = 'Hasta 3 minutos';
      $('aportarGrabar').textContent = '● Grabar';
      $('aportarGracias').hidden = true;
      $('aportarForm').hidden = false;
    });
  });
})(window);
