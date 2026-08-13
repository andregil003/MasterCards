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
  // Galería de íconos Font Awesome ofrecida al usuario (sin el prefijo "fa-").
  // OJO: solo iconos del set gratuito auto-hospedado en assets/fontawesome/.
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
  // Categorías del selector de íconos (cada ícono aparece en UNA sola).
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

// Claves de localStorage
var K = {
  EMAIL: 'mc_email',
  MC_USERNAME: 'mc_username',
  MC_TOKEN: 'mc_apitoken',
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
  idioma: 'auto',        // auto | es | en
  favoritas: {},         // {cardId: true} — solo local, no se sincroniza
  nombre: ''             // nombre de pila para el saludo (solo local)
};

var DEFAULT_META = { ultimaSync: 0, nuevasHoy: { fecha: '', count: 0 } };

// ------------------------------------------------------------------
// 1.5 I18N — Español / English
// ------------------------------------------------------------------
var I18N = {
  lang: 'es',
  dicts: {
    es: {
      app_name: 'MasterCards',
      meta_desc: 'MasterCards — Flashcards Offline-First estilo Anki.',
      // Login
      login_sub: 'Tus flashcards, siempre contigo. Inicia sesión con Google para sincronizar.',
      gis_error: 'No se pudo cargar Google Sign-In',
      // Header / navegación
      home: 'Inicio',
      settings: 'Ajustes',
      back: 'Volver',
      close: 'Cerrar',
      create_deck: 'Crear mazo',
      flip_hint: 'Dar la vuelta a la tarjeta',
      fav_aria: 'Marcar como favorita',
      edit_aria: 'Editar tarjeta',
      delete_aria: 'Borrar tarjeta',
      syncing: 'Sincronizando…',
      pending_changes: '{a} cambio(s) pendiente(s)',
      offline: 'Sin conexión',
      uptodate: 'Al día',
      online_toast: 'Conectado — sincronizando…',
      offline_toast: 'Sin conexión. Tus cambios se guardarán localmente.',
      storage_error: 'No se pudo guardar en el almacenamiento local',
      // Dashboard
      search_placeholder: 'Buscar mazos…',
      filter_due: 'Vencidas',
      filter_new: 'Nuevas',
      filter_fav: 'Favoritas',
      study_today: 'Estudiar Hoy',
      sort_alpha: 'Alfabético',
      sort_manual: 'Manual',
      study: 'Estudiar',
      share: 'Compartir',
      meta_due: '{a} vencidas',
      meta_new: '{a} nuevas',
      meta_total: '{a} tarjetas',
      empty_decks: 'No hay mazos todavía.',
      empty_decks_hint: 'Toca el botón + para crear el primero.',
      guide_step1: 'Crea un mazo con el botón +',
      guide_step2: 'Pega el JSON de una IA (botón «Copiar prompt») o añade una tarjeta individual',
      guide_step3: 'Pulsa «Estudiar Hoy» para empezar',
      link_copied: 'Enlace copiado al portapapeles',
      // Tipos de tarjeta
      card_type: 'Tipo de tarjeta',
      tipo_tarjeta: 'Tarjeta clásica',
      tipo_abierta: 'Pregunta abierta',
      tipo_opcion: 'Opción múltiple',
      tipo_desplegable: 'Lista desplegable',
      tipo_escala: 'Escala 1–10',
      tipo_numero: 'Número exacto',
      tipo_texto: 'Texto libre',
      opciones_label: 'Opciones (una por línea; marca la correcta con *)',
      err_opciones: 'Marca la correcta con * y añade al menos 2 opciones',
      err_num_required: 'La respuesta debe ser un número entero exacto',
      err_escala_range: 'La respuesta de la escala debe ser un número del 1 al 10',
      check: 'Comprobar',
      type_answer: 'Escribe tu respuesta',
      type_number: 'Escribe un número',
      choose_option: 'Selecciona…',
      escala_hint: 'Elige un número del 1 al 10.',
      reveal_answer: 'Ver respuesta',
      knew_it: 'La sabía',
      didnt_know: 'No la sabía',
      abierta_hint: 'Piensa la respuesta y luego compruébala.',
      // Crear mazo
      deck_name: 'Nombre del mazo',
      deck_name_ph: 'Ej: Inglés Básico',
      icon_label: 'Ícono',
      color_label: 'Color de acento',
      tab_json: 'Pegar JSON',
      tab_single: 'Tarjetas manuales',
      manual_cards_hint: 'Añade una o varias tarjetas. Cada bloque tiene su propio tipo.',
      add_card: 'Añadir tarjeta',
      card_n: 'Tarjeta {a}',
      opcion_ph: '*Madrid\nBarcelona',
      err_no_cards: 'Añade al menos una tarjeta o pega un JSON',
      json_label: 'JSON de la IA',
      json_ph: '[{"q":"¿Qué significa PWA?","a":"Progressive Web App","e":"PWA = aplicación web instalable"},{"q":"2+2","a":"4"}]',
      question_label: 'Pregunta',
      answer_label: 'Respuesta',
      explanation_label: 'Explicación (¿por qué?)',
      optional: 'opcional',
      copy_prompt: 'Copiar prompt para IA',
      prompt_copied: 'Prompt copiado al portapapeles',
      create_btn: 'Crear mazo',
      err_name_required: 'Ponle un nombre al mazo',
      err_json_empty: 'Pega el JSON o usa el modo tarjeta',
      err_json_invalid: 'JSON inválido. Formato: [{"q":"...","a":"...","e":"..."}]',
      cards_ready: '{a} tarjetas listas',
      err_qa_required: 'Pregunta y respuesta son obligatorias',
      deck_created: 'Mazo creado',
      // Estudio
      study_today_title: 'Estudiar Hoy',
      study_free_title: 'Estudio Libre',
      card_of: 'Tarjeta {a} de {b}',
      study_done: '¡Nada pendiente por hoy! Vuelve mañana o activa más tarjetas.',
      study_empty_deck: 'Este mazo no tiene tarjetas todavía.',
      again: 'Otra vez',
      hard: 'Difícil',
      good: 'Bien',
      easy: 'Fácil',
      why: '¿Por qué?',
      card_deleted: 'Tarjeta borrada',
      card_saved: 'Tarjeta guardada',
      added_fav: 'Añadida a favoritas',
      removed_fav: 'Quitada de favoritas',
      confirm_delete_card: 'Borrar tarjeta',
      confirm_delete_card_text: '¿Seguro que quieres borrar esta tarjeta?',
      save: 'Guardar',
      cancel: 'Cancelar',
      delete: 'Borrar',
      accept: 'Aceptar',
      // Resumen
      viewed: 'Vistas',
      correct: 'Aciertos',
      accuracy: 'Correcto',
      time: 'Tiempo',
      failed: 'Falladas',
      correct_pl: 'Correctas',
      all: 'Todas',
      review_failed: 'Repasar falladas',
      back_home: 'Volver al inicio',
      no_failed: 'No hay falladas que repasar',
      summary_empty: 'Nada por aquí.',
      // Ajustes
      language: 'Idioma',
      language_auto: 'Auto',
      theme: 'Tema',
      theme_auto: 'Auto',
      theme_light: 'Claro',
      theme_dark: 'Oscuro',
      animations: 'Animaciones',
      anim_sutil: 'Sutil',
      anim_hibrido: 'Híbrido',
      anim_vistoso: 'Vistoso',
      reveal: 'Revelar solución',
      reveal_fail: 'Al fallar',
      reveal_end: 'Al final',
      daily_limit_label: 'Límite diario de nuevas:',
      daily_limit: 'Límite diario de nuevas: {a}',
      export: 'Exportar datos',
      wipe: 'Borrar datos locales',
      logout: 'Cerrar sesión',
      export_ok: 'Datos exportados',
      wipe_confirm: 'Borrar datos locales',
      wipe_confirm_text: 'Se borrarán mazos, tarjetas y cola de sync de ESTE dispositivo. No afecta a la nube.',
      wipe_ok: 'Datos locales borrados',
      install_btn: 'Instalar app',
      // Saludo y nombre
      greeting_morning: 'Buenos días, {a}',
      greeting_afternoon: 'Buenas tardes, {a}',
      greeting_evening: 'Buenas noches, {a}',
      greeting_morning_no_name: 'Buenos días',
      greeting_afternoon_no_name: 'Buenas tardes',
      greeting_evening_no_name: 'Buenas noches',
      your_name: 'Tu nombre',
      your_name_ph: 'Ej: Ana',
      your_name_hint: 'Lo usamos para saludarte en el inicio.',
      name_modal_title: '¿Cómo te llamas?',
      name_modal_text: 'Lo usaremos para saludarte en el inicio. Puedes cambiarlo en Ajustes.',
      name_modal_skip: 'Omitir',
      name_saved: 'Nombre guardado',
      // Iconos
      icon_choose: 'Elegir ícono',
      icon_cat_tech: 'Tecnología',
      icon_cat_science: 'Ciencia',
      icon_cat_nature: 'Naturaleza',
      icon_cat_objects: 'Objetos',
      icon_cat_travel: 'Viajes',
      icon_cat_leisure: 'Ocio',
      // Instalación PWA
      install_banner: 'Instala MasterCards en tu dispositivo',
      install_now: 'Instalar',
      install_dismiss: 'Descartar',
      install_title: 'Instalar MasterCards',
      install_text_android: 'Usa el menú del navegador y elige "Instalar aplicación" o toca el botón Instalar.',
      install_text_ios: 'En iOS: toca el botón Compartir (icono de cuadrado con flecha) y elige "Añadir a pantalla de inicio".',
      install_generic: 'En tu navegador, abre el menú (⋮ o Compartir) y elige "Instalar aplicación" o "Añadir a pantalla de inicio".',
      installed_toast: 'App instalada. ¡Bienvenido a MasterCards!',
      // Importar / compartir
      import_title: 'Importar mazo',
      import_confirm: '¿Importar "{a}" a tu cuenta? Las tarjetas se copiarán con el progreso reiniciado.',
      import_btn: 'Importar',
      import_no_conn: 'Sin conexión: no se puede importar ahora',
      import_no_backend: 'Backend no configurado',
      import_fail: 'No se pudo importar el mazo',
      imported: 'Mazo importado',
      // Prompt para IA (copiar)
      prompt_intro: 'Actúa como un experto creando tarjetas flash. Crea un mazo sobre el tema "{a}" con tarjetas pregunta/respuesta claras y concisas.',
      prompt_rule1: 'Genera EXACTAMENTE este formato JSON, sin texto adicional (claves "q" pregunta, "a" respuesta, "e" explicación opcional, "t" tipo y "o" opciones):',
      prompt_rule2: 'Reglas: (1) En "opcion" y "desplegable" usa "o":[{"t":"Opción","c":true}…] con EXACTAMENTE UNA correcta ("c":true); (2) "escala" = respuesta entera del 1 al 10 y "numero" = respuesta entera exacta; (3) "texto" se responde escribiendo y "abierta" es autoevaluación; (4) las respuestas deben ser 100% correctas y concisas.',
      prompt_rule3: 'Entre 10 y 30 tarjetas, en español, variando los tipos. Todo el JSON en una sola línea por tarjeta.',
      // Cuentas MasterCards (usuario + contraseña)
      or: 'o',
      username: 'Usuario',
      username_ph: 'usuario',
      username_hint: '3–30 caracteres: letras, números, . _ -',
      password: 'Contraseña',
      pw_show: 'Mostrar contraseña',
      pw_hide: 'Ocultar contraseña',
      repeat_password: 'Repetir contraseña',
      login_btn: 'Iniciar sesión',
      create_account: 'Crear cuenta',
      forgot_password: '¿Olvidaste tu contraseña?',
      goto_login: 'Ya tengo cuenta',
      register_btn: 'Registrarme',
      continue: 'Continuar',
      backup_codes_title: 'Códigos de recuperación',
      backup_codes_hint: 'Guárdalos en un lugar seguro. Cada uno se usa UNA sola vez.',
      backup_codes_confirm: 'He guardado mis códigos',
      backup_codes_copy: 'Copiar',
      backup_codes_download: 'Descargar',
      recover_title: 'Recuperar cuenta',
      recover_method: 'Método de recuperación',
      recover_method_backup: 'Código de respaldo',
      recover_method_totp: 'App autenticadora',
      recover_code: 'Código',
      recover_code_ph: 'XXXXX-XXXXX o 6 dígitos',
      new_password: 'Contraseña nueva',
      recover_btn: 'Recuperar',
      totp_title: 'Verificación en dos pasos (opcional)',
      totp_title_login: 'Verificación en dos pasos',
      totp_hint: 'Escanea el QR con una app autenticadora (Google Authenticator, Authy…).',
      totp_login_hint: 'Introduce el código de 6 dígitos de tu app autenticadora.',
      totp_manual_hint: 'O escribe el código manualmente:',
      totp_verify_label: 'Código de 6 dígitos',
      totp_activate: 'Activar',
      totp_skip: 'Omitir',
      totp_verify_btn: 'Verificar y entrar',
      totp_disable: 'Desactivar verificación en dos pasos',
      totp_manage: 'Verificación en dos pasos',
      totp_activated: 'Verificación en dos pasos activada',
      totp_disabled: 'Verificación en dos pasos desactivada',
      pw_req_len: 'Mínimo 8 caracteres',
      pw_req_upper: 'Una mayúscula',
      pw_req_lower: 'Una minúscula',
      pw_req_digit: 'Un número',
      pw_req_special: 'Un símbolo (!@#…)',
      err_required: 'Completa todos los campos',
      err_username_invalid: 'Usuario inválido: 3–30 caracteres, empieza con letra o número, sin @',
      err_username_taken: 'Ese usuario ya existe',
      err_weak_password: 'La contraseña no cumple los requisitos',
      err_pass_mismatch: 'Las contraseñas no coinciden',
      err_auth_failed: 'Usuario o contraseña incorrectos',
      err_locked: 'Demasiados intentos. Espera {a} min',
      err_totp_invalid: 'Código incorrecto',
      err_auth_required: 'Sesión no válida. Inicia sesión de nuevo.',
      err_bad_request: 'Solicitud inválida',
      err_internal: 'Error del servidor. Inténtalo más tarde.',
      err_network: 'Sin conexión. Conéctate e inténtalo de nuevo.',
      crash_title: 'Algo salió mal',
      crash_reload: 'Recargar',
      crash_generic: 'Error inesperado. Recarga la app para continuar.',
      welcome_created: '¡Cuenta creada!',
      welcome_recovered: 'Contraseña restablecida',
      pw_changed: 'Contraseña cambiada',
      codes_regenerated: 'Códigos de respaldo regenerados',
      security_title: 'Seguridad',
      account_label: 'Cuenta',
      current_password: 'Contraseña actual',
      change_password_btn: 'Cambiar contraseña',
      regen_codes: 'Regenerar códigos'
    },
    en: {
      app_name: 'MasterCards',
      meta_desc: 'MasterCards — Offline-First Anki-style flashcards.',
      // Login
      login_sub: 'Your flashcards, always with you. Sign in with Google to sync.',
      gis_error: 'Could not load Google Sign-In',
      // Header / navigation
      home: 'Home',
      settings: 'Settings',
      back: 'Back',
      close: 'Close',
      create_deck: 'Create deck',
      flip_hint: 'Flip the card',
      fav_aria: 'Mark as favorite',
      edit_aria: 'Edit card',
      delete_aria: 'Delete card',
      syncing: 'Syncing…',
      pending_changes: '{a} pending change(s)',
      offline: 'Offline',
      uptodate: 'Up to date',
      online_toast: 'Connected — syncing…',
      offline_toast: 'Offline. Your changes will be saved locally.',
      storage_error: 'Could not save to local storage',
      // Dashboard
      search_placeholder: 'Search decks…',
      filter_due: 'Due',
      filter_new: 'New',
      filter_fav: 'Favorites',
      study_today: 'Study Today',
      sort_alpha: 'Alphabetical',
      sort_manual: 'Manual',
      study: 'Study',
      share: 'Share',
      meta_due: '{a} due',
      meta_new: '{a} new',
      meta_total: '{a} cards',
      empty_decks: 'No decks yet.',
      empty_decks_hint: 'Tap the + button to create your first one.',
      guide_step1: 'Create a deck with the + button',
      guide_step2: 'Paste an AI-generated JSON (the «Copy prompt» button) or add a single card',
      guide_step3: 'Tap «Study Today» to get started',
      link_copied: 'Link copied to clipboard',
      // Card types
      card_type: 'Card type',
      tipo_tarjeta: 'Classic card',
      tipo_abierta: 'Open question',
      tipo_opcion: 'Multiple choice',
      tipo_desplegable: 'Dropdown',
      tipo_escala: '1–10 scale',
      tipo_numero: 'Exact number',
      tipo_texto: 'Free text',
      opciones_label: 'Options (one per line; mark the correct one with *)',
      err_opciones: 'Mark the correct one with * and add at least 2 options',
      err_num_required: 'The answer must be an exact whole number',
      err_escala_range: 'The scale answer must be a number from 1 to 10',
      check: 'Check',
      type_answer: 'Type your answer',
      type_number: 'Type a number',
      choose_option: 'Select…',
      escala_hint: 'Pick a number from 1 to 10.',
      reveal_answer: 'Show answer',
      knew_it: 'I knew it',
      didnt_know: "I didn't know",
      abierta_hint: 'Think of the answer, then check it.',
      // Create deck
      deck_name: 'Deck name',
      deck_name_ph: 'e.g. Basic English',
      icon_label: 'Icon',
      color_label: 'Accent color',
      tab_json: 'Paste JSON',
      tab_single: 'Manual cards',
      manual_cards_hint: 'Add one or more cards. Each block has its own type.',
      add_card: 'Add card',
      card_n: 'Card {a}',
      opcion_ph: '*Correct\nIncorrect',
      err_no_cards: 'Add at least one card or paste JSON',
      json_label: 'AI JSON',
      json_ph: '[{"q":"What does PWA mean?","a":"Progressive Web App","e":"PWA = installable web app"},{"q":"2+2","a":"4"}]',
      question_label: 'Question',
      answer_label: 'Answer',
      explanation_label: 'Explanation (why?)',
      optional: 'optional',
      copy_prompt: 'Copy AI prompt',
      prompt_copied: 'Prompt copied to clipboard',
      create_btn: 'Create deck',
      err_name_required: 'Give your deck a name',
      err_json_empty: 'Paste the JSON or use the single-card mode',
      err_json_invalid: 'Invalid JSON. Format: [{"q":"...","a":"...","e":"..."}]',
      cards_ready: '{a} cards ready',
      err_qa_required: 'Question and answer are required',
      deck_created: 'Deck created',
      // Study
      study_today_title: 'Study Today',
      study_free_title: 'Free Study',
      card_of: 'Card {a} of {b}',
      study_done: 'Nothing due today! Come back tomorrow or enable more cards.',
      study_empty_deck: 'This deck has no cards yet.',
      again: 'Again',
      hard: 'Hard',
      good: 'Good',
      easy: 'Easy',
      why: 'Why?',
      card_deleted: 'Card deleted',
      card_saved: 'Card saved',
      added_fav: 'Added to favorites',
      removed_fav: 'Removed from favorites',
      confirm_delete_card: 'Delete card',
      confirm_delete_card_text: 'Are you sure you want to delete this card?',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      accept: 'OK',
      // Summary
      viewed: 'Viewed',
      correct: 'Correct',
      accuracy: 'Accuracy',
      time: 'Time',
      failed: 'Failed',
      correct_pl: 'Correct',
      all: 'All',
      review_failed: 'Review failed',
      back_home: 'Back to home',
      no_failed: 'Nothing to review',
      summary_empty: 'Nothing here.',
      // Settings
      language: 'Language',
      language_auto: 'Auto',
      theme: 'Theme',
      theme_auto: 'Auto',
      theme_light: 'Light',
      theme_dark: 'Dark',
      animations: 'Animations',
      anim_sutil: 'Subtle',
      anim_hibrido: 'Hybrid',
      anim_vistoso: 'Flashy',
      reveal: 'Reveal answer',
      reveal_fail: 'On failure',
      reveal_end: 'At the end',
      daily_limit_label: 'Daily new-card limit:',
      daily_limit: 'Daily new-card limit: {a}',
      export: 'Export data',
      wipe: 'Erase local data',
      logout: 'Sign out',
      export_ok: 'Data exported',
      wipe_confirm: 'Erase local data',
      wipe_confirm_text: 'Decks, cards and the sync queue on THIS device will be erased. Your cloud data is not affected.',
      wipe_ok: 'Local data erased',
      install_btn: 'Install app',
      // Greeting and name
      greeting_morning: 'Good morning, {a}',
      greeting_afternoon: 'Good afternoon, {a}',
      greeting_evening: 'Good evening, {a}',
      greeting_morning_no_name: 'Good morning',
      greeting_afternoon_no_name: 'Good afternoon',
      greeting_evening_no_name: 'Good evening',
      your_name: 'Your name',
      your_name_ph: 'e.g. Ana',
      your_name_hint: 'We use it to greet you on the home screen.',
      name_modal_title: 'What is your name?',
      name_modal_text: 'We will use it to greet you on the home screen. You can change it in Settings.',
      name_modal_skip: 'Skip',
      name_saved: 'Name saved',
      // Icons
      icon_choose: 'Choose icon',
      icon_cat_tech: 'Tech',
      icon_cat_science: 'Science',
      icon_cat_nature: 'Nature',
      icon_cat_objects: 'Objects',
      icon_cat_travel: 'Travel',
      icon_cat_leisure: 'Leisure',
      // PWA install
      install_banner: 'Install MasterCards on your device',
      install_now: 'Install',
      install_dismiss: 'Dismiss',
      install_title: 'Install MasterCards',
      install_text_android: 'Open your browser menu and choose "Install app", or tap the Install button.',
      install_text_ios: 'On iOS: tap the Share button (square with arrow) and choose "Add to Home Screen".',
      install_generic: 'In your browser, open the menu (⋮ or Share) and choose "Install app" or "Add to Home Screen".',
      installed_toast: 'App installed. Welcome to MasterCards!',
      // Import / share
      import_title: 'Import deck',
      import_confirm: 'Import "{a}" to your account? Cards will be copied with progress reset.',
      import_btn: 'Import',
      import_no_conn: 'Offline: cannot import right now',
      import_no_backend: 'Backend not configured',
      import_fail: 'Could not import the deck',
      imported: 'Deck imported',
      // AI prompt (copy)
      prompt_intro: 'Act as an expert flashcard creator. Make a deck about "{a}" with clear, concise question/answer cards.',
      prompt_rule1: 'Output EXACTLY this JSON format, with no extra text (keys "q" question, "a" answer, "e" optional explanation, "t" type and "o" options):',
      prompt_rule2: 'Rules: (1) For "opcion" and "desplegable" use "o":[{"t":"Option","c":true}…] with EXACTLY ONE correct ("c":true); (2) "escala" = whole answer from 1 to 10 and "numero" = exact whole answer; (3) "texto" is answered by typing and "abierta" is self-graded; (4) answers must be 100% correct and concise.',
      prompt_rule3: 'Between 10 and 30 cards, in English, mixing the types. Output one card per line.',
      // MasterCards accounts (username + password)
      or: 'or',
      username: 'Username',
      username_ph: 'username',
      username_hint: '3–30 chars: letters, numbers, . _ -',
      password: 'Password',
      pw_show: 'Show password',
      pw_hide: 'Hide password',
      repeat_password: 'Repeat password',
      login_btn: 'Sign in',
      create_account: 'Create account',
      forgot_password: 'Forgot your password?',
      goto_login: 'I already have an account',
      register_btn: 'Sign up',
      continue: 'Continue',
      backup_codes_title: 'Recovery codes',
      backup_codes_hint: 'Keep them in a safe place. Each code can be used only ONCE.',
      backup_codes_confirm: 'I have saved my codes',
      backup_codes_copy: 'Copy',
      backup_codes_download: 'Download',
      recover_title: 'Recover account',
      recover_method: 'Recovery method',
      recover_method_backup: 'Backup code',
      recover_method_totp: 'Authenticator app',
      recover_code: 'Code',
      recover_code_ph: 'XXXXX-XXXXX or 6 digits',
      new_password: 'New password',
      recover_btn: 'Recover',
      totp_title: 'Two-step verification (optional)',
      totp_title_login: 'Two-step verification',
      totp_hint: 'Scan the QR code with an authenticator app (Google Authenticator, Authy…).',
      totp_login_hint: 'Enter the 6-digit code from your authenticator app.',
      totp_manual_hint: 'Or type the code manually:',
      totp_verify_label: '6-digit code',
      totp_activate: 'Enable',
      totp_skip: 'Skip',
      totp_verify_btn: 'Verify and sign in',
      totp_disable: 'Disable two-step verification',
      totp_manage: 'Two-step verification',
      totp_activated: 'Two-step verification enabled',
      totp_disabled: 'Two-step verification disabled',
      pw_req_len: 'At least 8 characters',
      pw_req_upper: 'One uppercase letter',
      pw_req_lower: 'One lowercase letter',
      pw_req_digit: 'One number',
      pw_req_special: 'One symbol (!@#…)',
      err_required: 'Fill in all fields',
      err_username_invalid: 'Invalid username: 3–30 chars, start with a letter or number, no @',
      err_username_taken: 'That username is already taken',
      err_weak_password: 'The password does not meet the requirements',
      err_pass_mismatch: 'The passwords do not match',
      err_auth_failed: 'Incorrect username or password',
      err_locked: 'Too many attempts. Wait {a} min',
      err_totp_invalid: 'Incorrect code',
      err_auth_required: 'Invalid session. Sign in again.',
      err_bad_request: 'Invalid request',
      err_internal: 'Server error. Try again later.',
      err_network: 'Offline. Connect and try again.',
      crash_title: 'Something went wrong',
      crash_reload: 'Reload',
      crash_generic: 'Unexpected error. Reload the app to continue.',
      welcome_created: 'Account created!',
      welcome_recovered: 'Password reset',
      pw_changed: 'Password changed',
      codes_regenerated: 'Backup codes regenerated',
      security_title: 'Security',
      account_label: 'Account',
      current_password: 'Current password',
      change_password_btn: 'Change password',
      regen_codes: 'Regenerate codes'
    }
  },

  /** Traducción con placeholders {a}, {b}, … */
  t: function (key, params) {
    var d = I18N.dicts[I18N.lang] || I18N.dicts.es;
    var s = (d[key] != null) ? d[key] : (I18N.dicts.es[key] != null ? I18N.dicts.es[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
      });
    }
    return s;
  },

  /** Resuelve el idioma efectivo (auto → idioma del navegador, fallback es). */
  resolve: function () {
    var pref = (Store.settings().idioma) || 'auto';
    if (pref === 'es' || pref === 'en') return pref;
    var nav = (navigator.language || 'es').toLowerCase();
    return nav.indexOf('en') === 0 ? 'en' : 'es';
  },

  /** Aplica la traducción a todos los elementos estáticos (data-i18n). */
  apply: function () {
    I18N.lang = I18N.resolve();
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = I18N.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', I18N.t(el.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', I18N.t(el.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', I18N.t(el.dataset.i18nTitle));
    });
    document.documentElement.lang = I18N.lang;
    document.title = I18N.t('app_name');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', I18N.t('meta_desc'));
  }
};

/** Atajo de traducción (evita escribir I18N.t en todo el código). */
function t(key, params) { return I18N.t(key, params); }


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

/** Convierte un color hex en rgba con la opacidad dada (para fondos suaves). */
function withAlpha(color, alpha) {
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

/** Saludo según la hora del día: mañana 5–12, tarde 12–20, noche 20–5. */
function saludoDeLaHora() {
  var h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 20) return 'afternoon';
  return 'evening';
}

/** Rellena el saludo del dashboard ("Buenos días, {nombre}"). */
function renderGreeting() {
  var el = document.getElementById('greeting');
  if (!el) return;
  var nombre = (Store.settings().nombre || '').trim();
  var key = 'greeting_' + saludoDeLaHora() + (nombre ? '' : '_no_name');
  el.textContent = nombre ? t(key, { a: nombre }) : t(key);
}

/** Modal único: pide el nombre la primera vez (para el saludo). */
function maybeAskName() {
  if ((Store.settings().nombre || '').trim()) return;
  var modal = document.getElementById('name-modal');
  if (!modal) return;
  document.getElementById('name-modal-input').value = '';
  modal.classList.remove('hidden');
  setTimeout(function () { document.getElementById('name-modal-input').focus(); }, 60);
}

/** Modal de confirmación. Devuelve Promise<boolean>. */
function confirmBox(title, text, okLabel) {
  return new Promise(function (resolve) {
    var m = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    document.getElementById('modal-ok').textContent = okLabel || t('accept');
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

/** Botones del modal de nombre (saludo). */
function bindNameModal() {
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
function initPasswordToggles() {
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
// 4. Auth — sesión Google (GIS) o cuenta MasterCards (usuario+contraseña)
// ------------------------------------------------------------------
var Auth = {
  token: null,
  tokenExp: 0,
  mode: 'google', // 'google' | 'mc'

  /** ¿Sesión de cuenta MasterCards activa? */
  isMc: function () { return Auth.mode === 'mc'; },

  /** ¿Hay sesión guardada y válida (Google o MC)? */
  hasSession: function () {
    if (Auth.mode === 'mc') return !!Store.getMcToken() && !!Store.getMcUsername();
    return !!Store.email();
  },

  /** Dueño (owner) para el backend: email de Google o username de MC. */
  owner: function () {
    return Auth.mode === 'mc' ? Store.getMcUsername() : Store.email();
  },

  /** Boot: restaura la sesión MC si existe; si no, prepara el login con Google. */
  init: function () {
    var u = Store.getMcUsername(), tk = Store.getMcToken();
    if (u && tk) {
      Auth.mode = 'mc';
      Auth.token = tk;
      Auth.tokenExp = 0; // los tokens MC no caducan; se rotan en cada login
      return;
    }
    Auth.mode = 'google';
    Auth.initGoogle();
  },

  /** Inicializa GIS y pinta el botón de login. */
  initGoogle: function () {
    if (typeof google === 'undefined' || !google.accounts) {
      document.getElementById('login-error').textContent = t('gis_error');
      document.getElementById('login-error').classList.remove('hidden');
      return;
    }
    var btn = document.querySelector('.g_id_signin');
    // iOS Safari bloquea popups → flujo redirect. En el resto (Android instalado,
    // desktop) usamos popup: evita el redirect_uri_mismatch/405 de las PWAs instaladas.
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

  /** Procesa el JWT devuelto por Google y guarda email + token en memoria. */
  handleCredential: function (jwt) {
    if (!jwt) return;
    var payload = decodeJwt(jwt);
    Auth.mode = 'google';
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

  /** Devuelve el token actual si es válido (Google con margen 60s; MC siempre). */
  getToken: function () {
    if (Auth.mode === 'mc') return Store.getMcToken() || null;
    if (Auth.token && Auth.tokenExp > Date.now() + 60000) return Auth.token;
    return null;
  },

  /** Token rechazado: en MC cerramos sesión; en Google pedimos uno nuevo. */
  refresh: function () {
    if (Auth.mode === 'mc') { Auth.logout(); return; }
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.prompt();
    }
  },

  /** Guarda la sesión de una cuenta MasterCards. */
  startMcSession: function (username, apiToken) {
    Auth.mode = 'mc';
    Auth.token = apiToken;
    Auth.tokenExp = 0;
    Store.setMcAuth(username, apiToken);
  },

  /** POST de auth a la Web App. Lanza Error con err.code en caso de fallo. */
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

  /** Cierra sesión: olvida email y token. Los datos locales se conservan. */
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
function decodeJwt(jwt) {
  var parts = jwt.split('.');
  var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(decodeURIComponent(escape(atob(b64))));
}

// ------------------------------------------------------------------
// 4.5 CUENTAS MASTERCARDS — login/registro/recuperación/TOTP (UI)
// ------------------------------------------------------------------
var MC = {
  pendingLogin: null,    // {username, password} esperando TOTP en el login
  pendingRegister: null, // {username, apiToken} tras registrarse
  backupCodes: null,
  backupOnDone: null,    // continuación tras confirmar los códigos
  totpSetupToken: null   // token para activar TOTP
};

var USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
var TOTP_RE = /^\d{6}$/;

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
function authErrText(err) {
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
function validarPasswordMC(pw) {
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

/** Medidor de fortaleza: barra + lista de requisitos. */
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

/** Configura el modo de la pantalla TOTP ('setup' para QR, 'login' para verificar). */
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
      startApp();
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

/** Tras confirmar códigos en el registro: paso opcional de TOTP. */
function finishRegisterWithTotp() {
  var reg = MC.pendingRegister;
  if (!reg) return;
  Auth.postAuth('totpSetup', { token: reg.apiToken })
    .then(function (td) {
      MC.totpSetupToken = reg.apiToken;
      enterTotpSetup(td);
    })
    .catch(function () {
      // Sin TOTP: iniciar sesión directamente
      Auth.startMcSession(reg.username, reg.apiToken);
      MC.pendingRegister = null;
      MC.totpSetupToken = null;
      toast(t('welcome_created'));
      startApp();
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
        startApp();
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
            startApp();
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
    startApp();
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
      startApp();
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
function updateSecurityUI() {
  var sec = document.getElementById('security-section');
  if (!sec) return;
  sec.hidden = !Auth.isMc();
  var info = document.getElementById('account-info');
  if (info) info.textContent = Auth.isMc() ? t('account_label') + ': @' + Store.getMcUsername() : '';
}

/** Registra todos los eventos de las pantallas de cuenta. */
function initAuthScreens() {
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
function initSyncListeners() {
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

// ------------------------------------------------------------------
// Tipos de tarjeta (funciones puras, cubiertas en scripts/test.js)
// ------------------------------------------------------------------

var TIPOS_CARD = ['tarjeta', 'abierta', 'opcion', 'texto', 'desplegable', 'escala', 'numero'];

/** Tipos que guardan sus opciones [{texto,correcta}] (opción múltiple y desplegable). */
function tipoUsaOpciones(tipo) { return tipo === 'opcion' || tipo === 'desplegable'; }

/** Tipos que se corrigen automáticamente al responder (q=4/q=1). */
function tipoAuto(tipo) { return tipo === 'opcion' || tipo === 'desplegable' || tipo === 'escala' || tipo === 'numero' || tipo === 'texto'; }

/** Parsea un entero exacto desde la respuesta esperada. Devuelve null si no es válido. */
function parseEntero(s) {
  var n = Number(String(s || '').trim());
  return (s !== null && s !== undefined && String(s).trim() !== '' && isFinite(n) && Math.floor(n) === n) ? n : null;
}

/** Valida la respuesta esperada de escala/número: debe ser un entero exacto. */
function respuestaNumValida(respuesta) {
  var n = parseEntero(respuesta);
  return n !== null && n >= 1 && n <= 10;
}

/** Normaliza texto para comparar respuestas: minúsculas, sin tildes, sin puntuación. */
function normalizarTexto(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\s+/g, ' ');
}

/** Valida y normaliza un array de opciones [{texto, correcta}]. Devuelve null si no es válido. */
function normalizarOpciones(o) {
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

/** Parsea el textarea de opciones (una por línea; `*` marca la correcta). Devuelve null si no es válido. */
function parseLineasOpciones(text) {
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

/** Convierte las opciones de una tarjeta a formato del textarea de edición. */
function opcionesParaEditar(card) {
  return (card.opciones || []).map(function (o) {
    return (o.correcta ? '*' : '') + o.texto;
  }).join('\n');
}

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
    var editTipo = document.getElementById('edit-tipo');
    editTipo.value = TIPOS_CARD.indexOf(card.tipo) !== -1 ? card.tipo : 'tarjeta';
    document.getElementById('edit-o').value = opcionesParaEditar(card);
    document.getElementById('edit-opciones-wrap').hidden = !tipoUsaOpciones(editTipo.value);
  },

  /** Tipo efectivo de la tarjeta (con datos válidos). */
  tipoDe: function (card) {
    if (tipoUsaOpciones(card.tipo) && card.opciones && card.opciones.length >= 2) return card.tipo;
    if (card.tipo === 'texto' || card.tipo === 'abierta') return card.tipo;
    if (card.tipo === 'escala' || card.tipo === 'numero') return card.tipo;
    return 'tarjeta';
  },

  /** Construye los controles de respuesta según el tipo de tarjeta. */
  renderAnswers: function (card) {
    var wrap = document.getElementById('study-answers');
    var srs = document.getElementById('srs-buttons');
    var tipo = Study.tipoDe(card);
    wrap.innerHTML = '';
    wrap.hidden = tipo === 'tarjeta';
    srs.hidden = tipo !== 'tarjeta';
    if (tipo === 'opcion') {
      var fc = document.getElementById('flashcard');
      if (fc.classList.contains('flip')) return; // ya respondida
      // Barajar opciones para que el orden no se repita
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
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + t('check');
      var row = document.createElement('div');
      row.className = 'texto-check-row';
      row.appendChild(inp);
      row.appendChild(btn);
      wrap.appendChild(row);
      function doCheck() {
        if (btn.disabled) return;
        var ok = inp.value.trim() !== '' && normalizarTexto(inp.value) === normalizarTexto(card.respuesta);
        Study.gradeText(card, ok, inp, btn, row);
      }
      btn.addEventListener('click', doCheck);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doCheck(); }
      });
      setTimeout(function () { inp.focus(); }, 60);
    } else if (tipo === 'abierta') {
      var fc2 = document.getElementById('flashcard');
      if (fc2.classList.contains('flip')) {
        Study.renderManualAbierta(card);
      } else {
        var hint = document.createElement('p');
        hint.className = 'muted small';
        hint.textContent = t('abierta_hint');
        var reveal = document.createElement('button');
        reveal.type = 'button';
        reveal.className = 'btn block';
        reveal.innerHTML = '<i class="fa-solid fa-eye"></i> ' + t('reveal_answer');
        reveal.addEventListener('click', function () {
          fc2.classList.add('flip');
          Study.renderManualAbierta(card);
        });
        wrap.appendChild(hint);
        wrap.appendChild(reveal);
      }
    }
  },

  /** Botones "La sabía / No la sabía" para tarjetas abiertas ya reveladas. */
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

  /** Al voltear la tarjeta: muestra los botones manuales si es abierta. */
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

  /** Corrige una opción múltiple. */
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

  /** Corrige una respuesta de texto libre. */
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

  /** Corrige un desplegable. */
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

  /** Corrige una escala 1-10. */
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

  /** Respuesta del usuario. q: 1=Otra vez/No, 3=Difícil, 4=Bien/Sí, 5=Fácil. */
  answer: function (q) {
    var card = Study.queue[Study.index];
    if (!card || Study._answered) return;
    Study._answered = true;
    var controls = document.querySelectorAll('.srs, #study-answers button, #study-answers input');
    controls.forEach(function (c) { c.disabled = true; });

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
    var esTipo = Study.tipoDe(card) !== 'tarjeta';
    if (!correct) {
      // En tarjetas tipadas siempre se revela la respuesta (no hay opción de leerla antes).
      if (Store.settings().revelar === 'fallar' || esTipo) {
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
    // Si se reveló la respuesta al fallar, dar tiempo a leerla; si no, avance rápido.
    var revealDelay = (!correct && Store.settings().revelar === 'fallar') ? 1500 : 800;
    if (esTipo) revealDelay = 2200; // las tipadas dejan leer el feedback/corrección
    setTimeout(function () {
      controls.forEach(function (c) { c.disabled = false; });
      Study.render();
    }, revealDelay);
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
    toast(t('card_deleted'));
    Study.render();
  },

  /** Guarda la edición de la tarjeta actual. */
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
    // Barra inferior solo en pantallas principales (dashboard / ajustes)
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
    if (installDismissed || isStandalone() || !installPromptEvent) return;
    var b = document.getElementById('install-banner');
    if (b) { b.classList.remove('hidden'); b.hidden = false; }
  },

  hideInstallBanner: function () {
    var b = document.getElementById('install-banner');
    if (b) { b.classList.add('hidden'); b.hidden = true; }
  },

  promptInstall: function () {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      installPromptEvent.userChoice.then(function (choice) {
        installPromptEvent = null;
        if (choice.outcome === 'accepted') {
          UI.hideInstallBanner();
          toast(t('installed_toast'));
        }
      });
      return;
    }
    // iOS u otros navegadores sin beforeinstallprompt: instrucciones manuales.
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
        '<div class="deck-icon" style="background:' + withAlpha(d.color || '#22c55e', 0.16) + ';border:1px solid ' + withAlpha(d.color || '#22c55e', 0.4) + '">' +
          '<i class="fa-solid fa-' + (d.icono || 'layer-group') + '" style="color:' + (d.iconoColor || '#22c55e') + '"></i></div>' +
        '<div class="deck-info">' +
          '<div class="deck-name">' + esc(d.nombre) + '</div>' +
          '<div class="deck-meta">' + meta.join(' · ') + '</div></div>' +
        (manual ? '<span class="deck-grip" draggable="false"><i class="fa-solid fa-grip-vertical"></i></span>' : '') +
        '<div class="deck-actions">' +
          '<button class="btn primary" data-act="study"><i class="fa-solid fa-graduation-cap"></i> ' + esc(t('study')) + '</button>' +
          '<button class="btn ghost btn-ghost-icon" data-act="share" title="' + esc(t('share')) + '"><i class="fa-solid fa-share-nodes"></i></button>' +
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

    // Editor de tarjeta en estudio: muestra/oculta opciones según el tipo
    document.getElementById('edit-tipo').addEventListener('change', function () {
      document.getElementById('edit-opciones-wrap').hidden = !tipoUsaOpciones(this.value);
    });
  },

  /** Añade un bloque de tarjeta manual (tipo + pregunta + respuesta + …). */
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

  /** Renumera los bloques visibles de tarjetas manuales. */
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

    // Chips de categoría (se muestra una categoría a la vez)
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

    // Cuadrícula de íconos de la categoría activa
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

    // Colores del ícono (independiente del color de acento del mazo)
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

  /** Crea el mazo (JSON en lote o tarjeta individual) y encola la sync. */
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
      // Modo tarjetas manuales: una o varias
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
      // Color del ícono: solo local (presentación), no se sincroniza como el color.
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
        if (!opciones) tipo = 'tarjeta'; // opciones inválidas → clásica
      }
      if (tipo === 'escala' || tipo === 'numero') {
        // Respuesta esperada inválida → se degrada a clásica
        if (!c.a || parseEntero(c.a) === null || (tipo === 'escala' && !respuestaNumValida(c.a))) tipo = 'tarjeta';
      }
      return {
        id: uuid(), mazoId: mazoId, icono: c.i || '', pregunta: c.q || '',
        respuesta: c.a || '', explicacion: c.e || '', tipo: tipo, opciones: opciones,
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
        return { id: t.id, icono: t.icono, pregunta: t.pregunta, respuesta: t.respuesta,
                 explicacion: t.explicacion, tipo: t.tipo, opciones: t.opciones };
      })
    });

    // Resetear el formulario y volver al dashboard
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
    // Segmented controls
    document.querySelectorAll('.segmented').forEach(function (seg) {
      seg.querySelectorAll('button').forEach(function (b) {
        var key = seg.id.replace('seg-', '');
        var map = { tema: 'tema', anim: 'animacion', revelar: 'revelar', idioma: 'idioma' };
        b.classList.toggle('active', s[map[key]] === b.dataset.value);
      });
    });
    // Aplicar idioma y traducciones estáticas
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
    if (!Auth.hasSession()) return; // se procesará tras el login
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
    // Limpiar ?share= de la URL
    var params = new URLSearchParams(location.search);
    params.delete('share');
    history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : ''));
    UI.renderDashboard();
    toast(t('imported') + ': ' + deck.nombre);
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
  maybeAskName();

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

// ------------------------------------------------------------------
// Instalación PWA (beforeinstallprompt) y botón "Copiar prompt"
// ------------------------------------------------------------------
var installPromptEvent = null;
var installDismissed = false;

/** ¿La app se está ejecutando ya instalada (standalone)? */
function isStandalone() {
  return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ||
         navigator.standalone === true;
}

function initInstall() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPromptEvent = e;
    UI.showInstallBanner();
  });
  window.addEventListener('appinstalled', function () {
    installPromptEvent = null;
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
    installDismissed = true;
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

/** Boot de la aplicación. */
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
  // Auth: restaura sesión MC guardada o prepara el login con Google.
  Auth.init();

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

  // --- Drag & drop para ordenar mazos (pointer events, táctil) ---
  UI.initDrag();

  // Elegir pantalla inicial
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

// ------------------------------------------------------------------
// Errores globales: nunca pantallas en blanco silenciosas.
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
