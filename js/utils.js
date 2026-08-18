/* ============================================================
 *  MasterCards — utils.js
 *  Utilidades generales y helpers de DOM.
 * ============================================================ */

import { Store } from './store.js';
import { t } from './i18n.js';

/** UUID v4 (idempotencia de operaciones y entidades). */
export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Escapa HTML para inyectar texto de usuario de forma segura. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Sanitiza un nombre de ícono FA: solo letras, números y guiones. */
export function sanitizeIcon(s) {
  return String(s || '').replace(/[^a-z0-9-]/gi, '').slice(0, 50);
}

/** Sanitiza un color hex: solo # seguido de 3-8 hex. */
export function sanitizeColor(s) {
  return String(s || '').replace(/[^#0-9a-fA-F]/g, '').slice(0, 10);
}

/** Convierte un color hex en rgba con la opacidad dada (para fondos suaves). */
export function withAlpha(color, alpha) {
  var hex = String(color || '#22c55e').replace('#', '');
  if (hex.length !== 6) return color;
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * Markdown LIGERO (con escape HTML previo).
 * Soporta: **negrita**, *cursiva*, `código` y líneas con "- " (lista).
 * Devuelve HTML seguro (todos los demás caracteres quedan escapados).
 */
export function md(src) {
  var html = esc(src);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/(?:^|\n)- ([^\n]+)/g, '<li>$1</li>');
  if (html.indexOf('<li>') !== -1) {
    html = html.replace(/<li>/g, '<ul>' + '<li>');
    html = html.replace(/<\/li>(?!\s*<\/ul>)/g, '</li>') + '</ul>';
    html = html.replace(/(<\/ul>)\s*<ul>/g, '\n');
  }
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return html;
}

/** Inicio del día local en epoch ms. */
export function todayStart() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clave de fecha local YYYY-MM-DD para el contador diario. */
export function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/** Formatea epoch ms a fecha corta dd/mm. */
export function fmtShort(ms) {
  if (!ms) return '';
  var d = new Date(ms);
  return d.getDate() + '/' + (d.getMonth() + 1);
}

/** Toast simple (aviso de una línea). */
export function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}

/** Saludo según la hora del día: mañana 5–12, tarde 12–20, noche 20–5. */
export function saludoDeLaHora() {
  var h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 20) return 'afternoon';
  return 'evening';
}

/** Rellena el saludo del dashboard ("Buenos días, {nombre}"). */
export function renderGreeting() {
  var el = document.getElementById('greeting');
  if (!el) return;
  var nombre = (Store.settings().nombre || '').trim();
  var key = 'greeting_' + saludoDeLaHora() + (nombre ? '' : '_no_name');
  el.textContent = nombre ? t(key, { a: nombre }) : t(key);
}

/** Modal único: pide el nombre la primera vez (para el saludo). */
export function maybeAskName() {
  if ((Store.settings().nombre || '').trim()) return;
  var modal = document.getElementById('name-modal');
  if (!modal) return;
  document.getElementById('name-modal-input').value = '';
  modal.classList.remove('hidden');
  setTimeout(function () { document.getElementById('name-modal-input').focus(); }, 60);
}

/** Modal de confirmación. Devuelve Promise<boolean>. */
export function confirmBox(title, text, okLabel) {
  return new Promise(function (resolve) {
    var m = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    document.getElementById('modal-ok').textContent = okLabel || t('accept');
    m.classList.remove('hidden');
    confirmBox._resolve = resolve;
  });
}

export function bindModal() {
  document.getElementById('modal-ok').addEventListener('click', function () {
    document.getElementById('modal').classList.add('hidden');
    confirmBox._resolve && confirmBox._resolve(true);
  });
  document.getElementById('modal-cancel').addEventListener('click', function () {
    document.getElementById('modal').classList.add('hidden');
    confirmBox._resolve && confirmBox._resolve(false);
  });
}

/** Botones del modal de nombre (saludo). */
export function bindNameModal() {
  var modal = document.getElementById('name-modal');
  if (!modal) return;
  document.getElementById('name-modal-ok').addEventListener('click', function () {
    var nombre = document.getElementById('name-modal-input').value.trim().slice(0, 40);
    if (nombre) {
      var s = Store.settings();
      s.nombre = nombre;
      Store.setSettings(s);
      renderGreeting();
    }
    modal.classList.add('hidden');
  });
  document.getElementById('name-modal-skip').addEventListener('click', function () {
    modal.classList.add('hidden');
  });
  document.getElementById('name-modal-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('name-modal-ok').click(); }
  });
}

/** Botón ver/ocultar en los campos de contraseña (privacidad). */
export function initPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var field = btn.parentElement.querySelector('input');
      if (!field) return;
      var show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      btn.innerHTML = '<i class="fa-solid fa-' + (show ? 'eye-slash' : 'eye') + '"></i>';
      btn.setAttribute('aria-label', t(show ? 'pw_hide' : 'pw_show'));
    });
  });
}

/** Descarga un JSON como fichero (exportación/backup). */
export function downloadJSON(filename, obj) {
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

/** Copia texto al portapapeles con fallback para móvil. */
export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function () { return copyFallback(text); });
  }
  return Promise.resolve(copyFallback(text));
}

export function copyFallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
