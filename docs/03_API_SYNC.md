# 03 — Contrato Backend y Protocolo de Sincronización (API_SYNC)

> Prioridad 3. Contrato de red + motor de sincronización.

## 3.1 URL base

`SCRIPT_URL` = la URL `/exec` del deploy de Apps Script. Se configura en
`CONFIG` al inicio de `app.js`.

## 3.2 CORS (crítico)

Apps Script Web Apps **no soportan preflight OPTIONS**. El frontend SIEMPRE debe
enviar el body como `Content-Type: text/plain;charset=utf-8` (request "simple",
sin preflight). El deploy debe ser **"Execute as: Me" + "Anyone"**, que hace que
la respuesta incluya `Access-Control-Allow-Origin: *`.

```js
fetch(SCRIPT_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ token, syncOperations })
});
```

## 3.3 GET — Pull y compartición

### `GET {SCRIPT_URL}?email=<owner>&token=<token>`
Pull completo del usuario. `token` = **ID token de Google** (JWT) **o API token
de cuenta MasterCards** (64 hex). Respuesta:

```json
{
  "ok": true,
  "data": {
    "email": "user@gmail.com",
    "decks":  [ { "mazoId", "nombre", "icono", "color", "orden", "creado", "updatedAt", "borrado" } ],
    "cards":  [ { "id", "mazoId", "icono", "pregunta", "respuesta", "explicacion", "intervalo", "facilidad", "proximaRevision", "updatedAt", "borrado" } ]
  }
}
```
Incluye filas con `borrado:true` para que los clientes puedan converger.

### `GET {SCRIPT_URL}?share_id=<mazoId>`
Mazo público de solo lectura (sin auth). Respuesta: `{ "ok":true, "data": { "deck":{...}, "cards":[...] } }`.
`cards` excluye las borradas.

## 3.4 POST — Sync en lote

```json
{
  "token": "<idToken o apiToken MC>",
  "syncOperations": [
    { "opId": "uuid", "tipo": "createDeck", "createdAt": 123, "data": {...} },
    ...
  ]
}
```

Respuesta:

```json
{
  "ok": true,
  "data": {
    "email": "user@gmail.com",
    "processed": 2,
    "totalPending": 2,
    "results": [ { "opId": "...", "ok": true, "r": {...} },
                 { "opId": "...", "ok": false, "error": "..." } ]
  }
}
```

El cliente elimina de la cola **solo** las ops cuyo `opId` aparezca en `results`
(con `ok:true` o `ok:false` — el servidor ya las vio; las desconocidas se
reintentan).

### Tipos de operación (`tipo` → `data`)

| tipo | data | Notas |
|------|------|-------|
| `createDeck` | `{mazoId, nombre, icono, color, orden, creado}` | UPSERT |
| `editDeck` | `{mazoId, nombre?, icono?, color?, orden?}` | Campos presentes se actualizan |
| `deleteDeck` | `{mazoId}` | Soft-delete del mazo + cascada sobre tarjetas |
| `reorderDecks` | `{orden:[{mazoId,orden}]}` | Aplica orden por mazo |
| `createCards` | `{mazoId, tarjetas:[{id, icono, pregunta, respuesta, explicacion, intervalo?, facilidad?, proximaRevision?}]}` | UPSERT por id |
| `updateSRS` | `{id, intervalo, facilidad, proximaRevision, updatedAt}` | LWW por updatedAt |
| `editCard` | `{id, icono?, pregunta?, respuesta?, explicacion?, updatedAt}` | LWW por updatedAt |
| `deleteCard` | `{id}` | Soft-delete |

## 3.5 Errores

Respuesta de error: `{ "ok": false, "error": "CÓDIGO", "message": "..." }`.
Códigos de sync: `BAD_REQUEST`, `AUTH_REQUIRED`, `AUTH_FAILED`, `INTERNAL`.
Códigos de cuentas MC (además): `USERNAME_TAKEN`, `INVALID_USERNAME`,
`WEAK_PASSWORD`, `TOTP_INVALID`, `LOCKED` (con `data.bloqueoMs` restante).

## 3.6 Motor de sincronización (Sync Engine)

### Flujo de arranque (boot)
1. Si online y hay sesión:
   a. `flushQueue()` → envía todo `syncQueue` (≤100 ops por POST; si hay más, encadenar).
   b. `pull()` → `doGet?email&token` (token refrescado).
   c. `merge()` → por `mazoId`/`id` + `updatedAt` (LWW). El borrado remoto gana.
2. Render del dashboard.

### Encadenado local
- `enqueue(op)`: aplica el cambio a `mc_decks`/`mc_cards` inmediatamente, luego
  añade `op` a `mc_syncQueue` y guarda.

### Eventos
- `window.addEventListener('online', flushQueue)`.
- `document.visibilitychange` (visible + online → flush).
- Reintento con backoff: 1s → 5s → 30s (máx 3 reintentos por sesión).
- Durante el envío, `mc_meta.sincronizando=true` y se actualiza el indicador de nube.

### Indicador de estado (header)
- `al día`: online y cola vacía.
- `N pendientes`: offline (o errores) con `syncQueue.length > 0`.
- `sincronizando`: animación mientras corre `flushQueue`.

### Importar mazo (`?share=`)
1. `fetch(SCRIPT_URL?share_id=X)`.
2. Si sesión activa → confirmar "Importar este mazo a tu cuenta".
3. Copia simple: nuevos `mazoId` y `id`, `intervalo=0`, `facilidad=2.5`,
   `proximaRevision=0`; se encola `createDeck` + `createCards`.

## 3.7 Autenticación

Hay dos tipos de sesión, y el backend las distingue automáticamente
(`verifyAnyToken_`):

1. **Google (GIS)**: ID token JWT (~1h de vida). El frontend lo guarda en
   memoria (NO en localStorage de forma persistente) y lo refresca on-demand
   antes de cada flush/pull. El backend lo verifica contra
   `oauth2.googleapis.com/tokeninfo` y comprueba `aud === CLIENT_ID` y
   `email_verified`.
2. **Cuenta MasterCards**: username + contraseña. El API token (64 hex) se
   guarda en `mc_username`/`mc_apitoken` (localStorage) y se envía igual que el
   ID token. El backend lo hashea (SHA-256) y lo compara contra la hoja
   `Usuarios`. Los tokens MC **no caducan** pero se **rotan** en cada
   login/cambio de contraseña/recuperación.

Si el token expiró o es rechazado, el backend responde `AUTH_FAILED`; el
frontend refresca el token (Google) o cierra sesión (MC) y reintenta una vez.

## 3.8 Cuentas MasterCards — endpoint de auth

`POST {SCRIPT_URL}` con `Content-Type: text/plain;charset=utf-8`, body
`{ "action": "...", ... }`. Las acciones públicas no llevan token; las
autenticadas llevan `token` en el mismo body.

| action | autenticada | body | respuesta `ok` |
|--------|------------|------|----------------|
| `register` | no | `{username, password}` | `{username, apiToken, backupCodes[10], iteraciones}` |
| `login` | no | `{username, password, totpCode?}` | `{totpRequerido:true}` (si TOTP activo sin código) o `{username, apiToken, totpActivo}` |
| `recover` | no | `{username, method:'backup'\|'totp', code, nuevo}` | `{username, apiToken}` (rota token y TOTP) |
| `totpSetup` | sí | `{token, totpCode?, disable?}` | `{pending, secret, otpauth}` o `{activo}` |
| `changePassword` | sí | `{token, actual, nuevo}` | `{apiToken}` (token rotado) |
| `generateBackupCodes` | sí | `{token}` | `{backupCodes[10]}` (invalida los anteriores) |

Reglas de seguridad:
- Username: `^[a-z0-9][a-z0-9._-]{2,29}$` (minúsculas, sin `@`).
- Password: 8–128 con mayúscula, minúscula, dígito y símbolo; PBKDF2-HMAC-SHA256
  con 10.000 iteraciones y salt por fila.
- **Lockout**: 5 fallos de login/recover → cuenta bloqueada 15 min
  (`LOCKED` con `data.bloqueoMs`).
- Backup codes: formato `XXXXX-XXXXX`, alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`,
  solo se guardan hasheados (SHA-256) y se consumen de a uno.
- TOTP: RFC 6238, HMAC-SHA1, 6 dígitos, ventana ±1 paso. Secreto en Script
  Properties (`TOTP:<usuario>`). Apps Script no tiene HMAC-SHA1 nativo → se
  implementa sobre `Utilities.computeDigest`.
- `adminResetPassword(username, nueva)` (del dueño en el editor de Apps Script)
  como red de seguridad.
