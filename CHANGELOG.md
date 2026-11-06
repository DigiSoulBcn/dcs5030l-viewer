# Historial de cambios

## 2.0.0 — 6 de noviembre de 2026

### Novedades
- **Clic para apuntar** en el vídeo, con el campo de visión calibrado automáticamente comparando imágenes
  (≈ 95° × 50° en la DCS-5030L). La calibración se acepta solo si dos medidas distintas coinciden.
- **Mapa panorámico**: escaneo del entorno y minimapa con el campo de visión en vivo, las posiciones guardadas
  y las zonas inalcanzables; clic en el mapa para apuntar.
- **Detección de obstáculos** (*Límites*): mide el rango de giro real de la instalación y el visor no sale de él
  (mapa, clic, flechas). Si la cámara se descoloca, lo detecta y ofrece reiniciarla para recalibrarla.
- **Panel de ajustes**: imagen, calidad del vídeo, día/noche, LED, hora sobreimpresa, modo privacidad, fecha y
  hora (NTP, zona horaria, horario de verano UE/EE. UU.), detección de movimiento y de sonido, micrófono, reinicio.
  Cada cambio se confirma releyendo la cámara.
- Instantáneas JPEG, zoom digital, pantalla completa, atajos de teclado, modo claro y oscuro, hora de la cámara
  en la cabecera (avisa si va desfasada), pestaña de información del dispositivo.
- Las flechas mueven la vista en la dirección correcta aunque la cámara esté boca abajo.

### Servidor
- API JSON `/api/form/<ajuste>` para leer y guardar formularios de la cámara, con lista blanca, sin exponer
  contraseñas ni `SessionKey`, y protección frente a peticiones de otras webs.
- Contraseña cifrada con **DPAPI** en Windows (se migra automáticamente desde la versión 1).
- Conexiones a la cámara sin keep-alive y como mucho 2 peticiones cortas a la vez (la cámara rechaza
  conexiones si se satura); reintentos en el visor.
- `/api/info` con la hora real de la cámara; almacenamiento de calibración y panorámica en `datos/`.
- Opciones `--port` y `--upstream` (desarrollo).

### Correcciones
- Interruptores de voltear y reflejar intercambiados (el bit 1 refleja, el bit 2 voltea).

## 1.0.0 — 6 de noviembre de 2026

- Primera versión: vídeo MJPEG, sonido, movimiento pan/tilt, posiciones guardadas y servidor local que resuelve
  la autenticación Basic/Digest, el Referer obligatorio y el 403 de los formularios de la cámara.
- Documentación de la API de la cámara y de sus particularidades (incluido el fallo del año 2020).
