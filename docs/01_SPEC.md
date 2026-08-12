# 01 — Especificación Funcional (SPEC)

> Prioridad 1. Si contradice a otro doc, este manda.
> Última actualización: ver "Log de decisiones" al final.

## 1.1 Visión

PWA de flashcards estilo Anki, Mobile-First, **Offline-First**: el usuario puede
crear mazos, estudiar, editar y borrar tarjetas sin conexión; todo se sincroniza
con Google Sheets cuando hay red. Compartición de mazos por enlace (`?share=`).

## 1.2 Pantallas

### Login
- Botón de **Google Identity Services** (flujo `redirect`, no popup).
- Guarda `email` en localStorage; mantiene el ID token en memoria y lo refresca
  antes de sincronizar.
- Si ya hay sesión y datos, va directo al Dashboard.

### Dashboard
- **Búsqueda** por nombre de mazo + **filtros acumulables** (chips):
  Vencidas / Nuevas / Favoritas. Combinables entre sí y con la búsqueda.
- Orden de mazos: **manual con drag** (grip handle, pointer events) ↔ toggle
  **alfabético**.
- Cada mazo muestra: ícono FA + color de acento, nombre, contadores (vencidas /
  nuevas / total), botón **Estudiar** y botón **Compartir** (copia
  `?share=<Mazo_ID>` al portapapeles).
- **FAB** `fa-plus` → Crear Mazo. Botón **"Estudiar Hoy"** global.
- Header con indicador de sync (nube): `al día` / `sin conexión, N pendientes` /
  `sincronizando` + acceso a **Ajustes** (⚙️).

### Crear Mazo (bottom sheet)
- Nombre, **ícono** (galería curada ~30 íconos FA), **color de acento**.
- Crear contenido:
  - **Pegar JSON de IA**: `[{"q":"...","a":"...","e":"opcional","i":"opcional"}]`.
  - **Tarjeta individual**: pregunta + respuesta + explicación + ícono opcional.
- Al guardar se crea el mazo (op `createDeck`) y las tarjetas (op `createCards`)
  en local y en la cola de sync.

### Estudio
- **Tarjeta giratoria 3D** (`rotateY`) con pregunta (frente) y respuesta +
  explicación "¿Por qué?" (dorso).
- Botones ✏️ editar (convierte en textarea) y 🗑️ borrar, en la propia tarjeta.
- **4 botones SRS**: Otra vez / Difícil / Bien / Fácil (ver `04_SRS.md`).
- **Estudio Libre**: ignora el SRS (no actualiza fechas).
- Modos: **Estudiar Hoy** (global o por mazo), incluye nuevas (con límite diario
  configurable) + vencidas.
- Animaciones: acierto (pop + confeti verde), error (shake + glow rojo).
- Config "Revelar solución": **Al fallar** (muestra al instante respuesta +
  explicación) o **Al final** (se acumulan las falladas y al terminar se muestra
  un resumen con filtros Todas / Correctas / Falladas por defecto).
- Al terminar la sesión: resumen (vistas, % acierto, tiempo, filtros) y opción de
  repasar falladas.

### Ajustes (⚙️)
- **Tema**: Auto (nativo) / Claro / Oscuro.
- **Animaciones**: Sutil / Híbrido / Vistoso (+ respeto a `prefers-reduced-motion`).
- **Revelar solución**: Al fallar / Al final.
- **Límite diario de nuevas**: slider 5–100 (default 20).
- **Exportar datos** (descarga JSON completo) · **Borrar datos locales** ·
  **Cerrar sesión** (mantiene datos; si entras con otro email, avisa y ofrece limpiar).

## 1.3 Compartición (`?share=`)

- Al cargar la app con `?share=<Mazo_ID>` y sesión activa: fetch del mazo público
  (`doGet` con `share_id`) y prompt **"Importar este mazo a tu cuenta"**.
- Importar = **copia simple**: deck y tarjetas con IDs NUEVOS y SRS reiniciado.
- Re-importar el mismo mazo duplica (comportamiento aceptado).

## 1.4 Fuera de alcance (v1)

- Sin multiusuario colaborativo sobre el mismo mazo (solo importar copias).
- Sin sincronización de favoritos al backend (los favoritos son locales).
- Sin sonido / TTS.
- Sin dedup de importaciones.

## Log de decisiones

- 2026-08-12: Nombre "MasterCards"; repo público `andregil003/MasterCards`.
- 2026-08-12: Backend en dos hojas (Mazos + Tarjetas) en lugar de una
  denormalizada, para soportar ícono/color/orden del mazo y deleteDeck limpio.
- 2026-08-12: Auth vía ID token verificado en backend (tokeninfo + check `aud`).
- 2026-08-12: Iconos FA por mazo Y por tarjeta (auto-hospedados).
- 2026-08-12: Animaciones híbridas con ajuste de intensidad.
- 2026-08-12: Columna `Explicacion` en Tarjetas + config "Revelar solución".
