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
- 100% en español.

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
- **Auth**: Google Identity Services (flujo redirect). El backend verifica el ID
  token contra `oauth2.googleapis.com/tokeninfo`.

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

---

**Config actual**: `SCRIPT_URL` pendiente (esperando la URL `/exec` de tu deploy).
