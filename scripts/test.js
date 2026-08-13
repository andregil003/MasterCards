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

const FUNCS = ['esc', 'md', 'todayStart', 'todayKey', 'fmtShort', 'uuid', 'sm2', 'esNueva', 'estaVencida', 't'];
const CONFIG_BLOCK = /var CONFIG = \{[\s\S]*?\n\};/.exec(src)[0];
const I18N_BLOCK = extractBlock('var I18N = \\{', src);

const ctx = { window: { crypto: undefined }, Math, Date, String, console, Object };
vm.createContext(ctx);
vm.runInContext(CONFIG_BLOCK + '\n' + I18N_BLOCK + '\n' + FUNCS.map(extractFn).join('\n'), ctx);

const { sm2, md, esc, uuid, todayKey, esNueva, estaVencida, fmtShort, t } = ctx;
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

console.log('──────────────────────────────');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
