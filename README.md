# DCS-5030L Viewer

**Visor y panel de control moderno para la cámara IP D-Link DCS-5030L, sin Internet Explorer, sin ActiveX y sin Java.**

*English summary below.*

La DCS-5030L es una cámara IP motorizada que sigue funcionando perfectamente, pero su web necesita
Internet Explorer con un plugin ActiveX (`H264PlugLiteDL.ocx`) o un applet de Java con el certificado
caducado. La app mydlink tampoco sirve: solo admite cámaras nuevas que se añaden escaneando un código QR.
Resultado: una cámara en perfecto estado que ya casi no se puede usar.

Este proyecto la recupera con un pequeño servidor local y una página web que funcionan en cualquier navegador.

> En Windows 11, el modo Internet Explorer de Edge con el plugin de esta cámara puede provocar además una
> fuga de memoria en el kernel (millones de objetos de archivo que nunca se liberan). Fue lo que dio origen
> a este proyecto.

## Funciones

- 📺 **Vídeo en directo** (MJPEG) en Chrome, Edge, Firefox…, con zoom digital, pantalla completa y reconexión automática.
- 🎯 **Clic para apuntar**: pulsa en cualquier punto del vídeo y la cámara se centra en él. El campo de visión se
  calibra solo, analizando la imagen (≈ 95° × 50° en la DCS-5030L).
- 🧭 **Mapa panorámico**: la cámara recorre todo su giro haciendo fotos y compone una panorámica de su entorno.
  Ves en ella hacia dónde mira la cámara y tus posiciones guardadas, y con un clic la apuntas a cualquier sitio.
- 📏 **Detección de obstáculos**: mide hasta dónde puede girar la cámara sin chocar con paredes o marcos y no
  sale nunca de ese rango, para que no pierda la posición.
- 🕹️ **Movimiento** con botones o con las flechas del teclado (en la dirección correcta aunque la cámara esté
  colgada boca abajo).
- 📍 **Posiciones guardadas** en la propia cámara (teclas <kbd>1</kbd>–<kbd>9</kbd> para ir a ellas).
- 🔊 **Sonido** del micrófono de la cámara, con volumen.
- 📷 **Instantáneas** en JPEG con un clic (o la tecla <kbd>S</kbd>).
- ⚙️ **Panel de ajustes** sin Internet Explorer: imagen (brillo, contraste, saturación, voltear/reflejar), calidad
  del vídeo, modo día/noche, LED, hora sobreimpresa, modo privacidad, **fecha y hora con horario de verano**
  (sorteando el fallo del año 2020), detección de movimiento y de sonido, micrófono y reinicio. Cada cambio se
  comprueba releyendo la cámara, porque su web responde "OK" aunque no guarde.
- 🔐 Credenciales **cifradas** con la protección de datos de Windows (DPAPI).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.
- La cámara en tu red local y su usuario **admin** (los usuarios normales solo pueden ver, no mover).

## Uso

1. Descarga o clona este repositorio.
2. Haz doble clic en **`iniciar-visor.bat`** (o ejecuta `node servidor-camara.js --open`).
3. La primera vez te pide la IP:puerto de la cámara, el usuario y la contraseña, y comprueba que son correctos.
4. Se abre el navegador en `http://localhost:8099`.

Para cambiar los datos de acceso: `node servidor-camara.js --config`. Otras opciones: `--port N` (puerto local,
por defecto 8099) y `--open` (abre el navegador).

> 🔐 La contraseña se guarda en `camara.json` **cifrada con DPAPI**: solo tu usuario de Windows, en este equipo,
> puede descifrarla. En otros sistemas operativos se guarda sin cifrar. El servidor solo escucha en `localhost`
> y rechaza peticiones de otras webs. La calibración y la panorámica se guardan en la carpeta `datos/`.

### Consejos

- **Primera vez:** pulsa *Escanear panorámica* en la pestaña Control. El visor calibra el campo de visión,
  **mide hasta dónde puede girar la cámara sin chocar** y recorre su giro haciendo fotos (unos minutos en total).
  Después ya puedes apuntar con un clic en el mapa.
- **Obstáculos:** si la cámara está junto a una pared o un marco, al girar puede chocar con ellos. El motor se
  atasca, pierde pasos y la cámara deja de saber dónde está (las posiciones guardadas apuntan a otro sitio).
  El botón *Límites* lo evita: gira poco a poco hacia cada lado comprobando con la imagen que se mueve de
  verdad, y a partir de ahí el visor nunca sale de ese rango (tampoco con las flechas ni con las posiciones).
- Si aun así la cámara se descoloca, **reiníciala** (Ajustes → Reiniciar): al arrancar recorre su giro y se
  recalibra. El visor detecta el descoloque al terminar el escaneo y te lo ofrece.
- Si cambias la orientación (voltear/reflejar) o la resolución, el visor te pedirá calibrar y escanear de nuevo.

## Compatibilidad

| Modelo | Firmware | Estado |
|---|---|---|
| DCS-5030L (hardware A) | 1.06 build 2 | ✅ Probado |
| DCS-5020L, DCS-930L, DCS-932L, DCS-933L… | — | ❓ Probablemente compatibles (misma interfaz NIPCA), sin probar |

Si lo pruebas con otro modelo, abre un *issue* contando qué funciona y qué no.

## Cómo funciona

`servidor-camara.js` sirve el visor y reenvía las peticiones `/cam/*` a la cámara añadiendo las credenciales.
El navegador nunca habla directamente con la cámara: así se evitan los problemas de autenticación y CORS.

El servidor web de la cámara (`alphapd`) tiene bastantes particularidades: dos tipos de autenticación,
Referer obligatorio, detección de Internet Explorer, `SessionKey` por formulario, respuestas 200 que no
guardan nada… Todo está documentado en **[api-dcs5030l.md](api-dcs5030l.md)**, junto con los CGI y los
formularios de configuración.

### Archivos

| Archivo | Qué es |
|---|---|
| `iniciar-visor.bat` | Lanzador para Windows |
| `servidor-camara.js` | Servidor local (Node.js, sin dependencias): autenticación, proxy, API de ajustes |
| `visor-camara.html` | El visor (una sola página, sin dependencias) |
| `api-dcs5030l.md` | Documentación de la API HTTP de la cámara y sus particularidades |
| `camara.json`, `datos/` | Se crean al usarlo: credenciales y calibración/panorámica de *tu* cámara (no se suben a Git) |

### Desarrollo

`node servidor-camara.js --port 8097 --upstream http://127.0.0.1:8099/cam` arranca una segunda instancia que
reenvía a otro servidor del visor ya autenticado, en lugar de a la cámara: sirve para probar cambios sin
conocer ni volver a introducir la contraseña. Los ajustes que el visor puede tocar están en una lista blanca
(`FORMS` en `servidor-camara.js`); los formularios de contraseñas, Wi-Fi y firmware quedan fuera a propósito.

## Hoja de ruta

- **Ajustes de red** (próximo paso): IP fija o DHCP, Wi-Fi (búsqueda de redes, clave), puertos, UPnP, DNS dinámico.
  Con ellos el visor bastaría para poner en marcha una cámara **recién reseteada** sin Internet Explorer.
- Ejecutable único (sin necesidad de instalar Node).
- Grabación y detección de movimiento en el propio ordenador.
- Varias cámaras en el mismo visor.
- Resto de ajustes que aún requieren la web de la cámara: correo, FTP, tarjeta SD, usuarios.

Historial de cambios en [CHANGELOG.md](CHANGELOG.md).

## Créditos

- Hecho con la ayuda de [Claude Code](https://claude.com/claude-code).
- Gracias a **D-Link** por fabricar una cámara que sigue funcionando más de diez años después. Y gracias
  también por su innovador sistema de *obsolescencia programada* en el desplegable de año de la
  configuración de fecha y hora:

  ```js
  for (i=2011 ; i <= 2020; i++)
  ```

  Según el firmware, el mundo terminaba en 2020. Desde 2021 la página genera una fecha vacía, la propia
  cámara la rechaza y ya no se puede guardar la hora ni el horario de verano. Este proyecto le da unos
  años más de vida (ver [api-dcs5030l.md](api-dcs5030l.md), "Fallo del año").

## Aviso legal

Proyecto independiente, sin relación con D-Link Corporation ni avalado por ella. "D-Link" y "DCS-5030L"
son marcas de sus respectivos propietarios y se usan solo para identificar el hardware compatible.
Úsalo bajo tu propia responsabilidad.

## Licencia

[MIT](LICENSE): libre y gratuito. Puedes usarlo, modificarlo y redistribuirlo, también en otros proyectos,
siempre que mantengas el aviso de copyright.

---

## English summary

A modern browser-based viewer and control panel for the **D-Link DCS-5030L** pan/tilt IP camera that no
longer needs Internet Explorer, ActiveX or Java. A small local Node.js server (no dependencies) handles the
camera's authentication (Basic + Digest) and proxies its video (MJPEG), audio (PCM), pan/tilt and presets to a
web page that works in any modern browser. Features: click-to-aim (field of view auto-calibrated from the
image), a panoramic map of the surroundings, detection of physical obstacles so the motors never lose their
position, a settings panel (image, video, day/night, LED, privacy, date & time with DST working around the
firmware's year-2020 bug, motion/sound detection, microphone, reboot), snapshots and DPAPI-encrypted credentials.

Run `iniciar-visor.bat` (or `node servidor-camara.js --open`), enter the camera address and admin
credentials, and open `http://localhost:8099`. Tested on DCS-5030L hw A, firmware 1.06; other NIPCA-based
D-Link cameras (DCS-5020L, DCS-93xL) will probably work. The camera's HTTP API and its many quirks
(including the year picker that ends in 2020) are documented in [api-dcs5030l.md](api-dcs5030l.md).
MIT licensed. Not affiliated with D-Link.
