# 01 — Especificación Funcional (SPEC)

> Prioridad 1. Si contradice a otro doc, este manda.
> Última actualización: ver "Log de decisiones" al final.

## 1.1 Visión

PWA de flashcards estilo Anki, Mobile-First, **Offline-First**: el usuario puede
crear mazos, estudiar, editar y borrar tarjetas sin conexión; todo se sincroniza
con Google Sheets cuando hay red. Compartición de mazos por enlace (`?share=`).

## 1.2 Pantallas

### Login
- Botón de **Google Identity Services** (flujo `redirect`, no popup).
- Guarda `email` en localStorage; mantiene el ID token en memoria y lo refresca
  antes de sincronizar.
- Si ya hay sesión y datos, va directo al Dashboard.

### Dashboard
- **Búsqueda** por nombre de mazo + **filtros acumulables** (chips):
  Vencidas / Nuevas / Favoritas. Combinables entre sí y con la búsqueda.
- Orden de mazos: **manual con drag** (grip handle, pointer events) ↔ toggle
  **alfabético**.
- Cada mazo muestra: ícono FA + color de acento, nombre, contadores (vencidas /
  nuevas / total), botón **Estudiar** y botón **Compartir** (copia
  `?share=<Mazo_ID>` al portapapeles).
- **FAB** `fa-plus` → Crear Mazo. Botón **"Estudiar Hoy"** global.
- Header con indicador de sync (nube): `al día` / `sin conexión, N pendientes` /
  `sincronizando` + acceso a **Ajustes** (⚙️).

### Crear Mazo (bottom sheet)
- Nombre, **ícono** (galería curada ~30 íconos FA), **color de acento**.
- Crear contenido:
  - **Pegar JSON de IA**: `[{"q":"...","a":"...","e":"opcional","i":"opcional"}]`.
  - **Tarjeta individual**: pregunta + respuesta + explicación + ícono opcional.
- Al guardar se crea el mazo (op `createDeck`) y las tarjetas (op `createCards`)
  en local y en la cola de sync.

### Estudio
- **Tarjeta giratoria 3D** (`rotateY`) con pregunta (frente) y respuesta +
  explicación "¿Por qué?" (dorso).
- Botones ✏️ editar (convierte en textarea) y 🗑️ borrar, en la propia tarjeta.
- **4 botones SRS**: Otra vez / Difícil / Bien / Fácil (ver `04_SRS.md`).
- **Estudio Libre**: ignora el SRS (no actualiza fechas).
- Modos: **Estudiar Hoy** (global o por mazo), incluye nuevas (con límite diario
  configurable) + vencidas.
- Animaciones: acierto (pop + confeti verde), error (shake + glow rojo).
- Config "Revelar solución": **Al fallar** (muestra al instante respuesta +
  explicación) o **Al final** (se acumulan las falladas y al terminar se muestra
  un resumen con filtros Todas / Correctas / Falladas por defecto).
- Al terminar la sesión: resumen (vistas, % acierto, tiempo, filtros) y opción de
  repasar falladas.

### Ajustes (⚙️)
- **Tema**: Auto (nativo) / Claro / Oscuro.
- **Animaciones**: Sutil / Híbrido / Vistoso (+ respeto a `prefers-reduced-motion`).
- **Revelar solución**: Al fallar / Al final.
- **Límite diario de nuevas**: slider 5–100 (default 20).
- **Exportar datos** (descarga JSON completo) · **Borrar datos locales** ·
  **Cerrar sesión** (mantiene datos; si entras con otro email, avisa y ofrece limpiar).

## 1.3 Compartición (`?share=`)

- Al cargar la app con `?share=<Mazo_ID>` y sesión activa: fetch del mazo público
  (`doGet` con `share_id`) y prompt **"Importar este mazo a tu cuenta"**.
- Importar = **copia simple**: deck y tarjetas con IDs NUEVOS y SRS reiniciado.
- Re-importar el mismo mazo duplica (comportamiento aceptado).

## 1.4 Fuera de alcance (v1)

- Sin multiusuario colaborativo sobre el mismo mazo (solo importar copias).
- Sin sincronización de favoritos al backend (los favoritos son locales).
- Sin sonido / TTS.
- Sin dedup de importaciones.

## Log de decisiones

- 2026-08-12: Nombre "MasterCards"; repo público `andregil003/MasterCards`.
- 2026-08-12: Backend en dos hojas (Mazos + Tarjetas) en lugar de una
  denormalizada, para soportar ícono/color/orden del mazo y deleteDeck limpio.
- 2026-08-12: Auth vía ID token verificado en backend (tokeninfo + check `aud`).
- 2026-08-12: Iconos FA por mazo Y por tarjeta (auto-hospedados).
- 2026-08-12: Animaciones híbridas con ajuste de intensidad.
- 2026-08-12: Columna `Explicacion` en Tarjetas + config "Revelar solución".
- 2026-08-12: i18n ES/EN con diccionarios en `app.js` y `data-i18n`/`data-i18n-aria`
  en el HTML; selector de idioma en Ajustes (persiste en `mc_settings.idioma`).
  Default `auto` (idioma del navegador); decisión: cada dato vive en UN lugar
  (diccionarios), el HTML solo referencia claves.
- 2026-08-12: Instalación PWA con banner `beforeinstallprompt` (descartable, se
  guarda en `mc_install_dismissed`) + botón "Instalar" en Ajustes; oculto si ya
  está instalada (`display-mode: standalone`).
- 2026-08-12: Bottom nav móvil (Inicio/Ajustes) reutilizando los handlers de
  `btn-settings`/`btn-back` (sin duplicar lógica de navegación).
- 2026-08-12: Botón "Copiar prompt" en creación de mazo: genera el prompt con el
  nombre del mazo para que una IA devuelva el JSON y rellena el textarea.
- 2026-08-12: Tests automatizados: `scripts/test.js` (lógica pura extraída del
  propio `app.js`, incluye paridad de claves i18n y cobertura `data-i18n` del
  HTML) y `scripts/smoke-test.ps1` (contrato de la Web App desplegada).
- 2026-08-12: Segundo método de login: cuenta MasterCards (usuario+contraseña)
  con hash PBKDF2-HMAC-SHA256 (10.000 iteraciones, salt por fila), política
  estricta de contraseña (8–128, mayúscula, minúscula, dígito, símbolo) y
  bloqueo temporal anti fuerza bruta (5 fallos → 15 min).
- 2026-08-12: Recuperación de cuenta SIN email: 10 backup codes (solo se
  guardan como SHA-256 en la hoja; consumo de un solo uso) + TOTP opcional
  (RFC 6238, HMAC-SHA1, 6 dígitos; secreto en Script Properties, NUNCA en la
  hoja) + `adminResetPassword` del dueño como red de seguridad.
- 2026-08-12: `verifyAnyToken_` unifica auth: el mismo pull/flush acepta ID
  tokens de Google (JWT de 3 segmentos) y API tokens de cuentas MC (64 hex,
  guardados como SHA-256). Los tokens MC se rotan en cada login/cambio de
  contraseña/recuperación.
- 2026-08-12: QR del TOTP vía `api.qrserver.com` (gratis) con entrada manual
  del secreto como fallback offline-first.
- 2026-08-12: Tests ampliados: `scripts/test.js` (47 asserts: política de
  contraseña, username, TOTP contra vectores RFC 6238, PBKDF2 con vectores de
  referencia) y `scripts/smoke-test.ps1` (caminos negativos de auth, sin crear
  cuentas reales).
- 2026-08-12: `Utilities.computeDigest` NO expone PBKDF2 (solo MD2/MD5/SHA-1/256/
  384/512). PBKDF2-HMAC-SHA256 se implementa a mano (RFC 2898, dkLen=32) sobre
  HMAC-SHA256 construido con `computeDigest(SHA_256)`. Verificado contra
  `crypto.pbkdf2Sync` (vectores c=1/2/4096) y con la prueba e2e desplegada.
- 2026-08-12: `scripts/e2e-auth.js`: prueba de extremo a extremo del flujo de
  cuentas MC contra el backend desplegado (register → login → TOTP →
  changePassword → backup codes → recover). Crea un usuario real de prueba
  `e2e_<rand>` en la hoja Usuarios (borrarlo tras la validación).
- 2026-08-12: Layout responsive de escritorio: mobile-first 520px se mantiene;
  `@media (min-width: 900px)` amplía `main` a 1080px, mazos en grid
  (auto-fill 280px), oculta la barra inferior (navegación por el header),
  FAB junto al contenedor y estudio/sheet/ajustes centrados. Logo oficial =
  `assets/icons/icon-192.png` (tarjeta blanca con rayo verde) en la cabecera.
- 2026-08-12: Se retira el logo grande de las pantallas de login/cuenta (se veía
  mal); el logo queda solo como icono pequeño en la cabecera.
- 2026-08-12: Unificación de espaciados (reglas `.btn.block + .btn.block`,
  márgenes de `.field-label`/`.error`, `hr` de Seguridad, `.login-links`).
- 2026-08-12: Google login 405 en PWA instalada → GIS pasa a `ux_mode:'popup'`
  en Android/desktop (redirect solo iOS); URIs de redirección registradas en
  Cloud Console (dominio + `/MasterCards` con y sin barra). Se añaden
  manejadores globales de error (`window.onerror`/`unhandledrejection`) con un
  `crash-box` visible (mensaje + recargar) para evitar pantallas en blanco.
- 2026-08-12: El logo oficial se regenera como **PNG transparente** (tarjeta
  blanca redondeada + rayo verde, `assets/icons/icon-192.png`) y se
  vuelve a colocar en las 5 pantallas de cuenta (`logo-img`, 96px, con sombra
  verde suave) además de la cabecera. SW a `mastercards-v5`, luego `v6` al
  sustituir la banda diagonal por el rayo clásico.
- 2026-08-12: **Tipos de tarjeta**: `tarjeta` (4 botones SRS), `abierta`
  (manual «La sabía»/«No la sabía»), `opcion` (opción múltiple, una
  oportunidad), `texto` (respuesta escrita con `normalizarTexto`). Los tipos
  automáticos gradúan q=4/q=1. Columnas nuevas `Tipo`/`Opciones` en la hoja
  `Tarjetas` con migración automática. JSON de importación acepta `t` y `o`;
  formulario individual y editor con selector de tipo. `scripts/test.js` 61/61.
