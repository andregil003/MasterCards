# 05 — Arquitectura Frontend (FRONTEND)

> Prioridad 5. Módulos de `app.js`, UI, CSS y animaciones.

## 5.1 Ficheros

| Fichero | Rol |
|---------|-----|
| `index.html` | Pantallas, estructura, GIS, manifest+SW. |
| `style.css` | Tema, layout, flip 3D, animaciones. |
| `app.js` | Toda la lógica. |
| `manifest.json` | PWA. |
| `sw.js` | Service worker. |
| `assets/fontawesome/` | FA Free 6 auto-hospedado. |

## 5.2 Módulos de `app.js` (orden de definición)

1. **CONFIG** — `SCRIPT_URL`, `GOOGLE_CLIENT_ID`, constantes SM-2, íconos FA,
   nombres de claves localStorage.
2. **Utils** — `uuid()`, `esc()` (escape HTML), `md()` (markdown ligero),
   `todayStart()`, `fmtFecha()`, `saveJSON()`.
3. **Store** — getters/setters de localStorage con carga perezosa y cache en
   memoria; tolerancia a cuotas (`try/catch` + toast).
4. **Auth** — sesión dual: **GIS** (`ux_mode` condicional: popup en
   Android/desktop, redirect en iOS; callback, refresh) o cuenta **MC**
   (`mode:'google'|'mc'`, `hasSession()`, `owner()` → email o username,
   `startMcSession()`, `postAuth(action, body)` con errores `{code}`).
5. **Cuentas MC (4.5)** — pantallas de login/registro/códigos/recuperar/TOTP:
   `validarPasswordMC()` (política), medidor de fortaleza, backup codes (copiar/
   descargar), QR TOTP (`api.qrserver.com` + secreto manual), flujo
   registro → códigos → TOTP opcional.
6. **Sync Engine** — `enqueue`, `flushQueue`, `pull`, `merge`, backoff,
   listeners `online`/`visibilitychange`, indicador de nube. **El bloque más
   comentado del fichero.**
7. **SRS** — `sm2(card, q)`, `sesionHoy(deckId?, limit)`, contador diario.
8. **Router** — `show(...)` con secciones `data-screen`:
   `login|registro|backupcodes|totp|recuperar|dashboard|crearMazo|estudio|ajustes|resumen`.
9. **Dashboard** — render de mazos, búsqueda + filtros, drag (pointer events),
   compartir, FAB.
10. **CrearMazo** — pestañas JSON / Tarjetas manuales + picker de ícono/color.
    - **JSON**: pega el JSON de IA; acepta `t` (tipo) y `o` (opciones). Si un
      tipo no trae datos válidos (opciones para `opcion`/`desplegable`, número
      entero para `escala`/`numero`) se degrada a `tarjeta`.
    - **Tarjetas manuales**: lista de N tarjetas (añadir/borrar, renumeradas
      automáticamente) con selector de tipo por tarjeta y textarea de opciones
      con `*` para `opcion`/`desplegable`.
    - **Picker de ícono/color**: botón `.icon-sel` que abre panel plegable con
      chips de categoría (`CONFIG.ICON_GROUPS`), grid de iconos y fila de 8
      colores. El color elegido (`iconoColor`) es local-only.
11. **Estudio** — flip, editar/borrar, respuesta según tipo de tarjeta
    (`renderAnswers`): 4 botones SRS (clásica), opciones (`opt-btn`, barajadas,
    una oportunidad), `<select>`+Comprobar (`desplegable`), botones 1–10
    (`escala`), input numérico+Comprobar (`numero`, `parseEntero`), input+Comprobar
    (`texto`), o «Ver respuesta» + «La sabía»/«No la sabía» (`abierta`). Tipos
    tipados gradúan q=4/q=1, revelan siempre la respuesta y dejan 2,2 s de
    feedback. Animaciones, buffer de resumen, revelar al fallar/final.
12. **Ajustes** — persiste `mc_settings`, export/borrado/logout; para cuentas MC
    bloque de **Seguridad** (cambiar contraseña, TOTP, regenerar códigos).
    Botón **Instalar app** separado por `hr.settings-sep` de los botones
    destructivos. Campo **Tu nombre** (para el saludo del dashboard).
13. **Saludo** — `saludoDeLaHora()` (5–12 mañana, 12–20 tarde, 20–5 noche) +
    `renderGreeting()` con nombre del usuario si `settings.nombre` existe;
    `maybeAskName()` abre un modal único la primera vez (Omitir o Guardar),
    editable después desde Ajustes.
14. **Login MC** — placeholder de usuario traducible; cada campo de contraseña
    (login, registro ×2, recuperar ×2, seguridad ×3) lleva un toggle `.pw-toggle`
    para mostrar/ocultar (`initPasswordToggles`).
15. **Errores globales** — `window.onerror`/`unhandledrejection` muestran el
    `crash-box` fijo (mensaje + botón recargar); nunca pantallas en blanco.
16. **Boot** — secuencia inicial (sesión → flush → pull → merge → router).

## 5.3 Markdown ligero (`md()`)

Renderiza con escape HTML previo: `**negrita**`, `*cursiva*`, `` `código` ``,
líneas iniciadas con `- ` (lista). Devuelve HTML seguro (nunca innerHTML sin escapar).

## 5.4 Íconos Font Awesome

- **UI**: solo FA auto-hospedado. Prohibidos emojis.
- Galería del usuario (~30): `brain, bolt, book, book-open, calculator, camera,
  car, cat, cloud, code, compass, dog, dumbbell, earth-americas, feather,
  flag, flask, football, gamepad, gem, globe, graduation-cap, heart, history,
  language, leaf, lightbulb, location-dot, lock, magnet, map, mountain, music,
  palette, paw, pen, plane, plant, puzzle-piece, rocket, scale-balanced, star,
  sword, terminal, tree, trophy, utensils, video, volcano, wand-magic-sparkles`.
- Tarjeta individual: ícono opcional de la misma galería.
- Botones SRS: Otra vez `fa-rotate-left`, Difícil `fa-angles-down`, Bien
  `fa-circle-check`, Fácil `fa-bolt`.
- UI: FAB `fa-plus`, compartir `fa-share-nodes`, editar `fa-pen`, borrar
  `fa-trash`, ajustes `fa-gear`, nube `fa-cloud`/`fa-cloud-arrow-down`, búsqueda
  `fa-magnifying-glass`, cerrar `fa-xmark`, estudio `fa-graduation-cap`.

## 5.5 CSS y tema

- **Dark mode nativo** vía `prefers-color-scheme`, más override en
  `mc_settings.tema` (auto/claro/oscuro) añadiendo la clase `tema-claro` /
  `tema-oscuro` a `<html>` y usando variables CSS (`--bg`, `--surface`, `--text`,
  `--muted`, `--accent`, etc.).
- Mobile-first (`max-width: 520px`, `100dvh` para móvil, barra inferior fija);
  en escritorio (`@media min-width: 900px`) el layout se amplía: `main` a
  `1080px`, mazos en grid (`repeat(auto-fill, minmax(280px, 1fr))`), sin barra
  inferior (navegación por el header), FAB junto al contenedor, sheet de crear
  mazo y estudio centrados (~640px), ajustes en columna de 640px.
- Flip 3D: `.card-inner { transform-style: preserve-3d }`,
  `.card.flip .card-inner { transform: rotateY(180deg) }`,
  `.card-face { backface-visibility: hidden }`.
- Tipografía: system-ui / -apple-system / Segoe UI, `1rem` base.

## 5.6 Animaciones

Keyframes en `style.css`:

| Clase | Efecto | Duración |
|-------|--------|----------|
| `.flashcard.animate-error` | shake horizontal + glow rojo + parpadeo borde | ~350ms |
| `.flashcard.animate-success` | pop (scale 1→1.06→1) + glow verde | ~450ms |
| `.confetti-particula` | 10–16 partículas `fa-check` que suben y caen | ~700ms |

- Intensidad: `sutil` (disminuye glow y tamaño de confeti), `hibrido` (default),
  `vistoso` (más partículas y más rango). Se aplica como clase en el contenedor.
- **`prefers-reduced-motion: reduce`** → se desactivan los keyframes
  (solo transición de opacidad).
- Los botones SRS se deshabilitan durante la animación (~500ms) para no encadenar.

## 5.7 Drag & Drop (orden manual)

- NO usar HTML5 `drag` API (no funciona con touch). Usar pointer events:
  `pointerdown` sobre el grip `fa-grip-vertical` → `pointermove` reordena visual →
  `pointerup` persiste orden en `mc_decks` y encola `reorderDecks` (una sola op
  con el array completo de orden, al soltar).
- Mínimo 60px de altura de "hot zone" para touch.

## 5.8 Service Worker (`sw.js`)

- `CACHE = 'mastercards-v3'` (bump de versión para invalidar).
- Precache: `index.html`, `style.css`, `app.js`, `manifest.json`,
  `assets/fontawesome/css/all.min.css`, woff2 de FA, íconos PWA.
- Estrategias: **cache-first** para assets, **network-first con fallback al
  index** para navegaciones (`mode: 'navigate'`).
- **Auto-update solo si la cola está vacía**: en `activate`, si
  `localStorage['mc_syncQueue']` no está vacía, no hace `skipWaiting`/recarga
  (espera al siguiente evento de activación o recarga manual). Si está vacía,
  `clients.claim()` + recarga de pestañas activas.
