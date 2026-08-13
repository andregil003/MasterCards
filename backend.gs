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
 *  - Tres hojas: "Mazos", "Tarjetas" y "Usuarios".
 *
 *  AUTENTICACIÓN (dos vías):
 *  1. Cuentas MasterCards (usuario + contraseña):
 *     - Contraseñas con PBKDF2-HMAC-SHA256 + salt aleatorio por usuario
 *       (construido a mano sobre Utilities.computeDigest; iteraciones por fila).
 *     - Sesión por API token opaco (64 hex) del que solo se guarda su
 *       SHA-256 en la hoja. El cliente guarda el token crudo.
 *     - Recuperación sin email: 10 backup codes (SHA-256 de cada uno)
 *       y/o TOTP (RFC 6238, secreto en Script Properties, NO en la hoja).
 *     - Bloqueo temporal tras 5 intentos fallidos (15 min).
 *  2. Google (GIS): ID token OIDC verificado contra
 *     oauth2.googleapis.com/tokeninfo + comprobación de `aud`.
 *  La función verifyAnyToken_() decide por el formato del token:
 *  JWT (3 segmentos con puntos) → Google; hex (64) → cuenta MC.
 *  Por eso el pull (?email&token) y el flush ({token, syncOperations})
 *  usan el MISMO formato para ambas vías.
 *
 *  SEGURIDAD:
 *  - El endpoint de "compartir" (?share_id=) es público y de SOLO
 *    LECTURA por diseño: cualquiera con el enlace puede importar.
 *  - El secreto TOTP vive en Script Properties ('TOTP:<usuario>'),
 *    accesible solo desde el script; la hoja guarda únicamente hashes.
 *  - reset manual (dueño): adminResetPassword(usuario, nueva).
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

// Parámetros de las cuentas MasterCards
var PBKDF2_ITERACIONES = 10000;     // subible en el futuro (se guarda por fila)
var MAX_INTENTOS = 5;               // intentos fallidos antes del bloqueo
var BLOQUEO_MS = 15 * 60 * 1000;    // 15 minutos de bloqueo

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

// Columnas de la hoja "Usuarios" (1-indexed)
var USUARIOS = {
  USUARIO: 1,          // username (minúsculas, clave única)
  SALT: 2,             // Salt (hex) para PBKDF2
  HASH: 3,             // PBKDF2-HMAC-SHA256 hex
  ITERACIONES: 4,      // Iteraciones usadas al crear el hash
  API_TOKEN_HASH: 5,   // SHA-256 del API token vigente ('' = ninguno)
  BACKUP_CODES: 6,     // JSON array con el SHA-256 de cada backup code
  TOTP_ACTIVO: 7,      // true si el usuario activó TOTP
  INTENTOS: 8,         // Intentos fallidos consecutivos
  BLOQUEO_HASTA: 9,    // Epoch ms hasta el que la cuenta está bloqueada
  CREADO: 10           // Epoch ms de creación
};

// Encabezados usados para crear las hojas en el primer arranque
var HEADERS = {
  MAZOS: ['Mazo_ID', 'Usuario_Email', 'Nombre', 'Icono', 'Color', 'Orden',
          'Creado', 'UpdatedAt', 'Borrado'],
  TARJETAS: ['ID', 'Mazo_ID', 'Usuario_Email', 'Icono', 'Pregunta', 'Respuesta',
             'Explicacion', 'Intervalo', 'Facilidad', 'ProximaRevision',
             'UpdatedAt', 'Borrado'],
  USUARIOS: ['Usuario', 'Salt', 'Hash', 'Iteraciones', 'ApiTokenHash',
             'BackupCodes', 'TotpActivo', 'Intentos', 'BloqueoHasta', 'Creado']
};

// ------------------------------------------------------------------
// ENDPOINTS HTTP
// ------------------------------------------------------------------

/**
 * GET:
 *  ?email=<owner>&token=<token>  → pull completo (mazos + tarjetas).
 *    token = ID token de Google o API token de cuenta MasterCards.
 *  ?share_id=<mazoId>            → mazo público (solo lectura, sin auth).
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
      var email = verifyAnyToken_(params.token);
      if (!email || email !== String(params.email).toLowerCase()) {
        return jsonError('AUTH_FAILED', 'Token inválido o usuario no coincide');
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
 *  Body (text/plain;charset=utf-8), dos formatos:
 *   - Auth de cuentas MC: { "action": "register|login|recover|totpSetup|changePassword|generateBackupCodes", ... }
 *   - Sincronización:      { "token": "<token>", "syncOperations": [...] }
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // evita colisiones entre sincronizaciones y registros
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // ---- Acciones públicas de cuentas MasterCards (sin token) ----
    if (body.action === 'register') return handleRegister_(body);
    if (body.action === 'login') return handleLogin_(body);
    if (body.action === 'recover') return handleRecover_(body);

    // ---- Acciones autenticadas (requieren token de sesión) ----
    if (body.action) {
      if (!body.token) return jsonError('AUTH_REQUIRED', 'Falta el token');
      var owner = verifyAnyToken_(body.token);
      if (!owner) return jsonError('AUTH_FAILED', 'Token inválido o expirado');
      if (body.action === 'totpSetup') return handleTotpSetup_(owner, body);
      if (body.action === 'changePassword') return handleChangePassword_(owner, body);
      if (body.action === 'generateBackupCodes') return handleGenerateBackupCodes_(owner);
      return jsonError('BAD_REQUEST', 'Acción desconocida: ' + body.action);
    }

    // ---- Sincronización (cola de operaciones offline) ----
    if (!body.token) return jsonError('AUTH_REQUIRED', 'Falta el token');
    var email = verifyAnyToken_(body.token);
    if (!email) return jsonError('AUTH_FAILED', 'Token inválido o expirado');

    ensureDataStore_();

    var ops = Array.isArray(body.syncOperations) ? body.syncOperations : [];
    var MAX_OPS = 100; // límite por request (evita timeouts de Apps Script)
    var accepted = ops.slice(0, MAX_OPS);
    var results = processOperations_(email, accepted);
    return jsonOk({
      email: email,
      processed: accepted.length,
      totalPending: ops.length,
      results: results
    });
  } catch (err) {
    return jsonError('INTERNAL', String(err));
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// CUENTAS MASTERCARDS (registro, login, recuperación, TOTP)
// ------------------------------------------------------------------

function handleRegister_(body) {
  ensureDataStore_();
  var username = normalizeUsername_(body.username);
  if (validarUsername_(username)) return jsonError('INVALID_USERNAME', 'Usuario inválido');
  if (validarPassword_(body.password)) return jsonError('WEAK_PASSWORD', 'La contraseña no cumple la política');
  if (findUserRow_(username) > 0) return jsonError('USERNAME_TAKEN', 'El usuario ya existe');

  var salt = sha256Hex_(Utilities.getUuid() + '-' + Date.now()).slice(0, 32);
  var iter = PBKDF2_ITERACIONES;
  var backup = generarBackupCodes_();
  var apiToken = genApiToken_();

  getUsuarios_().appendRow([
    username, salt, pbkdf2Hex_(body.password, salt, iter), iter,
    sha256Hex_(apiToken), JSON.stringify(backup.hashes), false, 0, 0, Date.now()
  ]);
  return jsonOk({
    username: username,
    apiToken: apiToken,
    backupCodes: backup.raw,
    iteraciones: iter
  });
}

function handleLogin_(body) {
  ensureDataStore_();
  var username = normalizeUsername_(body.username);
  var rowInfo = findUserRowData_(username);
  if (!rowInfo) return jsonError('AUTH_FAILED', 'Usuario o contraseña incorrectos');
  var row = rowInfo.row, data = rowInfo.data;

  var bloqueo = Number(data[USUARIOS.BLOQUEO_HASTA - 1]) || 0;
  if (bloqueo > Date.now()) {
    return jsonError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.',
      { bloqueoMs: bloqueo - Date.now() });
  }

  var hash = pbkdf2Hex_(body.password, String(data[USUARIOS.SALT - 1]),
    Number(data[USUARIOS.ITERACIONES - 1]) || PBKDF2_ITERACIONES);
  if (hash !== String(data[USUARIOS.HASH - 1])) {
    if (registrarFallo_(row, data)) {
      return jsonError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.', { bloqueoMs: BLOQUEO_MS });
    }
    return jsonError('AUTH_FAILED', 'Usuario o contraseña incorrectos');
  }

  var totpActivo = !!data[USUARIOS.TOTP_ACTIVO - 1];
  if (totpActivo && !body.totpCode) {
    return jsonOk({ totpRequerido: true });
  }
  if (totpActivo && !verifyTotp_(username, body.totpCode, Date.now())) {
    if (registrarFallo_(row, data)) {
      return jsonError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.', { bloqueoMs: BLOQUEO_MS });
    }
    return jsonError('TOTP_INVALID', 'Código de autenticación incorrecto');
  }

  var apiToken = rotarToken_(row);
  resetIntentos_(row);
  return jsonOk({ username: username, apiToken: apiToken, totpActivo: totpActivo });
}

/** Recuperación de cuenta: backup code o código TOTP + contraseña nueva. */
function handleRecover_(body) {
  ensureDataStore_();
  var username = normalizeUsername_(body.username);
  var rowInfo = findUserRowData_(username);
  if (!rowInfo) return jsonError('AUTH_FAILED', 'Código de recuperación incorrecto');
  var row = rowInfo.row, data = rowInfo.data;

  var bloqueo = Number(data[USUARIOS.BLOQUEO_HASTA - 1]) || 0;
  if (bloqueo > Date.now()) {
    return jsonError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.',
      { bloqueoMs: bloqueo - Date.now() });
  }

  var valid = false;
  if (body.method === 'backup') {
    valid = consumirBackupCode_(row, data, body.code);
  } else if (body.method === 'totp') {
    valid = verifyTotp_(username, body.code, Date.now());
  }
  if (!valid) {
    if (registrarFallo_(row, data)) {
      return jsonError('LOCKED', 'Demasiados intentos. Inténtalo más tarde.', { bloqueoMs: BLOQUEO_MS });
    }
    return jsonError('AUTH_FAILED', 'Código de recuperación incorrecto');
  }
  if (validarPassword_(body.nuevo)) return jsonError('WEAK_PASSWORD', 'La contraseña no cumple la política');

  var salt = sha256Hex_(Utilities.getUuid() + '-' + Date.now()).slice(0, 32);
  var iter = PBKDF2_ITERACIONES;
  var sheet = getUsuarios_();
  sheet.getRange(row, USUARIOS.SALT).setValue(salt);
  sheet.getRange(row, USUARIOS.HASH).setValue(pbkdf2Hex_(body.nuevo, salt, iter));
  sheet.getRange(row, USUARIOS.ITERACIONES).setValue(iter);
  sheet.getRange(row, USUARIOS.INTENTOS).setValue(0);
  sheet.getRange(row, USUARIOS.BLOQUEO_HASTA).setValue(0);
  // Tras recuperar, el TOTP anterior se rota (el código usado es sensible al tiempo)
  sheet.getRange(row, USUARIOS.TOTP_ACTIVO).setValue(false);
  PropertiesService.getScriptProperties().deleteProperty(totpPropKey_(username));

  var apiToken = rotarToken_(row);
  return jsonOk({ username: username, apiToken: apiToken });
}

/** Configura / activa / desactiva TOTP del usuario autenticado. */
function handleTotpSetup_(owner, body) {
  ensureDataStore_();
  var row = findUserRow_(owner);
  if (row <= 0) return jsonError('AUTH_FAILED', 'Usuario no encontrado');
  var props = PropertiesService.getScriptProperties();
  var propKey = totpPropKey_(owner);

  if (body.disable) {
    props.deleteProperty(propKey);
    getUsuarios_().getRange(row, USUARIOS.TOTP_ACTIVO).setValue(false);
    return jsonOk({ activo: false });
  }

  var secret = props.getProperty(propKey);
  if (!secret) {
    secret = genTotpSecret_();
    props.setProperty(propKey, secret);
  }
  if (!body.totpCode) {
    return jsonOk({ pending: true, secret: secret, otpauth: otpauthUri_(owner, secret) });
  }
  if (!verifyTotp_(owner, body.totpCode, Date.now())) {
    return jsonError('TOTP_INVALID', 'Código de autenticación incorrecto');
  }
  getUsuarios_().getRange(row, USUARIOS.TOTP_ACTIVO).setValue(true);
  return jsonOk({ activo: true });
}

/** Cambio de contraseña estando logueado (rota el API token). */
function handleChangePassword_(owner, body) {
  ensureDataStore_();
  var rowInfo = findUserRowData_(owner);
  if (!rowInfo) return jsonError('AUTH_FAILED', 'Usuario no encontrado');
  var row = rowInfo.row, data = rowInfo.data;

  var hash = pbkdf2Hex_(body.actual, String(data[USUARIOS.SALT - 1]),
    Number(data[USUARIOS.ITERACIONES - 1]) || PBKDF2_ITERACIONES);
  if (hash !== String(data[USUARIOS.HASH - 1])) {
    return jsonError('AUTH_FAILED', 'Contraseña actual incorrecta');
  }
  if (validarPassword_(body.nuevo)) return jsonError('WEAK_PASSWORD', 'La contraseña no cumple la política');

  var salt = sha256Hex_(Utilities.getUuid() + '-' + Date.now()).slice(0, 32);
  var iter = PBKDF2_ITERACIONES;
  var sheet = getUsuarios_();
  sheet.getRange(row, USUARIOS.SALT).setValue(salt);
  sheet.getRange(row, USUARIOS.HASH).setValue(pbkdf2Hex_(body.nuevo, salt, iter));
  sheet.getRange(row, USUARIOS.ITERACIONES).setValue(iter);

  var apiToken = rotarToken_(row);
  return jsonOk({ apiToken: apiToken });
}

/** Regenera los backup codes (invalida los anteriores). */
function handleGenerateBackupCodes_(owner) {
  ensureDataStore_();
  var row = findUserRow_(owner);
  if (row <= 0) return jsonError('AUTH_FAILED', 'Usuario no encontrado');
  var backup = generarBackupCodes_();
  getUsuarios_().getRange(row, USUARIOS.BACKUP_CODES).setValue(JSON.stringify(backup.hashes));
  return jsonOk({ backupCodes: backup.raw });
}

/** Registra un intento fallido; si llega al límite, bloquea la cuenta. */
function registrarFallo_(row, data) {
  var sheet = getUsuarios_();
  var intentos = (Number(data[USUARIOS.INTENTOS - 1]) || 0) + 1;
  if (intentos >= MAX_INTENTOS) {
    sheet.getRange(row, USUARIOS.BLOQUEO_HASTA).setValue(Date.now() + BLOQUEO_MS);
    sheet.getRange(row, USUARIOS.INTENTOS).setValue(0);
    return true; // quedó bloqueada
  }
  sheet.getRange(row, USUARIOS.INTENTOS).setValue(intentos);
  return false;
}

function resetIntentos_(row) {
  var sheet = getUsuarios_();
  sheet.getRange(row, USUARIOS.INTENTOS).setValue(0);
  sheet.getRange(row, USUARIOS.BLOQUEO_HASTA).setValue(0);
}

/** Genera un nuevo API token, guarda su SHA-256 y devuelve el token crudo. */
function rotarToken_(row) {
  var apiToken = genApiToken_();
  getUsuarios_().getRange(row, USUARIOS.API_TOKEN_HASH).setValue(sha256Hex_(apiToken));
  return apiToken;
}

/** Verifica un backup code y, si acierta, lo consume (un solo uso). */
function consumirBackupCode_(row, data, code) {
  if (!code) return false;
  var hashes = [];
  try { hashes = JSON.parse(String(data[USUARIOS.BACKUP_CODES - 1] || '[]')); } catch (err) { hashes = []; }
  if (!hashes.length) return false;
  var target = sha256Hex_(normalizarBackupCode_(code));
  var idx = hashes.indexOf(target);
  if (idx < 0) return false;
  hashes.splice(idx, 1);
  getUsuarios_().getRange(row, USUARIOS.BACKUP_CODES).setValue(JSON.stringify(hashes));
  return true;
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
 * Verifica cualquier token de sesión y devuelve el dueño (minúsculas):
 *  - JWT (3 segmentos) → Google ID token → email verificado.
 *  - Hex (API token MC) → SHA-256 → username de la hoja Usuarios.
 * @return {String|null} dueño o null si el token no es válido.
 */
function verifyAnyToken_(token) {
  if (!token) return null;
  if (esJwt_(token)) {
    var email = verifyGoogleToken_(token);
    return email ? String(email).toLowerCase() : null;
  }
  return findUserByTokenHash_(sha256Hex_(String(token)));
}

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

/** ¿Tiene forma de JWT (3 segmentos separados por puntos)? */
function esJwt_(token) {
  if (typeof token !== 'string') return false;
  return token.indexOf('.') > 0 && token.split('.').length === 3;
}

// ------------------------------------------------------------------
// CRIPTOGRAFÍA (PBKDF2, SHA-256, HMAC-SHA1, TOTP RFC 6238)
// ------------------------------------------------------------------

/** Convierte un Byte[] de computeDigest (posiblemente con signo) a hex. */
function hexBytes_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function sha256Hex_(str) {
  return hexBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str)));
}

/** Digest SHA-256 sobre bytes. Devuelve Byte[] (con signo). */
function sha256Bytes_(bytes) {
  var normalized = [];
  for (var i = 0; i < bytes.length; i++) normalized.push(bytes[i] & 0xff);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalized);
}

/** HMAC-SHA256 sobre arrays de bytes (RFC 2104). Devuelve Byte[] (32 bytes). */
function hmacSha256_(keyBytes, msgBytes) {
  var BLOCK = 64;
  var key = [];
  for (var i = 0; i < keyBytes.length; i++) key.push(keyBytes[i] & 0xff);
  if (key.length > BLOCK) key = sha256Bytes_(key);
  while (key.length < BLOCK) key.push(0);
  var ipad = [], opad = [];
  for (var j = 0; j < BLOCK; j++) {
    ipad.push((key[j] & 0xff) ^ 0x36);
    opad.push((key[j] & 0xff) ^ 0x5c);
  }
  var inner = sha256Bytes_(ipad.concat(msgBytes));
  return sha256Bytes_(opad.concat(inner));
}

/**
 * PBKDF2-HMAC-SHA256 (RFC 2898), dkLen = 32 bytes = hLen (un solo bloque).
 * Salt como string (ASCII/UTF-8). Construido a mano porque Apps Script no
 * expone PBKDF2 en Utilities.computeDigest.
 */
function pbkdf2Hex_(password, salt, iteraciones) {
  var passStr = String(password), passBytes = [];
  for (var i = 0; i < passStr.length; i++) passBytes.push(passStr.charCodeAt(i) & 0xff);
  var saltStr = String(salt), saltBytes = [];
  for (var j = 0; j < saltStr.length; j++) saltBytes.push(saltStr.charCodeAt(j) & 0xff);

  // U1 = HMAC(password, salt || INT(1))  (4 bytes big-endian)
  var u = hmacSha256_(passBytes, saltBytes.concat([0, 0, 0, 1]));
  var t = u.slice(); // acumulador XOR (32 bytes)
  for (var iter = 1; iter < iteraciones; iter++) {
    u = hmacSha256_(passBytes, u);
    for (var k = 0; k < t.length; k++) t[k] = ((t[k] & 0xff) ^ (u[k] & 0xff)) & 0xff;
  }
  return hexBytes_(t);
}

// --- Base32 (RFC 4648) para secretos TOTP ---
var BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bytesToBase32_(bytes) {
  var out = '';
  var bits = 0, value = 0;
  for (var i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
}

function base32ToBytes_(s) {
  s = String(s).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  var out = [];
  var bits = 0, value = 0;
  for (var i = 0; i < s.length; i++) {
    var idx = BASE32_ALPHABET.indexOf(s[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out;
}

/** Secreto TOTP aleatorio (20 bytes → 32 chars base32). */
function genTotpSecret_() {
  var src = sha256Hex_(Utilities.getUuid() + '-' + Date.now());
  var bytes = [];
  for (var i = 0; i < 40; i += 2) bytes.push(parseInt(src.substr(i, 2), 16));
  return bytesToBase32_(bytes);
}

function totpPropKey_(username) {
  return 'TOTP:' + username;
}

/** Digest SHA-1 sobre bytes (normaliza signo). Devuelve Byte[] (con signo). */
function digestBytesSha1_(bytes) {
  var normalized = [];
  for (var i = 0; i < bytes.length; i++) normalized.push(bytes[i] & 0xff);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, normalized);
}

/** HMAC-SHA1 sobre arrays de bytes (RFC 2104). Devuelve Byte[] (20 bytes). */
function hmacSha1_(keyBytes, msgBytes) {
  var BLOCK = 64;
  var key = [];
  for (var i = 0; i < keyBytes.length; i++) key.push(keyBytes[i] & 0xff);
  if (key.length > BLOCK) key = digestBytesSha1_(key);
  while (key.length < BLOCK) key.push(0);
  var ipad = [], opad = [];
  for (var j = 0; j < BLOCK; j++) {
    ipad.push((key[j] & 0xff) ^ 0x36);
    opad.push((key[j] & 0xff) ^ 0x5c);
  }
  var inner = digestBytesSha1_(ipad.concat(msgBytes));
  return digestBytesSha1_(opad.concat(inner));
}

/** Código TOTP de 6 dígitos para un instante (epoch ms), RFC 6238 (SHA-1). */
function totpCode_(secret, timeMs) {
  var key = base32ToBytes_(secret);
  var counter = Math.floor(timeMs / 30000);
  var msg = [];
  for (var i = 7; i >= 0; i--) {
    msg.push(Math.floor(counter / Math.pow(2, i * 8)) & 0xff);
  }
  var hash = hmacSha1_(key, msg);
  var offset = hash[19] & 0x0f;
  var bin = ((hash[offset] & 0x7f) << 24) |
            ((hash[offset + 1] & 0xff) << 16) |
            ((hash[offset + 2] & 0xff) << 8) |
            (hash[offset + 3] & 0xff);
  var code = (bin % 1000000).toString();
  while (code.length < 6) code = '0' + code;
  return code;
}

/** Verifica un código TOTP contra el secreto del usuario (ventana ±1). */
function verifyTotp_(username, code, nowMs) {
  if (!code) return false;
  var secret = PropertiesService.getScriptProperties().getProperty(totpPropKey_(username));
  if (!secret) return false;
  var input = String(code).replace(/\s+/g, '');
  for (var w = -1; w <= 1; w++) {
    if (totpCode_(secret, nowMs + w * 30000) === input) return true;
  }
  return false;
}

/** URI otpauth para generar el QR en el frontend. */
function otpauthUri_(username, secret) {
  return 'otpauth://totp/MasterCards%20(' + encodeURIComponent(username) + ')?secret=' +
         secret + '&issuer=' + encodeURIComponent('MasterCards');
}

// ------------------------------------------------------------------
// HELPERS DE CUENTAS MASTERCARDS
// ------------------------------------------------------------------

/** API token opaco (64 hex) con buena entropía. */
function genApiToken_() {
  return sha256Hex_(Utilities.getUuid() + '-' + Date.now() + '-' + Math.random());
}

function normalizeUsername_(u) {
  return String(u || '').trim().toLowerCase();
}

/** Devuelve null si el username es válido, o 'INVALID_USERNAME'. */
function validarUsername_(u) {
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(u)) return 'INVALID_USERNAME';
  if (u.indexOf('@') !== -1) return 'INVALID_USERNAME';
  return null;
}

/** Devuelve null si la contraseña cumple la política, o 'WEAK_PASSWORD'. */
function validarPassword_(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) return 'WEAK_PASSWORD';
  if (!/[A-Z]/.test(pw)) return 'WEAK_PASSWORD';
  if (!/[a-z]/.test(pw)) return 'WEAK_PASSWORD';
  if (!/[0-9]/.test(pw)) return 'WEAK_PASSWORD';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'WEAK_PASSWORD';
  return null;
}

// Alfabeto de backup codes sin caracteres ambiguos (0/O/1/I/L)
var BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function normalizarBackupCode_(code) {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Genera 10 backup codes y devuelve { raw: [...], hashes: [...] }. */
function generarBackupCodes_() {
  var raw = [], hashes = [];
  for (var i = 0; i < 10; i++) {
    var src = sha256Hex_(Utilities.getUuid() + '-' + Date.now() + '-' + Math.random());
    var code = '';
    for (var j = 0; j < 10; j++) {
      code += BACKUP_ALPHABET[parseInt(src.substr((j * 2) % 56, 2), 16) % BACKUP_ALPHABET.length];
    }
    raw.push(code.slice(0, 5) + '-' + code.slice(5));
    hashes.push(sha256Hex_(code));
  }
  return { raw: raw, hashes: hashes };
}

function findUserRow_(username) {
  var data = getUsuarios_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][USUARIOS.USUARIO - 1]) === username) return i + 1;
  }
  return 0;
}

function findUserRowData_(username) {
  var data = getUsuarios_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][USUARIOS.USUARIO - 1]) === username) {
      return { row: i + 1, data: data[i] };
    }
  }
  return null;
}

function findUserByTokenHash_(hash) {
  var data = getUsuarios_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][USUARIOS.API_TOKEN_HASH - 1]) === hash) {
      return String(data[i][USUARIOS.USUARIO - 1]);
    }
  }
  return null;
}

// ------------------------------------------------------------------
// INFRAESTRUCTURA (hoja de cálculo)
// ------------------------------------------------------------------

/** Garantiza que exista la hoja de cálculo y las tres hojas con encabezados. */
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
  ensureSheet_(ss, 'Usuarios', HEADERS.USUARIOS);
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
function getUsuarios_() {
  // Se asegura SIEMPRE la creación de la hoja (puede ser una BD antigua sin ella).
  ensureDataStore_();
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(SS_PROP_KEY)).getSheetByName('Usuarios');
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

/** Busca la fila (1-indexed, 0 si no existe) de un valor en una columna. */
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

function jsonError(code, message, extra) {
  var payload = { ok: false, error: code, message: message };
  if (extra) {
    for (var k in extra) payload[k] = extra[k];
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
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

/**
 * RED DE SEGURIDAD (solo el dueño, desde el editor de Apps Script):
 * Restablece la contraseña de una cuenta MasterCards si el usuario la
 * perdió y no tiene backup codes ni TOTP. Rota el API token (las demás
 * sesiones se invalidan). Ejecutar con: adminResetPassword('usuario', 'Nueva#Pass1')
 */
function adminResetPassword(username, nueva) {
  ensureDataStore_();
  var u = normalizeUsername_(username);
  if (validarPassword_(nueva)) throw new Error('La contraseña no cumple la política');
  var row = findUserRow_(u);
  if (row <= 0) throw new Error('Usuario no encontrado: ' + u);
  var salt = sha256Hex_(Utilities.getUuid() + '-' + Date.now()).slice(0, 32);
  var iter = PBKDF2_ITERACIONES;
  var sheet = getUsuarios_();
  sheet.getRange(row, USUARIOS.SALT).setValue(salt);
  sheet.getRange(row, USUARIOS.HASH).setValue(pbkdf2Hex_(nueva, salt, iter));
  sheet.getRange(row, USUARIOS.ITERACIONES).setValue(iter);
  sheet.getRange(row, USUARIOS.INTENTOS).setValue(0);
  sheet.getRange(row, USUARIOS.BLOQUEO_HASTA).setValue(0);
  var apiToken = rotarToken_(row);
  Logger.log('Contraseña restablecida para ' + u + ' (API token rotado).');
  return apiToken;
}
