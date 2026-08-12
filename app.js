/* ============================================================
 *  MasterCards — app.js
 *  PWA de flashcards Offline-First (Vanilla JS).
 *
 *  Módulos:
 *   1. CONFIG        — URLs y constantes del proyecto
 *   2. Utils         — utilidades generales
 *   3. Store         — capa de datos en localStorage
 *   4. Auth          — Google Identity Services (flujo redirect)
 *   5. Sync Engine   — sincronización offline-first  ⭐
 *   6. SRS           — algoritmo SM-2 y sesiones      ⭐
 *   7. UI            — router, dashboard, estudio, ajustes
 *
 *  Documentación: docs/ (SPEC, SCHEMA, API_SYNC, SRS, FRONTEND)
 * ============================================================ */

'use strict';

// ------------------------------------------------------------------
// 1. CONFIG
// ------------------------------------------------------------------
var CONFIG = {
  // URL /exec del deploy de Apps Script.
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxjPVGw74cBjuj_GDMxvW2-PzFDifoj4c_kOW-4KsSM6SKDxuJw_HIEEnrbfzL3xc4c/exec',
  // Client ID OAuth (público). Verificado por el backend vía tokeninfo.
  GOOGLE_CLIENT_ID: '830630854057-vaq4hic6p256qlmhoml90s78i3e9dqi0.apps.googleusercontent.com',
  // Límites del motor de sync
  MAX_OPS_PER_SYNC: 100,
  BACKOFF: [1000, 5000, 30000], // reintentos: 1s → 5s → 30s
  // SM-2
  SM2_MIN_EF: 1.3,
  // Galería de íconos Font Awesome ofrecida al usuario (sin el prefijo "fa-")
  ICON_GALERY: [
    'brain', 'bolt', 'book', 'book-open', 'calculator', 'camera', 'car', 'cat',
    'cloud', 'code', 'compass', 'dog', 'dumbbell', 'earth-americas', 'feather',
    'flag', 'flask', 'football', 'gamepad', 'gem', 'globe', 'graduation-cap',
    'heart', 'history', 'language', 'leaf', 'lightbulb', 'location-dot', 'lock',
    'magnet', 'map', 'mountain', 'music', 'palette', 'paw', 'pen', 'plane',
    'plant', 'puzzle-piece', 'rocket', 'scale-balanced', 'star', 'sword',
    'terminal', 'tree', 'trophy', 'utensils', 'video', 'volcano',
    'wand-magic-sparkles'
  ],
  COLORS: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
};

// Claves de localStorage
var K = {
  EMAIL: 'mc_email',
  DECKS: 'mc_decks',
  CARDS: 'mc_cards',
  QUEUE: 'mc_syncQueue',
  SETTINGS: 'mc_settings',
  META: 'mc_meta'
};

var DEFAULT_SETTINGS = {
  tema: 'auto',          // auto | claro | oscuro
  animacion: 'hibrido',  // sutil | hibrido | vistoso
  revelar: 'fallar',     // fallar | final
  limiteNuevas: 20,      // límite diario de tarjetas nuevas (5-100)
  orden: 'manual',       // manual | alfabetico
  favoritas: {}          // {cardId: true} — solo local, no se sincroniza
};

var DEFAULT_META = { ultimaSync: 0, nuevasHoy: { fecha: '', count: 0 } };

// ------------------------------------------------------------------
// 2. Utils
// ------------------------------------------------------------------

/** UUID v4 (idempotencia de operaciones y entidades). */
function uuid() {
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
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Markdown LIGERO (con escape HTML previo).
 * Soporta: **negrita**, *cursiva*, `código` y líneas con "- " (lista).
 * Devuelve HTML seguro (todos los demás caracteres quedan escapados).
 */
function md(src) {
  var html = esc(src);
  // Código en línea primero (para no tocar su interior)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Listas "- item"
  html = html.replace(/(?:^|\n)- ([^\n]+)/g, '<li>$1</li>');
  if (html.indexOf('<li>') !== -1) {
    html = html.replace(/<li>/g, '<ul>' + '<li>');
    html = html.replace(/<\/li>(?!\s*<\/ul>)/g, '</li>') + '</ul>';
    html = html.replace(/(<\/ul>)\s*<ul>/g, '\n');
  }
  // Negrita **texto**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Cursiva *texto*
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return html;
}

/** Inicio del día local en epoch ms. */
function todayStart() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clave de fecha local YYYY-MM-DD para el contador diario. */
function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/** Formatea epoch ms a fecha corta dd/mm. */
function fmtShort(ms) {
  if (!ms) return '';
  var d = new Date(ms);
  return d.getDate() + '/' + (d.getMonth() + 1);
}

/** Toast simple (aviso de una línea). */
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
}

/** Modal de confirmación. Devuelve Promise<boolean>. */
function confirmBox(title, text, okLabel) {
  return new Promise(function (resolve) {
    var m = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    document.getElementById('modal-ok').textContent = okLabel || 'Aceptar';
    m.classList.remove('hidden');
    confirmBox._resolve = resolve;
  });
}
function bindModal() {
  document.getElementById('modal-ok').addEventListener('click', function () {
    document.getElementById('modal').classList.add('hidden');
    confirmBox._resolve && confirmBox._resolve(true);
  });
  document.getElementById('modal-cancel').addEventListener('click', function () {
    document.getElementById('modal').classList.add('hidden');
    confirmBox._resolve && confirmBox._resolve(false);
  });
}

/** Descarga un JSON como fichero (exportación/backup). */
function downloadJSON(filename, obj) {
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

/** Copia texto al portapapeles con fallback para móvil. */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function () { return copyFallback(text); });
  }
  return Promise.resolve(copyFallback(text));
}
function copyFallback(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

// ------------------------------------------------------------------
// 3. Store — capa de datos (localStorage con caché en memoria)
// ------------------------------------------------------------------
var Store = {
  data: {},

  /** Carga todas las claves una vez (boot). */
  load: function () {
    [K.EMAIL, K.DECKS, K.CARDS, K.QUEUE, K.SETTINGS, K.META].forEach(function (key) {
      try { Store.data[key] = JSON.parse(localStorage.getItem(key)); }
      catch (e) { Store.data[key] = null; }
    });
    if (!Store.data[K.SETTINGS]) {
      Store.data[K.SETTINGS] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    if (!Store.data[K.META]) {
      Store.data[K.META] = JSON.parse(JSON.stringify(DEFAULT_META));
    }
  },

  /** Guarda una clave; captura errores de cuota sin romper la app. */
  save: function (key) {
    try {
      localStorage.setItem(key, JSON.stringify(Store.data[key]));
    } catch (e) {
      toast('⚠️ No se pudo guardar en el almacenamiento local');
    }
  },

  email: function () { return Store.data[K.EMAIL] || ''; },
  setEmail: function (v) { Store.data[K.EMAIL] = v; Store.save(K.EMAIL); },

  decks: function () { return Store.data[K.DECKS] || []; },
  setDecks: function (v) { Store.data[K.DECKS] = v; Store.save(K.DECKS); },

  cards: function () { return Store.data[K.CARDS] || []; },
  setCards: function (v) { Store.data[K.CARDS] = v; Store.save(K.CARDS); },

  queue: function () { return Store.data[K.QUEUE] || []; },
  setQueue: function (v) { Store.data[K.QUEUE] = v; Store.save(K.QUEUE); },

  settings: function () {
    return Object.assign({}, DEFAULT_SETTINGS, Store.data[K.SETTINGS] || {});
  },
  setSettings: function (s) {
    Store.data[K.SETTINGS] = Object.assign({}, DEFAULT_SETTINGS, s);
    Store.save(K.SETTINGS);
  },

  meta: function () { return Store.data[K.META] || JSON.parse(JSON.stringify(DEFAULT_META)); },
  setMeta: function (m) { Store.data[K.META] = m; Store.save(K.META); },

  /** Tarjetas activas (sin borradas) de un mazo (o de todos si mazoId null). */
  deckCards: function (mazoId) {
    return Store.cards().filter(function (c) {
      return !c.borrado && (mazoId == null || c.mazoId === mazoId);
    });
  },

  deckById: function (mazoId) {
    return Store.decks().find(function (d) { return d.mazoId === mazoId && !d.borrado; });
  }
};

/** Encuentra una tarjeta por id dentro de las activas. */
function cardById(id) {
  return Store.cards().find(function (c) { return c.id === id && !c.borrado; });
}

/** Añade o actualiza una tarjeta en la colección local (por id). */
function upsertCardLocal(card) {
  var cards = Store.cards();
  var i = cards.findIndex(function (c) { return c.id === card.id; });
  if (i === -1) cards.push(card); else cards[i] = Object.assign(cards[i], card);
  Store.setCards(cards);
}

/** Marca una tarjeta como borrada (soft) y la excluye de las colecciones activas. */
function removeCardLocal(id) {
  var cards = Store.cards().map(function (c) {
    if (c.id === id) return Object.assign({}, c, { borrado: true });
    return c;
  });
  Store.setCards(cards);
}

// ------------------------------------------------------------------
// 4. Auth — Google Identity Services (flujo redirect, no popup)
// ------------------------------------------------------------------
var Auth = {
  token: null,
  tokenExp: 0,

  /** Inicializa GIS y pinta el botón de login. */
  init: function () {
    if (typeof google === 'undefined' || !google.accounts) {
      document.getElementById('login-error').textContent = 'No se pudo cargar Google Sign-In';
      document.getElementById('login-error').classList.remove('hidden');
      return;
    }
    var btn = document.querySelector('.g_id_signin');
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      ux_mode: 'redirect', // iOS Safari bloquea popups → flujo de redirección
      callback: function (resp) { Auth.handleCredential(resp.credential); },
      auto_select: false
    });
    google.accounts.id.renderButton(btn, {
      type: 'standard', shape: 'pill', theme: 'outline',
      text: 'continue_with', size: 'large', width: 260
    });
  },

  /** Procesa el JWT devuelto por Google y guarda email + token en memoria. */
  handleCredential: function (jwt) {
    if (!jwt) return;
    var payload = decodeJwt(jwt);
    Auth.token = jwt;
    Auth.tokenExp = (payload.exp || 0) * 1000;
    Store.setEmail((payload.email || '').toLowerCase());
    // Limpiar el parámetro credential de la URL (ya procesado)
    var params = new URLSearchParams(location.search);
    if (params.has('credential')) {
      params.delete('credential');
      history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : ''));
    }
    startApp();
  },

  /** Devuelve el ID token si aún es válido (margen 60s). */
  getToken: function () {
    if (Auth.token && Auth.tokenExp > Date.now() + 60000) return Auth.token;
    return null;
  },

  /** Pide un token fresco a Google (redirect). Se usa si el token expiró. */
  refresh: function () {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.prompt();
    }
  },

  /** Cierra sesión: olvida email y token. Los datos locales se conservan. */
  logout: function () {
    Store.setEmail('');
    Auth.token = null;
    Auth.tokenExp = 0;
    location.hash = '';
    show('login');
    document.getElementById('app-header').classList.add('hidden');
  }
};

/** Decodifica el payload de un JWT (base64url) sin validar firma (solo lectura). */
function decodeJwt(jwt) {
  var parts = jwt.split('.');
  var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

// ------------------------------------------------------------------
// 5. SYNC ENGINE — sincronización offline-first  ⭐
// ------------------------------------------------------------------
// Modelo:
//   - Toda modificación se aplica PRIMERO en local (Store) y se añade
//     una operación {opId, tipo, createdAt, data} a la cola (mc_syncQueue).
//   - Cuando hay conexión, `flushQueue()` envía TODA la cola en un único
//     POST al backend (batching). Cada op es idempotente: el backend hace
//     UPSERT por UUID y last-write-wins por `updatedAt`.
//   - Al arrancar online: flush → pull (GET) → merge (LWW).
//   - La confirmación del servidor borra de la cola SOLO las ops cuyo
//     opId aparece en `results` (se hayan aplicado o fallado). Así una op
//     no confirmada se reintenta sin duplicar.
var SyncEngine = {

  /** Aplica un cambio local y lo encola. Es el punto de entrada de todo. */
  enqueue: function (tipo, data) {
    var queue = Store.queue();
    queue.push({ opId: uuid(), tipo: tipo, createdAt: Date.now(), data: data });
    Store.setQueue(queue);
    SyncEngine.updateIndicator();
    // Si hay red, intentamos enviar al momento.
    if (navigator.onLine) SyncEngine.flushQueue();
  },

  /**
   * Envía la cola completa al backend en un único POST.
   * - Usa Content-Type text/plain (workaround CORS de Apps Script).
   * - Backoff exponencial (1s→5s→30s) ante fallos de red.
   * - Si el token expiró, pide uno nuevo (redirect) y aborta (volverá al boot).
   */
  flushQueue: function () {
    var queue = Store.queue();
    if (!navigator.onLine || queue.length === 0) {
      SyncEngine.updateIndicator();
      return Promise.resolve();
    }
    if (!CONFIG.SCRIPT_URL) {
      SyncEngine.setIndicator('pending');
      return Promise.resolve();
    }
    var token = Auth.getToken();
    if (!token) {
      // Token expirado: refrescamos (la app vuelve con un credential nuevo).
      Auth.refresh();
      return Promise.resolve();
    }

    SyncEngine.setIndicator('syncing');
    var ops = queue.slice(0, CONFIG.MAX_OPS_PER_SYNC);

    return fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: token, syncOperations: ops })
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json.ok) {
          if (json.error === 'AUTH_FAILED' || json.error === 'AUTH_REQUIRED') {
            Auth.refresh(); // token rechazado → re-login
            return;
          }
          throw new Error(json.message || json.error);
        }
        var confirmed = {};
        (json.data.results || []).forEach(function (r) { confirmed[r.opId] = true; });
        // Eliminar de la cola las ops que el servidor ya ha visto.
        var remaining = queue.filter(function (op) { return !confirmed[op.opId]; });
        Store.setQueue(remaining);
        SyncEngine.updateIndicator();
        SyncEngine._retry = 0;
      })
      .catch(function (err) {
        // Fallo de red/servidor → reintento con backoff
        SyncEngine._retry = (SyncEngine._retry || 0) + 1;
        var delay = CONFIG.BACKOFF[Math.min(SyncEngine._retry - 1, CONFIG.BACKOFF.length - 1)];
        SyncEngine.setIndicator('pending');
        setTimeout(function () { SyncEngine.flushQueue(); }, delay);
      });
  },

  /** Descarga TODOS los datos del usuario desde el backend. */
  pull: function () {
    if (!navigator.onLine || !CONFIG.SCRIPT_URL) return Promise.resolve();
    var token = Auth.getToken();
    if (!token) return Promise.resolve();
    var url = CONFIG.SCRIPT_URL +
      '?email=' + encodeURIComponent(Store.email()) +
      '&token=' + encodeURIComponent(token);
    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.ok) SyncEngine.merge(json.data);
        return json;
      });
  },

  /**
   * MERGE LWW (last-write-wins) entre servidor y local.
   * - Por cada mazo/tarjeta del servidor: si local no lo tiene → se añade;
   *   si lo tiene → gana el `updatedAt` mayor.
   * - `borrado:true` del servidor ELIMINA la entidad local (el borrado gana).
   * - Se limpian huérfanos (tarjetas de mazos inexistentes).
   */
  merge: function (serverData) {
    var decks = Store.decks();
    var cards = Store.cards();

    // NOTA: NO se eliminan tarjetas de mazos que el servidor no conozca
    // todavía (p. ej. un mazo creado offline y aún sin confirmar), para
    // no perder datos en sincronizaciones parciales.

    (serverData.decks || []).forEach(function (sDeck) {
      if (sDeck.borrado) {
        // El borrado remoto del mazo elimina el mazo local y sus tarjetas.
        decks = decks.filter(function (d) { return d.mazoId !== sDeck.mazoId; });
        cards = cards.filter(function (c) { return c.mazoId !== sDeck.mazoId; });
        return;
      }
      var local = decks.find(function (d) { return d.mazoId === sDeck.mazoId; });
      if (!local) {
        decks.push(sDeck);
      } else if ((sDeck.updatedAt || 0) >= (local.updatedAt || 0)) {
        Object.assign(local, sDeck);
      }
    });

    (serverData.cards || []).forEach(function (sCard) {
      if (sCard.borrado) {
        cards = cards.filter(function (c) { return c.id !== sCard.id; });
        return;
      }
      var local = cards.find(function (c) { return c.id === sCard.id; });
      if (!local) {
        cards.push(sCard);
      } else if ((sCard.updatedAt || 0) >= (local.updatedAt || 0)) {
        Object.assign(local, sCard);
      }
    });

    decks = decks.filter(function (d) { return !d.borrado; });
    cards = cards.filter(function (c) { return !c.borrado; });

    Store.setDecks(decks);
    Store.setCards(cards);
    var meta = Store.meta();
    meta.ultimaSync = Date.now();
    Store.setMeta(meta);
  },

  /** Actualiza el indicador de nube según el estado. */
  updateIndicator: function () {
    var pending = Store.queue().length;
    if (!navigator.onLine || pending > 0) SyncEngine.setIndicator('pending');
    else SyncEngine.setIndicator('ok');
  },

  setIndicator: function (state) {
    var el = document.getElementById('sync-indicator');
    if (!el) return;
    el.classList.remove('ok', 'pending', 'syncing');
    if (state === 'syncing') {
      el.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
      el.classList.add('syncing');
      el.title = 'Sincronizando…';
    } else if (state === 'pending') {
      var n = Store.queue().length;
      el.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>';
      el.classList.add('pending');
      el.title = n > 0 ? n + ' cambio(s) pendiente(s)' : 'Sin conexión';
    } else {
      el.innerHTML = '<i class="fa-solid fa-cloud"></i>';
      el.classList.add('ok');
      el.title = 'Al día';
    }
  }
};

/** Registro de listeners de conectividad. */
function initSyncListeners() {
  window.addEventListener('online', function () {
    toast('🛜 Conectado — sincronizando…');
    SyncEngine.flushQueue().then(SyncEngine.pull);
  });
  window.addEventListener('offline', function () {
    toast('📴 Sin conexión. Tus cambios se guardarán localmente.');
    SyncEngine.updateIndicator();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && navigator.onLine) SyncEngine.flushQueue();
  });
}

// ------------------------------------------------------------------
// 6. SRS — SM-2 y sesiones de estudio  ⭐
// ------------------------------------------------------------------

/**
 * Algoritmo SM-2 (variante de 4 botones).
 * q: calidad → Otra vez=1, Difícil=3, Bien=4, Fácil=5.
 *
 * EF' = EF + (0.1 - (5-q)(0.08 + (5-q)*0.02))  [mín 1.3]
 * Si q < 3  → intervalo = 1 (fallo, repaso mañana)
 * Si q >= 3 → 1ª vez = 1 día, 2ª vez = 6 días, luego round(intervalo*EF)
 */
function sm2(facilidad, intervalo, q) {
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

/** ¿Una tarjeta está vencida? (proximaRevision en el pasado o 0 = nueva). */
function esNueva(card) { return !card.proximaRevision; }
function estaVencida(card) { return !!card.proximaRevision && card.proximaRevision <= Date.now(); }

/** Registra una tarjeta nueva estudiada hoy (para el límite diario). */
function contarNuevaHoy() {
  var meta = Store.meta();
  if (meta.nuevasHoy.fecha !== todayKey()) {
    meta.nuevasHoy = { fecha: todayKey(), count: 0 };
  }
  meta.nuevasHoy.count++;
  Store.setMeta(meta);
}

// --- Sesión de estudio ---
var Study = {
  mode: 'hoy',          // hoy | libre
  deckId: null,         // null = todos los mazos
  initial: [],          // cola original (para la barra de progreso)
  queue: [],            // cola de trabajo (puede crecer al repasar falladas)
  index: 0,
  log: [],              // [{card, q, correct}]
  redoSet: {},          // evita repasar la misma fallada más de una vez
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
      all = Store.deckCards(deckId); // ignora SRS
    } else {
      all = Store.deckCards(deckId);
      var vencidas = all.filter(estaVencida);
      // Límite diario de nuevas: se respeta aquí, al construir la cola.
      var meta = Store.meta();
      if (meta.nuevasHoy.fecha !== todayKey()) {
        meta.nuevasHoy = { fecha: todayKey(), count: 0 };
      }
      var permitidas = Math.max(0, Store.settings().limiteNuevas - meta.nuevasHoy.count);
      var nuevas = all.filter(esNueva).slice(0, permitidas);
      // Orden: vencidas primero, luego nuevas
      all = vencidas.concat(nuevas);
    }

    Study.initial = all.slice();
    Study.queue = all.slice();

    if (!all.length) {
      // Nada que estudiar: mostrar aviso en lugar de una sesión vacía.
      show('estudio');
      document.getElementById('header-title').textContent =
        mode === 'libre' ? 'Estudio Libre' : (deckId ? Store.deckById(deckId).nombre : 'Estudiar Hoy');
      document.getElementById('btn-back').hidden = false;
      document.getElementById('study-empty').classList.remove('hidden');
      document.getElementById('study-empty-text').textContent =
        mode === 'hoy' ? '¡Nada pendiente por hoy! Vuelve mañana o activa más tarjetas.'
                       : 'Este mazo no tiene tarjetas todavía.';
      document.getElementById('study-area').hidden = true;
      return;
    }

    show('estudio');
    document.getElementById('header-title').textContent =
      mode === 'libre' ? 'Estudio Libre' : (deckId ? Store.deckById(deckId).nombre : 'Estudiar Hoy');
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
      'Tarjeta ' + (Study.index + 1) + ' de ' + Study.queue.length;

    document.getElementById('study-empty').classList.add('hidden');
    document.getElementById('study-area').hidden = false;
    document.getElementById('edit-panel').hidden = true;
    Study.showCard(Study.queue[Study.index]);
  },

  showCard: function (card) {
    var fc = document.getElementById('flashcard');
    fc.classList.remove('flip', 'animate-error', 'animate-success');
    fc.classList.remove('editing');
    document.getElementById('card-icon').className = 'fa-solid fa-' + (card.icono || 'bolt') + ' card-deco';
    document.getElementById('card-q').innerHTML = md(card.pregunta);
    document.getElementById('card-a').innerHTML = md(card.respuesta);
    var why = document.getElementById('card-e');
    if (card.explicacion && card.explicacion.trim()) {
      document.getElementById('card-e-text').innerHTML = md(card.explicacion);
      why.hidden = false;
    } else {
      why.hidden = true;
    }
    // Editar/borrar/favorita
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
  },

  /** Respuesta del usuario. q: 1=Otra vez, 3=Difícil, 4=Bien, 5=Fácil. */
  answer: function (q) {
    var card = Study.queue[Study.index];
    if (!card) return;
    var btns = document.querySelectorAll('.srs');
    btns.forEach(function (b) { b.disabled = true; });

    var correct = q >= 3;
    Study.log.push({ card: card, q: q, correct: correct });

    // --- Animación según el resultado ---
    var fc = document.getElementById('flashcard');
    fc.classList.add(correct ? 'animate-success' : 'animate-error');
    if (correct) spawnConfetti();

    // --- Modo "hoy": actualizar SRS y encolar ---
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
      // Fecha epoch ms: se guarda el momento exacto de la revisión.
      SyncEngine.enqueue('updateSRS', {
        id: card.id, intervalo: next.intervalo, facilidad: next.facilidad,
        proximaRevision: updated.proximaRevision, updatedAt: now
      });
      if (wasNew) contarNuevaHoy();
    }

    // --- Fallo: comportamiento según configuración ---
    if (!correct) {
      if (Store.settings().revelar === 'fallar') {
        // Mostrar la respuesta + explicación inmediatamente
        fc.classList.add('flip');
      }
      // La fallada se repite al final de la sesión (una sola vez)
      if (!Study.redoSet[card.id]) {
        Study.redoSet[card.id] = true;
        Study.queue.push(card);
      }
    } else if (!fc.classList.contains('flip')) {
      fc.classList.add('flip');
    }

    Study.index++;
    // Avanzar tras la animación (~600ms)
    setTimeout(function () {
      btns.forEach(function (b) { b.disabled = false; });
      Study.render();
    }, 600);
  },

  /** Fin de sesión → pantalla de resumen. */
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

  /** Elimina una tarjeta de la sesión y de la colección (soft delete). */
  deleteCurrent: function (id) {
    var idx = Study.queue.findIndex(function (c) { return c.id === id; });
    if (idx !== -1) Study.queue.splice(idx, 1);
    if (idx < Study.index) Study.index--;
    removeCardLocal(id);
    SyncEngine.enqueue('deleteCard', { id: id });
    toast('Tarjeta borrada');
    Study.render();
  },

  /** Guarda la edición de la tarjeta actual. */
  saveEdit: function (id) {
    var card = cardById(id);
    if (!card) return;
    var now = Date.now();
    var updated = Object.assign({}, card, {
      pregunta: document.getElementById('edit-q').value,
      respuesta: document.getElementById('edit-a').value,
      explicacion: document.getElementById('edit-e').value,
      updatedAt: now
    });
    upsertCardLocal(updated);
    SyncEngine.enqueue('editCard', {
      id: id, pregunta: updated.pregunta, respuesta: updated.respuesta,
      explicacion: updated.explicacion, updatedAt: now
    });
    document.getElementById('edit-panel').hidden = true;
    Study.showCard(updated);
    toast('Tarjeta guardada');
  }
};

/** Genera el confeti de acierto (partículas fa-check). */
function spawnConfetti() {
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

// ------------------------------------------------------------------
// 7. UI — router, dashboard, estudio, ajustes, importación
// ------------------------------------------------------------------
var UI = {

  // ---------- Router ----------
  show: function (name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.hidden = s.dataset.screen !== name;
    });
    window.scrollTo(0, 0);
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
    var now = Date.now();

    function deckStats(mazoId) {
      var ds = cards.filter(function (c) { return c.mazoId === mazoId; });
      return {
        due: ds.filter(function (c) { return estaVencida(c); }).length,
        nuev: ds.filter(esNueva).length,
        total: ds.length
      };
    }

    // Búsqueda
    if (query) {
      decks = decks.filter(function (d) { return d.nombre.toLowerCase().includes(query); });
    }
    // Filtros (acumulables entre sí)
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

    // Orden
    var manual = Store.settings().orden === 'manual';
    if (manual) {
      decks.sort(function (a, b) {
        return (a.orden || 0) - (b.orden || 0) || (a.creado || 0) - (b.creado || 0);
      });
    } else {
      decks.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    }
    document.getElementById('btn-sort-toggle').innerHTML = manual
      ? '<i class="fa-solid fa-arrow-down-a-z"></i> Alfabético'
      : '<i class="fa-solid fa-grip-vertical"></i> Manual';

    var list = document.getElementById('deck-list');
    list.innerHTML = '';
    document.getElementById('dashboard-empty').classList.toggle('hidden', decks.length > 0);

    decks.forEach(function (d) {
      var s = deckStats(d.mazoId);
      var el = document.createElement('div');
      el.className = 'deck-card';
      el.dataset.id = d.mazoId;
      var meta = [];
      if (s.due) meta.push('<span class="due">' + s.due + ' vencidas</span>');
      if (s.nuev) meta.push('<span class="new">' + s.nuev + ' nuevas</span>');
      if (!meta.length) meta.push('<span>' + s.total + ' tarjetas</span>');
      el.innerHTML =
        '<div class="deck-icon" style="background:' + (d.color || '#22c55e') + '">' +
          '<i class="fa-solid fa-' + (d.icono || 'layer-group') + '"></i></div>' +
        '<div class="deck-info">' +
          '<div class="deck-name">' + esc(d.nombre) + '</div>' +
          '<div class="deck-meta">' + meta.join(' · ') + '</div></div>' +
        (manual ? '<span class="deck-grip" draggable="false"><i class="fa-solid fa-grip-vertical"></i></span>' : '') +
        '<div class="deck-actions">' +
          '<button class="btn primary" data-act="study"><i class="fa-solid fa-graduation-cap"></i> Estudiar</button>' +
          '<button class="btn ghost" data-act="share"><i class="fa-solid fa-share-nodes"></i> Compartir</button>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        // Si acaba de terminar un arrastre, ignorar el clic fantasma.
        if (UI._moved) { UI._moved = false; return; }
        var act = ev.target.closest('[data-act]');
        if (act && act.dataset.act === 'study') { Study.start('hoy', d.mazoId); return; }
        if (act && act.dataset.act === 'share') { UI.shareDeck(d.mazoId); return; }
        Study.start('hoy', d.mazoId);
      });
      list.appendChild(el);
    });
  },

  /** Comparte un mazo: copia la URL con ?share=<Mazo_ID>. */
  shareDeck: function (mazoId) {
    var url = location.origin + location.pathname + '?share=' + mazoId;
    copyText(url).then(function () { toast('Enlace copiado al portapapeles'); });
  },

  // ---------- Crear mazo ----------
  initCreateDeck: function () {
    UI.renderIconPicker('deck-icon-picker', 'deck-icon', 'layer-group');
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
    });

    document.getElementById('btn-create-deck').addEventListener('click', UI.createDeck);
  },

  renderIconPicker: function (containerId, key, current) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    var sel = current || CONFIG.ICON_GALERY[0];
    CONFIG.ICON_GALERY.forEach(function (ic) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-opt' + (ic === sel ? ' active' : '');
      b.innerHTML = '<i class="fa-solid fa-' + ic + '"></i>';
      b.addEventListener('click', function () {
        container.querySelectorAll('.icon-opt').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        UI._pickers = UI._pickers || {};
        UI._pickers[key] = ic;
      });
      container.appendChild(b);
    });
    UI._pickers = UI._pickers || {};
    UI._pickers[key] = sel;
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

  /** Crea el mazo (JSON en lote o tarjeta individual) y encola la sync. */
  createDeck: function () {
    var nombre = document.getElementById('deck-name').value.trim();
    if (!nombre) { toast('Ponle un nombre al mazo'); return; }

    var jsonTab = !document.getElementById('panel-json').hidden;
    var cardsRaw = [];
    if (jsonTab) {
      var raw = document.getElementById('json-input').value.trim();
      var feedback = document.getElementById('json-feedback');
      if (!raw) { toast('Pega el JSON o usa el modo tarjeta'); return; }
      try {
        cardsRaw = JSON.parse(raw);
        if (!Array.isArray(cardsRaw)) throw new Error('no-array');
        feedback.textContent = cardsRaw.length + ' tarjetas listas';
        feedback.classList.remove('error');
      } catch (e) {
        feedback.textContent = 'JSON inválido. Formato: [{"q":"...","a":"...","e":"..."}]';
        feedback.classList.add('error');
        return;
      }
    } else {
      var q = document.getElementById('single-q').value.trim();
      var a = document.getElementById('single-a').value.trim();
      if (!q || !a) { toast('Pregunta y respuesta son obligatorias'); return; }
      cardsRaw = [{ q: q, a: a, e: document.getElementById('single-e').value.trim() }];
    }

    var now = Date.now();
    var mazoId = uuid();
    var deck = {
      mazoId: mazoId,
      nombre: nombre,
      icono: UI._pickers['deck-icon'] || 'layer-group',
      color: UI._pickers['deck-color'] || CONFIG.COLORS[0],
      orden: Store.decks().filter(function (d) { return !d.borrado; }).length,
      creado: now, updatedAt: now, borrado: false
    };

    var tarjetas = cardsRaw.map(function (c) {
      return {
        id: uuid(), mazoId: mazoId, icono: c.i || '', pregunta: c.q || '',
        respuesta: c.a || '', explicacion: c.e || '',
        intervalo: 0, facilidad: 2.5, proximaRevision: 0,
        updatedAt: now, borrado: false
      };
    });

    // Aplicar localmente
    Store.setDecks(Store.decks().concat([deck]));
    Store.setCards(Store.cards().concat(tarjetas));
    // Encolar sync
    SyncEngine.enqueue('createDeck', {
      mazoId: mazoId, nombre: nombre, icono: deck.icono, color: deck.color,
      orden: deck.orden, creado: now
    });
    SyncEngine.enqueue('createCards', {
      mazoId: mazoId,
      tarjetas: tarjetas.map(function (t) {
        return { id: t.id, icono: t.icono, pregunta: t.pregunta, respuesta: t.respuesta, explicacion: t.explicacion };
      })
    });

    // Resetear el formulario y volver al dashboard
    document.getElementById('deck-name').value = '';
    document.getElementById('json-input').value = '';
    document.getElementById('json-feedback').textContent = '';
    document.getElementById('single-q').value = '';
    document.getElementById('single-a').value = '';
    document.getElementById('single-e').value = '';
    UI.renderDashboard();
    UI.show('dashboard');
    toast('Mazo creado: ' + nombre);
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
      list.innerHTML = '<p class="muted" style="text-align:center">Nada por aquí.</p>';
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
    // Segmented controls
    document.querySelectorAll('.segmented').forEach(function (seg) {
      seg.querySelectorAll('button').forEach(function (b) {
        var key = seg.id.replace('seg-', '');
        var map = { tema: 'tema', anim: 'animacion', revelar: 'revelar' };
        b.classList.toggle('active', s[map[key]] === b.dataset.value);
      });
    });
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
    document.getElementById('limite-slider').addEventListener('input', function (e) {
      var s = Store.settings();
      s.limiteNuevas = Number(e.target.value);
      Store.setSettings(s);
      UI.applySettings();
    });
    document.getElementById('btn-export').addEventListener('click', function () {
      downloadJSON('mastercards-backup.json', {
        email: Store.email(),
        fecha: new Date().toISOString(),
        decks: Store.decks(),
        cards: Store.cards(),
        settings: Store.settings()
      });
      toast('Datos exportados');
    });
    document.getElementById('btn-wipe').addEventListener('click', function () {
      confirmBox('Borrar datos locales', 'Se borrarán mazos, tarjetas y cola de sync de ESTE dispositivo. No afecta a la nube.', 'Borrar')
        .then(function (ok) {
          if (!ok) return;
          [K.DECKS, K.CARDS, K.QUEUE, K.SETTINGS, K.META].forEach(function (k) { localStorage.removeItem(k); });
          Store.load();
          Auth.logout();
          toast('Datos locales borrados');
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
    if (!Store.email()) return; // se procesará tras el login
    UI.doImport(shareId);
  },

  doImport: function (shareId) {
    if (!navigator.onLine) { toast('Sin conexión: no se puede importar ahora'); return; }
    if (!CONFIG.SCRIPT_URL) { toast('Backend no configurado'); return; }
    fetch(CONFIG.SCRIPT_URL + '?share_id=' + encodeURIComponent(shareId))
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json.ok) throw new Error(json.message || 'mazo no encontrado');
        var deck = json.data.deck;
        confirmBox('Importar mazo', '¿Importar "' + deck.nombre + '" a tu cuenta? Las tarjetas se copiarán con el progreso reiniciado.', 'Importar')
          .then(function (ok) {
            if (!ok) return;
            UI.applyImport(json.data);
          });
      })
      .catch(function () { toast('No se pudo importar el mazo'); });
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
    // Limpiar ?share= de la URL
    var params = new URLSearchParams(location.search);
    params.delete('share');
    history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : ''));
    UI.renderDashboard();
    toast('Mazo importado: ' + deck.nombre);
  }
};

/** Router simple. */
function show(name) { UI.show(name); }

// ------------------------------------------------------------------
// 8. Init — evento global para GIS + boot
// ------------------------------------------------------------------

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

  // Sync: flush → pull → merge (solo si hay red)
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

/** Boot de la aplicación. */
function boot() {
  Store.load();
  UI.initCreateDeck();
  UI.initSettings();
  UI.applySettings();
  bindModal();
  initSyncListeners();
  // GIS solo hace falta si no hay sesión guardada (evita errores offline).
  if (!Store.email()) Auth.init();

  // Registrar Service Worker (solo en contexto seguro / HTTPS)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('SW no registrado:', e);
    });
  }

  // Config del botón "Estudiar Hoy"
  document.getElementById('btn-study-today').addEventListener('click', function () {
    Study.start('hoy', null);
  });
  // Toggle orden manual/alfabético
  document.getElementById('btn-sort-toggle').addEventListener('click', function () {
    var s = Store.settings();
    s.orden = s.orden === 'manual' ? 'alfabetico' : 'manual';
    Store.setSettings(s);
    UI.renderDashboard();
  });
  // Filtros
  document.querySelectorAll('#filters .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
      UI.renderDashboard();
    });
  });
  document.getElementById('search-input').addEventListener('input', function () {
    UI.renderDashboard();
  });
  // FAB y botones de cabecera
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
  document.getElementById('btn-settings').addEventListener('click', function () {
    document.getElementById('header-title').textContent = 'Ajustes';
    UI.applySettings();
    show('ajustes');
  });
  document.getElementById('btn-back').addEventListener('click', function () {
    UI.renderDashboard();
    document.getElementById('header-title').textContent = 'MasterCards';
    document.getElementById('btn-back').hidden = true;
    show('dashboard');
  });

  // --- Estudio: eventos de la tarjeta ---
  var fc = document.getElementById('flashcard');
  fc.addEventListener('click', function () { fc.classList.toggle('flip'); });
  fc.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fc.classList.toggle('flip'); }
  });
  document.querySelectorAll('.srs').forEach(function (btn) {
    btn.addEventListener('click', function () { Study.answer(Number(btn.dataset.q)); });
  });
  document.getElementById('btn-edit-card').addEventListener('click', function (e) {
    e.stopPropagation();
    document.getElementById('edit-panel').hidden = false;
  });
  document.getElementById('btn-save-edit').addEventListener('click', function () {
    Study.saveEdit(document.getElementById('btn-edit-card').dataset.id);
  });
  document.getElementById('btn-cancel-edit').addEventListener('click', function () {
    document.getElementById('edit-panel').hidden = true;
  });
  document.getElementById('btn-del-card').addEventListener('click', function (e) {
    e.stopPropagation();
    var id = document.getElementById('btn-del-card').dataset.id;
    confirmBox('Borrar tarjeta', '¿Seguro que quieres borrar esta tarjeta?', 'Borrar')
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
    toast(isFav ? 'Añadida a favoritas' : 'Quitada de favoritas');
  });

  // --- Resumen ---
  document.querySelectorAll('[data-summary-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      UI.renderSummary(chip.dataset.summaryFilter);
    });
  });
  document.getElementById('btn-again-failed').addEventListener('click', function () {
    var failed = Study.log.filter(function (l) { return !l.correct; }).map(function (l) { return l.card; });
    if (!failed.length) { toast('No hay falladas que repasar'); return; }
    Study.start('libre', null, failed);
  });
  document.getElementById('btn-summary-close').addEventListener('click', function () {
    UI.renderDashboard();
    document.getElementById('btn-back').hidden = true;
    show('dashboard');
  });

  // --- Drag & drop para ordenar mazos (pointer events, táctil) ---
  UI.initDrag();

  // Elegir pantalla inicial
  if (Store.email()) {
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
    var rect = current.getBoundingClientRect();
    // Encontrar el elemento bajo el puntero y reordenar al pasar
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
    // Encolar el nuevo orden en una sola operación
    SyncEngine.enqueue('reorderDecks', { orden: order });
    dragging = null;
  });
};

// Arranque
document.addEventListener('DOMContentLoaded', boot);
