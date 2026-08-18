/*
 * e2e-auth.js — Prueba de extremo a extremo del flujo de cuentas MasterCards
 * contra el backend DESPLEGADO. Crea un usuario real de prueba (`e2e_<rand>`)
 * en la hoja Usuarios y recorre: register → login → totpSetup → login+TOTP →
 * changePassword → generateBackupCodes → recover.
 *
 * Uso:  node scripts/e2e-auth.js
 * Después: borrar la fila `e2e_<rand>` de la hoja Usuarios (o ignorarla).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- URL del backend, leída de js/config.js ---
const configSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
const urlMatch = configSrc.match(/SCRIPT_URL\s*[:=]\s*['"]([^'"]+)['"]/);
if (!urlMatch) { console.error('No encuentro SCRIPT_URL en js/config.js'); process.exit(1); }
const SCRIPT_URL = urlMatch[1];

// --- Helpers cripto (espejo del backend.gs) ---
function base32Decode(s) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  const out = []; let bits = 0, value = 0;
  for (const ch of s) {
    const idx = ALPHA.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out;
}
function hmacSha1(keyBytes, msgBytes) {
  const BLOCK = 64;
  let key = keyBytes.map(b => b & 0xff);
  const digest = bytes => Array.from(crypto.createHash('sha1').update(Buffer.from(bytes.map(b => b & 0xff))).digest());
  if (key.length > BLOCK) key = digest(key);
  while (key.length < BLOCK) key.push(0);
  const ipad = [], opad = [];
  for (let j = 0; j < BLOCK; j++) { ipad.push((key[j] & 0xff) ^ 0x36); opad.push((key[j] & 0xff) ^ 0x5c); }
  return digest(opad.concat(digest(ipad.concat(msgBytes))));
}
function totpCode(secret, timeSec) {
  const key = base32Decode(secret);
  const counter = Math.floor(timeSec / 30);
  const msg = [];
  for (let i = 7; i >= 0; i--) msg.push(Math.floor(counter / Math.pow(2, i * 8)) & 0xff);
  const hash = hmacSha1(key, msg);
  const offset = hash[19] & 0x0f;
  const bin = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) |
              ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  let code = (bin % 1000000).toString();
  while (code.length < 6) code = '0' + code;
  return code;
}

// --- Utilidades de test ---
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

async function call(body) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text, status: res.status }; }
  return { status: res.status, json };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const rand = crypto.randomBytes(3).toString('hex');
  const USER = 'e2e_' + rand;
  const PWD1 = 'Abcd#1234', PWD2 = 'Efgh#5678', PWD3 = 'Wxyz#9012';
  console.log('Endpoint: ' + SCRIPT_URL);
  console.log('Usuario de prueba: ' + USER);
  console.log('');

  // 1. register
  let r = await call({ action: 'register', username: USER, password: PWD1 });
  const d1 = r.json.data;
  ok('1) register ok', r.json.ok === true && d1.username === USER);
  ok('1) register devuelve apiToken', typeof d1.apiToken === 'string' && d1.apiToken.length === 64);
  ok('1) register devuelve 10 backup codes', Array.isArray(d1.backupCodes) && d1.backupCodes.length === 10);
  let token = d1.apiToken;

  // 2. login sin TOTP
  r = await call({ action: 'login', username: USER, password: PWD1 });
  const d2 = r.json.data;
  ok('2) login ok', r.json.ok === true && d2.username === USER);
  ok('2) login devuelve apiToken (rotado)', typeof d2.apiToken === 'string' && d2.apiToken.length === 64);
  ok('2) login totpActivo=false', d2.totpActivo === false);
  token = d2.apiToken;

  // 3. totpSetup → pending
  r = await call({ action: 'totpSetup', token: token });
  const d3 = r.json.data;
  ok('3) totpSetup pending', r.json.ok === true && d3.pending === true);
  ok('3) totpSetup devuelve secreto base32', typeof d3.secret === 'string' && d3.secret.length > 10);
  const secret = d3.secret;

  // 4. totpSetup con código correcto → activo
  const code1 = totpCode(secret, Math.floor(Date.now() / 1000));
  r = await call({ action: 'totpSetup', token: token, totpCode: code1 });
  ok('4) totpSetup activo', r.json.ok === true && r.json.data.activo === true);

  // 5. login ahora pide TOTP; login con código
  r = await call({ action: 'login', username: USER, password: PWD1 });
  ok('5) login pide TOTP', r.json.ok === true && r.json.data.totpRequerido === true);
  const code2 = totpCode(secret, Math.floor(Date.now() / 1000));
  r = await call({ action: 'login', username: USER, password: PWD1, totpCode: code2 });
  ok('5) login con TOTP ok', r.json.ok === true && r.json.data.totpActivo === true);
  token = r.json.data.apiToken;

  // 6. changePassword rota token
  r = await call({ action: 'changePassword', token: token, actual: PWD1, nuevo: PWD2 });
  const d6 = r.json.data;
  ok('6) changePassword ok', r.json.ok === true && typeof d6.apiToken === 'string' && d6.apiToken.length === 64);
  const tokenViejo = token;
  token = d6.apiToken;
  r = await call({ action: 'totpSetup', token: tokenViejo });
  ok('6) token viejo invalidado', r.json.ok === false && r.json.error === 'AUTH_FAILED');

  // 7. generateBackupCodes con el token nuevo
  r = await call({ action: 'generateBackupCodes', token: token });
  ok('7) generateBackupCodes ok', r.json.ok === true && Array.isArray(r.json.data.backupCodes) && r.json.data.backupCodes.length === 10);
  const backup = r.json.data.backupCodes[0];

  // 8. recover con backup code → rota token y desactiva TOTP
  r = await call({ action: 'recover', username: USER, method: 'backup', code: backup, nuevo: PWD3 });
  const d8 = r.json.data;
  ok('8) recover con backup code ok', r.json.ok === true && typeof d8.apiToken === 'string' && d8.apiToken.length === 64);
  token = d8.apiToken;

  // 9. después del recover: login sin TOTP (TOTP desactivado) con la nueva contraseña
  r = await call({ action: 'login', username: USER, password: PWD3 });
  ok('9) login tras recover (sin TOTP)', r.json.ok === true && r.json.data.totpActivo === false);

  console.log('');
  console.log('──────────────────────────────');
  console.log('PASS=' + pass + '  FAIL=' + fail);
  console.log('Usuario de prueba creado en la hoja Usuarios: ' + USER);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
