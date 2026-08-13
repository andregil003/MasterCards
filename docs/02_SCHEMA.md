# 02 — Esquema de Datos (SCHEMA)

> Prioridad 2. Define las hojas de cálculo y el estado local.

## 2.1 Hoja de cálculo "MasterCards"

Creada automáticamente por `backend.gs` en el primer uso (ID guardado en
Script Properties bajo la clave `SPREADSHEET_ID`).

### Hoja `Mazos`

| Col | Nombre | Tipo | Notas |
|-----|--------|------|-------|
| A | Mazo_ID | string (UUID) | Generado en cliente. Clave de compartición. |
| B | Usuario_Email | string | Dueño (email verificado, minúsculas). |
| C | Nombre | string | |
| D | Icono | string | Nombre del ícono FA sin `fa-` (ej. `layer-group`). |
| E | Color | string | Hex `#rrggbb` (acento del mazo). |
| F | Orden | number | Posición manual en dashboard. |
| G | Creado | number | epoch ms. |
| H | UpdatedAt | number | epoch ms. Para LWW. |
| I | Borrado | boolean | Soft-delete. |

### Hoja `Tarjetas`

| Col | Nombre | Tipo | Notas |
|-----|--------|------|-------|
| A | ID | string (UUID) | Generado en cliente. |
| B | Mazo_ID | string | FK → Mazos.A. |
| C | Usuario_Email | string | Dueño. |
| D | Icono | string | Opcional (`''` = sin ícono). |
| E | Pregunta | string | Markdown ligero. |
| F | Respuesta | string | Markdown ligero. |
| G | Explicacion | string | "¿Por qué es correcta?". |
| H | Intervalo | number | Días (SM-2). 0 = nunca estudiada. |
| I | Facilidad | number | EF (SM-2), default 2.5, mín 1.3. |
| J | ProximaRevision | number | epoch ms. 0 = tarjeta nueva. |
| K | UpdatedAt | number | epoch ms. Para LWW. |
| L | Borrado | boolean | Soft-delete. |

### Hoja `Usuarios` (cuentas MasterCards)

Creada automáticamente por `backend.gs`. Una fila por cuenta MC. La columna
`Usuario` es el `owner` que se usa como dueño de mazos/tarjetas.

| Col | Nombre | Tipo | Notas |
|-----|--------|------|-------|
| A | Usuario | string | username en minúsculas (sin `@`). Clave natural. |
| B | Salt | string | 32 hex únicos por usuario. |
| C | Hash | string | PBKDF2-HMAC-SHA256(password, salt, iteraciones), 64 hex. |
| D | Iteraciones | number | Guardadas por fila (permite subir coste a futuro). |
| E | TokenHash | string | SHA-256 del API token vigente (el token crudo solo vive en el cliente). |
| F | BackupCodes | string | JSON con los SHA-256 de los backup codes (nunca los códigos en claro). |
| G | TotpActivo | boolean | TOTP opcional habilitado. |
| H | Intentos | number | Fallos consecutivos de login/recover (para lockout). |
| I | BloqueoHasta | number | epoch ms hasta el que la cuenta queda bloqueada. 0 = sin bloqueo. |
| J | Creado | number | epoch ms. |

**Secreto TOTP**: se guarda en **Script Properties** (clave `TOTP:<usuario>`),
NUNCA en la hoja. Al recuperar la cuenta se rota (se borra el secreto y
`TotpActivo=false`).

## 2.2 Estado local (localStorage)

Claves (prefijo `mc_`):

| Clave | Contenido |
|-------|-----------|
| `mc_email` | Email del usuario logueado con Google. |
| `mc_username` | Username de la cuenta MasterCards logueada. |
| `mc_apitoken` | API token de la cuenta MasterCards (64 hex). Nunca se sube al repo. |
| `mc_decks` | Array de mazos (`{mazoId,nombre,icono,color,orden,creado,updatedAt,borrado}`). |
| `mc_cards` | Array de tarjetas (`{id,mazoId,icono,pregunta,respuesta,explicacion,intervalo,facilidad,proximaRevision,updatedAt,borrado}`). |
| `mc_syncQueue` | Array de operaciones pendientes (`{opId,tipo,createdAt,data}`). |
| `mc_settings` | `{tema:'auto'\|'claro'\|'oscuro', animacion:'sutil'\|'hibrido'\|'vistoso', revelar:'fallar'\|'final', limiteNuevas:number, favoritas:{cardId:true}}` |
| `mc_meta` | `{ultimaSync:number, nuevasHoy:{fecha:'YYYY-MM-DD',count:number}, sincronizando:boolean}` |

**Reglas:**
- Fechas siempre **epoch ms** (números). Solo el contador diario usa `YYYY-MM-DD`
  (string de fecha local) como clave.
- `favoritas` es un objeto `{cardId:true}` (estado LOCAL, no se sincroniza).
- El borrado en local es soft: se marca `borrado:true` y se elimina de las
  colecciones activas; la fila se conserva hasta que el servidor confirme.

## 2.3 IDs y deduplicación

- `mazoId` y `id` de tarjeta: **UUID v4 generados en el cliente** (sin guiones o
  con guiones; deben ser strings).
- `opId`: UUID único por operación de sync para **idempotencia** (reenvío no
  duplica).
- Upsert por ID. Escrituras LWW comparando `updatedAt`.
