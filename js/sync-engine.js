/* ============================================================
 *  MasterCards — sync-engine.js
 *  Sincronización offline-first  ⭐
 * ============================================================ */

import { CONFIG } from './config.js';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { t } from './i18n.js';
import { toast, uuid } from './utils.js';

export var SyncEngine = {

  /** Aplica un cambio local y lo encola. Es el punto de entrada de todo. */
  enqueue: function (tipo, data) {
    var queue = Store.queue();
    queue.push({ opId: uuid(), tipo: tipo, createdAt: Date.now(), data: data });
    Store.setQueue(queue);
    SyncEngine.updateIndicator();
    if (navigator.onLine) SyncEngine.flushQueue();
  },

  /**
   * Envía la cola completa al backend en un único POST.
   * - Usa Content-Type text/plain (workaround CORS de Apps Script).
   * - Backoff exponencial (1s→5s→30s) ante fallos de red.
   * - Si el token expiró, pide uno nuevo (redirect) y aborta.
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
            Auth.refresh();
            return;
          }
          throw new Error(json.message || json.error);
        }
        var confirmed = {};
        (json.data.results || []).forEach(function (r) { confirmed[r.opId] = true; });
        var remaining = queue.filter(function (op) { return !confirmed[op.opId]; });
        Store.setQueue(remaining);
        SyncEngine.updateIndicator();
        SyncEngine._retry = 0;
      })
      .catch(function (err) {
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
      '?email=' + encodeURIComponent(Auth.owner()) +
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
   */
  merge: function (serverData) {
    var decks = Store.decks();
    var cards = Store.cards();

    (serverData.decks || []).forEach(function (sDeck) {
      if (sDeck.borrado) {
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
      el.title = t('syncing');
    } else if (state === 'pending') {
      var n = Store.queue().length;
      el.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>';
      el.classList.add('pending');
      el.title = n > 0 ? t('pending_changes', { a: n }) : t('offline');
    } else {
      el.innerHTML = '<i class="fa-solid fa-cloud"></i>';
      el.classList.add('ok');
      el.title = t('uptodate');
    }
  }
};

/** Registro de listeners de conectividad. */
export function initSyncListeners() {
  window.addEventListener('online', function () {
    toast(t('online_toast'));
    SyncEngine.flushQueue().then(SyncEngine.pull);
  });
  window.addEventListener('offline', function () {
    toast(t('offline_toast'));
    SyncEngine.updateIndicator();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && navigator.onLine) SyncEngine.flushQueue();
  });
}
