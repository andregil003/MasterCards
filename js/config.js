/* ============================================================
 *  MasterCards — config.js
 *  URLs, constantes y claves de localStorage.
 * ============================================================ */

export var CONFIG = {
  VERSION: '1.2.0',
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxjPVGw74cBjuj_GDMxvW2-PzFDifoj4c_kOW-4KsSM6SKDxuJw_HIEEnrbfzL3xc4c/exec',
  GOOGLE_CLIENT_ID: '830630854057-vaq4hic6p256qlmhoml90s78i3e9dqi0.apps.googleusercontent.com',
  MAX_OPS_PER_SYNC: 100,
  BACKOFF: [1000, 5000, 30000],
  SM2_MIN_EF: 1.3,
  ICON_GALERY: [
    'brain', 'bolt', 'book', 'book-open', 'calculator', 'camera', 'car', 'cat',
    'cloud', 'code', 'compass', 'dog', 'dumbbell', 'earth-americas', 'feather',
    'flag', 'flask', 'football', 'gamepad', 'gem', 'globe', 'graduation-cap',
    'heart', 'history', 'language', 'leaf', 'lightbulb', 'location-dot', 'lock',
    'magnet', 'map', 'mountain', 'music', 'palette', 'paw', 'pen', 'plane',
    'seedling', 'puzzle-piece', 'rocket', 'scale-balanced', 'star',
    'shield-halved', 'terminal', 'tree', 'trophy', 'utensils', 'video', 'volcano',
    'wand-magic-sparkles'
  ],
  ICON_GROUPS: {
    tech: ['brain', 'bolt', 'cloud', 'code', 'gamepad', 'terminal', 'video', 'wand-magic-sparkles'],
    science: ['calculator', 'flask', 'lightbulb', 'magnet', 'rocket', 'volcano', 'earth-americas', 'mountain'],
    nature: ['cat', 'dog', 'leaf', 'paw', 'seedling', 'tree', 'feather'],
    objects: ['book', 'book-open', 'camera', 'gem', 'lock', 'map', 'palette', 'pen', 'scale-balanced', 'utensils'],
    travel: ['car', 'compass', 'flag', 'globe', 'location-dot', 'plane'],
    leisure: ['dumbbell', 'football', 'graduation-cap', 'heart', 'history', 'language', 'music', 'puzzle-piece', 'star', 'trophy']
  },
  COLORS: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']
};

export var K = {
  EMAIL: 'mc_email',
  MC_USERNAME: 'mc_username',
  MC_TOKEN: 'mc_apitoken',
  SESSION_TS: 'mc_session_ts',
  DECKS: 'mc_decks',
  CARDS: 'mc_cards',
  QUEUE: 'mc_syncQueue',
  SETTINGS: 'mc_settings',
  META: 'mc_meta'
};

/** TTL de sesión MC: 24 horas. */
export var SESSION_TTL = 24 * 60 * 60 * 1000;

export var DEFAULT_SETTINGS = {
  tema: 'auto',
  animacion: 'hibrido',
  revelar: 'fallar',
  limiteNuevas: 20,
  orden: 'manual',
  idioma: 'auto',
  favoritas: {},
  nombre: ''
};

export var DEFAULT_META = { ultimaSync: 0, nuevasHoy: { fecha: '', count: 0 } };
