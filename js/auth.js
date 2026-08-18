/* ============================================================
 *  MasterCards — auth.js
 *  Sesión Google (GIS) o cuenta MasterCards (usuario+contraseña).
 * ============================================================ */

import { CONFIG } from './config.js';
import { Store } from './store.js';
import { t } from './i18n.js';
import { toast, esc, copyText, downloadJSON } from './utils.js';
import { show } from './ui.js';

// ------------------------------------------------------------------
// Auth — sesión
// ------------------------------------------------------------------
export var Auth = {
  token: null,
  tokenExp: 0,
  mode: 'google',

  isMc: function () { return Auth.mode === 'mc'; },

  hasSession: function () {
    if (Auth.mode === 'mc') return !!Store.getMcToken() && !!Store.getMcUsername();
    return !!Store.email();
  },

  owner: function () {
    return Auth.mode === 'mc' ? Store.getMcUsername() : Store.email();
  },

  init: function () {
    var u = Store.getMcUsername(), tk = Store.getMcToken();
    if (u && tk) {
      Auth.mode = 'mc';
      Auth.token = tk;
      Auth.tokenExp = 0;
      return;
    }
    Auth.mode = 'google';
    Auth.initGoogle();
  },

  initGoogle: function () {
    if (typeof google === 'undefined' || !google.accounts) {
      document.getElementById('login-error').textContent = t('gis_error');
      document.getElementById('login-error').classList.remove('hidden');
      return;
    }
    var btn = document.querySelector('.g_id_signin');
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      ux_mode: isIOS ? 'redirect' : 'popup',
      callback: function (resp) { Auth.handleCredential(resp.credential); },
      auto_select: false
    });
    google.accounts.id.renderButton(btn, {
      type: 'standard', shape: 'pill', theme: 'outline',
      text: 'continue_with', size: 'large', width: 260
    });
  },

  handleCredential: function (jwt) {
    if (!jwt) return;
    var payload = decodeJwt(jwt);
    Auth.mode = 'google';
    Auth.token = jwt;
    Auth.tokenExp = (payload.exp || 0) * 1000;
    Store.setEmail((payload.email || '').toLowerCase());
    var params = new URLSearchParams(location.search);
    if (params.has('credential')) {
      params.delete('credential');
      history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : ''));
    }
    window._mc_startApp();
  },

  getToken: function () {
    if (Auth.mode === 'mc') return Store.getMcToken() || null;
    if (Auth.token && Auth.tokenExp > Date.now() + 60000) return Auth.token;
    return null;
  },

  refresh: function () {
    if (Auth.mode === 'mc') { Auth.logout(); return; }
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.prompt();
    }
  },

  startMcSession: function (username, apiToken) {
    Auth.mode = 'mc';
    Auth.token = apiToken;
    Auth.tokenExp = 0;
    Store.setMcAuth(username, apiToken);
  },

  postAuth: function (action, body) {
    if (!navigator.onLine) {
      var ne = new Error(t('err_network'));
      ne.code = 'OFFLINE';
      return Promise.reject(ne);
    }
    return fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, body))
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (!json.ok) {
        var err = new Error(authErrText({ code: json.error, message: json.message, auth: json }));
        err.code = json.error;
        err.auth = json;
        throw err;
      }
      return json.data;
    });
  },

  logout: function () {
    Store.setEmail('');
    Store.setMcAuth('', '');
    Auth.mode = 'google';
    Auth.token = null;
    Auth.tokenExp = 0;
    location.hash = '';
    show('login');
    document.getElementById('app-header').classList.add('hidden');
  }
};

/** Decodifica el payload de un JWT (base64url) sin validar firma (solo lectura). */
export function decodeJwt(jwt) {
  var parts = jwt.split('.');
  var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

// ------------------------------------------------------------------
// Cuentas MasterCards — UI
// ------------------------------------------------------------------
export var MC = {
  pendingLogin: null,
  pendingRegister: null,
  backupCodes: null,
  backupOnDone: null,
  totpSetupToken: null
};

export var USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export var TOTP_RE = /^\d{6}$/;

var AUTH_ERR_KEYS = {
  OFFLINE: 'err_network',
  AUTH_FAILED: 'err_auth_failed',
  LOCKED: 'err_locked',
  USERNAME_TAKEN: 'err_username_taken',
  INVALID_USERNAME: 'err_username_invalid',
  WEAK_PASSWORD: 'err_weak_password',
  TOTP_INVALID: 'err_totp_invalid',
  AUTH_REQUIRED: 'err_auth_required',
  BAD_REQUEST: 'err_bad_request',
  INTERNAL: 'err_internal'
};

/** Texto de error traducible a partir del error/JSON de auth. */
export function authErrText(err) {
  if (err && err.code && AUTH_ERR_KEYS[err.code]) {
    var key = AUTH_ERR_KEYS[err.code];
    if (err.code === 'LOCKED' && err.auth && err.auth.data && err.auth.data.bloqueoMs) {
      return t(key, { a: Math.ceil(err.auth.data.bloqueoMs / 60000) });
    }
    return t(key);
  }
  return (err && err.message) ? err.message : t('err_internal');
}

function showErr(el, err) {
  if (el) { el.textContent = authErrText(err); el.classList.remove('hidden'); }
}

/** Política de contraseña (espejo del backend). Devuelve {ok, fails:[claves]}. */
export function validarPasswordMC(pw) {
  var fails = [];
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) {
    fails.push('pw_req_len', 'pw_req_upper', 'pw_req_lower', 'pw_req_digit', 'pw_req_special');
  } else {
    if (!/[A-Z]/.test(pw)) fails.push('pw_req_upper');
    if (!/[a-z]/.test(pw)) fails.push('pw_req_lower');
    if (!/[0-9]/.test(pw)) fails.push('pw_req_digit');
    if (!/[^A-Za-z0-9]/.test(pw)) fails.push('pw_req_special');
  }
  return { ok: fails.length === 0, fails: fails };
}

function normUsername(s) { return String(s || '').trim().toLowerCase(); }
function normTotp(s) { return String(s || '').replace(/\s+/g, ''); }

function renderPwMeter(el, pw) {
  if (!el) return;
  var pol = validarPasswordMC(pw);
  var reqs = ['pw_req_len', 'pw_req_upper', 'pw_req_lower', 'pw_req_digit', 'pw_req_special'];
  var strength = pol.ok ? 4 : Math.max(0, 4 - pol.fails.length);
  el.innerHTML = '<div class="pw-bar"><span class="pw-fill" data-lvl="' + strength + '"></span></div><ul class="pw-reqs">' +
    reqs.map(function (key) {
      var ok = pol.fails.indexOf(key) === -1;
      return '<li class="' + (ok ? 'ok' : '') + '"><i class="fa-solid fa-circle-' + (ok ? 'check' : 'xmark') + '"></i> ' + esc(t(key)) + '</li>';
    }).join('') + '</ul>';
}

function renderBackupCodes(codes) {
  return (codes || []).map(function (c) {
    return '<code class="bc">' + esc(c) + '</code>';
  }).join('');
}

function setTotpMode(mode) {
  var isSetup = mode === 'setup';
  document.getElementById('totp-title').textContent = t(isSetup ? 'totp_title' : 'totp_title_login');
  document.getElementById('totp-hint').textContent = t(isSetup ? 'totp_hint' : 'totp_login_hint');
  document.getElementById('totp-qr').hidden = !isSetup;
  document.getElementById('totp-secret').hidden = !isSetup;
  document.getElementById('totp-manual-hint').hidden = !isSetup;
  document.getElementById('btn-totp-skip').hidden = !isSetup;
  document.getElementById('btn-totp-activate').textContent = t(isSetup ? 'totp_activate' : 'totp_verify_btn');
  document.getElementById('btn-totp-disable').hidden = true;
  document.getElementById('totp-code').value = '';
  document.getElementById('totp-error').classList.add('hidden');
}

function enterTotpLogin() {
  setTotpMode('login');
  document.getElementById('app-header').classList.add('hidden');
  show('totp');
}

function enterTotpSetup(td) {
  setTotpMode('setup');
  if (td && td.otpauth) {
    document.getElementById('totp-qr-img').src =
      'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(td.otpauth);
  }
  document.getElementById('totp-secret').value = (td && td.secret) || '';
  document.getElementById('app-header').classList.add('hidden');
  show('totp');
}

function gotoAccount(screen) {
  ['mc-login-error', 'reg-error', 'rec-error', 'totp-error'].forEach(function (id) {
    document.getElementById(id).classList.add('hidden');
  });
  MC.pendingLogin = null;
  document.getElementById('app-header').classList.add('hidden');
  show(screen);
}

function doLoginMC() {
  var errEl = document.getElementById('mc-login-error');
  errEl.classList.add('hidden');
  var username = normUsername(document.getElementById('mc-username').value);
  var pw = document.getElementById('mc-password').value;
  if (!username || !pw) {
    errEl.textContent = t('err_required');
    errEl.classList.remove('hidden');
    return;
  }
  var attempt = function (totp) {
    var body = { username: username, password: pw };
    if (totp) body.totpCode = totp;
    return Auth.postAuth('login', body).then(function (data) {
      if (data.totpRequerido) {
        MC.pendingLogin = { username: username, password: pw };
        enterTotpLogin();
        return;
      }
      Auth.startMcSession(username, data.apiToken);
      document.getElementById('mc-password').value = '';
      window._mc_startApp();
    }).catch(function (err) {
      showErr(errEl, err);
      if (err.code !== 'LOCKED') document.getElementById('mc-password').value = '';
      document.getElementById('mc-password').focus();
    });
  };
  attempt(null);
}

function doRegister() {
  var errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');
  var username = normUsername(document.getElementById('reg-username').value);
  var pw = document.getElementById('reg-password').value;
  var pw2 = document.getElementById('reg-password2').value;
  if (!username || !pw || !pw2) {
    errEl.textContent = t('err_required');
    errEl.classList.remove('hidden');
    return;
  }
  if (!USERNAME_RE.test(username)) {
    errEl.textContent = t('err_username_invalid');
    errEl.classList.remove('hidden');
    return;
  }
  if (!validarPasswordMC(pw).ok) {
    errEl.textContent = t('err_weak_password');
    errEl.classList.remove('hidden');
    return;
  }
  if (pw !== pw2) {
    errEl.textContent = t('err_pass_mismatch');
    errEl.classList.remove('hidden');
    return;
  }
  var btn = document.getElementById('form-register').querySelector('button[type="submit"]');
  btn.disabled = true;
  Auth.postAuth('register', { username: username, password: pw })
    .then(function (data) {
      MC.pendingRegister = { username: data.username, apiToken: data.apiToken };
      MC.backupCodes = data.backupCodes;
      MC.backupOnDone = finishRegisterWithTotp;
      document.getElementById('backup-codes-list').innerHTML = renderBackupCodes(data.backupCodes);
      document.getElementById('backup-codes-confirm').checked = false;
      document.getElementById('btn-backup-codes-next').disabled = true;
      document.getElementById('app-header').classList.add('hidden');
      show('backupcodes');
    })
    .catch(function (err) { showErr(errEl, err); })
    .then(function () { btn.disabled = false; });
}

function finishRegisterWithTotp() {
  var reg = MC.pendingRegister;
  if (!reg) return;
  Auth.postAuth('totpSetup', { token: reg.apiToken })
    .then(function (td) {
      MC.totpSetupToken = reg.apiToken;
      enterTotpSetup(td);
    })
    .catch(function () {
      Auth.startMcSession(reg.username, reg.apiToken);
      MC.pendingRegister = null;
      MC.totpSetupToken = null;
      toast(t('welcome_created'));
      window._mc_startApp();
    });
}

function onBackupNext() {
  if (!MC.backupCodes) return;
  var next = MC.backupOnDone;
  MC.backupCodes = null;
  MC.backupOnDone = null;
  if (typeof next === 'function') { next(); return; }
  show('ajustes');
}

function onTotpActivate() {
  var errEl = document.getElementById('totp-error');
  errEl.classList.add('hidden');
  var code = normTotp(document.getElementById('totp-code').value);
  if (!TOTP_RE.test(code)) {
    errEl.textContent = t('err_totp_invalid');
    errEl.classList.remove('hidden');
    return;
  }

  if (MC.pendingLogin) {
    var pl = MC.pendingLogin;
    MC.pendingLogin = null;
    Auth.postAuth('login', { username: pl.username, password: pl.password, totpCode: code })
      .then(function (data) {
        if (data.totpRequerido) {
          MC.pendingLogin = pl;
          errEl.textContent = t('err_totp_invalid');
          errEl.classList.remove('hidden');
          return;
        }
        Auth.startMcSession(pl.username, data.apiToken);
        window._mc_startApp();
      })
      .catch(function (err) { showErr(errEl, err); });
    return;
  }

  if (MC.totpSetupToken) {
    Auth.postAuth('totpSetup', { token: MC.totpSetupToken, totpCode: code })
      .then(function (data) {
        if (data.activo) {
          toast(t('totp_activated'));
          MC.totpSetupToken = null;
          if (MC.pendingRegister) {
            var reg = MC.pendingRegister;
            MC.pendingRegister = null;
            Auth.startMcSession(reg.username, reg.apiToken);
            toast(t('welcome_created'));
            window._mc_startApp();
          } else {
            show('ajustes');
          }
        }
      })
      .catch(function (err) { showErr(errEl, err); });
  }
}

function onTotpSkip() {
  MC.totpSetupToken = null;
  if (MC.pendingRegister) {
    var reg = MC.pendingRegister;
    MC.pendingRegister = null;
    Auth.startMcSession(reg.username, reg.apiToken);
    toast(t('welcome_created'));
    window._mc_startApp();
    return;
  }
  show('ajustes');
}

function onTotpDisable() {
  Auth.postAuth('totpSetup', { token: Auth.getToken(), disable: true })
    .then(function () {
      toast(t('totp_disabled'));
      show('ajustes');
    })
    .catch(function (err) { toast(authErrText(err)); });
}

function openTotpSettings() {
  Auth.postAuth('totpSetup', { token: Auth.getToken() })
    .then(function (td) {
      MC.totpSetupToken = Auth.getToken();
      setTotpMode('setup');
      document.getElementById('btn-totp-disable').hidden = false;
      if (td.otpauth) {
        document.getElementById('totp-qr-img').src =
          'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent(td.otpauth);
      }
      document.getElementById('totp-secret').value = td.secret || '';
      document.getElementById('totp-code').value = '';
      show('totp');
    })
    .catch(function (err) { toast(authErrText(err)); });
}

function doRecover() {
  var errEl = document.getElementById('rec-error');
  errEl.classList.add('hidden');
  var username = normUsername(document.getElementById('rec-username').value);
  var methodEl = document.querySelector('#seg-recover-method .active');
  var method = methodEl ? methodEl.dataset.value : 'backup';
  var code = normTotp(document.getElementById('rec-code').value);
  var pw = document.getElementById('rec-password').value;
  var pw2 = document.getElementById('rec-password2').value;
  if (!username || !code) {
    errEl.textContent = t('err_required');
    errEl.classList.remove('hidden');
    return;
  }
  if (!validarPasswordMC(pw).ok) {
    errEl.textContent = t('err_weak_password');
    errEl.classList.remove('hidden');
    return;
  }
  if (pw !== pw2) {
    errEl.textContent = t('err_pass_mismatch');
    errEl.classList.remove('hidden');
    return;
  }
  var btn = document.getElementById('form-recover').querySelector('button[type="submit"]');
  btn.disabled = true;
  Auth.postAuth('recover', { username: username, method: method, code: code, nuevo: pw })
    .then(function (data) {
      Auth.startMcSession(username, data.apiToken);
      toast(t('welcome_recovered'));
      window._mc_startApp();
    })
    .catch(function (err) { showErr(errEl, err); })
    .then(function () { btn.disabled = false; });
}

function doChangePassword() {
  var errEl = document.getElementById('cp-error');
  errEl.classList.add('hidden');
  var actual = document.getElementById('cp-current').value;
  var nuevo = document.getElementById('cp-new').value;
  var nuevo2 = document.getElementById('cp-new2').value;
  if (!validarPasswordMC(nuevo).ok) {
    errEl.textContent = t('err_weak_password');
    errEl.classList.remove('hidden');
    return;
  }
  if (nuevo !== nuevo2) {
    errEl.textContent = t('err_pass_mismatch');
    errEl.classList.remove('hidden');
    return;
  }
  var btn = document.getElementById('form-change-password').querySelector('button[type="submit"]');
  btn.disabled = true;
  Auth.postAuth('changePassword', { token: Auth.getToken(), actual: actual, nuevo: nuevo })
    .then(function (data) {
      Store.setMcAuth(Store.getMcUsername(), data.apiToken);
      Auth.token = data.apiToken;
      document.getElementById('form-change-password').reset();
      document.getElementById('cp-pw-meter').innerHTML = '';
      toast(t('pw_changed'));
    })
    .catch(function (err) { showErr(errEl, err); })
    .then(function () { btn.disabled = false; });
}

function doRegenCodes() {
  Auth.postAuth('generateBackupCodes', { token: Auth.getToken() })
    .then(function (data) {
      MC.backupCodes = data.backupCodes;
      MC.backupOnDone = function () { show('ajustes'); };
      document.getElementById('backup-codes-list').innerHTML = renderBackupCodes(data.backupCodes);
      document.getElementById('backup-codes-confirm').checked = false;
      document.getElementById('btn-backup-codes-next').disabled = true;
      show('backupcodes');
      toast(t('codes_regenerated'));
    })
    .catch(function (err) { toast(authErrText(err)); });
}

/** Muestra u oculta el bloque de seguridad en Ajustes (solo cuentas MC). */
export function updateSecurityUI() {
  var sec = document.getElementById('security-section');
  if (!sec) return;
  sec.hidden = !Auth.isMc();
  var info = document.getElementById('account-info');
  if (info) info.textContent = Auth.isMc() ? t('account_label') + ': @' + Store.getMcUsername() : '';
}

/** Registra todos los eventos de las pantallas de cuenta. */
export function initAuthScreens() {
  document.getElementById('btn-goto-register').addEventListener('click', function () { gotoAccount('registro'); });
  document.getElementById('btn-goto-login').addEventListener('click', function () { gotoAccount('login'); });
  document.getElementById('btn-goto-login2').addEventListener('click', function () { gotoAccount('login'); });
  document.getElementById('btn-goto-recover').addEventListener('click', function () { gotoAccount('recuperar'); });

  document.getElementById('form-login-mc').addEventListener('submit', function (e) {
    e.preventDefault();
    doLoginMC();
  });

  document.getElementById('form-register').addEventListener('submit', function (e) {
    e.preventDefault();
    doRegister();
  });
  document.getElementById('reg-password').addEventListener('input', function () {
    renderPwMeter(document.getElementById('reg-pw-meter'), this.value);
  });

  document.getElementById('form-recover').addEventListener('submit', function (e) {
    e.preventDefault();
    doRecover();
  });
  document.getElementById('rec-password').addEventListener('input', function () {
    renderPwMeter(document.getElementById('rec-pw-meter'), this.value);
  });
  document.querySelectorAll('#seg-recover-method button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#seg-recover-method button').forEach(function (x) {
        x.classList.toggle('active', x === b);
      });
      document.getElementById('rec-code').placeholder = b.dataset.value === 'totp' ? '000000' : 'XXXXX-XXXXX';
    });
  });

  document.getElementById('btn-backup-codes-copy').addEventListener('click', function () {
    copyText(MC.backupCodes ? MC.backupCodes.join('\n') : '').then(function () { toast(t('backup_codes_copy')); });
  });
  document.getElementById('btn-backup-codes-download').addEventListener('click', function () {
    if (!MC.backupCodes) return;
    downloadJSON('mastercards-backup-codes.txt', MC.backupCodes.join('\n'));
  });
  document.getElementById('backup-codes-confirm').addEventListener('change', function () {
    document.getElementById('btn-backup-codes-next').disabled = !this.checked;
  });
  document.getElementById('btn-backup-codes-next').addEventListener('click', onBackupNext);

  document.getElementById('btn-totp-activate').addEventListener('click', onTotpActivate);
  document.getElementById('btn-totp-skip').addEventListener('click', onTotpSkip);
  document.getElementById('btn-totp-disable').addEventListener('click', onTotpDisable);
  document.getElementById('totp-code').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
  });

  document.getElementById('btn-totp-manage').addEventListener('click', openTotpSettings);
  document.getElementById('btn-regen-codes').addEventListener('click', doRegenCodes);
  document.getElementById('form-change-password').addEventListener('submit', function (e) {
    e.preventDefault();
    doChangePassword();
  });
  document.getElementById('cp-new').addEventListener('input', function () {
    renderPwMeter(document.getElementById('cp-pw-meter'), this.value);
  });
}
