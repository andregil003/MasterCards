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

### `GET {SCRIPT_URL}?email=<email>&token=<idToken>`
Pull completo del usuario. Respuesta:

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
  "token": "<idToken>",
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
Códigos: `BAD_REQUEST`, `AUTH_REQUIRED`, `AUTH_FAILED`, `INTERNAL`.

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

- GIS emite un **ID token** (~1h de vida). El frontend lo guarda en memoria (NO
  en localStorage de forma persistente) y lo refresca on-demand antes de cada
  flush/pull.
- El backend verifica el token contra `oauth2.googleapis.com/tokeninfo` y
  comprueba `aud === CLIENT_ID` y `email_verified`.
- Si el token expiró entre que se generó y se envía, el backend responde
  `AUTH_FAILED`; el frontend refresca el token y reintenta una vez.
