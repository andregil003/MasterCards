/* ============================================================
 *  MasterCards — app.js (entry point)
 *  Boot, init, PWA install, prompt copy, drag & drop, errores.
 * ============================================================ */

import { Store } from './store.js';
import { Auth } from './auth.js';
import { UI, show } from './ui.js';
import { SyncEngine, initSyncListeners } from './sync-engine.js';
import { Study } from './srs.js';
import { t, toast, bindModal, bindNameModal, initPasswordToggles, renderGreeting, maybeAskName, confirmBox, downloadJSON, copyText } from './utils.js';
import { pwa, isStandalone } from './pwa.js';
import { I18N } from './i18n.js';
import { initAuthScreens, updateSecurityUI } from './auth.js';
import { K } from './config.js';

/** Función global que GIS llama tras la redirección de login. */
window.handleCredentialResponse = function (response) {
  Auth.handleCredential(response && response.credential);
};

/** Secuencia de arranque tras tener sesión. */
function startApp() {
  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('header-title').textContent = 'MasterCards';
  UI.applySettings();
  show('dashboard');
  SyncEngine.updateIndicator();
  UI.renderDashboard();
  maybeAskName();

  if (navigator.onLine) {
    SyncEngine.flushQueue().then(function () {
      return SyncEngine.pull();
    }).then(function () {
      UI.renderDashboard();
      UI.handleShareParam();
    });
  } else {
    UI.handleShareParam();
  }
}

// Expose startApp globally for auth module callbacks
window._mc_startApp = startApp;

// ------------------------------------------------------------------
// PWA Install
// ------------------------------------------------------------------
function initInstall() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    pwa.installPromptEvent = e;
    UI.showInstallBanner();
  });
  window.addEventListener('appinstalled', function () {
    pwa.installPromptEvent = null;
    UI.hideInstallBanner();
    toast(t('installed_toast'));
  });
  document.getElementById('btn-install-banner').addEventListener('click', function () {
    UI.promptInstall();
  });
  document.getElementById('btn-install').addEventListener('click', function () {
    UI.promptInstall();
  });
  document.getElementById('btn-install-dismiss').addEventListener('click', function () {
    pwa.installDismissed = true;
    UI.hideInstallBanner();
  });
  if (isStandalone()) UI.hideInstallBanner();
}

/** Copia al portapapeles el prompt para que una IA genere el JSON del mazo. */
function initPromptCopy() {
  document.getElementById('btn-copy-prompt').addEventListener('click', function () {
    var nombre = document.getElementById('deck-name').value.trim();
    var prompt = t('prompt_intro', { a: nombre || '[TEMA]' }) + '\n\n' +
      t('prompt_rule1') + '\n' +
      '[{"q":"¿Qué significa PWA?","a":"Progressive Web App","t":"tarjeta","e":"Aplicación web instalable"}]\n' +
      '[{"q":"¿Cuál es la capital de España?","a":"Madrid","t":"opcion","o":[{"t":"Madrid","c":true},{"t":"Barcelona","c":false},{"t":"Sevilla","c":false}]}]\n' +
      '[{"q":"Elige el antónimo de «frío»","a":"Cálido","t":"desplegable","o":[{"t":"Cálido","c":true},{"t":"Frío","c":false},{"t":"Tibio","c":false}]}]\n' +
      '[{"q":"¿Cuántos lados tiene un hexágono?","a":"6","t":"numero"}]\n' +
      '[{"q":"Del 1 al 10, ¿cómo de difícil fue este tema?","a":"8","t":"escala"}]\n' +
      '[{"q":"Escribe una frase con «aunque»","a":"Aunque llueva, saldré a correr","t":"texto"}]\n' +
      '[{"q":"Explica con tus palabras qué es la fotosíntesis","a":"Las plantas convierten luz en energía","t":"abierta"}]\n\n' +
      t('prompt_rule2') + '\n' +
      t('prompt_rule3');
    copyText(prompt).then(function () { toast(t('prompt_copied')); });
  });
}

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
function boot() {
  Store.load();
  UI.applySettings();
  UI.initCreateDeck();
  UI.initSettings();
  bindModal();
  bindNameModal();
  initPasswordToggles();
  initSyncListeners();
  initInstall();
  initPromptCopy();
  initAuthScreens();
  Auth.init();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('SW no registrado:', e);
    });
  }

  document.getElementById('btn-study-today').addEventListener('click', function () {
    Study.start('hoy', null);
  });
  document.getElementById('btn-sort-toggle').addEventListener('click', function () {
    var s = Store.settings();
    s.orden = s.orden === 'manual' ? 'alfabetico' : 'manual';
    Store.setSettings(s);
    UI.renderDashboard();
  });
  document.querySelectorAll('#filters .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
      UI.renderDashboard();
    });
  });
  document.getElementById('search-input').addEventListener('input', function () {
    UI.renderDashboard();
  });
  document.getElementById('fab').addEventListener('click', function () {
    show('crearMazo');
  });
  document.querySelectorAll('[data-close-sheet]').forEach(function (b) {
    b.addEventListener('click', function () {
      UI.renderDashboard();
      document.getElementById('btn-back').hidden = true;
      show('dashboard');
    });
  });
  function openSettings() {
    document.getElementById('header-title').textContent = t('settings');
    UI.applySettings();
    updateSecurityUI();
    show('ajustes');
  }
  function openHome() {
    UI.renderDashboard();
    document.getElementById('header-title').textContent = 'MasterCards';
    document.getElementById('btn-back').hidden = true;
    show('dashboard');
  }
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('nav-settings').addEventListener('click', openSettings);
  document.getElementById('nav-home').addEventListener('click', openHome);
  document.getElementById('btn-back').addEventListener('click', openHome);

  // --- Estudio: eventos de la tarjeta ---
  var fc = document.getElementById('flashcard');
  fc.addEventListener('click', function () {
    fc.classList.toggle('flip');
    Study.onFlip();
  });
  fc.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fc.classList.toggle('flip');
      Study.onFlip();
    }
  });
  document.querySelectorAll('.srs').forEach(function (btn) {
    btn.addEventListener('click', function () { Study.answer(Number(btn.dataset.q)); });
  });
  document.getElementById('btn-edit-card').addEventListener('click', function (e) {
    e.stopPropagation();
    document.getElementById('edit-panel').hidden = false;
    document.getElementById('srs-buttons').hidden = true;
    document.getElementById('study-answers').hidden = true;
  });
  document.getElementById('btn-save-edit').addEventListener('click', function () {
    Study.saveEdit(document.getElementById('btn-edit-card').dataset.id);
  });
  document.getElementById('btn-cancel-edit').addEventListener('click', function () {
    document.getElementById('edit-panel').hidden = true;
    document.getElementById('srs-buttons').hidden = false;
  });
  document.getElementById('btn-del-card').addEventListener('click', function (e) {
    e.stopPropagation();
    var id = document.getElementById('btn-del-card').dataset.id;
    confirmBox(t('confirm_delete_card'), t('confirm_delete_card_text'), t('delete'))
      .then(function (ok) { if (ok) Study.deleteCurrent(id); });
  });
  document.getElementById('btn-fav-card').addEventListener('click', function (e) {
    e.stopPropagation();
    var id = document.getElementById('btn-fav-card').dataset.id;
    if (!id) return;
    var s = Store.settings();
    s.favoritas = s.favoritas || {};
    s.favoritas[id] = !s.favoritas[id];
    Store.setSettings(s);
    var isFav = s.favoritas[id];
    var btn = document.getElementById('btn-fav-card');
    btn.innerHTML = '<i class="' + (isFav ? 'fa-solid' : 'fa-regular') + ' fa-star"></i>';
    btn.classList.toggle('active', isFav);
    toast(isFav ? t('added_fav') : t('removed_fav'));
  });

  // --- Resumen ---
  document.querySelectorAll('[data-summary-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      UI.renderSummary(chip.dataset.summaryFilter);
    });
  });
  document.getElementById('btn-again-failed').addEventListener('click', function () {
    var failed = Study.log.filter(function (l) { return !l.correct; }).map(function (l) { return l.card; });
    if (!failed.length) { toast(t('no_failed')); return; }
    Study.start('libre', null, failed);
  });
  document.getElementById('btn-summary-close').addEventListener('click', function () {
    UI.renderDashboard();
    document.getElementById('btn-back').hidden = true;
    show('dashboard');
  });

  // --- Drag & drop para ordenar mazos ---
  UI.initDrag();

  if (Auth.hasSession()) {
    startApp();
  } else {
    show('login');
    document.getElementById('app-header').classList.add('hidden');
  }
}

// ------------------------------------------------------------------
// Drag & Drop — orden manual (pointer events, NO HTML5 drag)
// ------------------------------------------------------------------
UI.initDrag = function () {
  var list = document.getElementById('deck-list');
  var dragging = null;
  var startY = 0;

  list.addEventListener('pointerdown', function (ev) {
    var grip = ev.target.closest('.deck-grip');
    if (!grip) return;
    if (Store.settings().orden !== 'manual') return;
    ev.preventDefault();
    dragging = grip.closest('.deck-card');
    startY = ev.clientY;
    UI._moved = false;
    dragging.classList.add('dragging');
    dragging.setPointerCapture(ev.pointerId);
  });

  list.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    UI._moved = true;
    var cards = Array.prototype.slice.call(list.querySelectorAll('.deck-card'));
    var current = dragging;
    var target = cards.find(function (c) {
      if (c === current) return false;
      var r = c.getBoundingClientRect();
      return ev.clientY > r.top && ev.clientY < r.bottom;
    });
    if (target) {
      var movingDown = ev.clientY > startY;
      cards.sort(function (a, b) {
        var ra = a.getBoundingClientRect().top, rb = b.getBoundingClientRect().top;
        return ra - rb;
      });
      var fromIdx = cards.indexOf(current);
      var toIdx = cards.indexOf(target);
      if (fromIdx < toIdx && !movingDown) return;
      if (fromIdx > toIdx && movingDown) return;
      cards.splice(fromIdx, 1);
      cards.splice(toIdx, 0, current);
      cards.forEach(function (c) { list.appendChild(c); });
      startY = ev.clientY;
    }
  });

  list.addEventListener('pointerup', function (ev) {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    var order = Array.prototype.slice.call(list.querySelectorAll('.deck-card'))
      .map(function (el, i) { return { mazoId: el.dataset.id, orden: i }; });
    var decks = Store.decks().map(function (d) {
      var o = order.find(function (x) { return x.mazoId === d.mazoId; });
      return o ? Object.assign({}, d, { orden: o.orden }) : d;
    });
    Store.setDecks(decks);
    SyncEngine.enqueue('reorderDecks', { orden: order });
    dragging = null;
  });
};

// Arranque
document.addEventListener('DOMContentLoaded', boot);

// ------------------------------------------------------------------
// Errores globales
// ------------------------------------------------------------------
function showCrash(msg) {
  var box = document.getElementById('crash-box');
  if (!box) return;
  document.getElementById('crash-msg').textContent = msg || t('crash_generic');
  box.classList.remove('hidden');
}
window.addEventListener('error', function (e) {
  showCrash(e && e.message ? e.message : 'Error');
});
window.addEventListener('unhandledrejection', function (e) {
  var r = e && e.reason;
  showCrash(r && r.message ? r.message : String(r));
});
if (document.getElementById('crash-reload')) {
  document.getElementById('crash-reload').addEventListener('click', function () {
    location.reload();
  });
}
