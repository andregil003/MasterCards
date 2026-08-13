# AGENTS.md — Instrucciones para cualquier IA que trabaje en MasterCards

> **LEE ESTO PRIMERO.** Este fichero es la puerta de entrada al proyecto. Cualquier
> IA o desarrollador que retome este código debe leerlo y los documentos que
> referencia antes de escribir una sola línea.

## 1. Qué es MasterCards

PWA de flashcards estilo Anki, **Mobile-First** y **Offline-First**, en Vanilla JS
(sin frameworks, sin build system) con **Google Apps Script + Google Sheets** como
backend. App instalable (PWA), UI 100% en español.

## 2. Orden de lectura obligatorio

1. `AGENTS.md` (este fichero)
2. `docs/01_SPEC.md` — funcionalidad y decisiones tomadas
3. `docs/02_SCHEMA.md` — estructura de datos (hojas + localStorage)
4. `docs/03_API_SYNC.md` — contrato backend y motor de sincronización
5. `docs/04_SRS.md` — algoritmo SM-2 y fechas
6. `docs/05_FRONTEND.md` — arquitectura del frontend y UI/CSS
7. `docs/06_DEPLOYMENT.md` — pasos manuales de despliegue
8. `docs/07_CHECKLIST.md` — criterios de verificación

**Regla de oro**: cada dato vive en UN solo documento. Si un documento dice algo
distinto a otro, el de mayor número de prioridad manda: `SPEC > SCHEMA > API_SYNC >
SRS > FRONTEND`. Si encuentras contradicciones, corrígelas en el doc correcto y
registra el cambio al final de `01_SPEC.md` (log de decisiones).

## 3. Decisiones YA tomadas (NO cambiar sin consultar al dueño)

- Nombre de la app: **MasterCards**.
- Backend: **Google Apps Script Web App** (deploy "Execute as: Me" + "Anyone").
- Autenticación: **GIS (Google Identity Services)** con flujo `redirect`
  (los popups fallan en iOS). El frontend envía el ID token; el backend lo
  verifica contra `https://oauth2.googleapis.com/tokeninfo` y comprueba `aud`.
- Almacenamiento local: **localStorage** (mazos, tarjetas, email, syncQueue).
- Datos en dos hojas: **Mazos** y **Tarjetas** (ver `02_SCHEMA.md`).
- Sincronización: cola `syncQueue` en localStorage, un único POST en lote con
  `Content-Type: text/plain;charset=utf-8` (workaround CORS: Apps Script no
  soporta preflight OPTIONS). Idempotencia por UUID + `UpdatedAt` (LWW).
- SRS: **SM-2** con 4 botones: Otra vez=1, Difícil=3, Bien=4, Fácil=5.
- Iconos: **Font Awesome Free 6 AUTO-HOSPEDADO** en `assets/fontawesome/`.
  **PROHIBIDO usar emojis como iconos en la UI.**
- Animaciones: híbridas (error = shake sutil + glow rojo; acierto = pop + confeti
  verde) con ajuste Sutil/Híbrido/Vistoso en Ajustes y respeto a
  `prefers-reduced-motion`.
- Tarjetas: markdown ligero (negrita, cursiva, código, listas) + sección
  "¿Por qué?" (explicación) siempre visible al revelar.
- Config del usuario (Ajustes): tema (auto/claro/oscuro), intensidad de
  animaciones, revelar solución (al fallar / al final), límite diario de nuevas
  (slider 5–100), exportar JSON, borrar datos locales, cerrar sesión.
- Estudio: botón global "Estudiar Hoy" + botón por mazo. Resumen final con
  filtros Todas/Correctas/Falladas.
- Dashboard: orden manual con drag (pointer events, NO HTML5 drag) ↔ alfabético,
  búsqueda + filtros combinables (Vencidas/Nuevas/Favoritas).
- Service Worker: actualización automática SOLO si la syncQueue está vacía.
- Hosting: GitHub Pages. UI en español. Dark mode nativo + override manual.

## 4. Restricciones técnicas obligatorias

- **Vanilla JS + HTML + CSS.** Nada de frameworks, bundlers ni npm.
- Sin emojis en la UI (Font Awesome siempre).
- Fechas SIEMPRE en **epoch ms** (números). Nunca strings locales.
- Comentarios del código en español, JSDoc en funciones clave.
- No subir secretos. El Client ID OAuth no es un secreto (es público), pero
  NUNCA se sube el secreto del client ni tokens.
- `fetch` al backend SIEMPRE con `Content-Type: text/plain;charset=utf-8`.
- La UI debe funcionar en móvil (touch) y con teclado.

## 5. Estado del proyecto / tareas

(Actualizar aquí a medida que avance el proyecto. Marca lo completado.)

- [x] Repositorio creado (público, `andregil003/MasterCards`)
- [x] Documentación (`AGENTS.md` + `docs/01…07`)
- [x] `backend.gs` (Web App Apps Script)
- [x] `index.html`, `style.css`, `app.js`
- [x] `manifest.json`, `sw.js`
- [x] Assets Font Awesome auto-hospedado + íconos PWA
- [x] README.md final + `docs/06_DEPLOYMENT.md` completado
- [x] Apps Script desplegado (URL: `https://script.google.com/macros/s/AKfycbxjPVGw74cBjuj_GDMxvW2-PzFDifoj4c_kOW-4KsSM6SKDxuJw_HIEEnrbfzL3xc4c/exec`)
- [x] OAuth Client ID registrado (hecho: `830630854057-vaq4hic6p256qlmhoml90s78i3e9dqi0.apps.googleusercontent.com`)
- [x] GitHub Pages activado (`https://andregil003.github.io/MasterCards/`)
- [x] Instalación PWA con banner `beforeinstallprompt` + botón en Ajustes
- [x] Bottom nav (Inicio/Ajustes) en móvil; back header en escritorio
- [x] i18n ES/EN (diccionarios en `app.js`, `data-i18n`/`data-i18n-aria` en HTML,
      selector de idioma en Ajustes, persistencia en localStorage)
- [x] Botón "Copiar prompt" para que una IA genere el JSON del mazo
- [x] Tests automatizados (`node scripts/test.js`, `scripts/smoke-test.ps1`)
- [x] Checklist de verificación (`docs/07_CHECKLIST.md`, con sección 7.8 de tests)

## 6. Cómo verificar tu trabajo

- **Tests de lógica (sin navegador):** `node scripts/test.js`. Extrae funciones
  puras del propio `app.js` (SM-2, markdown, fechas, i18n) y verifica la paridad
  de claves ES/EN y que todas las `data-i18n` del HTML existen en ambos idiomas.
  Debe terminar con `PASS=… FAIL=0`.
- **Smoke test del backend desplegado:** `powershell -ExecutionPolicy Bypass -File
  scripts/smoke-test.ps1`. Comprueba el contrato JSON de la Web App (errores
  `BAD_REQUEST`/`AUTH_FAILED`, share público) sin tocar datos reales. Lee la URL
  desde `app.js`, así que nunca se desincroniza.
- **Verificación manual:** abrir `index.html` en un navegador (servidor estático)
  y seguir `docs/07_CHECKLIST.md`.
- Cualquier cambio debe mantener la app funcionando 100% offline tras el primer
  arranque online (SW + localStorage).
- Tras cambiar texto de la UI, añadir la clave en AMBOS diccionarios (`es` y `en`)
  de `app.js`; `node scripts/test.js` fallará si se te olvida.
- Tras cambiar `sw.js`, incrementar `CACHE` para que la versión nueva llegue a los
  clientes instalados.
