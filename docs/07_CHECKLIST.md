# 07 — Checklist de Verificación

> Toda IA que entregue cambios debe correr esto antes de decir "listo".
> Manual: abrir la app en el navegador (servidor estático local o Pages).

## 7.1 Offline-First

- [ ] Con conexión: al abrir, hace flush → pull → merge (ver en DevTools Network).
- [ ] Apagar red (DevTools → Offline): la app sigue funcionando (login ya hecho).
- [ ] Crear un mazo + tarjetas offline → aparecen en el dashboard y se pueden estudiar.
- [ ] Calificar tarjetas offline → se marcan y `mc_syncQueue` crece.
- [ ] Volver a conectar → `online` dispara flush → `mc_syncQueue` queda vacía.
- [ ] El indicador de nube refleja: al día / N pendientes / sincronizando.
- [ ] Reintento con backoff si el servidor falla (1s→5s→30s).
- [ ] Recargar con cola no vacía NO pierde las ops pendientes.

## 7.2 Sync

- [ ] Dos dispositivos (o dos pestañas): editar tarjeta en A, ver cambio en B tras sync.
- [ ] Borrar tarjeta en A → desaparece en B (borrado remoto gana).
- [ ] Reenviar la misma op no duplica filas en Sheets (idempotencia).
- [ ] Pull incluye borradas y el cliente las limpia (convergencia).

## 7.3 SRS / Estudio

- [ ] Primera revisión: intervalo=1, segunda=6, luego round(EF*intervalo).
- [ ] "Otra vez" resetea a 1 día y EF baja (mín 1.3).
- [ ] Límite diario de nuevas: estudiar >N nuevas no sobrepasa el límite; el
      contador se reinicia al cambiar de día.
- [ ] "Estudio Libre" no modifica intervalos/fechas.
- [ ] "Estudiar Hoy" global y por mazo funcionan.
- [ ] Flip 3D gira bien en móvil y escritorio.

## 7.4 Animaciones

- [ ] Acierto: pop + confeti verde; error: shake + glow rojo.
- [ ] Sutil / Híbrido / Vistoso cambian la intensidad.
- [ ] `prefers-reduced-motion: reduce` desactiva keyframes.
- [ ] Los botones SRS se bloquean durante la animación.

## 7.5 UI / Funcionalidades

- [ ] Login GIS funciona (redirect, vuelve a la app) y guarda email.
- [ ] Dashboard: búsqueda + filtros combinables; orden drag ↔ alfabético.
- [ ] Crear mazo por JSON y por tarjeta individual (con explicación).
- [ ] Compartir copia `?share=<Mazo_ID>`; abrir ese enlace en otra sesión ofrece
      "Importar este mazo".
- [ ] Editar/borrar tarjeta desde el estudio (✏️→textarea, 🗑️).
- [ ] Resumen final: filtros Todas/Correctas/Falladas + "Repasar falladas".
- [ ] Ajustes: tema (auto/claro/oscuro), animaciones, revelar solución, límite,
      exportar JSON, borrar datos, cerrar sesión.
- [ ] Selector de idioma (ES/EN): cambia toda la UI al instante y persiste.
- [ ] "Copiar prompt" en creación de mazo: genera el prompt para que una IA
      devuelva el JSON y al pegarlo se rellena el textarea.
- [ ] Barra inferior (Inicio/Ajustes) en móvil; botón de ajustes en header en
      escritorio; back funciona.

## 7.6 PWA

- [ ] Instalable (icono en la barra del navegador, `display: standalone`).
- [ ] Banner "Instalar" aparece con `beforeinstallprompt` (descartable) y el botón
      "Instalar" de Ajustes llama al prompt; con la app ya instalada no se muestra.
- [ ] Después del primer arranque online, abrir sin red carga el app shell + FA.
- [ ] Nueva versión: se instala y recarga automáticamente solo si la cola está vacía.

## 7.7 Backend (desde el navegador)

- [ ] `GET ?email&token` devuelve mazos+tarjetas; token inválido → `AUTH_FAILED`.
- [ ] `GET ?share_id` devuelve el mazo público sin auth.
- [ ] `POST` con `text/plain` procesa ops y responde `results`.
- [ ] Las hojas `Mazos`/`Tarjetas` se crean solas en el primer uso.

## 7.8 Tests automáticos

> La sección 7.8 se comprueba sin navegador. El resto es manual.

- [ ] `node scripts/test.js` → termina con `FAIL=0` (SM-2, markdown, fechas,
      i18n, paridad de claves y cobertura `data-i18n` del HTML; política de
      contraseña, username, TOTP RFC 6238 y PBKDF2).
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1` →
      `Smoke test OK` (contrato JSON del backend desplegado, incluye caminos
      negativos de auth).

## 7.9 Cuentas MasterCards (usuario + contraseña)

- [ ] Login con Google sigue funcionando (sin cuentas MC el flujo es idéntico).
- [ ] Crear cuenta con contraseña fuerte → muestra los 10 códigos de respaldo
      (copiar y descargar) → requiere confirmar antes de continuar → se entra
      con sesión MC y se puede sincronizar.
- [ ] El medidor de fortaleza marca los requisitos y rechaza contraseñas débiles.
- [ ] Username duplicado → `Ese usuario ya existe`.
- [ ] Login con usuario/contraseña correctos → dashboard.
- [ ] Login con contraseña errónea → `Usuario o contraseña incorrectos`;
      5 fallos → cuenta bloqueada 15 min (`Demasiados intentos. Espera 15 min`).
- [ ] TOTP opcional tras el registro: escanear QR (o secreto manual), verificar
      con un código de Google Authenticator → activado. Siguiente login pide el
      código de 6 dígitos.
- [ ] Recuperar cuenta con un backup code → pide contraseña nueva → entra y el
      código usado queda invalidado.
- [ ] Recuperar con TOTP (si está activo) funciona.
- [ ] Ajustes → Seguridad (solo cuentas MC): cambiar contraseña rota el token
      (la app sigue funcionando sin re-login); regenerar códigos invalida los
      anteriores; desactivar TOTP.
- [ ] Cerrar sesión MC → vuelve al login y los datos locales se conservan.
- [ ] Compartir/importar mazo funcionan con una sesión MC.
- [ ] `adminResetPassword('usuario', 'Nueva#Pass1')` en el editor de Apps Script
      restablece una cuenta olvidada.
