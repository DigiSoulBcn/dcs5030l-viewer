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

- 📺 **Vídeo en directo** (MJPEG) en Chrome, Edge, Firefox…
- 🔊 **Sonido** del micrófono de la cámara, con interruptor y volumen.
- 🕹️ **Movimiento** (pan/tilt) con botones o con las flechas del teclado.
- 📍 **Posiciones guardadas**: guardar, ir y borrar, almacenadas en la propia cámara.
- 🔐 Gestiona por ti la autenticación de la cámara (Basic y Digest).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior.
- La cámara en tu red local y su usuario **admin** (los usuarios normales solo pueden ver, no mover).

## Uso

1. Descarga o clona este repositorio.
2. Haz doble clic en **`iniciar-visor.bat`** (o ejecuta `node servidor-camara.js --open`).
3. La primera vez te pide la IP:puerto de la cámara, el usuario y la contraseña, y comprueba que son correctos.
4. Se abre el navegador en `http://localhost:8099`.

Para cambiar los datos de acceso: `node servidor-camara.js --config`.

> ⚠️ Las credenciales se guardan **sin cifrar** en `camara.json`, junto al programa. El servidor solo
> escucha en `localhost`, no es accesible desde la red. `camara.json` está excluido de Git.

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

## Ideas para el futuro

- Ejecutable único (sin necesidad de instalar Node).
- Credenciales cifradas.
- Panel de configuración completo: fecha y hora (con horario de verano), imagen, detección de movimiento,
  modo día/noche, tarjeta SD…

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

A modern browser-based viewer for the **D-Link DCS-5030L** pan/tilt IP camera that no longer needs
Internet Explorer, ActiveX or Java. A small local Node.js server handles the camera's authentication
(Basic + Digest) and proxies its video (MJPEG), audio (PCM), pan/tilt and preset controls to a web page
that works in any modern browser.

Run `iniciar-visor.bat` (or `node servidor-camara.js --open`), enter the camera address and admin
credentials, and open `http://localhost:8099`. Tested on DCS-5030L hw A, firmware 1.06; other NIPCA-based
D-Link cameras (DCS-5020L, DCS-93xL) will probably work. The camera's HTTP API and its many quirks
(including the year picker that ends in 2020) are documented in [api-dcs5030l.md](api-dcs5030l.md).
MIT licensed. Not affiliated with D-Link.
