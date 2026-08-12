# 06 — Despliegue (DEPLOYMENT)

> Pasos manuales. El código no puede hacer esto por ti.

## 6.1 Requisitos previos

- Repo público `andregil003/MasterCards` (hecho).
- GitHub Pages activado sobre `main` (ruta `/MasterCards`).
- Apps Script desplegado (URL `/exec`).
- OAuth Client ID (hecho).

## 6.2 OAuth Client ID (Google Cloud) — HECHO

- Proyecto en [console.cloud.google.com](https://console.cloud.google.com).
- Client ID de aplicación web:
  - Orígenes de JavaScript: `https://andregil003.github.io`
  - Redirecciones: `https://andregil003.github.io/`, `https://andregil003.github.io/MasterCards`
  - **Valor**: `830630854057-vaq4hic6p256qlmhoml90s78i3e9dqi0.apps.googleusercontent.com`
- El secreto del cliente NO se usa (GIS con flow de código implícito / ID token).

## 6.3 Apps Script — PENDIENTE (usuario)

1. [script.google.com](https://script.google.com) → proyecto `MasterCards-backend`.
2. Pegar `backend.gs` → Guardar.
3. Implementar → Nueva implementación → Aplicación web:
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier persona**
4. Copiar URL `/exec` → poner en `CONFIG.SCRIPT_URL` de `app.js`.
5. Para actualizar después: Implementar → Administrar implementaciones → Editar →
   **Nueva versión** (nunca borrar y recrear, o cambia la URL).

### Verificación rápida del backend
- Abrir `{URL}/exec?share_id=prueba` → debe devolver `{"ok":false,...}` (mazo no
  encontrado) o JSON. Si devuelve HTML o un error de CORS en la consola, revisar
  el acceso "Cualquier persona".

## 6.4 GitHub Pages

- GitHub → repo → Settings → Pages → Source: **Deploy from a branch**, `main`, `/`.
- URL resultante: `https://andregil003.github.io/MasterCards/`.
- Los origins del Client ID ya cubren esta URL.

## 6.5 Config final en `app.js`

```js
var CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/.../exec',
  GOOGLE_CLIENT_ID: '830630854057-...'
};
```

## 6.6 Fuentes (Font Awesome)

- Descargar FA Free 6 (css + woff2) de cdnjs y colocarlos en
  `assets/fontawesome/`. Referenciar en `index.html` con ruta relativa.
  (Script de descarga: `scripts/fetch-fontawesome.ps1` si existe.)

## 6.7 Actualizaciones

- Versionar el SW bumpando `CACHE` en `sw.js`.
- Commits en `main`; Pages publica automáticamente.
