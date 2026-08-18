/* ============================================================
 *  MasterCards — store.js
 *  Capa de datos (localStorage con caché en memoria).
 * ============================================================ */

import { K, DEFAULT_SETTINGS, DEFAULT_META } from './config.js';
import { toast } from './utils.js';
import { t } from './i18n.js';

export var Store = {
  data: {},

  /** Carga todas las claves una vez (boot). */
  load: function () {
    [K.EMAIL, K.MC_USERNAME, K.MC_TOKEN, K.DECKS, K.CARDS, K.QUEUE, K.SETTINGS, K.META].forEach(function (key) {
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
      toast(t('storage_error'));
    }
  },

  email: function () { return Store.data[K.EMAIL] || ''; },
  setEmail: function (v) { Store.data[K.EMAIL] = v; Store.save(K.EMAIL); },

  getMcUsername: function () { return Store.data[K.MC_USERNAME] || ''; },
  getMcToken: function () { return Store.data[K.MC_TOKEN] || ''; },
  setMcAuth: function (username, apiToken) {
    Store.data[K.MC_USERNAME] = username || '';
    Store.data[K.MC_TOKEN] = apiToken || '';
    Store.save(K.MC_USERNAME);
    Store.save(K.MC_TOKEN);
  },

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
export function cardById(id) {
  return Store.cards().find(function (c) { return c.id === id && !c.borrado; });
}

/** Añade o actualiza una tarjeta en la colección local (por id). */
export function upsertCardLocal(card) {
  var cards = Store.cards();
  var i = cards.findIndex(function (c) { return c.id === card.id; });
  if (i === -1) cards.push(card); else cards[i] = Object.assign(cards[i], card);
  Store.setCards(cards);
}

/** Marca una tarjeta como borrada (soft) y la excluye de las colecciones activas. */
export function removeCardLocal(id) {
  var cards = Store.cards().map(function (c) {
    if (c.id === id) return Object.assign({}, c, { borrado: true });
    return c;
  });
  Store.setCards(cards);
}
