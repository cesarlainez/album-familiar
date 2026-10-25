# Álbum Familiar como servicio — plan v3

> Objetivo: abrir el álbum a cualquier familia, con registro y varios usuarios,
> cobrando **como máximo 1 US$ al mes**, sin perder dinero en el alojamiento y con
> más formas de buscar familias, personas y lugares.
>
> v3: reglas de Firestore reales que aplican el plan, consentimiento
> vinculado al usuario, índice solo vía Worker, dueño intocable, firma de
> fotos por lote, tope de precio explícito y límite de pérdida.
>
> v2 incorporó las observaciones de dos revisiones (negocio/finanzas y
> técnica/seguridad). Cambios grandes: economía con impuestos, contador y
> contracargos; pasarela confirmada antes de programar; archivos privados;
> reglas, cuotas e índice hechos por servidor; plazos duplicados; GEDCOM; plan
> de cierre ordenado.

---

## 0. Punto de partida (lo que ya existe)

| Pieza | Estado hoy | Problema para venderlo |
|---|---|---|
| Frontend | HTML/CSS/JS puro en GitHub Pages, sin build | Bien: se mueve a Cloudflare Pages (gratis, uso comercial permitido). |
| Datos | Firestore (Spark), `familias/{id}/perfiles` | Ya separado por familia; falta saber *quién* pertenece a cada una. |
| Fotos | Data URL dentro de Firestore (`fotos/`, < 900 KB) | Cada foto vista = lecturas Firestore; límite de 1 MiB. |
| Seguridad | Lectura pública; escritura con **una** cuenta compartida (`AUTH_EMAIL`) | Cualquiera con sesión escribe en cualquier familia. |
| Búsqueda | Buscador de familias oculto; no hay campo de lugar | Falta todo lo de buscar familias y lugares. |
| Diferencial | Lienzo de grafo libre, flip-card, PNG/PDF, respaldo .zip, filtro por rama | Se conserva tal cual. |

---

## 1. Puerta de entrada: lo que se confirma ANTES de programar (Fase 0)

Sin una forma legal de cobrar y recibir el dinero en El Salvador, el
proyecto no existe. Por eso esto va primero y es condición para seguir:

1. **Pasarela principal: Paddle** (*merchant of record*: vende al cliente,
   liquida IVA/sales tax de EE. UU. y la UE, gestiona contracargos).
   Confirmar por escrito: (a) que acepta un vendedor de El Salvador,
   (b) cómo paga (transferencia, PayPal o Payoneer) y con qué comisión,
   (c) tarifa real para un producto de 9,99 US$ (Paddle negocia precio para
   productos de menos de 10 US$), (d) si el precio se muestra con o sin
   impuestos.
2. **Pasarela local opcional: Wompi El Salvador.** Pedir por escrito tarifa
   (la ficha pública habla de ~2,85 %), si hay cargo fijo y si admite cobros
   recurrentes. Si no admite recurrencia, no hay plan mensual.
3. **Contador** (en esta fase solo **una consulta única**; el contrato
   mensual empieza en la Fase 5, cuando se cobra): inscripción (NIT/IVA si aplica), si las ventas vía Paddle
   cuentan como exportación de servicios (IVA 0 %), obligación de
   facturación electrónica (DTE), impuesto sobre la renta y costo mensual.
4. **Abogado** (una vez): términos de uso, política de privacidad conforme a
   la ley salvadoreña de datos personales y lo básico de GDPR/CCPA para la
   diáspora, contenido subido por usuarios y retiro de contenido.
5. Descartadas: Lemon Squeezy (en transición a Stripe Managed Payments; con
   recargos internacional + suscripción + pago fuera de EE. UU. sale ~7–8 %)
   y Stripe directo (cuenta estándar para El Salvador no confirmada).

**Regla de salida**: si Paddle no acepta al vendedor y Wompi no admite
recurrencia, se para el proyecto y se evalúa Payoneer + PayPal antes de
escribir una línea de código de cobro.

---

## 2. Tres propuestas innovadoras (reordenadas)

Criterio: que no disparen el costo por familia, que ayuden a vender y que
encajen con cómo funcionan las familias salvadoreñas (abuelos en WhatsApp,
mitad de la familia en EE. UU.).

### 2.1 «Atlas de raíces» — lugares y búsqueda (antes del primer cobro)
- Campo estructurado `lugares` (nacimiento, residencia, defunción) con
  catálogo de El Salvador (departamento → municipio → distrito, según la
  reorganización de 2024), cantones como texto libre, y ciudades de la
  diáspora.
- **Mapa + línea de tiempo**: la migración de la familia animada por décadas
  (MapLibre + teselas PMTiles servidas desde R2; sin cuota de Google Maps).
- **Buscador**: personas (apellido, década, lugar), familias (apellidos,
  lugar de origen) y lugares, sobre el índice público (sección 5.5).
- Por qué primero: es lo que pidió el dueño (buscar familias y lugares), no
  depende de que existan otras familias y es barato.

### 2.2 «Aportes sin cuenta» — que los abuelos y los tíos de lejos participen
- El admin genera un **enlace de aportes** y lo comparte por WhatsApp. Quien
  lo abre (sin registrarse) ve una página móvil sencilla: **grabar una nota
  de voz** (botón grande), subir una foto, escribir un recuerdo, decir «esta
  persona en la foto es…».
- Todo cae en una **bandeja de revisión**; el admin o un editor lo aprueba
  y lo pega al perfil. Nada se publica solo.
- Notas de voz Opus 24 kbps (~180 KB/min, máx. 3 min).
- Por qué es diferencial: MyHeritage/FamilySearch exigen cuenta para
  aportar; aquí el abuelo solo toca un botón desde WhatsApp. Es también el
  motor de crecimiento: cada aporte trae gente nueva al árbol.
- Enlace con token aleatorio, caduca (14 días), con límite de aportes por
  día y de tamaño; el Worker lo controla (5.3).

### 2.3 «Puentes familiares» — conectar árboles con precisión (después de 15 familias de pago)
- Un **proceso de servidor** (no el navegador) compara personas del índice.
  Hay coincidencia solo con **puntaje mínimo**: apellidos fonéticos + década
  + lugar **y además** coincidencia de al menos un padre, madre o cónyuge.
  Así se evita la avalancha de falsos «Hernández, San Salvador, años 50».
- Máximo 5 propuestas por familia al mes.
- Máquina de estados `propuesto → aceptadoA | aceptadoB → aceptado |
  rechazado`; cada lado lo acepta su admin. La comparación usa un **índice
  de emparejamiento interno** (`emparejamiento/{fid_pid}`, solo servidor,
  nunca legible desde el cliente) que incluye a las familias privadas que
  activen los puentes, con los mismos filtros de vivos y menores que el
  índice público. **El nombre de la otra familia
  solo se revela cuando ambas aceptan**; antes se ve «otra familia registrada
  podría compartir a…». Una familia privada puede desactivar los puentes.
- Al aceptar, aparece un hilo de luz dorado entre los dos lienzos; no se
  copian datos y cualquiera de los dos puede retirarlo.

**Ideas menores para después**: QR imprimible por persona, cápsula del
tiempo (desbloqueo decidido por la hora del servidor), póster impreso por
afiliado (ingreso extra).

---

## 3. Precio y modelo de cobro

### 3.1 Quién paga: la familia, no la persona
Se cobra **por árbol**; los miembros invitados son ilimitados y gratis. Una
familia de 10 personas paga ~0,08 US$ por persona al mes.

### 3.2 Planes

| | **Semilla** (gratis) | **Familia** |
|---|---|---|
| Precio | 0 | **9,99 US$/año** (≈ 0,83 US$/mes) + impuestos donde la ley lo exija; mensual de **1 US$ con IVA incluido** solo si Wompi admite recurrencia |
| Personas en el árbol | hasta 60 | hasta 2 000 |
| Fotos | 1 por persona, máx. 60 | 4 por persona, cuota 3 GB |
| Aportes sin cuenta | 10 al mes | ilimitados (con límite diario anti-abuso) |
| Miembros / roles | 3 | ilimitados (admin, editor, lector) |
| Buscador | sí | sí |
| Puentes | no | sí (cuando exista) |
| GEDCOM (importar/exportar) | exportar sí; importar hasta 60 personas | sí |
| Respaldo automático semanal | — | sí (además del .zip manual) |
| Visibilidad | privada o con enlace | privada, con enlace o pública |

Prueba de 30 días del plan Familia al registrarse (sin tarjeta). Al terminar
sin pagar, la familia vuelve a los límites de Semilla: lo que exceda queda
**en solo lectura**, sin borrar nada. Su costo durante la prueba (~0,01 US$)
es despreciable frente al margen.

### 3.3 Neto real por cobro

| Escenario | Cálculo | Neto/año |
|---|---|---|
| Paddle, comprador de EE. UU., precio + impuestos | 9,99 − (5 % + 0,50) | 8,99 |
| Paddle, comprador de la UE con IVA incluido (peor caso) | 9,99/1,20 − comisión | ~7,30 |
| Comisión de envío del dinero (Payoneer/transferencia) | ~3 % | −0,27 |
| Reserva para reembolsos y contracargos | 2 % de la venta | −0,20 |
| **Neto base que usa el plan (conservador)** | | **8,00** |
| Wompi mensual 1 US$ IVA incl. (si existe) | 0,885 − (3 % + IVA de la comisión) × 12 | ~10,20 |

---

## 4. Costos

### 4.1 Arquitectura objetivo

```
Navegador ── Cloudflare Pages (HTML/JS, gratis)
   │
   ├─ Firebase Auth (correo, Google, enlace mágico)
   ├─ Firestore (Blaze): familias, miembros, personas, índice, puentes
   ├─ Cloud Functions: índice, contadores, emparejamiento, corte por presupuesto
   └─ Cloudflare Worker ── R2 PRIVADO: fotos, miniaturas, audios, respaldos
         ├─ verifica token de Firebase y membresía → firma URLs GET/PUT cortas
         ├─ cuotas, límites por usuario, enlaces de aportes e invitaciones
         └─ webhooks de Paddle/Wompi → escribe plan en Firestore (REST + cuenta de servicio)
```

### 4.2 Precios de referencia (verificar al contratar)
- **R2**: 10 GB-mes, 1 M escrituras y 10 M lecturas gratis/mes; luego
  0,015 US$/GB-mes, 4,50 US$/M escrituras, 0,36 US$/M lecturas; egreso 0.
- **Firestore** (Blaze): gratis 1 GiB + 50 000 lecturas y 20 000 escrituras
  diarias; luego ~0,06 US$/100 000 lecturas y ~0,18 US$/GiB-mes.
- **Cloud Functions**: 2 M invocaciones/mes gratis.
- **Workers**: 100 000 peticiones/día gratis; plan pagado 5 US$/mes (solo
  cuando se acerque al límite, o para Durable Objects).
- **App Check con reCAPTCHA**: gratis hasta ~10 000 evaluaciones/mes; luego
  plan de pago (~8 US$/mes por 100 000). Se presupuesta desde 1 000 familias.
- **Correo transaccional**: los correos de Auth son gratis; avisos propios
  con un plan gratuito (p. ej. 3 000/mes) hasta que haga falta pagar.
- **Dominio**: ~12 US$/año.

### 4.3 Costo variable por familia (supuesto conservador)

| | Familia de pago (150 personas, 300 fotos, 10 min audio, 40 visitas/mes) | Familia gratuita (60 personas, 60 fotos) |
|---|---|---|
| R2 almacenamiento + lecturas | 0,006 | 0,0015 |
| Firestore lecturas/escrituras | 0,004 | 0,0015 |
| Worker (1 firma de lote por visita, subidas, búsquedas) | 0,0002 | 0,0001 |
| **US$/mes** | **≈ 0,01** | **≈ 0,003** |

### 4.4 Costos fijos y únicos

| Concepto | Únicos | Mensual |
|---|---|---|
| Dominio | — | 1 |
| Contador (**estimado, a confirmar en Fase 0**) | 100 inscripción | 40 |
| Abogado: términos y privacidad (**estimado, a confirmar en Fase 0**) | 300 | — |
| Imprevistos de nube | — | 4 |
| Workers pagado + reCAPTCHA (a partir de ~1 000 familias) | — | 13 |
| **Total al inicio** | **400** | **45** |

### 4.5 Puntos de equilibrio (honestos)

Supuestos: conversión 3 % → **33 familias gratuitas por cada una de pago**;
neto 8,00 US$/año; costo variable por familia de pago 0,12 US$/año + 33
gratuitas × 0,036 = 1,31 US$/año. **Aporte neto por familia de pago:
6,69 US$/año.**

| Qué se cubre | Fijos/año | Familias de pago necesarias | Familias totales |
|---|---|---|---|
| **A. Solo alojamiento** (dominio + nube) | 60 | **9** (más ~300 gratuitas) | ~310 |
| **B. Alojamiento + contador** (+156 de Workers/reCAPTCHA, por pasar de 1 000 familias) | 696 | **104** | ~3 550 |
| **C. B + 400 únicos recuperados en 1 año** | 1 096 | **164** | ~5 580 |
| **D. C + tiempo del dueño (10 h/mes × 10 US$)** | 2 296 | **344** | ~11 700 |

Las tarifas de contador, abogado y la hora del dueño (10 US$) son
estimaciones: al cerrar la Fase 0 se recalculan B, C y D con las cifras
reales.

Lectura: **el alojamiento se paga con menos de 10 familias**; lo que de
verdad cuesta es el contador y el tiempo del dueño. Por eso:
- Si el contador confirma que, a bajo volumen, se puede declarar sin
  contrato mensual, la meta B cae a la A.
- Con renovación base del **50 %** cada año, para mantener 164 familias
  de pago hay que conseguir ~82 nuevas al año.

### 4.6 Candados reales contra facturas sorpresa
1. **Corte automático probado**: alerta de presupuesto (Pub/Sub) → Cloud
   Function que pone `config/global.soloLectura = true` (las reglas lo leen
   y bloquean escrituras) y, si se pasa del tope duro, desvincula la
   facturación del proyecto. Se prueba en la Fase 1 con un tope de 1 US$.
   Las alertas llegan con horas de retraso: por eso también los puntos 2–4.
   Ojo: desvincular la facturación también detiene las Functions (incluido
   el propio corte) y deja el proyecto en cuotas gratuitas; el
   restablecimiento es manual: revisar la causa, volver a vincular la
   facturación y poner `soloLectura = false`. Por eso el primer escalón es
   el flag y la desvinculación queda solo como tope duro. Paddle reintenta
   los webhooks fallidos; al restablecer, se concilian los pagos del
   periodo desde la API de Paddle para que ninguno quede sin registrar.
2. **Límites por usuario en el Worker** (Rate Limiting de Cloudflare o
   Durable Objects): subidas/día, bytes/día, búsquedas/minuto.
3. **Límite de cuentas nuevas por día** y verificación de correo antes de
   crear una familia.
4. **Sin listeners masivos**: el lienzo lee una vez y cachea; nada de
   `onSnapshot` sobre colecciones grandes.
5. **Árboles públicos como instantánea**: al publicar, una Function genera
   un JSON estático en R2 (sin personas vivas); una visita anónima cuesta
   0 lecturas Firestore.
6. App Check para el navegador (no frena a un usuario con script; para eso
   están los límites 2–3).

---

## 5. Multiusuario: cómo se construye

### 5.1 Modelo de datos
Los `fid` son aleatorios (no «Familia_Lainez»); el nombre visible es un campo.
```
config/global                  soloLectura (lo escribe solo la Function de corte)
usuarios/{uid}                 nombre, correo — NUNCA se usa para autorizar
familias/{fid}                 nombre, apellidos[], lugarRaiz, visibilidad (privada|enlace|publica),
                               apareceEnBusqueda, puentesActivos, tokenEnlace, dueño
familias/{fid}/estado/plan     plan (semilla|prueba|familia), venceEl, soloLectura,
                               cuotaBytes, usadoBytes, personas  ← solo servidor
familias/{fid}/miembros/{uid}  uid, rol: admin | editor | lector
familias/{fid}/perfiles/{pid}  (lo de hoy) + lugares{}, fechaNac, fechaDef, fotos[] (claves R2), audios[],
                               uidVinculado        ← solo servidor (invitación «esta persona soy yo»)
                               consentimientoIndice{uid, fecha} ← solo el usuario vinculado
familias/{fid}/aportes/{id}    pendiente de revisión (lo crea el Worker)
invitaciones/{token}           fid, rol, vincularA (pid opcional), venceEl, usos  ← solo servidor
indice/{fid_pid}               claves[], nombreVisible, decada, lugar, fidPublico?  ← solo servidor
indiceFamilias/{fid}           apellidosFoneticos[], lugares[]  ← solo servidor (solo públicas)
emparejamiento/{fid_pid}       claves para Puentes  ← solo servidor
puentes/{id}                   fidA, pidA, fidB, pidB, puntaje, estado, aceptaA, aceptaB
                               (sin nombres de familias; se resuelven al quedar «aceptado»)
```

**Lo que hace solo el servidor** (Worker con cuenta de servicio, o
Functions): crear y borrar familias (con su `estado/plan` y el miembro
admin, en una transacción), altas por invitación, vincular un perfil a un
usuario, escribir `estado/`, índices, aportes y el estado de los puentes.
Así las reglas del cliente quedan cortas y comprobables.

### 5.2 Reglas de Firestore (texto real, a probar en el emulador)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function cfg()          { return get(/databases/$(db)/documents/config/global).data; }
    function fam(fid)       { return get(/databases/$(db)/documents/familias/$(fid)).data; }
    function plan(fid)      { return get(/databases/$(db)/documents/familias/$(fid)/estado/plan).data; }
    function refMiembro(fid){ return /databases/$(db)/documents/familias/$(fid)/miembros/$(request.auth.uid); }
    function esMiembro(fid) { return request.auth != null && exists(refMiembro(fid)); }
    function rol(fid)       { return get(refMiembro(fid)).data.rol; }
    function editor(fid)    { return esMiembro(fid) && rol(fid) in ['admin', 'editor']; }
    function admin(fid)     { return esMiembro(fid) && rol(fid) == 'admin'; }
    function limite(p)      { return p in ['familia', 'prueba'] ? 2000 : 60; }
    function cambia()       { return request.resource.data.diff(resource.data).affectedKeys(); }
    // Escribir exige: sin corte global, plan vigente (30 días de gracia) y sin bloqueo del plan.
    function puedeEscribir(fid) {
      let p = plan(fid);
      return cfg().soloLectura != true && p.soloLectura != true
          && (p.plan == 'semilla' || p.venceEl + duration.value(30, 'd') > request.time);
    }

    match /config/{doc}   { allow read: if request.auth != null; allow write: if false; }
    match /usuarios/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }

    match /familias/{fid} {
      allow read: if esMiembro(fid);          // anónimos y «con enlace» ven la instantánea, no Firestore
      allow create, delete: if false;         // solo el Worker
      allow update: if admin(fid) && puedeEscribir(fid)
        && cambia().hasOnly(['nombre', 'apellidos', 'lugarRaiz', 'visibilidad', 'apareceEnBusqueda', 'puentesActivos'])
        && request.resource.data.visibilidad in ['privada', 'enlace', 'publica']
        && (request.resource.data.visibilidad != 'publica' || plan(fid).plan == 'familia');

      match /estado/{doc} { allow read: if esMiembro(fid); allow write: if false; }

      match /miembros/{uid} {
        allow read: if esMiembro(fid);
        allow create: if false;               // altas solo por el Worker
        // Nadie toca su propio rol ni al dueño (que siempre es admin → la familia nunca queda sin admin).
        allow update: if admin(fid) && uid != request.auth.uid && uid != fam(fid).dueño
          && cambia().hasOnly(['rol']) && request.resource.data.rol in ['admin', 'editor', 'lector'];
        allow delete: if uid != fam(fid).dueño && (admin(fid) || uid == request.auth.uid);
      }

      match /perfiles/{pid} {
        allow read: if esMiembro(fid);
        allow create: if editor(fid) && puedeEscribir(fid)
          && plan(fid).get('bloqueoAltas', false) != true
          && plan(fid).personas < limite(plan(fid).plan)
          && !request.resource.data.keys().hasAny(['uidVinculado', 'consentimientoIndice']);
        allow update: if puedeEscribir(fid) && (
             (editor(fid) && !cambia().hasAny(['uidVinculado', 'consentimientoIndice'])
              // la fecha de defunción de alguien vinculado (vivo con cuenta) no la toca un editor
              && (resource.data.get('uidVinculado', '') == '' || !cambia().hasAny(['fechaDef'])))
          || (request.auth.uid == resource.data.get('uidVinculado', '')
              && cambia().hasOnly(['consentimientoIndice'])
              && (request.resource.data.get('consentimientoIndice', null) == null
                  || request.resource.data.consentimientoIndice.uid == request.auth.uid)));
        // Borrar siempre se puede (salvo corte global): es la salida para volver bajo el límite.
        allow delete: if editor(fid) && cfg().soloLectura != true;
      }

      match /aportes/{id} {
        allow read, delete: if editor(fid);
        allow create, update: if false;       // los crea el Worker
      }
    }

    // «Mis familias»: cada usuario lee sus propias membresías (collection group).
    match /{ruta=**}/miembros/{uid} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
    }

    match /puentes/{id} {
      allow read: if admin(resource.data.fidA) || admin(resource.data.fidB);
      allow update: if cfg().soloLectura != true && (
             (admin(resource.data.fidA) && cambia().hasOnly(['aceptaA']) && request.resource.data.aceptaA is bool)
          || (admin(resource.data.fidB) && cambia().hasOnly(['aceptaB']) && request.resource.data.aceptaB is bool));
      allow create, delete: if false;
    }

    // invitaciones, indice, indiceFamilias, emparejamiento y todo lo demás:
    // ni lectura ni escritura desde el cliente. La búsqueda pasa por el Worker.
    match /{documento=**} { allow read, write: if false; }
  }
}
```
Notas:
- El contador `personas` puede pasarse por unas pocas altas simultáneas
  (las reglas evalúan cada escritura de un lote contra el mismo valor). Por
  eso **las altas masivas (GEDCOM, restaurar copia) pasan por el Worker**,
  que valida `personas + n <= límite`; y la Function que mantiene el
  contador pone `estado/plan.bloqueoAltas` si se excede. `bloqueoAltas`
  solo frena altas: editar y borrar siguen permitidos para volver al
  límite. `soloLectura` del plan queda para vencimientos y abuso.
- Al vencer la prueba, una Function programada cambia `prueba → semilla` y
  pone `bloqueoAltas` si la familia pasa de 60 personas (no la deja en solo
  lectura).
- Riesgo aceptado y documentado: un editor podría poner una `fechaDef`
  falsa a una persona viva **sin cuenta vinculada**; para eso están el
  botón «Denunciar» y el derecho a borrar (5.7). Si la persona tiene
  `uidVinculado`, la Function exige su consentimiento aunque haya `fechaDef`.
- Cada petición usa a lo sumo 4 `get()` distintos (config, familia, plan,
  miembro), por debajo del límite de 10 de Firestore.

**Casos obligatorios en CI (emulador)**: usuario ajeno lee/escribe familia
privada; editor se asciende; admin degrada o expulsa al dueño; alta de
miembro sin Worker; familia Semilla se pone «publica»; alta de persona con
el plan lleno; escritura con plan vencido > 30 días; editor escribe
`consentimientoIndice` o `uidVinculado`; lectura directa de `indice` o
`invitaciones`; admin de A modifica `aceptaB`; corte global activo; borrar
con `bloqueoAltas`; retirar el consentimiento (campo borrado); editor
cambia `fechaDef` de un perfil vinculado; lote de altas que excede el tope.

### 5.3 Worker (Cloudflare)
- **Verificación del token de Firebase**: RS256 contra las claves JWKS de
  `securetoken.google.com`, comprobando `aud` = projectId, `iss`, `exp`,
  `iat` y `auth_time`. Las claves se cachean según su `Cache-Control`.
- **Escritura en Firestore** desde el Worker: API REST con una cuenta de
  servicio (JWT firmado → token OAuth, cacheado 55 min); la clave privada
  como *secret* del Worker.
- **Crear familia**: verifica correo confirmado, máximo 3 familias por
  cuenta, límite de familias nuevas por día (global y por IP) y **una sola
  prueba de 30 días por cuenta**; crea en una transacción `familias/{fid}`,
  `estado/plan` y `miembros/{uid}` (admin). Borrar familia: solo el dueño,
  con las subcolecciones y los archivos de R2 (tras 30 días de papelera).
- **Ver fotos y audios** (bucket R2 privado, claves aleatorias
  `fid/uuid.jpg`): el navegador hace **una** llamada `POST /firmar` con las
  claves visibles (máx. 200). El Worker lee **una vez** la membresía (o que
  la familia sea pública) y devuelve URLs GET firmadas con la fecha
  redondeada a la hora y **2 h de validez**: dentro de esa hora las URLs se
  repiten y el navegador las sirve de su caché, y nunca caducan antes de
  1 h. Consecuencia documentada: quien es expulsado conserva acceso a las
  fotos ya firmadas hasta 2 h. Coste por visita: 1 petición al Worker + 1 lectura
  Firestore + las lecturas R2 ya contadas en 4.3.
- **Subir**: comprueba rol, plan y cuota y firma un PUT con
  `Content-Length` y `Content-Type` fijados; si no se puede fijar, la
  subida pasa por el Worker (máx. 2 MB).
- **Imágenes**: el navegador las recodifica (canvas → JPEG/WebP, sin EXIF,
  máx. 1600 px) como hoy; el Worker valida los primeros bytes (firma JPEG/
  WebP/Opus) y el tamaño.
- **Cuotas**: el Worker actualiza `estado/plan.usadoBytes` en una
  transacción REST al confirmar cada subida; un recorrido nocturno de R2
  concilia el total y borra **huérfanos** (sin perfil que los referencie
  tras 7 días).
- **Personas**: una Function (`onWrite` en perfiles) mantiene
  `estado/plan.personas` (ver nota de 5.2).
- **Invitaciones**: valida token, fid, rol, caducidad y `usos > 0`; en una
  transacción decrementa `usos` y crea `miembros/{uid}` (siempre con el
  campo `uid`, del que depende «Mis familias»). Si la invitación
  trae `vincularA` («esta persona soy yo»), escribe además
  `perfiles/{pid}.uidVinculado = uid`; solo así puede alguien dar
  consentimiento sobre su propio perfil.
- **Búsqueda** `GET /buscar`: consulta `indice`/`indiceFamilias` por REST con
  la cuenta de servicio, máximo 20 resultados, límite por usuario y minuto.
- **Webhooks de pago**: firma verificada (Paddle/Wompi), idempotentes por
  id de evento; escriben `estado/plan`.

### 5.4 Flujos
1. **Registro**: correo + contraseña, Google o enlace mágico → verificar
   correo → «Crear mi familia» (Worker) o «Tengo una invitación».
2. **Invitar**: enlace con rol (y opcionalmente «esta persona eres tú»),
   para WhatsApp; caduca a 7 días.
3. **Panel «Mis familias»**: consulta collection group de `miembros` donde
   `uid == yo`, no `usuarios.familias[]`.
4. **GEDCOM** (5.5.1 y 7.0, en la Fase 3): importar en el navegador →
   resumen → escritura en lotes (cuenta para el plan); exportar además del
   .zip, para que la familia nunca quede atrapada.
5. **Pagar**: «Pasar a Familia» → Paddle → webhook → `estado/plan`. Al
   vencer: 30 días de gracia (lo aplican las reglas), después **solo
   lectura** (nunca se borra; siempre se puede descargar el .zip y el
   GEDCOM).
6. **Modo «con enlace»**: `?t=tokenEnlace` aleatorio (no el fid); muestra la
   instantánea sin personas vivas; el admin puede regenerar el token
   (endpoint `POST /enlace/regenerar` del Worker, porque las reglas no
   dejan escribir `tokenEnlace` desde el cliente).

### 5.5 Índice y búsqueda
- **Quién entra**: personas de familias con `visibilidad == 'publica'` o con
  `apareceEnBusqueda == true` (opción para familias privadas o «con
  enlace»). Las familias «con enlace» **no** entran salvo que activen esa
  opción.
- Lo construye una **Function** a partir de los perfiles, con ID `fid_pid`.
  Entra una persona solo si tiene `fechaDef`, **o** tiene
  `consentimientoIndice` cuyo `uid == uidVinculado`; y nunca si la edad
  calculada desde `fechaNac` es menor de 18 años, ni si faltan las dos
  fechas. Se reindexa al cambiar el perfil y se borra al borrarlo, al
  retirarse el consentimiento o al apagar la visibilidad.
- **Resultados**: de familias públicas se muestra la familia y se puede
  abrir su instantánea; de familias privadas solo nombre, década y lugar,
  con un botón «pedir contacto» (el Worker reenvía un correo al admin, sin
  revelar su identidad).
- **Fonética en español** (algoritmo propio documentado): minúsculas, sin
  tildes, `v→b`, `z/ce/ci→s`, `ll/y→y`, `h` muda, `qu/k/c(a,o,u)→k`,
  `g(e,i)/j→j`, colapsar letras dobles.
- **Claves compuestas precalculadas** para un solo `array-contains` por
  consulta: `ape:laines`, `ape:laines|dec:1930`, `ape:laines|lug:chalatenango`,
  `lug:chalatenango|dec:1930`. Familias en `indiceFamilias` (solo públicas).
  Todo pasa por el Worker (`read: false` en las reglas).

### 5.6 Migración de Familia_Lainez (sin perder nada)
1. Respaldo .zip y exportación completa de Firestore (`gcloud firestore
   export`) **antes de tocar nada**.
2. Script de migración: lee cada foto de Firestore, la sube a R2, compara
   **recuento y hash SHA-256**, reescribe las referencias del perfil.
3. Las fotos viejas se quedan en Firestore 30 días tras la verificación.
4. El dueño actual queda como `admin`; se eliminan el login compartido y
   `AUTH_EMAIL`.
5. Las reglas nuevas (que cierran la lectura pública) y la versión nueva
   del frontend se despliegan **juntas**; si el dueño quiere seguir
   enseñando el álbum, se publica como instantánea o «con enlace».

### 5.7 Privacidad, contenido y legal
- Personas vivas privadas por defecto; menores nunca en el índice ni en
  instantáneas públicas.
- **Botón «Denunciar»** en perfiles públicos e instantáneas; proceso de
  retiro en 72 h; cláusulas de contenido prohibido y derechos de autor.
- **Derecho a borrar para quien no es miembro**: formulario público →
  verificación por correo → aviso al admin → si no responde en 15 días, la
  persona se oculta del índice y de las instantáneas.
- Cuentas eliminadas: sus perfiles quedan en la familia (son de la familia),
  pero se borra su usuario y sus consentimientos.

---

## 6. Hoja de ruta (una persona, tiempo parcial)

| Fase | Semanas | Entregable | Criterio de salida |
|---|---|---|---|
| **0. Validar** | 1–3 | Paddle/Wompi por escrito, contador, abogado contratado; respaldo total del álbum | Pasarela viable confirmada (si no: se para) |
| **1. Blindaje** | 4–7 | Blaze + corte automático probado, App Check, Worker + R2 privado, Cloudflare Pages, migración de fotos con hashes. **Transitorio**: el Worker sirve GET sin sesión solo a la familia actual, marcada `publicaTemporal` (lo que hoy es lectura pública); se retira en la Fase 2 | Álbum igual que hoy para quien lo visita, factura 0 US$, corte probado |
| **2. Multiusuario** | 8–15 | Registro, familias por Worker, roles, invitaciones, reglas de 5.2 + emulador en CI, cuotas; se retira `publicaTemporal` y la familia actual pasa a instantánea o «con enlace» | Todos los casos de CI en verde |
| **3. Atlas, búsqueda y GEDCOM** | 16–22 | Lugares, índice por Function, buscador vía Worker, mapa; importar/exportar GEDCOM | Búsqueda < 1 s, ninguna persona viva sin consentimiento en el índice, GEDCOM de ida y vuelta sin pérdidas |
| **4. Beta cerrada** | 23–26 | 10–20 familias conocidas, gratis; legales publicados; soporte | ≥ 8 familias activas a 30 días |
| **5. Cobro** | 27–30 | Paddle (anual) + Wompi (si aplica), webhooks, vencimientos | Pago, reembolso y vencimiento probados de punta a punta |
| **6. Lanzamiento** | 31+ | Grupos de salvadoreños en EE. UU., videos cortos del lienzo, «regala el árbol» en Día de la Madre y Navidad | 9 familias de pago (meta A) en 3 meses |
| **7. Aportes sin cuenta** | tras meta A | Enlace de aportes + bandeja de revisión | ≥ 30 % de familias de pago lo usan |
| **8. Puentes** | tras 15 familias de pago | Function de emparejamiento + máquina de estados | < 20 % de propuestas rechazadas |

---

## 7. Indicadores y decisiones

| Indicador | Meta | Si no se cumple |
|---|---|---|
| Costo variable por familia | < 0,05 US$/mes | Bajar cuotas del plan gratuito |
| Conversión gratis → pago | ≥ 3 % | Ajustar límites de Semilla o la prueba de 30 días |
| Renovación anual | ≥ 50 % (base) | Recordatorios de aniversario y del respaldo |
| Horas de soporte del dueño | ≤ 10 h/mes | Más preguntas frecuentes y videos. Si hay que subir precio, **tope absoluto: 10,99 US$/año antes de impuestos u 11,99 US$/año con impuestos incluidos** (nunca más de 1 US$/mes) |
| Familias de pago a 12–18 meses del lanzamiento | ≥ 104 (meta B) | Revisar canal de venta antes de invertir más tiempo |
| **Límite de pérdida** a 12 meses del lanzamiento | ≥ 40 familias de pago | Cambiar el contador por declaración simple (si la ley lo permite) o congelar el plan pagado. Pérdida máxima aceptada: ~700 US$ (400 únicos + ~300 de operación) |

---

## 8. Plan de cierre ordenado (por si el dueño lo deja)

- Compromiso público en los términos: **aviso con 90 días** antes de cerrar.
- Durante el aviso: descarga del .zip y GEDCOM de cada familia, y
  reembolso proporcional de los planes anuales vigentes.
- El código es abierto (el repo ya es público); se ofrece el relevo a un
  voluntario o a la propia familia, que puede alojar su árbol con las
  instrucciones del README.
- Fondo de reserva: los primeros 12 meses de gastos fijos se apartan antes
  de considerar ganancia.

---

## 9. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Pasarela no paga a El Salvador | Puerta de la Fase 0: no se programa sin confirmarlo |
| Factura por abuso o un enlace viral | Instantáneas, límites en el Worker, corte automático probado (4.6) |
| Fuga entre familias o escalada de rol | Reglas de 5.2 probadas en CI; lo sensible lo escribe solo el servidor |
| Fotos privadas expuestas | R2 privado, URLs firmadas de 10 min, claves aleatorias |
| Datos de vivos o menores expuestos | Índice e instantáneas generados por servidor con filtros de edad y defunción |
| Contenido ilícito subido | Denuncia, retiro en 72 h, términos, recodificación y validación de archivos |
| Pérdida de datos (ya pasó con Supabase) | Respaldo semanal a un segundo bucket + exportación Firestore + .zip/GEDCOM por familia |
| Contracargos y reembolsos | Paddle los gestiona; reserva del 2 %; reembolso sin preguntas en 14 días |
| El dueño se agota con el soporte | Meta de ≤ 10 h/mes, plan de cierre ordenado |
