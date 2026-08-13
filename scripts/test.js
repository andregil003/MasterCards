#!/usr/bin/env node
/**
 * ============================================================
 *  MasterCards — tests de lógica pura (sin navegador)
 * ============================================================
 *  Uso:  node scripts/test.js   (o  npm test si añades scripts)
 *
 *  Extrae del propio app.js las funciones puras (sm2, md, esc,
 *  uuid, fechas, I18N…) y las evalúa en un contexto Node, así
 *  los tests SIEMPRE reflejan el código real desplegado.
 *
 *  No requiere dependencias ni build.
 * ============================================================
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const APP = path.join(__dirname, '..', 'app.js');
const INDEX = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(APP, 'utf8');
const html = fs.readFileSync(INDEX, 'utf8');

// ------------------------------------------------------------------
// Extracción por balanceo de llaves (misma técnica que un harness simple)
// ------------------------------------------------------------------
function extractBlock(pattern, code) {
  const m = new RegExp(pattern, 'm').exec(code);
  if (!m) throw new Error('No se encontró: ' + pattern);
  let i = m.index + m[0].indexOf('{');
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(m.index, i + 1);
    }
  }
  throw new Error('Bloque sin cerrar: ' + pattern);
}

function extractFn(name) {
  return extractBlock('function ' + name + '\\b[^{]*\\{', src);
}

const FUNCS = ['esc', 'md', 'todayStart', 'todayKey', 'fmtShort', 'uuid', 'sm2', 'esNueva', 'estaVencida', 't', 'validarPasswordMC', 'normalizarTexto', 'normalizarOpciones', 'parseLineasOpciones', 'opcionesParaEditar', 'parseEntero', 'respuestaNumValida', 'tipoUsaOpciones', 'tipoAuto', 'saludoDeLaHora'];
const CONFIG_BLOCK = /var CONFIG = \{[\s\S]*?\n\};/.exec(src)[0];
const I18N_BLOCK = extractBlock('var I18N = \\{', src);
// Regex de las cuentas MC (declaradas como var en app.js)
const USERNAME_RE_BLOCK = /var USERNAME_RE = \S+;/.exec(src)[0];
const TOTP_RE_BLOCK = /var TOTP_RE = \S+;/.exec(src)[0];

const ctx = { window: { crypto: undefined }, Math, Date, String, console, Object };
vm.createContext(ctx);
vm.runInContext(CONFIG_BLOCK + '\n' + I18N_BLOCK + '\n' + USERNAME_RE_BLOCK + '\n' + TOTP_RE_BLOCK + '\n' + FUNCS.map(extractFn).join('\n'), ctx);

const { sm2, md, esc, uuid, todayKey, esNueva, estaVencida, fmtShort, t, validarPasswordMC, normalizarTexto, normalizarOpciones, parseLineasOpciones, opcionesParaEditar, parseEntero, respuestaNumValida, tipoUsaOpciones, tipoAuto, saludoDeLaHora, USERNAME_RE, TOTP_RE } = ctx;
const I18N = ctx.I18N;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + name); }
}

console.log('▶ SM-2');
let r = sm2(2.5, 0, 5);
ok('q=5 → I=1', r.intervalo === 1);
ok('q=5 → EF=2.6', Math.abs(r.facilidad - 2.6) < 1e-9);
r = sm2(2.5, 1, 4);
ok('q=4 tras 1 día → I=6', r.intervalo === 6);
ok('q=4 → EF=2.5', Math.abs(r.facilidad - 2.5) < 1e-9);
r = sm2(2.5, 6, 4);
ok('q=4 tras 6 → I=15', r.intervalo === 15);
r = sm2(2.5, 15, 4);
ok('q=4 tras 15 → I=38', r.intervalo === 38);
r = sm2(2.5, 0, 2);
ok('fallo → I=1', r.intervalo === 1);
ok('fallo → EF=2.18', Math.abs(r.facilidad - 2.18) < 1e-9);
r = sm2(1.4, 0, 1);
ok('EF nunca < 1.3', r.facilidad >= 1.3);

console.log('▶ Markdown');
ok('negrita', md('**hola**') === '<strong>hola</strong>');
ok('código', md('a `b` c') === 'a <code>b</code> c');
ok('escape <script>', md('<script>') === '&lt;script&gt;');
ok('lista', md('- uno\n- dos').indexOf('<li>uno</li>') !== -1 && md('- uno\n- dos').indexOf('<li>dos</li>') !== -1);
ok('cursiva', md('*it*') === '<em>it</em>');

console.log('▶ Utils');
ok('uuid v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid()));
ok('todayKey', /^\d{4}-\d{2}-\d{2}$/.test(todayKey()));
const now = Date.now();
ok('estaVencida (pasado)', estaVencida({ proximaRevision: now - 1 }) === true);
ok('estaVencida (futuro)', estaVencida({ proximaRevision: now + 100000 }) === false);
ok('esNueva', esNueva({ proximaRevision: 0 }) === true);
ok('fmtShort', fmtShort(new Date(2026, 7, 12).getTime()) === '12/8');
ok('esc', esc('<b>') === '&lt;b&gt;' && esc('"') === '&quot;');

console.log('▶ Tipos de tarjeta');
ok('normalizarTexto: tildes', normalizarTexto('Ámbar') === 'ambar');
ok('normalizarTexto: mayúsculas', normalizarTexto('MADRID') === 'madrid');
ok('normalizarTexto: puntuación', normalizarTexto('Hola, ¿qué tal?') === 'hola que tal');
ok('normalizarTexto: espacios', normalizarTexto('  dos   espacios  ') === 'dos espacios');
ok('normalizarTexto: vacío', normalizarTexto('') === '');
ok('normalizarOpciones: válido', JSON.stringify(normalizarOpciones([{ texto: 'A', correcta: true }, { texto: 'B', correcta: false }])) === '[{"texto":"A","correcta":true},{"texto":"B","correcta":false}]');
ok('normalizarOpciones: formato t/c', JSON.stringify(normalizarOpciones([{ t: 'A', c: true }, 'B'])) === '[{"texto":"A","correcta":true},{"texto":"B","correcta":false}]');
ok('normalizarOpciones: sin correcta → null', normalizarOpciones([{ texto: 'A' }, { texto: 'B' }]) === null);
ok('normalizarOpciones: 1 opción → null', normalizarOpciones([{ texto: 'A', correcta: true }]) === null);
ok('normalizarOpciones: no-array → null', normalizarOpciones('x') === null);
ok('parseLineasOpciones: * marca correcta', JSON.stringify(parseLineasOpciones('*Madrid\nBarcelona')) === '[{"texto":"Madrid","correcta":true},{"texto":"Barcelona","correcta":false}]');
ok('parseLineasOpciones: sin * → null', parseLineasOpciones('Madrid\nBarcelona') === null);
ok('parseLineasOpciones: vacío → null', parseLineasOpciones('') === null);
ok('opcionesParaEditar: formato edición', opcionesParaEditar({ opciones: [{ texto: 'A', correcta: true }, { texto: 'B', correcta: false }] }) === '*A\nB');
ok('parseEntero: entero válido', parseEntero('7') === 7 && parseEntero(7) === 7);
ok('parseEntero: con espacios', parseEntero('  8 ') === 8);
ok('parseEntero: decimal → null', parseEntero('2.5') === null);
ok('parseEntero: no numérico → null', parseEntero('hola') === null);
ok('parseEntero: vacío → null', parseEntero('') === null && parseEntero(null) === null && parseEntero(undefined) === null);
ok('respuestaNumValida: rango 1-10', respuestaNumValida('5') === true && respuestaNumValida('11') === false && respuestaNumValida('0') === false);
ok('tipoUsaOpciones: opcion y desplegable', tipoUsaOpciones('opcion') === true && tipoUsaOpciones('desplegable') === true && tipoUsaOpciones('tarjeta') === false);
ok('tipoAuto: los tipos calificables', tipoAuto('opcion') && tipoAuto('desplegable') && tipoAuto('escala') && tipoAuto('numero') && tipoAuto('texto') && !tipoAuto('tarjeta') && !tipoAuto('abierta'));
const hora = saludoDeLaHora();
ok('saludoDeLaHora: devuelve morning/afternoon/evening', hora === 'morning' || hora === 'afternoon' || hora === 'evening');

console.log('▶ I18N');
const keysEs = Object.keys(I18N.dicts.es);
const keysEn = Object.keys(I18N.dicts.en);
const onlyEs = keysEs.filter(k => keysEn.indexOf(k) === -1);
const onlyEn = keysEn.filter(k => keysEs.indexOf(k) === -1);
ok('mismas claves es/en (solo es: ' + onlyEs.join(',') + ', solo en: ' + onlyEn.join(',') + ')',
   onlyEs.length === 0 && onlyEn.length === 0);
ok('ninguna clave vacía en es', keysEs.every(k => String(I18N.dicts.es[k]).length > 0));
ok('ninguna clave vacía en en', keysEn.every(k => String(I18N.dicts.en[k]).length > 0));
I18N.lang = 'es';
ok('t(card_of) es', t('card_of', { a: 2, b: 5 }) === 'Tarjeta 2 de 5');
I18N.lang = 'en';
ok('t(card_of) en', t('card_of', { a: 2, b: 5 }) === 'Card 2 of 5');
ok('t(clave inexistente) devuelve la clave', t('zzz_no_existe') === 'zzz_no_existe');
ok('t(placeholder en meta_due)', t('meta_due', { a: 7 }) === '7 due');

console.log('▶ I18N ↔ HTML');
const htmlKeys = [];
const reI18n = /data-i18n(?:-aria)?="([A-Za-z0-9_]+)"/g;
let hm;
while ((hm = reI18n.exec(html)) !== null) htmlKeys.push(hm[1]);
const uniq = Array.from(new Set(htmlKeys));
const missingHtml = uniq.filter(k => keysEs.indexOf(k) === -1 || keysEn.indexOf(k) === -1);
ok('HTML: ' + uniq.length + ' claves data-i18n, todas existen en es/en' +
   (missingHtml.length ? ' (faltan: ' + missingHtml.join(',') + ')' : ''), missingHtml.length === 0);

console.log('▶ Cuentas MC (política, desde app.js)');
ok('pw rechaza corta', validarPasswordMC('Ab1!').ok === false);
ok('pw rechaza sin símbolo', validarPasswordMC('Abcdefg8').ok === false);
ok('pw rechaza sin mayúscula', validarPasswordMC('abcdefg8!').ok === false);
ok('pw rechaza sin número', validarPasswordMC('Abcdefgh!').ok === false);
ok('pw rechaza >128', validarPasswordMC('P@ssw0rd!' + 'a'.repeat(200)).ok === false);
ok('pw acepta fuerte', validarPasswordMC('P@ssw0rd!').ok === true);
ok('fails marca requisito símbolo', validarPasswordMC('Abcdefg8').fails.indexOf('pw_req_special') !== -1);
ok('USERNAME_RE válido', USERNAME_RE.test('mi_usuario') === true);
ok('USERNAME_RE rechaza @', USERNAME_RE.test('mal@usuario') === false);
ok('USERNAME_RE rechaza corto', USERNAME_RE.test('ab') === false);
ok('USERNAME_RE rechaza mayúsculas', USERNAME_RE.test('Usuario1') === false);
ok('TOTP_RE 6 dígitos', TOTP_RE.test('123456') === true);
ok('TOTP_RE rechaza 5', TOTP_RE.test('12345') === false);

console.log('▶ TOTP / PBKDF2 (referencia de backend.gs)');
function refBase32(bytes) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | (b & 0xff); bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  while (out.length % 8) out += '=';
  return out;
}
function refBase32Decode(s) {
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
function refHmacSha1(keyBytes, msgBytes) {
  const BLOCK = 64;
  let key = keyBytes.map(b => b & 0xff);
  const digest = bytes => Array.from(crypto.createHash('sha1').update(Buffer.from(bytes.map(b => b & 0xff))).digest());
  if (key.length > BLOCK) key = digest(key);
  while (key.length < BLOCK) key.push(0);
  const ipad = [], opad = [];
  for (let j = 0; j < BLOCK; j++) { ipad.push((key[j] & 0xff) ^ 0x36); opad.push((key[j] & 0xff) ^ 0x5c); }
  return digest(opad.concat(digest(ipad.concat(msgBytes))));
}
function refTotp(secret, timeSec) {
  const key = refBase32Decode(secret);
  const counter = Math.floor(timeSec / 30);
  const msg = [];
  for (let i = 7; i >= 0; i--) msg.push(Math.floor(counter / Math.pow(2, i * 8)) & 0xff);
  const hash = refHmacSha1(key, msg);
  const offset = hash[19] & 0x0f;
  const bin = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) |
              ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  let code = (bin % 1000000).toString();
  while (code.length < 6) code = '0' + code;
  return code;
}
const secB32 = refBase32(Array.from(Buffer.from('12345678901234567890')));
ok('base32 RFC 4648', secB32 === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
const rfcVectors = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130']
];
let totpOk = true;
for (const [tv, exp] of rfcVectors) if (refTotp(secB32, tv) !== exp) { totpOk = false; console.log('    TOTP T=' + tv + ' → ' + refTotp(secB32, tv) + ' (esperado ' + exp + ')'); }
ok('TOTP RFC 6238 SHA-1 (6 dígitos)', totpOk);
const p1 = crypto.pbkdf2Sync('password', 'salt', 1, 32, 'sha256').toString('hex');
const p2 = crypto.pbkdf2Sync('password', 'salt', 2, 32, 'sha256').toString('hex');
const p4096 = crypto.pbkdf2Sync('password', 'salt', 4096, 32, 'sha256').toString('hex');
ok('PBKDF2 c=1 vector', p1 === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
ok('PBKDF2 c=2 vector', p2 === 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
ok('PBKDF2 c=4096 vector', p4096 === 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');

console.log('──────────────────────────────');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
