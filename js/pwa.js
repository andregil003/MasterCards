/* ============================================================
 *  MasterCards — pwa.js
 *  Estado de la instalación PWA (beforeinstallprompt).
 * ============================================================ */

/** Estado mutable compartido entre módulos. */
export var pwa = {
  installPromptEvent: null,
  installDismissed: false
};

/** ¿La app se está ejecutando ya instalada (standalone)? */
export function isStandalone() {
  return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ||
         navigator.standalone === true;
}
