/* ============================================================
 *  MasterCards — ui.js
 *  Router, dashboard, creación de mazos, resumen, ajustes,
 *  importación, icon picker, color picker.
 * ============================================================ */

import { CONFIG, K } from './config.js';
import { Store } from './store.js';
import { Auth, updateSecurityUI } from './auth.js';
import { SyncEngine } from './sync-engine.js';
import { Study, TIPOS_CARD, tipoUsaOpciones, normalizarOpciones, parseLineasOpciones, parseEntero, respuestaNumValida, esNueva, estaVencida } from './srs.js';
import { toast, esc, md, withAlpha, downloadJSON, copyText, renderGreeting, maybeAskName, confirmBox, sanitizeIcon, sanitizeColor, uuid } from './utils.js';
import { pwa, isStandalone } from './pwa.js';
import { t, I18N } from './i18n.js';

export var UI = {

  // ---------- Router ----------
  show: function (name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.hidden = s.dataset.screen !== name;
    });
    var navShown = (name === 'dashboard' || name === 'ajustes');
    var nav = document.getElementById('bottom-nav');
    if (nav) {
      nav.hidden = !navShown;
      nav.classList.toggle('hidden', !navShown);
    }
    document.body.classList.toggle('nav-shown', navShown);
    if (navShown) {
      var nh = document.getElementById('nav-home');
      var ns = document.getElementById('nav-settings');
      if (nh && ns) {
        nh.classList.toggle('active', name === 'dashboard');
        ns.classList.toggle('active', name === 'ajustes');
      }
    }
    window.scrollTo(0, 0);
  },

  // ---------- Instalación PWA ----------
  showInstallBanner: function () {
    if (pwa.installDismissed || isStandalone() || !pwa.installPromptEvent) return;
    var b = document.getElementById('install-banner');
    if (b) { b.classList.remove('hidden'); b.hidden = false; }
  },

  hideInstallBanner: function () {
    var b = document.getElementById('install-banner');
    if (b) { b.classList.add('hidden'); b.hidden = true; }
  },

  promptInstall: function () {
    if (pwa.installPromptEvent) {
      pwa.installPromptEvent.prompt();
      pwa.installPromptEvent.userChoice.then(function (choice) {
        pwa.installPromptEvent = null;
        if (choice.outcome === 'accepted') {
          UI.hideInstallBanner();
          toast(t('installed_toast'));
        }
      });
      return;
    }
    var text = '';
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) text = t('install_text_ios');
    else if (/Android/i.test(navigator.userAgent)) text = t('install_text_android');
    else text = t('install_generic');
    confirmBox(t('install_title'), text, t('install_now'));
  },

  // ---------- Dashboard ----------
  renderDashboard: function () {
    var query = (document.getElementById('search-input').value || '').toLowerCase().trim();
    var activeFilters = {};
    document.querySelectorAll('#filters .chip.active').forEach(function (c) {
      activeFilters[c.dataset.filter] = true;
    });

    var decks = Store.decks().filter(function (d) { return !d.borrado; });
    var cards = Store.cards().filter(function (c) { return !c.borrado; });

    function deckStats(mazoId) {
      var ds = cards.filter(function (c) { return c.mazoId === mazoId; });
      return {
        due: ds.filter(function (c) { return estaVencida(c); }).length,
        nuev: ds.filter(esNueva).length,
        total: ds.length
      };
    }

    if (query) {
      decks = decks.filter(function (d) { return d.nombre.toLowerCase().includes(query); });
    }
    decks = decks.filter(function (d) {
      var s = deckStats(d.mazoId);
      if (activeFilters.vencidas && s.due === 0) return false;
      if (activeFilters.nuevas && s.nuev === 0) return false;
      if (activeFilters.favoritas) {
        var hasFav = cards.some(function (c) { return c.mazoId === d.mazoId && Store.settings().favoritas[c.id]; });
        if (!hasFav) return false;
      }
      return true;
    });

    var manual = Store.settings().orden === 'manual';
    if (manual) {
      decks.sort(function (a, b) {
        return (a.orden || 0) - (b.orden || 0) || (a.creado || 0) - (b.creado || 0);
      });
    } else {
      decks.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    }
    document.getElementById('btn-sort-toggle').innerHTML = manual
      ? '<i class="fa-solid fa-arrow-down-a-z"></i> <span id="sort-toggle-label">' + esc(t('sort_alpha')) + '</span>'
      : '<i class="fa-solid fa-grip-vertical"></i> <span id="sort-toggle-label">' + esc(t('sort_manual')) + '</span>';

    var list = document.getElementById('deck-list');
    list.innerHTML = '';
    document.getElementById('dashboard-empty').classList.toggle('hidden', decks.length > 0);

    decks.forEach(function (d) {
      var s = deckStats(d.mazoId);
      var el = document.createElement('div');
      el.className = 'deck-card';
      el.dataset.id = d.mazoId;
      var meta = [];
      if (s.due) meta.push('<span class="due">' + esc(t('meta_due', { a: s.due })) + '</span>');
      if (s.nuev) meta.push('<span class="new">' + esc(t('meta_new', { a: s.nuev })) + '</span>');
      if (!meta.length) meta.push('<span>' + esc(t('meta_total', { a: s.total })) + '</span>');
      el.innerHTML =
        '<div class="deck-icon" style="background:' + withAlpha(sanitizeColor(d.color) || '#22c55e', 0.16) + ';border:1px solid ' + withAlpha(sanitizeColor(d.color) || '#22c55e', 0.4) + '">' +
          '<i class="fa-solid fa-' + sanitizeIcon(d.icono || 'layer-group') + '" style="color:' + sanitizeColor(d.iconoColor || '#22c55e') + '"></i></div>' +
        '<div class="deck-info">' +
          '<div class="deck-name">' + esc(d.nombre) + '</div>' +
          '<div class="deck-meta">' + meta.join(' · ') + '</div></div>' +
        (manual ? '<span class="deck-grip" draggable="false"><i class="fa-solid fa-grip-vertical"></i></span>' : '') +
        '<div class="deck-actions">' +
          '<button class="btn primary" data-act="study"><i class="fa-solid fa-graduation-cap"></i> ' + esc(t('study')) + '</button>' +
          '<button class="btn ghost btn-ghost-icon" data-act="share" title="' + esc(t('share')) + '"><i class="fa-solid fa-share-nodes"></i></button>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        if (UI._moved) { UI._moved = false; return; }
        var act = ev.target.closest('[data-act]');
        if (act && act.dataset.act === 'study') { Study.start('hoy', d.mazoId); return; }
        if (act && act.dataset.act === 'share') { UI.shareDeck(d.mazoId); return; }
        Study.start('hoy', d.mazoId);
      });
      list.appendChild(el);
    });
  },

  shareDeck: function (mazoId) {
    var url = location.origin + location.pathname + '?share=' + mazoId;
    copyText(url).then(function () { toast(t('link_copied')); });
  },

  // ---------- Crear mazo ----------
  initCreateDeck: function () {
    UI.renderIconPicker('deck-icon-picker', 'deck-icon', 'layer-group', CONFIG.COLORS[0]);
    UI.renderColorPicker('deck-color-picker', 'deck-color', CONFIG.COLORS[0]);

    document.getElementById('tab-json').addEventListener('click', function () {
      document.getElementById('tab-json').classList.add('active');
      document.getElementById('tab-single').classList.remove('active');
      document.getElementById('panel-json').hidden = false;
      document.getElementById('panel-single').hidden = true;
    });
    document.getElementById('tab-single').addEventListener('click', function () {
      document.getElementById('tab-single').classList.add('active');
      document.getElementById('tab-json').classList.remove('active');
      document.getElementById('panel-single').hidden = false;
      document.getElementById('panel-json').hidden = true;
      if (!document.querySelectorAll('#manual-cards-list .manual-card-block').length) {
        UI.createManualBlock();
      }
    });

    document.getElementById('btn-create-deck').addEventListener('click', UI.createDeck);

    document.getElementById('btn-add-card').addEventListener('click', function () {
      UI.createManualBlock();
    });

    document.getElementById('edit-tipo').addEventListener('change', function () {
      document.getElementById('edit-opciones-wrap').hidden = !tipoUsaOpciones(this.value);
    });
  },

  createManualBlock: function (value) {
    var list = document.getElementById('manual-cards-list');
    var wrap = document.createElement('div');
    wrap.className = 'manual-card-block';
    var tipos = TIPOS_CARD.map(function (tp) {
      return '<option value="' + tp + '">' + esc(t('tipo_' + tp)) + '</option>';
    }).join('');
    wrap.innerHTML =
      '<div class="manual-card-head">' +
        '<span class="manual-card-num">' + esc(t('card_n', { a: 1 })) + '</span>' +
        '<button type="button" class="icon-btn manual-card-del" aria-label="' + esc(t('delete_aria')) + '"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<label class="field-label">' + esc(t('card_type')) + '</label>' +
      '<select class="input m-tipo">' + tipos + '</select>' +
      '<div class="m-opciones-wrap" hidden>' +
        '<label class="field-label">' + esc(t('opciones_label')) + '</label>' +
        '<textarea class="input textarea m-o" rows="3" placeholder="' + esc(t('opcion_ph')) + '"></textarea>' +
      '</div>' +
      '<label class="field-label">' + esc(t('question_label')) + '</label>' +
      '<textarea class="input textarea m-q" rows="2"></textarea>' +
      '<label class="field-label">' + esc(t('answer_label')) + '</label>' +
      '<textarea class="input textarea m-a" rows="2"></textarea>' +
      '<label class="field-label">' + esc(t('explanation_label')) + ' <span class="muted">' + esc(t('optional')) + '</span></label>' +
      '<textarea class="input textarea m-e" rows="2"></textarea>';
    var tipoSel = wrap.querySelector('.m-tipo');
    var optsWrap = wrap.querySelector('.m-opciones-wrap');
    tipoSel.addEventListener('change', function () {
      optsWrap.hidden = !tipoUsaOpciones(tipoSel.value);
    });
    if (value) {
      tipoSel.value = TIPOS_CARD.indexOf(value.t) !== -1 ? value.t : 'tarjeta';
      optsWrap.hidden = !tipoUsaOpciones(tipoSel.value);
      wrap.querySelector('.m-q').value = value.q || '';
      wrap.querySelector('.m-a').value = value.a || '';
      wrap.querySelector('.m-e').value = value.e || '';
      wrap.querySelector('.m-o').value = value.o || '';
    }
    wrap.querySelector('.manual-card-del').addEventListener('click', function () {
      wrap.remove();
      UI.renumberManual();
    });
    list.appendChild(wrap);
    UI.renumberManual();
    return wrap;
  },

  renumberManual: function () {
    var list = document.getElementById('manual-cards-list');
    Array.prototype.forEach.call(list.children, function (b, i) {
      var n = b.querySelector('.manual-card-num');
      if (n) n.textContent = t('card_n', { a: i + 1 });
    });
  },

  renderIconPicker: function (containerId, key, current, currentColor) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    UI._pickers = UI._pickers || {};
    UI._pickers[key] = current || CONFIG.ICON_GALERY[0];
    UI._pickers[key + '-color'] = currentColor || CONFIG.COLORS[0];

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-sel';
    var ic = document.createElement('i');
    ic.className = 'fa-solid fa-' + UI._pickers[key];
    ic.style.color = UI._pickers[key + '-color'];
    btn.appendChild(ic);
    var label = document.createElement('span');
    label.className = 'icon-sel-label';
    label.textContent = t('icon_choose');
    btn.appendChild(label);
    var caret = document.createElement('i');
    caret.className = 'fa-solid fa-chevron-down icon-sel-caret';
    btn.appendChild(caret);

    var panel = document.createElement('div');
    panel.className = 'icon-panel';
    panel.hidden = true;

    function paint() {
      ic.className = 'fa-solid fa-' + UI._pickers[key];
      ic.style.color = UI._pickers[key + '-color'];
      panel.querySelectorAll('.icon-opt').forEach(function (b) {
        b.classList.toggle('active', b.dataset.ic === UI._pickers[key]);
        b.querySelector('i').style.color = UI._pickers[key + '-color'];
      });
      panel.querySelectorAll('.color-opt').forEach(function (b) {
        b.classList.toggle('active', b.dataset.color === UI._pickers[key + '-color']);
      });
    }

    btn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
    });

    var chips = document.createElement('div');
    chips.className = 'icon-chips';
    var cats = Object.keys(CONFIG.ICON_GROUPS);
    var activeCat = cats[0];
    cats.forEach(function (cat, ci) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'icon-chip' + (ci === 0 ? ' active' : '');
      chip.textContent = t('icon_cat_' + cat);
      chip.addEventListener('click', function () {
        activeCat = cat;
        chips.querySelectorAll('.icon-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        grid.innerHTML = '';
        renderGrid();
      });
      chips.appendChild(chip);
    });

    var grid = document.createElement('div');
    grid.className = 'icon-grid';
    function renderGrid() {
      CONFIG.ICON_GROUPS[activeCat].forEach(function (icn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-opt' + (icn === UI._pickers[key] ? ' active' : '');
        b.dataset.ic = icn;
        var i = document.createElement('i');
        i.className = 'fa-solid fa-' + icn;
        i.style.color = UI._pickers[key + '-color'];
        b.appendChild(i);
        b.addEventListener('click', function () {
          UI._pickers[key] = icn;
          panel.hidden = true;
          paint();
        });
        grid.appendChild(b);
      });
    }
    renderGrid();

    var colorRow = document.createElement('div');
    colorRow.className = 'color-picker icon-color-row';
    CONFIG.COLORS.forEach(function (color) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-opt' + (color === UI._pickers[key + '-color'] ? ' active' : '');
      b.dataset.color = color;
      b.style.background = color;
      b.addEventListener('click', function () {
        UI._pickers[key + '-color'] = color;
        paint();
      });
      colorRow.appendChild(b);
    });

    panel.appendChild(chips);
    panel.appendChild(grid);
    panel.appendChild(colorRow);
    container.appendChild(btn);
    container.appendChild(panel);
  },

  renderColorPicker: function (containerId, key, current) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    var sel = current || CONFIG.COLORS[0];
    CONFIG.COLORS.forEach(function (color) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-opt' + (color === sel ? ' active' : '');
      b.style.background = color;
      b.addEventListener('click', function () {
        container.querySelectorAll('.color-opt').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        UI._pickers = UI._pickers || {};
        UI._pickers[key] = color;
      });
      container.appendChild(b);
    });
    UI._pickers = UI._pickers || {};
    UI._pickers[key] = sel;
  },

  createDeck: function () {
    var nombre = document.getElementById('deck-name').value.trim();
    if (!nombre) { toast(t('err_name_required')); return; }

    var jsonTab = !document.getElementById('panel-json').hidden;
    var cardsRaw = [];
    if (jsonTab) {
      var raw = document.getElementById('json-input').value.trim();
      var feedback = document.getElementById('json-feedback');
      if (!raw) { toast(t('err_json_empty')); return; }
      try {
        cardsRaw = JSON.parse(raw);
        if (!Array.isArray(cardsRaw)) throw new Error('no-array');
        feedback.textContent = t('cards_ready', { a: cardsRaw.length });
        feedback.classList.remove('error');
      } catch (e) {
        feedback.textContent = t('err_json_invalid');
        feedback.classList.add('error');
        return;
      }
    } else {
      var blocks = document.querySelectorAll('#manual-cards-list .manual-card-block');
      if (!blocks.length) { toast(t('err_no_cards')); return; }
      for (var bi = 0; bi < blocks.length; bi++) {
        var b = blocks[bi];
        var bq = b.querySelector('.m-q').value.trim();
        var ba = b.querySelector('.m-a').value.trim();
        if (!bq || !ba) { toast(t('err_qa_required')); return; }
        var bt = b.querySelector('.m-tipo').value;
        var bo = null;
        if (tipoUsaOpciones(bt)) {
          bo = parseLineasOpciones(b.querySelector('.m-o').value);
          if (!bo) { toast(t('err_opciones')); return; }
        }
        if (bt === 'escala' || bt === 'numero') {
          if (parseEntero(ba) === null) { toast(t('err_num_required')); return; }
          if (bt === 'escala' && !respuestaNumValida(ba)) { toast(t('err_escala_range')); return; }
        }
        cardsRaw.push({ q: bq, a: ba, e: b.querySelector('.m-e').value.trim(), t: bt, o: bo });
      }
    }

    var now = Date.now();
    var mazoId = uuid();
    var deck = {
      mazoId: mazoId,
      nombre: nombre,
      icono: UI._pickers['deck-icon'] || 'layer-group',
      iconoColor: UI._pickers['deck-icon-color'] || CONFIG.COLORS[0],
      color: UI._pickers['deck-color'] || CONFIG.COLORS[0],
      orden: Store.decks().filter(function (d) { return !d.borrado; }).length,
      creado: now, updatedAt: now, borrado: false
    };

    var tarjetas = cardsRaw.map(function (c) {
      var tipo = TIPOS_CARD.indexOf(c.t) !== -1 ? c.t : 'tarjeta';
      var opciones = null;
      if (tipoUsaOpciones(tipo)) {
        opciones = normalizarOpciones(c.o);
        if (!opciones) tipo = 'tarjeta';
      }
      if (tipo === 'escala' || tipo === 'numero') {
        if (!c.a || parseEntero(c.a) === null || (tipo === 'escala' && !respuestaNumValida(c.a))) tipo = 'tarjeta';
      }
      return {
        id: uuid(), mazoId: mazoId, icono: c.i || '', pregunta: c.q || '',
        respuesta: c.a || '', explicacion: c.e || '', tipo: tipo, opciones: opciones,
        intervalo: 0, facilidad: 2.5, proximaRevision: 0,
        updatedAt: now, borrado: false
      };
    });

    Store.setDecks(Store.decks().concat([deck]));
    Store.setCards(Store.cards().concat(tarjetas));
    SyncEngine.enqueue('createDeck', {
      mazoId: mazoId, nombre: nombre, icono: deck.icono, color: deck.color,
      orden: deck.orden, creado: now
    });
    SyncEngine.enqueue('createCards', {
      mazoId: mazoId,
      tarjetas: tarjetas.map(function (t) {
        return { id: t.id, icono: t.icono, pregunta: t.pregunta, respuesta: t.respuesta,
                 explicacion: t.explicacion, tipo: t.tipo, opciones: t.opciones };
      })
    });

    document.getElementById('deck-name').value = '';
    document.getElementById('json-input').value = '';
    document.getElementById('json-feedback').textContent = '';
    document.getElementById('manual-cards-list').innerHTML = '';
    UI.renderDashboard();
    UI.show('dashboard');
    toast(t('deck_created') + ': ' + nombre);
  },

  // ---------- Resumen ----------
  renderSummary: function (filter) {
    document.querySelectorAll('[data-summary-filter]').forEach(function (c) {
      c.classList.toggle('active', c.dataset.summaryFilter === filter);
    });
    var items = Study.log.slice();
    if (filter === 'falladas') items = items.filter(function (l) { return !l.correct; });
    if (filter === 'correctas') items = items.filter(function (l) { return l.correct; });
    var list = document.getElementById('summary-list');
    list.innerHTML = '';
    if (!items.length) {
      list.innerHTML = '<p class="muted" style="text-align:center">' + esc(t('summary_empty')) + '</p>';
      return;
    }
    items.forEach(function (l) {
      var el = document.createElement('div');
      el.className = 'summary-item ' + (l.correct ? 'correct' : 'failed');
      el.innerHTML =
        '<div class="sq">' + md(l.card.pregunta) + '</div>' +
        '<div class="sa"><i class="fa-solid fa-circle-check"></i> ' + md(l.card.respuesta) + '</div>' +
        (l.card.explicacion ? '<div class="se"><i class="fa-solid fa-circle-question"></i> ' + md(l.card.explicacion) + '</div>' : '');
      list.appendChild(el);
    });
  },

  // ---------- Ajustes ----------
  applySettings: function () {
    var s = Store.settings();
    document.documentElement.classList.remove('tema-claro', 'tema-oscuro');
    if (s.tema === 'claro') document.documentElement.classList.add('tema-claro');
    if (s.tema === 'oscuro') document.documentElement.classList.add('tema-oscuro');
    document.body.classList.remove('anim-sutil', 'anim-hibrido', 'anim-vistoso');
    document.body.classList.add('anim-' + s.animacion);
    document.getElementById('limite-val').textContent = s.limiteNuevas;
    document.getElementById('limite-slider').value = s.limiteNuevas;
    document.querySelectorAll('.segmented').forEach(function (seg) {
      seg.querySelectorAll('button').forEach(function (b) {
        var key = seg.id.replace('seg-', '');
        var map = { tema: 'tema', anim: 'animacion', revelar: 'revelar', idioma: 'idioma' };
        b.classList.toggle('active', s[map[key]] === b.dataset.value);
      });
    });
    I18N.apply();
    renderGreeting();
    var setNombre = document.getElementById('set-nombre');
    if (setNombre) setNombre.value = s.nombre || '';
  },

  initSettings: function () {
    function seg(key, mapKey) {
      document.querySelectorAll('#seg-' + key + ' button').forEach(function (b) {
        b.addEventListener('click', function () {
          var s = Store.settings();
          s[mapKey] = b.dataset.value;
          Store.setSettings(s);
          UI.applySettings();
        });
      });
    }
    seg('tema', 'tema');
    seg('anim', 'animacion');
    seg('revelar', 'revelar');
    seg('idioma', 'idioma');
    var setNombre = document.getElementById('set-nombre');
    if (setNombre) {
      setNombre.value = Store.settings().nombre || '';
      setNombre.addEventListener('change', function () {
        var s = Store.settings();
        s.nombre = setNombre.value.trim().slice(0, 40);
        Store.setSettings(s);
        renderGreeting();
        toast(t('name_saved'));
      });
    }
    document.getElementById('limite-slider').addEventListener('input', function (e) {
      var s = Store.settings();
      s.limiteNuevas = Number(e.target.value);
      Store.setSettings(s);
      UI.applySettings();
    });
    document.getElementById('btn-export').addEventListener('click', function () {
      downloadJSON('mastercards-backup.json', {
        email: Auth.owner(),
        fecha: new Date().toISOString(),
        decks: Store.decks(),
        cards: Store.cards(),
        settings: Store.settings()
      });
      toast(t('export_ok'));
    });
    document.getElementById('btn-wipe').addEventListener('click', function () {
      confirmBox(t('wipe_confirm'), t('wipe_confirm_text'), t('wipe'))
        .then(function (ok) {
          if (!ok) return;
          [K.DECKS, K.CARDS, K.QUEUE, K.SETTINGS, K.META].forEach(function (k) { localStorage.removeItem(k); });
          Store.load();
          Auth.logout();
          toast(t('wipe_ok'));
        });
    });
    document.getElementById('btn-logout').addEventListener('click', function () {
      Auth.logout();
    });
  },

  // ---------- Importar mazo (?share=) ----------
  pendingShare: null,
  handleShareParam: function () {
    var params = new URLSearchParams(location.search);
    var shareId = params.get('share');
    if (!shareId) return;
    UI.pendingShare = shareId;
    if (!Auth.hasSession()) return;
    UI.doImport(shareId);
  },

  doImport: function (shareId) {
    if (!navigator.onLine) { toast(t('import_no_conn')); return; }
    if (!CONFIG.SCRIPT_URL) { toast(t('import_no_backend')); return; }
    fetch(CONFIG.SCRIPT_URL + '?share_id=' + encodeURIComponent(shareId))
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json.ok) throw new Error(json.message || 'mazo no encontrado');
        var deck = json.data.deck;
        confirmBox(t('import_title'), t('import_confirm', { a: deck.nombre }), t('import_btn'))
          .then(function (ok) {
            if (!ok) return;
            UI.applyImport(json.data);
          });
      })
      .catch(function () { toast(t('import_fail')); });
  },

  applyImport: function (shareData) {
    var now = Date.now();
    var newMazoId = uuid();
    var deck = shareData.deck;
    var localDeck = {
      mazoId: newMazoId, nombre: deck.nombre, icono: deck.icono,
      color: deck.color,
      orden: Store.decks().filter(function (d) { return !d.borrado; }).length,
      creado: now, updatedAt: now, borrado: false
    };
    var map = {};
    shareData.cards.forEach(function (c) { map[c.id] = uuid(); });
    var localCards = shareData.cards.map(function (c) {
      return {
        id: map[c.id], mazoId: newMazoId, icono: c.icono || '',
        pregunta: c.pregunta, respuesta: c.respuesta, explicacion: c.explicacion || '',
        intervalo: 0, facilidad: 2.5, proximaRevision: 0, updatedAt: now, borrado: false
      };
    });
    Store.setDecks(Store.decks().concat([localDeck]));
    Store.setCards(Store.cards().concat(localCards));
    SyncEngine.enqueue('createDeck', {
      mazoId: newMazoId, nombre: deck.nombre, icono: deck.icono, color: deck.color,
      orden: localDeck.orden, creado: now
    });
    SyncEngine.enqueue('createCards', {
      mazoId: newMazoId,
      tarjetas: localCards.map(function (t) {
        return { id: t.id, icono: t.icono, pregunta: t.pregunta, respuesta: t.respuesta, explicacion: t.explicacion };
      })
    });
    var params = new URLSearchParams(location.search);
    params.delete('share');
    history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : ''));
    UI.renderDashboard();
    toast(t('imported') + ': ' + deck.nombre);
  }
};

/** Router simple. */
export function show(name) { UI.show(name); }
