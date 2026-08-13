/**
 * ============================================================
 *  MasterCards — Backend (Google Apps Script + Sheets)
 * ============================================================
 *  Web App que funciona como API para la PWA Offline-First.
 *
 *  DEPLOY (IMPORTANTE):
 *  - Ejecutar como: "Yo"
 *  - Quién tiene acceso: "Cualquier persona"
 *  Con ese deploy, Apps Script responde con
 *  `Access-Control-Allow-Origin: *` (permite CORS desde la PWA).
 *  El frontend SIEMPRE envía el body como `text/plain;charset=utf-8`
 *  para evitar el preflight OPTIONS (Apps Script no lo soporta).
 *
 *  ALMACENAMIENTO:
 *  - Se crea automáticamente una hoja de cálculo "MasterCards" la
 *    primera vez que se usa (su ID se guarda en Script Properties).
 *  - Dos hojas: "Mazos" y "Tarjetas".
 *
 *  SEGURIDAD:
 *  - Autenticación mediante ID token de Google (GIS). El backend lo
 *    verifica llamando a oauth2.googleapis.com/tokeninfo y comprueba
 *    que `aud` sea el Client ID de la app (ver CLIENT_ID abajo).
 *  - El endpoint de "compartir" (?share_id=) es público y de SOLO
 *    LECTURA por diseño: cualquiera con el enlace puede importar.
 * ============================================================
 */

// ------------------------------------------------------------------
// CONFIGURACIÓN
// ------------------------------------------------------------------
// ⚠️ Sustituir por el Client ID real de la app web (Google Cloud).
// Verificado contra `aud` del ID token para impedir tokens ajenos.
var CLIENT_ID = '830630854057-vaq4hic6p256qlmhoml90s78i3e9dqi0.apps.googleusercontent.com';

var SHEET_NAME = 'MasterCards';
var SS_PROP_KEY = 'SPREADSHEET_ID';

// Columnas de la hoja "Mazos" (1-indexed)
var MAZOS = {
  MAZO_ID: 1,        // UUID generado en el cliente (clave de compartición)
  EMAIL: 2,          // Usuario_Email  (dueño del mazo)
  NOMBRE: 3,         // Nombre
  ICONO: 4,          // Icono (nombre del ícono Font Awesome, sin "fa-")
  COLOR: 5,          // Color de acento (hex)
  ORDEN: 6,          // Posición manual en el dashboard (número)
  CREADO: 7,         // Creado (epoch ms)
  UPDATED_AT: 8,     // UpdatedAt (epoch ms) — para resolución LWW
  BORRADO: 9         // Borrado (true = eliminación lógica)
};

// Columnas de la hoja "Tarjetas" (1-indexed)
var TARJETAS = {
  ID: 1,             // UUID generado en el cliente
  MAZO_ID: 2,        // Referencia a Mazos.MAZO_ID
  EMAIL: 3,          // Usuario_Email (dueño)
  ICONO: 4,          // Icono opcional de la tarjeta
  PREGUNTA: 5,       // Pregunta (markdown ligero)
  RESPUESTA: 6,      // Respuesta (markdown ligero)
  EXPLICACION: 7,    // Explicación "¿por qué es correcta?"
  INTERVALO: 8,      // Días de intervalo actual (SM-2)
  FACILIDAD: 9,      // Factor de facilidad EF (SM-2)
  PROX_REVISION: 10, // ProximaRevision (epoch ms; 0 = tarjeta nueva)
  UPDATED_AT: 11,    // UpdatedAt (epoch ms) — LWW
  BORRADO: 12        // Borrado lógico
};

// Encabezados usados para crear las hojas en el primer arranque
var HEADERS = {
  MAZOS: ['Mazo_ID', 'Usuario_Email', 'Nombre', 'Icono', 'Color', 'Orden',
          'Creado', 'UpdatedAt', 'Borrado'],
  TARJETAS: ['ID', 'Mazo_ID', 'Usuario_Email', 'Icono', 'Pregunta', 'Respuesta',
             'Explicacion', 'Intervalo', 'Facilidad', 'ProximaRevision',
             'UpdatedAt', 'Borrado']
};

// ------------------------------------------------------------------
// ENDPOINTS HTTP
// ------------------------------------------------------------------

/**
 * GET:
 *  ?email=<email>&token=<idToken>  → pull completo del usuario (mazos + tarjetas)
 *  ?share_id=<mazoId>              → mazo público (solo lectura, sin auth)
 */
function doGet(e) {
  try {
    ensureDataStore_(); // crea la hoja de cálculo en el primer acceso
    var params = (e && e.parameter) || {};
    // --- Compartir: endpoint público de solo lectura ---
    if (params.share_id) {
      return jsonOk(getDeckPublic_(params.share_id));
    }
    // --- Pull del usuario (requiere token verificado) ---
    if (params.email && params.token) {
      var email = verifyGoogleToken_(params.token);
      if (!email || email !== String(params.email).toLowerCase()) {
        return jsonError('AUTH_FAILED', 'Token inválido o email no coincide');
      }
      return jsonOk(getUserData_(email));
    }
    return jsonError('BAD_REQUEST', 'Parámetros: ?email&token o ?share_id');
  } catch (err) {
    return jsonError('INTERNAL', String(err));
  }
}

/**
 * POST:
 *  Body (text/plain;charset=utf-8): { "token": "<idToken>", "syncOperations": [...] }
 *  Procesa las operaciones en lote (hasta MAX_OPS_PER_SYNC por request).
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // evita colisiones entre sincronizaciones
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.token) return jsonError('AUTH_REQUIRED', 'Falta el token');
    var email = verifyGoogleToken_(body.token);
    if (!email) return jsonError('AUTH_FAILED', 'Token inválido o expirado');

    ensureDataStore_();

    var ops = Array.isArray(body.syncOperations) ? body.syncOperations : [];
    var MAX_OPS = 100; // límite por request (evita timeouts de Apps Script)
    var accepted = ops.slice(0, MAX_OPS);
    var results = processOperations_(email, accepted);
    var report = {
      email: email,
      processed: accepted.length,
      totalPending: ops.length,
      results: results
    };
    return jsonOk(report);
  } catch (err) {
    return jsonError('INTERNAL', String(err));
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// OPERACIONES DE SINCRONIZACIÓN
// ------------------------------------------------------------------

/**
 * Procesa una lista de operaciones offline. Cada op es idempotente:
 *  - Los creates son UPSERTS (por UUID): reenviar no duplica.
 *  - Las escrituras aplican last-write-wins comparando UpdatedAt.
 * Devuelve un array con el resultado de cada operación.
 */
function processOperations_(email, ops) {
  var results = [];
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i] || {};
    try {
      switch (op.tipo) {
        case 'createDeck':    results.push({ opId: op.opId, ok: true, r: createDeck_(email, op.data || {}) }); break;
        case 'editDeck':      results.push({ opId: op.opId, ok: true, r: editDeck_(email, op.data || {}) }); break;
        case 'deleteDeck':    results.push({ opId: op.opId, ok: true, r: deleteDeck_(email, op.data || {}) }); break;
        case 'reorderDecks':  results.push({ opId: op.opId, ok: true, r: reorderDecks_(email, op.data || {}) }); break;
        case 'createCards':   results.push({ opId: op.opId, ok: true, r: createCards_(email, op.data || {}) }); break;
        case 'updateSRS':     results.push({ opId: op.opId, ok: true, r: updateSRS_(email, op.data || {}) }); break;
        case 'editCard':      results.push({ opId: op.opId, ok: true, r: editCard_(email, op.data || {}) }); break;
        case 'deleteCard':    results.push({ opId: op.opId, ok: true, r: deleteCard_(email, op.data || {}) }); break;
        default:              results.push({ opId: op.opId, ok: false, error: 'TIPO_DESCONOCIDO: ' + op.tipo });
      }
    } catch (err) {
      results.push({ opId: op.opId, ok: false, error: String(err) });
    }
  }
  return results;
}

/** UPSERT de un mazo (createDeck / edición implícita). */
function createDeck_(email, d) {
  var sheet = getMazos_();
  var data = sheet.getDataRange().getValues();
  // Seguridad: la búsqueda SIEMPRE filtra por email. Si el mazo existe pero
  // pertenece a otro usuario, se rechaza (no se sobrescriben datos ajenos).
  var row = findRow_(data, MAZOS.MAZO_ID, d.mazoId, email);
  if (row === 0 && findRow_(data, MAZOS.MAZO_ID, d.mazoId) > 0) {
    throw new Error('Mazo perteneciente a otro usuario: ' + d.mazoId);
  }
  var now = Date.now();
  var valores = [
    d.mazoId, email, d.nombre || 'Sin nombre', d.icono || 'layer-group',
    d.color || '#22c55e', d.orden != null ? d.orden : 0,
    d.creado || now, now, false
  ];
  if (row > 0) {
    // Ya existe (ej. operación reenviada): actualizar sólo campos editables
    var r = sheet.getRange(row, 1, 1, valores.length);
    setCell_(r, MAZOS.NOMBRE, d.nombre || data[row - 1][MAZOS.NOMBRE - 1]);
    setCell_(r, MAZOS.ICONO,  d.icono || data[row - 1][MAZOS.ICONO - 1]);
    setCell_(r, MAZOS.COLOR,  d.color || data[row - 1][MAZOS.COLOR - 1]);
    setCell_(r, MAZOS.ORDEN,  d.orden != null ? d.orden : data[row - 1][MAZOS.ORDEN - 1]);
    setCell_(r, MAZOS.UPDATED_AT, now);
    setCell_(r, MAZOS.BORRADO, false);
  } else {
    sheet.appendRow(valores);
  }
  return { mazoId: d.mazoId };
}

/** Edición de metadatos de un mazo (nombre, ícono, color, orden). */
function editDeck_(email, d) {
  var row = findMazoRow_(email, d.mazoId);
  if (row < 0) throw new Error('Mazo no encontrado: ' + d.mazoId);
  var r = getMazos_().getRange(row, 1, 1, 9);
  if (d.nombre != null) setCell_(r, MAZOS.NOMBRE, d.nombre);
  if (d.icono != null) setCell_(r, MAZOS.ICONO, d.icono);
  if (d.color != null) setCell_(r, MAZOS.COLOR, d.color);
  if (d.orden != null) setCell_(r, MAZOS.ORDEN, d.orden);
  setCell_(r, MAZOS.UPDATED_AT, Date.now());
  return { mazoId: d.mazoId };
}

/** Borrado lógico de un mazo + cascada sobre sus tarjetas. */
function deleteDeck_(email, d) {
  var sheet = getMazos_();
  var data = sheet.getDataRange().getValues();
  var row = findRow_(data, MAZOS.MAZO_ID, d.mazoId, email);
  if (row > 0) {
    sheet.getRange(row, MAZOS.BORRADO).setValue(true);
    sheet.getRange(row, MAZOS.UPDATED_AT).setValue(Date.now());
  }
  // Cascada: soft-delete de todas sus tarjetas
  var cards = getTarjetas_();
  var cData = cards.getDataRange().getValues();
  for (var i = 1; i < cData.length; i++) {
    if (String(cData[i][TARJETAS.MAZO_ID - 1]) === String(d.mazoId)) {
      cards.getRange(i + 1, TARJETAS.BORRADO).setValue(true);
      cards.getRange(i + 1, TARJETAS.UPDATED_AT).setValue(Date.now());
    }
  }
  return { mazoId: d.mazoId };
}

/** Aplica el orden manual: data.orden = [ { mazoId, orden } ] */
function reorderDecks_(email, d) {
  var sheet = getMazos_();
  var data = sheet.getDataRange().getValues();
  (d.orden || []).forEach(function (item) {
    var row = findRow_(data, MAZOS.MAZO_ID, item.mazoId, email);
    if (row > 0) sheet.getRange(row, MAZOS.ORDEN).setValue(item.orden);
  });
  return { count: (d.orden || []).length };
}

/** UPSERT de tarjetas en lote (createCards). data: { mazoId, tarjetas: [...] } */
function createCards_(email, d) {
  // Seguridad: solo se permiten tarjetas en mazos del propio usuario.
  if (findMazoRow_(email, d.mazoId) < 0) {
    throw new Error('Mazo no encontrado: ' + d.mazoId);
  }
  var sheet = getTarjetas_();
  var data = sheet.getDataRange().getValues();
  var creadas = 0;
  (d.tarjetas || []).forEach(function (t) {
    if (!t || !t.id) return;
    var row = findRow_(data, TARJETAS.ID, t.id, email);
    var now = Date.now();
    if (row > 0) {
      // Upsert: sobreescribir texto (LWW simple por UpdatedAt)
      var r = sheet.getRange(row, 1, 1, 12);
      if (t.icono != null) setCell_(r, TARJETAS.ICONO, t.icono);
      if (t.pregunta != null) setCell_(r, TARJETAS.PREGUNTA, t.pregunta);
      if (t.respuesta != null) setCell_(r, TARJETAS.RESPUESTA, t.respuesta);
      if (t.explicacion != null) setCell_(r, TARJETAS.EXPLICACION, t.explicacion);
      setCell_(r, TARJETAS.UPDATED_AT, now);
      setCell_(r, TARJETAS.BORRADO, false);
    } else {
      sheet.appendRow([
        t.id, d.mazoId, email, t.icono || '', t.pregunta || '', t.respuesta || '',
        t.explicacion || '', t.intervalo || 0, t.facilidad || 2.5,
        t.proximaRevision || 0, now, false
      ]);
      creadas++;
    }
  });
  return { creadas: creadas, total: (d.tarjetas || []).length };
}

/**
 * Actualización de progreso SRS (updateSRS).
 * data: { id, intervalo, facilidad, proximaRevision, updatedAt }
 * LWW: sólo aplica si updatedAt del cliente es más reciente que la fila.
 */
function updateSRS_(email, d) {
  var sheet = getTarjetas_();
  var data = sheet.getDataRange().getValues();
  var row = findRow_(data, TARJETAS.ID, d.id, email);
  if (row < 0) throw new Error('Tarjeta no encontrada: ' + d.id);
  var fila = data[row - 1];
  var serverTs = Number(fila[TARJETAS.UPDATED_AT - 1]) || 0;
  var clientTs = Number(d.updatedAt) || 0;
  if (clientTs < serverTs) return { id: d.id, skipped: 'lww' }; // versión más vieja
  var r = sheet.getRange(row, 1, 1, 12);
  setCell_(r, TARJETAS.INTERVALO, d.intervalo != null ? d.intervalo : 0);
  setCell_(r, TARJETAS.FACILIDAD, d.facilidad != null ? d.facilidad : 2.5);
  setCell_(r, TARJETAS.PROX_REVISION, d.proximaRevision != null ? d.proximaRevision : 0);
  setCell_(r, TARJETAS.UPDATED_AT, Math.max(clientTs, serverTs));
  return { id: d.id };
}

/** Edición de texto de una tarjeta (editCard). LWW por UpdatedAt. */
function editCard_(email, d) {
  var sheet = getTarjetas_();
  var data = sheet.getDataRange().getValues();
  var row = findRow_(data, TARJETAS.ID, d.id, email);
  if (row < 0) throw new Error('Tarjeta no encontrada: ' + d.id);
  var fila = data[row - 1];
  var serverTs = Number(fila[TARJETAS.UPDATED_AT - 1]) || 0;
  var clientTs = Number(d.updatedAt) || 0;
  if (clientTs < serverTs) return { id: d.id, skipped: 'lww' };
  var r = sheet.getRange(row, 1, 1, 12);
  if (d.icono != null) setCell_(r, TARJETAS.ICONO, d.icono);
  if (d.pregunta != null) setCell_(r, TARJETAS.PREGUNTA, d.pregunta);
  if (d.respuesta != null) setCell_(r, TARJETAS.RESPUESTA, d.respuesta);
  if (d.explicacion != null) setCell_(r, TARJETAS.EXPLICACION, d.explicacion);
  setCell_(r, TARJETAS.UPDATED_AT, Math.max(clientTs, serverTs));
  return { id: d.id };
}

/** Borrado lógico de una tarjeta (deleteCard). */
function deleteCard_(email, d) {
  var sheet = getTarjetas_();
  var data = sheet.getDataRange().getValues();
  var row = findRow_(data, TARJETAS.ID, d.id, email);
  if (row > 0) {
    sheet.getRange(row, TARJETAS.BORRADO).setValue(true);
    sheet.getRange(row, TARJETAS.UPDATED_AT).setValue(Date.now());
  }
  return { id: d.id };
}

// ------------------------------------------------------------------
// LECTURAS
// ------------------------------------------------------------------

/** Pull completo del usuario: mazos + tarjetas (incluye borradas para converger). */
function getUserData_(email) {
  var mazos = readMazos_(email);
  var mazoIds = mazos.map(function (m) { return String(m.mazoId); });
  var tarjetas = mazoIds.length ? readTarjetas_(mazoIds, email) : [];
  return { email: email, decks: mazos, cards: tarjetas };
}

/** Mazo público por share_id (deck + tarjetas no borradas). */
function getDeckPublic_(shareId) {
  var data = getMazos_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][MAZOS.MAZO_ID - 1]) === String(shareId) && !data[i][MAZOS.BORRADO - 1]) {
      var deck = rowToDeck_(data[i]);
      var cards = readTarjetas_([String(shareId)]).filter(function (c) { return !c.borrado; });
      return { deck: deck, cards: cards };
    }
  }
  throw new Error('Mazo no encontrado');
}

function readMazos_(email) {
  var data = getMazos_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (String(r[MAZOS.EMAIL - 1]).toLowerCase() !== email) continue;
    out.push(rowToDeck_(r));
  }
  return out;
}

function readTarjetas_(mazoIds, email) {
  var data = getTarjetas_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (mazoIds.indexOf(String(r[TARJETAS.MAZO_ID - 1])) === -1) continue;
    if (email && String(r[TARJETAS.EMAIL - 1]).toLowerCase() !== email) continue;
    out.push({
      id: String(r[TARJETAS.ID - 1]),
      mazoId: String(r[TARJETAS.MAZO_ID - 1]),
      icono: String(r[TARJETAS.ICONO - 1] || ''),
      pregunta: String(r[TARJETAS.PREGUNTA - 1] || ''),
      respuesta: String(r[TARJETAS.RESPUESTA - 1] || ''),
      explicacion: String(r[TARJETAS.EXPLICACION - 1] || ''),
      intervalo: Number(r[TARJETAS.INTERVALO - 1]) || 0,
      facilidad: Number(r[TARJETAS.FACILIDAD - 1]) || 2.5,
      proximaRevision: Number(r[TARJETAS.PROX_REVISION - 1]) || 0,
      updatedAt: Number(r[TARJETAS.UPDATED_AT - 1]) || 0,
      borrado: !!r[TARJETAS.BORRADO - 1]
    });
  }
  return out;
}

function rowToDeck_(r) {
  return {
    mazoId: String(r[MAZOS.MAZO_ID - 1]),
    nombre: String(r[MAZOS.NOMBRE - 1] || ''),
    icono: String(r[MAZOS.ICONO - 1] || 'layer-group'),
    color: String(r[MAZOS.COLOR - 1] || '#22c55e'),
    orden: Number(r[MAZOS.ORDEN - 1]) || 0,
    creado: Number(r[MAZOS.CREADO - 1]) || 0,
    updatedAt: Number(r[MAZOS.UPDATED_AT - 1]) || 0,
    borrado: !!r[MAZOS.BORRADO - 1]
  };
}

// ------------------------------------------------------------------
// AUTENTICACIÓN
// ------------------------------------------------------------------

/**
 * Verifica un ID token OIDC de Google y devuelve el email verificado.
 * Llama a tokeninfo (endpoint público, sin API key) y comprueba `aud`.
 * @return {String|null} email o null si el token no es válido.
 */
function verifyGoogleToken_(idToken) {
  if (!idToken) return null;
  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  var info = JSON.parse(resp.getContentText());
  // `aud` debe ser NUESTRO Client ID → el token fue emitido para esta app.
  if (info.aud !== CLIENT_ID) return null;
  // `email_verified` debe ser true
  if (info.email_verified !== true) return null;
  var now = Date.now() / 1000;
  if (info.exp && info.exp < now) return null; // token expirado
  return String(info.email || '').toLowerCase();
}

// ------------------------------------------------------------------
// INFRAESTRUCTURA (hoja de cálculo)
// ------------------------------------------------------------------

/** Garantiza que exista la hoja de cálculo y las dos hojas con encabezados. */
function ensureDataStore_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SS_PROP_KEY);
  var ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    props.setProperty(SS_PROP_KEY, ss.getId());
  }
  ensureSheet_(ss, 'Mazos', HEADERS.MAZOS);
  ensureSheet_(ss, 'Tarjetas', HEADERS.TARJETAS);
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
}

function getMazos_() {
  // Autodefensa: si aún no existe la hoja, se crea (evita "Argumento no válido: id")
  var id = PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY);
  if (!id) ensureDataStore_();
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY)).getSheetByName('Mazos');
}
function getTarjetas_() {
  var id = PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY);
  if (!id) ensureDataStore_();
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY)).getSheetByName('Tarjetas');
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

/** Busca la fila (1-indexed, 0 si no existe) de un valor en la columna A. */
function findRow_(data, colIdx, valor, email) {
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIdx - 1]) === String(valor)) {
      if (email && String(data[i][1]).toLowerCase() !== email) continue; // col 2 = email
      return i + 1;
    }
  }
  return 0;
}

/** Busca la fila de un mazo perteneciente al email dado. */
function findMazoRow_(email, mazoId) {
  return findRow_(getMazos_().getDataRange().getValues(), MAZOS.MAZO_ID, mazoId, email);
}

/** setValue en una celda dentro de un rango ya creado (a partir del índice). */
function setCell_(range, colIdx, value) {
  range.getCell(1, colIdx).setValue(value);
}

function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: code, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------
// MENÚ (para depurar desde el editor de Apps Script)
// ------------------------------------------------------------------

/** Ejecutar manualmente la primera vez para crear la BD (opcional). */
function setup() {
  ensureDataStore_();
  Logger.log('Base de datos lista: ' +
    SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY)).getUrl());
}
