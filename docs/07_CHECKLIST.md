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

## 7.6 PWA

- [ ] Instalable (icono en la barra del navegador, `display: standalone`).
- [ ] Después del primer arranque online, abrir sin red carga el app shell + FA.
- [ ] Nueva versión: se instala y recarga automáticamente solo si la cola está vacía.

## 7.7 Backend (desde el navegador)

- [ ] `GET ?email&token` devuelve mazos+tarjetas; token inválido → `AUTH_FAILED`.
- [ ] `GET ?share_id` devuelve el mazo público sin auth.
- [ ] `POST` con `text/plain` procesa ops y responde `results`.
- [ ] Las hojas `Mazos`/`Tarjetas` se crean solas en el primer uso.
