/* ============================================================
 *  MasterCards — srs.js
 *  Algoritmo SM-2, tipos de tarjeta y sesión de estudio  ⭐
 * ============================================================ */

import { CONFIG } from './config.js';
import { Store, cardById, upsertCardLocal, removeCardLocal } from './store.js';
import { SyncEngine } from './sync-engine.js';
import { t } from './i18n.js';
import { toast, todayKey, md } from './utils.js';
import { UI, show } from './ui.js';

// ------------------------------------------------------------------
// SM-2
// ------------------------------------------------------------------

export function sm2(facilidad, intervalo, q) {
  var ef = facilidad || 2.5;
  var I = intervalo || 0;
  ef = Math.max(CONFIG.SM2_MIN_EF, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (q < 3) {
    I = 1;
  } else {
    if (I === 0) I = 1;
    else if (I === 1) I = 6;
    else I = Math.round(I * ef);
  }
  return { facilidad: ef, intervalo: I };
}

export function esNueva(card) { return !card.proximaRevision; }
export function estaVencida(card) { return !!card.proximaRevision && card.proximaRevision <= Date.now(); }

// ------------------------------------------------------------------
// Tipos de tarjeta
// ------------------------------------------------------------------

export var TIPOS_CARD = ['tarjeta', 'abierta', 'opcion', 'texto', 'desplegable', 'escala', 'numero'];

export function tipoUsaOpciones(tipo) { return tipo === 'opcion' || tipo === 'desplegable'; }

export function tipoAuto(tipo) { return tipo === 'opcion' || tipo === 'desplegable' || tipo === 'escala' || tipo === 'numero' || tipo === 'texto'; }

export function parseEntero(s) {
  var n = Number(String(s || '').trim());
  return (s !== null && s !== undefined && String(s).trim() !== '' && isFinite(n) && Math.floor(n) === n) ? n : null;
}

export function respuestaNumValida(respuesta) {
  var n = parseEntero(respuesta);
  return n !== null && n >= 1 && n <= 10;
}

export function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizarOpciones(o) {
  if (!Array.isArray(o)) return null;
  var out = [];
  for (var i = 0; i < o.length; i++) {
    var x = o[i];
    var texto = typeof x === 'string' ? x : String((x && (x.texto != null ? x.texto : x.t)) || '');
    texto = texto.trim();
    if (!texto) continue;
    var correcta = typeof x === 'object' && x !== null && (!!x.correcta || !!x.c);
    out.push({ texto: texto, correcta: correcta });
  }
  if (out.length < 2 || !out.some(function (x) { return x.correcta; })) return null;
  return out;
}

export function parseLineasOpciones(text) {
  var lines = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  var opts = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    var correcta = /^\*/.test(l);
    var txt = l.replace(/^\*+/, '').trim();
    if (txt) opts.push({ texto: txt, correcta: correcta });
  }
  if (opts.length < 2 || !opts.some(function (o) { return o.correcta; })) return null;
  return opts;
}

export function opcionesParaEditar(card) {
  return (card.opciones || []).map(function (o) {
    return (o.correcta ? '*' : '') + o.texto;
  }).join('\n');
}

export function contarNuevaHoy() {
  var meta = Store.meta();
  if (meta.nuevasHoy.fecha !== todayKey()) {
    meta.nuevasHoy = { fecha: todayKey(), count: 0 };
  }
  meta.nuevasHoy.count++;
  Store.setMeta(meta);
}

// ------------------------------------------------------------------
// Sesión de estudio
// ------------------------------------------------------------------

export var Study = {
  mode: 'hoy',
  deckId: null,
  initial: [],
  queue: [],
  index: 0,
  log: [],
  redoSet: {},
  start: 0,

  /** Construye la sesión y muestra la primera tarjeta. */
  start: function (mode, deckId, explicitCards) {
    Study.mode = mode;
    Study.deckId = deckId;
    Study.log = [];
    Study.redoSet = {};
    Study.index = 0;
    Study.start = Date.now();

    var all;
    if (explicitCards) {
      all = explicitCards;
    } else if (mode === 'libre') {
      all = Store.deckCards(deckId);
    } else {
      all = Store.deckCards(deckId);
      var vencidas = all.filter(estaVencida);
      var meta = Store.meta();
      if (meta.nuevasHoy.fecha !== todayKey()) {
        meta.nuevasHoy = { fecha: todayKey(), count: 0 };
      }
      var permitidas = Math.max(0, Store.settings().limiteNuevas - meta.nuevasHoy.count);
      var nuevas = all.filter(esNueva).slice(0, permitidas);
      all = vencidas.concat(nuevas);
    }

    Study.initial = all.slice();
    Study.queue = all.slice();

    if (!all.length) {
      show('estudio');
      document.getElementById('header-title').textContent =
        mode === 'libre' ? t('study_free_title') : (deckId ? Store.deckById(deckId).nombre : t('study_today_title'));
      document.getElementById('btn-back').hidden = false;
      document.getElementById('study-empty').classList.remove('hidden');
      document.getElementById('study-empty-text').textContent =
        mode === 'hoy' ? t('study_done') : t('study_empty_deck');
      document.getElementById('study-area').hidden = true;
      return;
    }

    show('estudio');
    document.getElementById('header-title').textContent =
      mode === 'libre' ? t('study_free_title') : (deckId ? Store.deckById(deckId).nombre : t('study_today_title'));
    document.getElementById('btn-back').hidden = false;
    Study.render();
  },

  render: function () {
    if (Study.index >= Study.queue.length) {
      Study.end();
      return;
    }
    var total = Math.max(Study.initial.length, 1);
    document.getElementById('study-progress').style.width =
      Math.min(100, (Study.index / total) * 100) + '%';
    document.getElementById('study-info').textContent =
      t('card_of', { a: Study.index + 1, b: Study.queue.length });

    document.getElementById('study-empty').classList.add('hidden');
    document.getElementById('study-area').hidden = false;
    document.getElementById('edit-panel').hidden = true;
    Study.showCard(Study.queue[Study.index]);
  },

  showCard: function (card) {
    Study._answered = false;
    var fc = document.getElementById('flashcard');
    fc.classList.remove('flip', 'animate-error', 'animate-success');
    fc.classList.remove('editing');
    document.getElementById('edit-panel').hidden = true;
    Study.renderAnswers(card);
    document.getElementById('card-icon').className = 'fa-solid fa-' + (card.icono || 'bolt') + ' card-deco';
    var deckFor = Store.deckById(card.mazoId);
    document.getElementById('card-icon').style.color = (deckFor && deckFor.iconoColor) || '#22c55e';
    document.getElementById('card-q').innerHTML = md(card.pregunta);
    document.getElementById('card-a').innerHTML = md(card.respuesta);
    var why = document.getElementById('card-e');
    if (card.explicacion && card.explicacion.trim()) {
      document.getElementById('card-e-text').innerHTML = md(card.explicacion);
      why.hidden = false;
    } else {
      why.hidden = true;
    }
    document.getElementById('btn-edit-card').dataset.id = card.id;
    document.getElementById('btn-del-card').dataset.id = card.id;
    var fav = document.getElementById('btn-fav-card');
    var isFav = !!(Store.settings().favoritas || {})[card.id];
    fav.dataset.id = card.id;
    fav.innerHTML = '<i class="' + (isFav ? 'fa-solid' : 'fa-regular') + ' fa-star"></i>';
    fav.classList.toggle('active', isFav);
    document.getElementById('edit-q').value = card.pregunta;
    document.getElementById('edit-a').value = card.respuesta;
    document.getElementById('edit-e').value = card.explicacion || '';
    var editTipo = document.getElementById('edit-tipo');
    editTipo.value = TIPOS_CARD.indexOf(card.tipo) !== -1 ? card.tipo : 'tarjeta';
    document.getElementById('edit-o').value = opcionesParaEditar(card);
    document.getElementById('edit-opciones-wrap').hidden = !tipoUsaOpciones(editTipo.value);
  },

  tipoDe: function (card) {
    if (tipoUsaOpciones(card.tipo) && card.opciones && card.opciones.length >= 2) return card.tipo;
    if (card.tipo === 'texto' || card.tipo === 'abierta') return card.tipo;
    if (card.tipo === 'escala' || card.tipo === 'numero') return card.tipo;
    return 'tarjeta';
  },

  renderAnswers: function (card) {
    var wrap = document.getElementById('study-answers');
    var srs = document.getElementById('srs-buttons');
    var tipo = Study.tipoDe(card);
    wrap.innerHTML = '';
    wrap.hidden = tipo === 'tarjeta';
    srs.hidden = tipo !== 'tarjeta';
    if (tipo === 'opcion') {
      var fc = document.getElementById('flashcard');
      if (fc.classList.contains('flip')) return;
      var idxs = card.opciones.map(function (_, i) { return i; });
      for (var i = idxs.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp;
      }
      idxs.forEach(function (idx) {
        var o = card.opciones[idx];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'opt-btn';
        b.textContent = o.texto;
        b.dataset.idx = String(idx);
        b.addEventListener('click', function () { Study.gradeOption(card, idx, b, wrap); });
        wrap.appendChild(b);
      });
    } else if (tipo === 'desplegable') {
      var sel = document.createElement('select');
      sel.className = 'input';
      var ph = document.createElement('option');
      ph.value = '';
      ph.textContent = t('choose_option');
      ph.disabled = true;
      sel.appendChild(ph);
      card.opciones.forEach(function (o, i) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = o.texto;
        sel.appendChild(opt);
      });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + t('check');
      var row = document.createElement('div');
      row.className = 'texto-check-row';
      row.appendChild(sel);
      row.appendChild(btn);
      wrap.appendChild(row);
      function doSelect() {
        if (btn.disabled) return;
        var ok = sel.value !== '' && !!card.opciones[Number(sel.value)].correcta;
        Study.gradeSelect(card, ok, sel, btn, row);
      }
      btn.addEventListener('click', doSelect);
    } else if (tipo === 'escala') {
      var hint = document.createElement('p');
      hint.className = 'muted small';
      hint.textContent = t('escala_hint');
      wrap.appendChild(hint);
      var nums = document.createElement('div');
      nums.className = 'escala-row';
      for (var v = 1; v <= 10; v++) {
        (function (val) {
          var nb = document.createElement('button');
          nb.type = 'button';
          nb.className = 'escala-btn';
          nb.textContent = String(val);
          nb.addEventListener('click', function () { Study.gradeEscala(card, val); });
          nums.appendChild(nb);
        })(v);
      }
      wrap.appendChild(nums);
    } else if (tipo === 'numero') {
      var ninp = document.createElement('input');
      ninp.type = 'number';
      ninp.inputMode = 'numeric';
      ninp.className = 'input';
      ninp.placeholder = t('type_number');
      var nbtn = document.createElement('button');
      nbtn.type = 'button';
      nbtn.className = 'btn primary';
      nbtn.innerHTML = '<i class="fa-solid fa-check"></i> ' + t('check');
      var nrow = document.createElement('div');
      nrow.className = 'texto-check-row';
      nrow.appendChild(ninp);
      nrow.appendChild(nbtn);
      wrap.appendChild(nrow);
      function doNumero() {
        if (nbtn.disabled) return;
        var ok = ninp.value.trim() !== '' &&
          parseEntero(ninp.value) !== null &&
          parseEntero(ninp.value) === parseEntero(card.respuesta);
        Study.gradeText(card, ok, ninp, nbtn, nrow);
      }
      nbtn.addEventListener('click', doNumero);
      ninp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doNumero(); }
      });
      setTimeout(function () { ninp.focus(); }, 60);
    } else if (tipo === 'texto') {
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'input';
      inp.autocomplete = 'off';
      inp.autocapitalize = 'off';
      inp.spellcheck = false;
      inp.placeholder = t('type_answer');
      var btn2 = document.createElement('button');
      btn2.type = 'button';
      btn2.className = 'btn primary';
      btn2.innerHTML = '<i class="fa-solid fa-check"></i> ' + t('check');
      var row2 = document.createElement('div');
      row2.className = 'texto-check-row';
      row2.appendChild(inp);
      row2.appendChild(btn2);
      wrap.appendChild(row2);
      function doCheck() {
        if (btn2.disabled) return;
        var ok = inp.value.trim() !== '' && normalizarTexto(inp.value) === normalizarTexto(card.respuesta);
        Study.gradeText(card, ok, inp, btn2, row2);
      }
      btn2.addEventListener('click', doCheck);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doCheck(); }
      });
      setTimeout(function () { inp.focus(); }, 60);
    } else if (tipo === 'abierta') {
      var fc2 = document.getElementById('flashcard');
      if (fc2.classList.contains('flip')) {
        Study.renderManualAbierta(card);
      } else {
        var hint2 = document.createElement('p');
        hint2.className = 'muted small';
        hint2.textContent = t('abierta_hint');
        var reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'btn block';
        reveal.innerHTML = '<i class="fa-solid fa-eye"></i> ' + t('reveal_answer');
        reveal.addEventListener('click', function () {
          fc2.classList.add('flip');
          Study.renderManualAbierta(card);
        });
        wrap.appendChild(hint2);
        wrap.appendChild(reveal);
      }
    }
  },

  renderManualAbierta: function (card) {
    var wrap = document.getElementById('study-answers');
    if (Study._answered) return;
    var row = document.createElement('div');
    row.className = 'manual-row';
    var known = document.createElement('button');
    known.type = 'button';
    known.className = 'btn primary';
    known.innerHTML = '<i class="fa-solid fa-check"></i> ' + t('knew_it');
    known.addEventListener('click', function () { Study.answer(4); });
    var not = document.createElement('button');
    not.type = 'button';
    not.className = 'btn danger';
    not.innerHTML = '<i class="fa-solid fa-xmark"></i> ' + t('didnt_know');
    not.addEventListener('click', function () { Study.answer(1); });
    row.appendChild(known);
    row.appendChild(not);
    wrap.appendChild(row);
  },

  onFlip: function () {
    var card = Study.queue[Study.index];
    if (!card || Study.tipoDe(card) !== 'abierta') return;
    var fc = document.getElementById('flashcard');
    if (fc.classList.contains('flip')) {
      var wrap = document.getElementById('study-answers');
      wrap.innerHTML = '';
      Study.renderManualAbierta(card);
    }
  },

  gradeOption: function (card, idx, btn, wrap) {
    if (Study._answered) return;
    var correct = !!card.opciones[idx].correcta;
    wrap.querySelectorAll('.opt-btn').forEach(function (b) {
      b.disabled = true;
      var o = card.opciones[Number(b.dataset.idx)];
      if (o.correcta) b.classList.add('right');
      else if (b === btn) b.classList.add('wrong');
    });
    Study.answer(correct ? 4 : 1);
  },

  gradeText: function (card, ok, inp, btn, row) {
    if (Study._answered) return;
    btn.disabled = true;
    inp.disabled = true;
    row.classList.add(ok ? 'right' : 'wrong');
    if (!ok) {
      var correct = document.createElement('span');
      correct.className = 'texto-correcta';
      correct.textContent = card.respuesta;
      row.appendChild(correct);
    }
    Study.answer(ok ? 4 : 1);
  },

  gradeSelect: function (card, ok, sel, btn, row) {
    if (Study._answered) return;
    btn.disabled = true;
    sel.disabled = true;
    row.classList.add(ok ? 'right' : 'wrong');
    if (!ok) {
      var right = card.opciones.filter(function (o) { return o.correcta; })[0];
      if (right) {
        var correct = document.createElement('span');
        correct.className = 'texto-correcta';
        correct.textContent = right.texto;
        row.appendChild(correct);
      }
    }
    Study.answer(ok ? 4 : 1);
  },

  gradeEscala: function (card, val) {
    if (Study._answered) return;
    var expected = parseEntero(card.respuesta);
    var ok = expected !== null && val === expected;
    document.querySelectorAll('.escala-btn').forEach(function (b) {
      b.disabled = true;
      if (b.textContent === String(expected)) b.classList.add('right');
      if (b.textContent === String(val) && !ok) b.classList.add('wrong');
    });
    Study.answer(ok ? 4 : 1);
  },

  answer: function (q) {
    var card = Study.queue[Study.index];
    if (!card || Study._answered) return;
    Study._answered = true;
    var controls = document.querySelectorAll('.srs, #study-answers button, #study-answers input');
    controls.forEach(function (c) { c.disabled = true; });

    var correct = q >= 3;
    Study.log.push({ card: card, q: q, correct: correct });

    var fc = document.getElementById('flashcard');
    fc.classList.add(correct ? 'animate-success' : 'animate-error');
    if (correct) spawnConfetti();

    if (Study.mode === 'hoy') {
      var next = sm2(card.facilidad, card.intervalo, q);
      var wasNew = esNueva(card);
      var now = Date.now();
      var updated = Object.assign({}, card, {
        facilidad: next.facilidad,
        intervalo: next.intervalo,
        proximaRevision: now + next.intervalo * 86400000,
        updatedAt: now
      });
      upsertCardLocal(updated);
      SyncEngine.enqueue('updateSRS', {
        id: card.id, intervalo: next.intervalo, facilidad: next.facilidad,
        proximaRevision: updated.proximaRevision, updatedAt: now
      });
      if (wasNew) contarNuevaHoy();
    }

    var esTipo = Study.tipoDe(card) !== 'tarjeta';
    if (!correct) {
      if (Store.settings().revelar === 'fallar' || esTipo) {
        fc.classList.add('flip');
      }
      if (!Study.redoSet[card.id]) {
        Study.redoSet[card.id] = true;
        Study.queue.push(card);
      }
    } else if (!fc.classList.contains('flip')) {
      fc.classList.add('flip');
    }

    Study.index++;
    var revealDelay = (!correct && Store.settings().revelar === 'fallar') ? 1500 : 800;
    if (esTipo) revealDelay = 2200;
    setTimeout(function () {
      controls.forEach(function (c) { c.disabled = false; });
      Study.render();
    }, revealDelay);
  },

  end: function () {
    var elapsed = Math.round((Date.now() - Study.start) / 1000);
    var vistas = Study.log.length;
    var aciertos = Study.log.filter(function (l) { return l.correct; }).length;
    document.getElementById('sum-vistas').textContent = vistas;
    document.getElementById('sum-aciertos').textContent = aciertos;
    document.getElementById('sum-pct').textContent =
      vistas ? Math.round((aciertos / vistas) * 100) + '%' : '0%';
    document.getElementById('sum-tiempo').textContent =
      (elapsed >= 60 ? Math.floor(elapsed / 60) + 'm ' : '') + (elapsed % 60) + 's';
    show('resumen');
    UI.renderSummary('falladas');
  },

  deleteCurrent: function (id) {
    var idx = Study.queue.findIndex(function (c) { return c.id === id; });
    if (idx !== -1) Study.queue.splice(idx, 1);
    if (idx < Study.index) Study.index--;
    removeCardLocal(id);
    SyncEngine.enqueue('deleteCard', { id: id });
    toast(t('card_deleted'));
    Study.render();
  },

  saveEdit: function (id) {
    var card = cardById(id);
    if (!card) return;
    var now = Date.now();
    var tipo = document.getElementById('edit-tipo').value;
    if (TIPOS_CARD.indexOf(tipo) === -1) tipo = 'tarjeta';
    var pregunta = document.getElementById('edit-q').value;
    var respuesta = document.getElementById('edit-a').value;
    var explicacion = document.getElementById('edit-e').value;
    var opciones = null;
    if (tipoUsaOpciones(tipo)) {
      opciones = parseLineasOpciones(document.getElementById('edit-o').value);
      if (!opciones) { toast(t('err_opciones')); return; }
    }
    if (tipo === 'escala' || tipo === 'numero') {
      if (!respuesta.trim() || parseEntero(respuesta) === null) { toast(t('err_num_required')); return; }
      if (tipo === 'escala' && !respuestaNumValida(respuesta)) { toast(t('err_escala_range')); return; }
    }
    var updated = Object.assign({}, card, {
      pregunta: pregunta,
      respuesta: respuesta,
      explicacion: explicacion,
      tipo: tipo,
      opciones: opciones,
      updatedAt: now
    });
    upsertCardLocal(updated);
    SyncEngine.enqueue('editCard', {
      id: id, pregunta: updated.pregunta, respuesta: updated.respuesta,
      explicacion: updated.explicacion, tipo: tipo, opciones: opciones,
      updatedAt: now
    });
    document.getElementById('edit-panel').hidden = true;
    document.getElementById('srs-buttons').hidden = false;
    Study.showCard(updated);
    toast(t('card_saved'));
  }
};

/** Genera el confeti de acierto (partículas fa-check). */
export function spawnConfetti() {
  var holder = document.getElementById('confetti');
  holder.innerHTML = '';
  var intensity = Store.settings().animacion === 'vistoso' ? 16 :
                  Store.settings().animacion === 'sutil' ? 6 : 10;
  for (var i = 0; i < intensity; i++) {
    var p = document.createElement('i');
    p.className = 'fa-solid fa-check confetti-part';
    p.style.left = (5 + Math.random() * 90) + '%';
    p.style.fontSize = (0.6 + Math.random() * 1.2) + 'rem';
    p.style.animationDelay = (Math.random() * 0.25) + 's';
    p.style.color = Math.random() > 0.5 ? '#22c55e' : '#3b82f6';
    holder.appendChild(p);
  }
  setTimeout(function () { holder.innerHTML = ''; }, 1100);
}
