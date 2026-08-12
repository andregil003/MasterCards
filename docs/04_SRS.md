# 04 — Algoritmo SRS (SM-2) y Manejo de Fechas

> Prioridad 4. Toda la lógica de estudio.

## 4.1 Mapeo de botones a calidad (q)

| Botón | q | Efecto |
|-------|---|--------|
| Otra vez | 1 | Falla. Reinicia intervalo a 1 día. |
| Difícil | 3 | Acierto pero dudoso. |
| Bien | 4 | Acierto normal. |
| Fácil | 5 | Acierto fácil. |

## 4.2 Fórmulas SM-2

Estado por tarjeta: `facilidad` (EF) y `intervalo` (días).

```
EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
EF' = max(EF', 1.3)

Si q < 3  (fallo):
  intervalo = 1

Si q >= 3  (acierto):
  si intervalo == 0  ->  intervalo = 1     (primera revisión)
  si intervalo == 1  ->  intervalo = 6     (segunda revisión)
  si no              ->  intervalo = round(intervalo * EF')
```

`proximaRevision = hoy + intervalo días` (epoch ms).

> **Nota**: se usa EF actualizado (`EF'`) para calcular el intervalo. La primera
> revisión es siempre 1 día, la segunda 6 días (convención SM-2).

## 4.3 Estados de una tarjeta

- **Nueva**: `proximaRevision === 0` y `intervalo === 0`.
- **Vencida**: `proximaRevision > 0 && proximaRevision <= now`.
- **Futura**: `proximaRevision > now`.

## 4.4 Modos de estudio

### Estudiar Hoy
- Pool = nuevas (respetando **límite diario configurable**, default 20) + vencidas.
- Se incluye primero lo vencido y luego nuevas.
- Límite diario: contador `mc_meta.nuevasHoy = {fecha:'YYYY-MM-DD', count}`; si la
  fecha cambió, se reinicia. El contador suma cada nueva estudiada en sesión
  "Estudiar Hoy".

### Estudio Libre
- Pool = todas las tarjetas del mazo (o de todos si es global), en orden.
- **No** actualiza SRS (no encola `updateSRS`).

### Estudiar por mazo
- Mismo comportamiento que Estudiar Hoy pero acotado al `mazoId` indicado.

## 4.5 Manejo de fechas

- **Siempre epoch ms** (`Date.now()`), números, en hojas y localStorage.
- El único string de fecha es la clave del contador diario (`YYYY-MM-DD` local).
- "Hoy" se calcula comparando epoch con el inicio del día local
  (`new Date(); setHours(0,0,0,0)`), para evitar saltos por zona horaria.

## 4.6 Flujo de una respuesta

1. El usuario toca un botón SRS → se aplica animación (acierto/error).
2. Si es modo **Estudiar Hoy**: calcular nuevo EF/intervalo/proximaRevision y
   encolar `updateSRS` con `updatedAt = Date.now()`.
3. Si es **Estudio Libre**: no tocar SRS.
4. Si falló y config `revelar === 'fallar'`: mostrar respuesta + explicación.
   Si `revelar === 'final'`: guardar la fallada en el buffer del resumen.
5. Avanzar a la siguiente tarjeta (mantener la fallada en rotación si "Otra vez"
   y config lo permite: se reinserta al final de la cola de la sesión).

## 4.7 Resumen final

Al terminar la sesión: tarjetas vistas, aciertos (q>=3), % acierto, tiempo.
Filtros: **Todas / Correctas / Falladas** (por defecto Falladas). Cada entrada:
pregunta → respuesta correcta → explicación. Botón "Repasar falladas" (nueva
sesión con solo falladas, ignorando SRS).
