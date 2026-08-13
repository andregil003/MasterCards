# MasterCards ⚡

PWA de **flashcards estilo Anki**, **Mobile-First** y **Offline-First**, en Vanilla
JS, con **Google Apps Script + Google Sheets** como backend.

- **Sin conexión**: puedes crear mazos, estudiar, editar y borrar tarjetas.
  Todo se sincroniza automáticamente cuando vuelves a tener red.
- **SRS SM-2**: 4 botones (Otra vez / Difícil / Bien / Fácil) con algoritmo de
  repetición espaciada y límite diario configurable.
- **Compartir mazos** por enlace (`?share=<ID>`).
- **Font Awesome auto-hospedado** (funciona 100% offline), sin emojis en la UI.
- Dark mode nativo + animaciones configurables (sutil/híbrido/vistoso).
- **Bilingüe ES/EN** (selector en Ajustes) e **instalable** (PWA con banner).
- **Dos formas de entrar**: con Google o creando una **cuenta MasterCards**
  (usuario + contraseña) con **verificación en dos pasos (TOTP)** opcional y
  **códigos de recuperación** de respaldo.

## ⚙️ Arquitectura

```
┌──────────────┐   fetch (text/plain)   ┌────────────────────┐   Sheets
│  PWA (HTML/  │ ─────────────────────► │  Apps Script       │ ──────►  Mazos
│  CSS/JS)     │ ◄───────────────────── │  (backend.gs)      │ ──────►  Tarjetas
│  localStorage│      JSON + CORS       │  + tokeninfo OIDC  │
└──────────────┘                        └────────────────────┘
```

- **Frontend**: `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`.
- **Backend**: `backend.gs` (Web App de Apps Script; deploy "Execute as: Me" + "Anyone").
- **Datos locales**: `localStorage` (`mc_*`). **Cola offline**: `mc_syncQueue`.
- **Auth**: Google Identity Services (flujo redirect) o cuentas MasterCards
  (PBKDF2 + TOTP). El backend distingue ambos tokens en el mismo pull/flush
  (`verifyAnyToken_`).

## 🚀 Despliegue

1. **Google Cloud** → crear **OAuth Client ID** (Aplicación web):
   - Orígenes: `https://<tu-usuario>.github.io`
   - Redirecciones: `https://<tu-usuario>.github.io/` y `https://<tu-usuario>.github.io/MasterCards`
2. **Apps Script** ([script.google.com](https://script.google.com)) → nuevo
   proyecto → pegar `backend.gs` → **Implementar → Aplicación web**:
   - Ejecutar como: **Yo** · Acceso: **Cualquier persona**
   - Copiar la URL `/exec`.
3. Editar `app.js` → `CONFIG.SCRIPT_URL` con la URL `/exec` y
   `CONFIG.GOOGLE_CLIENT_ID` con tu Client ID.
4. **GitHub Pages** → publicar `main`. Listo.

> Guía detallada paso a paso en [`docs/06_DEPLOYMENT.md`](docs/06_DEPLOYMENT.md).

## 📚 Documentación

Si una IA (o tú) va a retomar el proyecto, leer **`AGENTS.md` primero**:

| Doc | Contenido |
|-----|-----------|
| [`AGENTS.md`](AGENTS.md) | Instrucciones para cualquier IA + estado del proyecto |
| [`docs/01_SPEC.md`](docs/01_SPEC.md) | Funcionalidad y decisiones tomadas |
| [`docs/02_SCHEMA.md`](docs/02_SCHEMA.md) | Estructura de datos (hojas + localStorage) |
| [`docs/03_API_SYNC.md`](docs/03_API_SYNC.md) | Contrato backend y motor de sincronización |
| [`docs/04_SRS.md`](docs/04_SRS.md) | Algoritmo SM-2 y fechas |
| [`docs/05_FRONTEND.md`](docs/05_FRONTEND.md) | Arquitectura del frontend y UI |
| [`docs/06_DEPLOYMENT.md`](docs/06_DEPLOYMENT.md) | Pasos manuales de despliegue |
| [`docs/07_CHECKLIST.md`](docs/07_CHECKLIST.md) | Criterios de verificación |

## 🧪 Probar en local

```powershell
npx serve .   # o cualquier servidor estático (https necesario para SW)
```

Nota: el Service Worker y el login de Google requieren HTTPS o `localhost`.

## ✅ Tests

- **Lógica pura (SM-2, markdown, fechas, i18n, política de contraseña, TOTP,
  PBKDF2)** sin navegador:

  ```powershell
  node scripts/test.js
  ```

  Extrae las funciones reales de `app.js` y verifica que las claves ES/EN de los
  diccionarios y todos los `data-i18n` del HTML existen en ambos idiomas; el TOTP
  se valida contra los vectores del RFC 6238.
- **Contrato del backend desplegado** (solo lecturas y auth con credenciales
  inválidas, no toca datos):

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
  ```

---

**App en producción**: https://andregil003.github.io/MasterCards/
