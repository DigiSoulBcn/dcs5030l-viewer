# API de la D-Link DCS-5030L (firmware 1.06)

Referencia obtenida de una cámara real (hardware A, firmware 1.06 build 2, servidor web `alphapd/2.1.8`)
el 6/11/2026. Todo lo de este documento está comprobado contra esa cámara salvo donde se indica.

## Particularidades del servidor web (lo importante)

| Comportamiento | Detalle | Cómo resolverlo |
|---|---|---|
| Dos tipos de autenticación | CGI estándar (vídeo, audio, PTZ, `/config/*.cgi`) usan **Basic** realm `NIPCA`. La web de configuración (`/`, `*.htm`, formularios `/set*`) usa **Digest** realm `DCS-5030L_C5`, MD5, `qop=auth`. | Probar Basic; si 401 con `Digest` → reintentar con Digest. |
| 403 al ver Basic | Los formularios `POST /set*` responden **403** si llevan cabecera Basic, en vez de pedir Digest. | Ante 403, pedir sin credenciales para obtener el desafío Digest y reintentar. |
| Referer obligatorio | Las páginas `*.htm` responden **403** sin un `Referer` de la propia cámara. Los formularios exigen además que el Referer sea **la página del formulario** (p. ej. `/time.htm` para `/setSystemDate`). | Enviar `Referer: http://<cámara>/<página>.htm`. |
| Detección de navegador | Con User-Agent de navegador moderno (Chrome/Edge) devuelve un aviso "utilice Internet Explorer" en vez de la página. Sin User-Agent sirve la página normal. | No enviar User-Agent, o enviar uno de IE 11. |
| `SessionKey` | Los formularios llevan un campo oculto `SessionKey` (128 hex) generado en cada carga de la página. | Cargar la página del formulario justo antes y reenviar su `SessionKey`. |
| Respuesta de los formularios | Siempre **200**. El éxito o error va en el HTML (bloque "RESPONDER AL MENSAJE"). Un envío puede dar 200 y no guardar nada. | Releer la página tras guardar y comparar valores. |
| Fallo del año | El desplegable de año de `time.htm` solo va de 2011 a 2020; con año ≥ 2021 la página envía `Date` vacío y la cámara lo rechaza ("formato de fecha aaaa-mm-dd"). | En modo NTP la fecha no se usa: enviar una fecha de 2020. |
| Rutas inexistentes | Responden **403**, no 404. | Un 403 no implica falta de permisos. |
| Permisos | Las cuentas de usuario normales pueden ver vídeo/audio; mover la cámara y `/config/*` requieren **admin**. | — |
| Cabecera `Date` | La de la web de configuración es fija (2019), la de los CGI es la hora real de la cámara. | Leer la hora de los campos ocultos `f_year`, `f_month`… (con `name=`) de `stsdev.htm`. |
| Pocas conexiones | La cámara rechaza conexiones si recibe varias a la vez (además de los streams de vídeo/audio). | Sin keep-alive, peticiones cortas en cola (máx. 2 simultáneas) y reintentos. |
| Posición sin sensores | Los motores son paso a paso sin realimentación: `ptz_pos.cgi` devuelve la posición que el firmware *cree*. Recorridos largos hasta los topes pueden hacer perder pasos y desplazar todo el sistema de coordenadas (y las posiciones guardadas). | Evitar los extremos del recorrido. Al **reiniciar**, la cámara recorre su giro, se recalibra y vuelve a la posición de inicio (`customizedhome`). |
| Fin de movimiento | No hay forma de saber cuándo termina un movimiento (la posición se actualiza al instante). | Comparar instantáneas sucesivas hasta que la imagen deje de cambiar. |

### Campo de visión (medido)

Con la cámara a 1280×720: **≈ 95° × 50°** (1 unidad de pan ≈ 1,05 % del ancho de imagen; 1 unidad de tilt ≈ 2 % del alto).
Con la imagen volteada (`Mirror=3`, cámara colgada del techo) el eje vertical se invierte.

### Valores de algunos ajustes

| Campo | Valores |
|---|---|
| `DayNightMode` (`/setDayNightMode`) | 0 = automático (sensor de luz), 1 = manual, 2 = siempre día, 3 = siempre noche, 4 = programado |
| `LightSensorControl` | 1 = baja, 3 = media, 5 = alta |
| `Mirror` (`/setSystemStream`, image.htm) | bit 1 (valor 1) = reflejar (espejo), bit 2 (valor 2) = voltear (boca abajo); comprobado en la cámara |
| `BrightnessControl`, `ContrastControl`, `SaturationControl` | 1, 14, 26, 39, 51, **64** (= 0), 77, 90, 103, 115, 128 → de −5 a +5 |
| `LEDControl` (`/setSystemControl`) | 0 = normal, 1 = apagado |
| `OSDEnable` | 1 = hora sobreimpresa, 0 = no |
| `PrivacyEnable` (`/setSystemPrivacy`) | 1 = modo privacidad (sin vídeo) |
| `VideoResolution` / `VideoResolution264` | 1 = 320×240, 2 = 640×480, 3 = 1280×720 |
| `CompressionRate` (MJPEG) | 0 = muy alta calidad … 4 = muy baja |
| `AudioEnable`, `AudioVolume` | 0/1; 0–100 en pasos de 10 |

## CGI estándar (Basic, realm NIPCA)

| Ruta | Método | Uso | Respuesta |
|---|---|---|---|
| `/video/mjpg.cgi` (también `/video.cgi`, `/mjpeg.cgi`) | GET | Vídeo MJPEG continuo | `multipart/x-mixed-replace` |
| `/image/jpeg.cgi` | GET | Instantánea JPEG | `image/jpeg` |
| `/audio.cgi` | GET | Audio continuo | WAV PCM mono 16 bits 11025 Hz, cabecera RIFF de longitud "infinita", chunked |
| `/h264.mpt` | GET | Vídeo H.264 (no probado) | — |
| `/common/info.cgi` | GET | Modelo, firmware, MAC, IP, capacidades (`ptz=P,T`, `speaker=no`…) | `clave=valor` |
| `/config/stream_info.cgi` | GET | Perfiles de vídeo/audio, resoluciones, bitrates | `clave=valor` |
| `/config/ptz_info.cgi` | GET | Límites: `pmax=336 pmin=0 tmax=106 tmin=0` | `clave=valor` |
| `/config/ptz_pos.cgi` | GET | Posición actual `p=… t=…` | `clave=valor` |
| `/config/ptz_preset_list.cgi` | GET | `presets=Nombre1,Nombre2` y `Nombre=p,t` | `clave=valor` |
| `/config/ptz_preset.cgi?name=X&act=add\|del\|go` | GET | Guardar posición actual / borrar / ir | `clave=valor` |
| `/config/ptz_move.cgi?p=P&t=T` | GET | **Movimiento absoluto** a pan P, tilt T (unidades ≈ grados). Responde al instante con la posición destino, antes de llegar | `clave=valor` |
| `/pantiltcontrol.cgi` | POST | `PanSingleMoveDegree`, `TiltSingleMoveDegree`, `PanTiltSingleMove` (0–8: ↖ ↑ ↗ ← inicio → ↙ ↓ ↘) | — |

## Formularios de la web de configuración (Digest + Referer + SessionKey)

Generado automáticamente a partir de las páginas de la cámara. Solo nombres de campos y opciones, sin
los valores configurados (algunos son claves Wi-Fi o contraseñas). Los "desplegables auxiliares" no se
envían: el JavaScript de la página copia su valor al campo oculto correspondiente antes de enviar.

### Ejemplo comprobado: fecha y hora con horario de verano europeo

`POST /setSystemDate` con `Referer: http://<cámara>/time.htm`:

```
ReplySuccessPage=time.htm  ReplyErrorPage=errrdate.htm  SessionKey=<de time.htm>
DateTimeMode=0 (0 = NTP, 1 = manual)  TimeZoneIndex=34(GMT+01:00)  TimeZoneSelect=34(GMT+01:00)
TimeServerIPAddress=ntp.dlink.com.tw  Date=2020-MM-DD  Time=HH:MM:SS
DSTEnable=1  DSTOffset=5 (+1:00)
DSTStartMonth=2 (marzo, base 0)  DSTStartWeek=4 (5.º = último)  DSTStartDay=0 (domingo)  DSTStartTime=2
DSTEndMonth=9 (octubre)          DSTEndWeek=4                   DSTEndDay=0               DSTEndTime=3
ConfigSystemDate=Save
```

### advanced.htm

**Formulario** `POST /setSystemAdmin`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `AdminID` | hidden |  |
| `UserID1` | hidden |  |
| `UserID2` | hidden |  |
| `UserID3` | hidden |  |
| `UserID4` | hidden |  |
| `UserID5` | hidden |  |
| `UserID6` | hidden |  |
| `UserID7` | hidden |  |
| `UserID8` | hidden |  |
| `AdminPassword` | hidden |  |
| `SessionKey` | hidden |  |
| `ConfigSystemAdmin` | hidden |  |

**Formulario** `POST /setSystemControl`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `CameraName` | text |  |
| `LEDControl` | radio | 0 / 1 |
| `AccessControlEnable` | radio | 0 / 1 |
| `SnapshotURLAuthentication` | radio | 0 / 1 |
| `OSDEnable` | radio | 1 / 0 |
| `ConfigSystemControl` | hidden |  |

**Formulario** `POST /setSystemAddUser`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `UserName` | text |  |
| `UserPassword` | password |  |
| `UserAdd` | hidden |  |

**Formulario** `POST /setSystemDeleteUser`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `HexUserName` | hidden |  |
| `UserDelete` | hidden |  |

**Formulario** `POST /setSystemPrivacy`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `PrivacyEnable` | radio | 0 / 1 |
| `ConfigSystemPrivacy` | hidden |  |

### audio.htm

**Formulario** `POST /setSystemStream`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `AudioEnable` | radio | 1 / 0 |
| `AudioVolume` | hidden |  |
| `ConfigSystemStream` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `VolumeSel`

### ddns.htm

**Formulario** `POST /setSystemNetwork`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `DDNSEnable` | radio | 1 / 0 |
| `DDNSProvider` | text |  |
| `DDNSHostName` | text |  |
| `DDNSUserName` | text |  |
| `DDNSPassword` | password |  |
| `DDNSTimeout` | text |  |
| `ConfigSystemNetwork` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `Provider`

### email.htm

**Formulario** `POST /setSystemEmail`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `EmailScheduleEnable` | hidden |  |
| `EmailScheduleDay` | hidden |  |
| `EmailScheduleEnableVideo` | hidden |  |
| `EmailScheduleDayVideo` | hidden |  |
| `SessionKey` | hidden |  |
| `EmailSMTPServerAddress` | text |  |
| `EmailSMTPPortNumber` | text |  |
| `EmailSenderAddress` | text |  |
| `EmailReceiverAddress` | text |  |
| `EmailUserName` | text |  |
| `EmailPassword` | password |  |
| `EmailTLSAuthentication` | radio | 0 / 1 / 2 |
| `EmailScheduleMode` | radio | 0 / 1 / 2 |
| `EmailScheduleTimeStart` | text |  |
| `EmailScheduleTimeStop` | text |  |
| `EmailMotionMode` | radio | 0 / 1 |
| `EmailMotionFrameInterval` | select | =0.5, =1 |
| `EmailScheduleInterval` | text |  |
| `EmailScheduleModeVideo` | radio | 0 / 1 / 2 |
| `EmailScheduleTimeStartVideo` | text |  |
| `EmailScheduleTimeStopVideo` | text |  |
| `EmailScheduleIntervalVideo` | text |  |
| `EmailScheduleVideoLimitSize` | text |  |
| `EmailScheduleVideoLimitTime` | text |  |
| `ConfigSystemEmail` | hidden |  |

**Formulario** `POST /setTestEmail`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `EmailTest` | hidden |  |

### extwlan.htm

**Formulario** `POST /setSystemWireless`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `WirelessMode` | hidden |  |
| `APWEPEncryption` | hidden |  |
| `APWEPKeyFormat` | hidden |  |
| `APWEPKeyLen` | hidden |  |
| `SessionKey` | hidden |  |
| `APExtendName` | radio | 0 / 1 |
| `APSSID` | text |  |
| `APMaxClient` | select | =1, =2, =3, =4, =5 |
| `APWEPEncryWay` | radio | 0 / 2 / 4 |
| `APAuthenticationType` | radio | 0 / 1 / 2 |
| `APKey1` | password |  |
| `APPreSharedKey` | password |  |
| `ConfigSystemWireless` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `APKeyLenSel`, `APKeyFormatSel`

### file.htm

**Formulario** `POST /setConfigUpload`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `ConfigFile` | file |  |

**Formulario** `POST /setSystemFactoryReset`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |

**Formulario** `POST /setSystemReboot`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |

### image.htm

**Formulario** `POST /setSystemStream`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `BrightnessControl` | hidden |  |
| `ContrastControl` | hidden |  |
| `SaturationControl` | hidden |  |
| `AntiFlickerEnable` | hidden |  |
| `Mirror` | hidden |  |
| `ConfigSystemStream` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `BrightnessControlSel`, `ContrastControlSel`, `SaturationControlSel`

### motion.htm

**Formulario** `POST /setSystemMotion`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `MotionDetectionEnable` | radio | 1 / 0 |
| `MotionDetectionScheduleDay` | hidden |  |
| `MotionDetectionScheduleMode` | radio | 0 / 1 |
| `MotionDetectionScheduleTimeStart` | text |  |
| `MotionDetectionScheduleTimeStop` | text |  |
| `MotionDetectionSensitivity` | text |  |
| `ConfigSystemMotion` | hidden |  |

### network.htm

**Formulario** `POST /setSystemNetwork`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SecondHTTPPortEnable` | hidden |  |
| `HTTPAuthentication` | hidden |  |
| `SessionKey` | hidden |  |
| `IPAddressMode` | radio | 4 / 1 / 5 |
| `IPAddress` | text |  |
| `SubnetMask` | text |  |
| `DefaultGateway` | text |  |
| `PPPoEUserID` | text |  |
| `PPPoEPassword` | password |  |
| `DNSIPAddress1` | text |  |
| `DNSIPAddress2` | text |  |
| `SecondHTTPPort` | text |  |
| `UPnPEnable` | radio | 1 / 0 |
| `UPnPPortForwarding` | radio | 1 / 0 |
| `BonjourEnable` | radio | 1 / 0 |
| `BonjourName` | text |  |
| `ConfigSystemNetwork` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `HTTPAuthenticationSel`

### night.htm

**Formulario** `POST /setDayNightMode`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `LightSensorControl` | hidden |  |
| `DayNightMode` | radio | 0 / 1 / 2 / 3 / 4 |
| `IRLedScheduleMonStart` | text |  |
| `IRLedScheduleMonEnd` | text |  |
| `IRLedScheduleTueStart` | text |  |
| `IRLedScheduleTueEnd` | text |  |
| `IRLedScheduleWedStart` | text |  |
| `IRLedScheduleWedEnd` | text |  |
| `IRLedScheduleThuStart` | text |  |
| `IRLedScheduleThuEnd` | text |  |
| `IRLedScheduleFriStart` | text |  |
| `IRLedScheduleFriEnd` | text |  |
| `IRLedScheduleSatStart` | text |  |
| `IRLedScheduleSatEnd` | text |  |
| `IRLedScheduleSunStart` | text |  |
| `IRLedScheduleSunEnd` | text |  |
| `ConfigDayNightMode` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `LightSensorSel`

### ptzsetup.htm

**Formulario** `POST /setSystemPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `SpaceValue` | hidden |  |
| `Pan` | hidden |  |
| `Tilt` | hidden |  |
| `PresetList` | select | =1 (nombre de la posición 1), =2, =3, =4, =5, =6, =7, =8, =9, =10, =11, =12, =13, =14, … (24) |
| `PresetName` | text |  |

**Formulario** `POST /setControlPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `PanSingleMoveDegree` | hidden |  |
| `TiltSingleMoveDegree` | hidden |  |
| `PanTiltSingleMove` | hidden |  |

**Formulario** `POST /setControlPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `ClearPosition` | hidden |  |

**Formulario** `POST /setControlPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `SetCurrentPosition` | hidden |  |
| `SetName` | hidden |  |

**Formulario** `POST /setControlPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `SetHomePosition` | hidden |  |

**Formulario** `POST /setControlPanTilt`

| Campo | Tipo | Opciones |
|---|---|---|
| `ResetHomePosition` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `PanDegree`, `TiltDegree`

### sdcard.htm

**Formulario** `POST /setSystemSDCard`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `SDCardScheduleEnable` | hidden |  |
| `SDCardScheduleDay` | hidden |  |
| `SDCardScheduleEnableVideo` | hidden |  |
| `SDCardScheduleDayVideo` | hidden |  |
| `SDCardFullAction` | hidden |  |
| `SDCardFullActionVideo` | hidden |  |
| `SDCardScheduleMode` | radio | 0 / 1 / 2 |
| `SDCardScheduleTimeStart` | text |  |
| `SDCardScheduleTimeStop` | text |  |
| `SDCardMotionSoundDetection` | radio | 1 / 2 |
| `SDCardScheduleInterval` | text |  |
| `SDCardKeepFreeSpace` | text |  |
| `SDCardScheduleModeVideo` | radio | 0 / 1 / 2 |
| `SDCardScheduleTimeStartVideo` | text |  |
| `SDCardScheduleTimeStopVideo` | text |  |
| `SDCardMotionSoundDetectionVideo` | radio | 1 / 2 |
| `SDCardRecordingFormatVideo` | hidden |  |
| `SDCardMaxRecordTimeVideo` | hidden |  |
| `SDCardKeepFreeSpaceVideo` | text |  |
| `ConfigSystemSDCard` | hidden |  |

**Formulario** `POST /setTestSDCard`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `SDCardTest` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `SDCardRecordingFormatVideoSel`, `SDCardVideoMaxRecordTimeSel`

### sdcman.htm

**Formulario** `POST /setManageSDCardList`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `SDCardCurrentPath` | hidden |  |
| `SDCardCurrentDirectory` | hidden |  |
| `SDCardCurrentOfPage` | hidden |  |
| `SDCardTotalOfPage` | hidden |  |
| `SDCardShowItems` | hidden |  |
| `SDCardFilesInPage` | hidden |  |
| `SDCardScheduleEnable` | hidden |  |
| `SDCardScheduleEnableVideo` | hidden |  |
| `ConfigSDCardList` | hidden |  |
| `SDCardShowItemsSel` | select | 5=5, 10=10, 15=15, 20=20, 25=25 |
| `SDCardCurrentOfPageSel` | select | 1=1 |

**Formulario** `POST /setManageSDCardFormat`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `ConfigSDCardFormat` | hidden |  |

**Formulario** `POST /setManageSDCardDelMulti`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `SDCardCurrentDirectory` | hidden |  |
| `SDCardCurrentOfPage` | hidden |  |
| `SDCardTotalOfPage` | hidden |  |
| `SDCardShowItems` | hidden |  |
| `SDCardSelectedFile1` | hidden |  |
| `SDCardSelectedFile2` | hidden |  |
| `SDCardSelectedFile3` | hidden |  |
| `SDCardSelectedFile4` | hidden |  |
| `SDCardSelectedFile5` | hidden |  |
| `SDCardSelectedFile6` | hidden |  |
| `SDCardSelectedFile7` | hidden |  |
| `SDCardSelectedFile8` | hidden |  |
| `SDCardSelectedFile9` | hidden |  |
| `SDCardSelectedFile10` | hidden |  |
| `SDCardSelectedFile11` | hidden |  |
| `SDCardSelectedFile12` | hidden |  |
| `SDCardSelectedFile13` | hidden |  |
| `SDCardSelectedFile14` | hidden |  |
| `SDCardSelectedFile15` | hidden |  |
| `SDCardSelectedFile16` | hidden |  |
| `SDCardSelectedFile17` | hidden |  |
| `SDCardSelectedFile18` | hidden |  |
| `SDCardSelectedFile19` | hidden |  |
| `SDCardSelectedFile20` | hidden |  |
| `SDCardSelectedFile21` | hidden |  |
| `SDCardSelectedFile22` | hidden |  |
| `SDCardSelectedFile23` | hidden |  |
| `SDCardSelectedFile24` | hidden |  |
| `SDCardSelectedFile25` | hidden |  |
| `ConfigSDCardDelete` | hidden |  |

**Formulario** `POST /setManageSDCardDelMulti`

| Campo | Tipo | Opciones |
|---|---|---|
| `SessionKey` | hidden |  |

### sounddb.htm

**Formulario** `POST /setSystemSoundDB`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `SoundDetectionEnable` | radio | 1 / 0 |
| `SoundDetectionScheduleDay` | hidden |  |
| `SoundDetectionScheduleMode` | radio | 0 / 1 |
| `SoundDetectionScheduleTimeStart` | text |  |
| `SoundDetectionScheduleTimeStop` | text |  |
| `SoundDetectionDB` | hidden |  |
| `ConfigSystemSoundDB` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `LevelSel`

### stsdev.htm

**Formulario** `POST /stsdev.htm`

| Campo | Tipo | Opciones |
|---|---|---|
| `f_year` | hidden |  |
| `f_month` | hidden |  |
| `f_date` | hidden |  |
| `f_hour` | hidden |  |
| `f_min` | hidden |  |
| `f_sec` | hidden |  |

### stsuser.htm

**Formulario** `POST /stsuser.htm`

| Campo | Tipo | Opciones |
|---|---|---|

### time.htm

**Formulario** `POST /setSystemDate`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `DateTimeMode` | hidden |  |
| `TimeZoneIndex` | hidden |  |
| `TimeServerIPAddress` | hidden |  |
| `Date` | hidden |  |
| `Time` | hidden |  |
| `TimeZoneSelect` | select | 01(GMT-12:00)=(GMT-12:00) Línea de fecha internacional occidental, 02(GMT-11:00)=(GMT-11:00) Midway Island, 03(GMT-10:00)=(GMT-10:00) Hawaii, 04(GMT-09:00)=(GMT-09:00) Alaska, 05(GMT-08:00)=(GMT-08:00) Hora del Pacífico (EE.UU. y Canadá), 06(GMT-08:00)=(GMT-08:00) Tijuana, Baja California, 07(GMT-07:00)=(GMT-07:00) Arizona, 08(GMT-07:00)=(GMT-07:00) Chihuahua, La Paz, Mazatlán, 09(GMT-07:00)=(GMT-07:00) Hora de las Rocosas (EE.UU. y Canadá), 10(GMT-06:00)=(GMT-06:00) América Central, 11(GMT-06:00)=(GMT-06:00) Hora central (EE.UU. y Canadá), 12(GMT-06:00)=(GMT-06:00) Guadalajara, Ciudad de Méjico, Monterrey, 13(GMT-06:00)=(GMT-06:00) Saskatchewan, 14(GMT-05:00)=(GMT-05:00) Bogotá, Lima, Quito, Rio Branco, … (92) |
| `DSTEnable` | radio | 1 / 0 |
| `DSTOffset` | hidden |  |
| `DSTStartMonth` | hidden |  |
| `DSTStartWeek` | hidden |  |
| `DSTStartDay` | hidden |  |
| `DSTStartTime` | hidden |  |
| `DSTEndMonth` | hidden |  |
| `DSTEndWeek` | hidden |  |
| `DSTEndDay` | hidden |  |
| `DSTEndTime` | hidden |  |
| `ConfigSystemDate` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `NTP_URL`, `OffsetSel`, `StartMonthSel`, `StartWeekSel`, `StartDaySel`, `StartTimeSel`, `EndMonthSel`, `EndWeekSel`, `EndDaySel`, `EndTimeSel`, `s_year`, `s_month`, `s_date`, `s_hour`, `s_min`, `s_sec`

### upgrade.htm

**Formulario** `POST /setFirmwareUpgrade`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `ForceBootCodeUpgrade` | hidden |  |
| `DownloadFile` | file |  |

### upload.htm

**Formulario** `POST /setSystemFTP`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `FTPScheduleEnable` | hidden |  |
| `FTPScheduleDay` | hidden |  |
| `FTPCreateFolderInterval` | hidden |  |
| `FTPScheduleEnableVideo` | hidden |  |
| `FTPScheduleDayVideo` | hidden |  |
| `SessionKey` | hidden |  |
| `FTPHostAddress` | text |  |
| `FTPPortNumber` | text |  |
| `FTPUserName` | text |  |
| `FTPPassword` | password |  |
| `FTPDirectoryPath` | text |  |
| `FTPPassiveMode` | radio | 1 / 0 |
| `FTPScheduleMode` | radio | 0 / 1 / 2 |
| `FTPScheduleTimeStart` | text |  |
| `FTPScheduleTimeStop` | text |  |
| `FTPScheduleVideoFrequencyMode` | radio | 0 / 1 |
| `FTPScheduleFramePerSecond` | hidden |  |
| `FTPScheduleFramePerSecondSel` | select | 1=1, 2=2, 3=3, -1=Automát |
| `FTPScheduleSecondPerFrame` | text |  |
| `FTPScheduleBaseFileName` | text |  |
| `FTPScheduleFileMode` | radio | 0 / 1 / 2 |
| `FTPScheduleMaxFileSequenceNumber` | text |  |
| `FTPScheduleModeVideo` | radio | 0 / 1 / 2 |
| `FTPScheduleTimeStartVideo` | text |  |
| `FTPScheduleTimeStopVideo` | text |  |
| `FTPScheduleBaseFileNameVideo` | text |  |
| `FTPScheduleVideoLimitSize` | text |  |
| `FTPScheduleVideoLimitTime` | text |  |
| `ConfigSystemFTP` | hidden |  |

**Formulario** `POST /setTestFTP`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `FTPServerTest` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `FolderTime`

### video.htm

**Formulario** `POST /setSystemStream`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `SessionKey` | hidden |  |
| `VideoResolution264` | hidden |  |
| `BitRate264` | hidden |  |
| `FrameRate264` | hidden |  |
| `VideoResolution` | hidden |  |
| `CompressionRate` | hidden |  |
| `FrameRate` | hidden |  |
| `ViewMode` | hidden |  |
| `LightFrequency` | radio | 0 / 1 |
| `ConfigSystemStream` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `VideoResolution264Sel`, `BitRate264Sel`, `FrameRate264Sel`, `VideoResolutionSel`, `CompressionRateSel`, `FrameRateSel`, `ViewModeSel`

### wireless.htm

**Formulario** `POST /setSystemWireless`

| Campo | Tipo | Opciones |
|---|---|---|
| `ReplySuccessPage` | hidden |  |
| `ReplyErrorPage` | hidden |  |
| `WirelessDisable` | hidden |  |
| `TransmissionRate` | hidden |  |
| `TxKey` | hidden |  |
| `WEPEncryption` | hidden |  |
| `WEPKeyFormat` | hidden |  |
| `SessionKey` | hidden |  |
| `SSID` | text |  |
| `WirelessChannel` | select | =1, =2, =3, =4, =5, =6, =7, =8, =9, =10, =11, =12, =13 |
| `TxRateSel` | select | 0=Totalmente automática, 1=1 Mb, 2=2 Mb, 5=5.5 Mb, 11=11 Mb, 6=6 Mb, 9=9 Mb, 12=12 Mb, 18=18 Mb, 24=24 Mb, 36=36 Mb, 48=48 Mb, 54=54 Mb |
| `ConnectionMode` | radio | 0 / 1 |
| `WEPEncryWay` | radio | 0 / 2 / 4 |
| `AuthenticationType` | radio | 0 / 1 / 2 |
| `Key1` | password |  |
| `Key2` | password |  |
| `Key3` | password |  |
| `Key4` | password |  |
| `PreSharedKey` | password |  |
| `BeaconInterval` | int |  |
| `Preamble` | radio | 0 / 1 |
| `ConfigSystemWireless` | hidden |  |

Desplegables auxiliares (sin name; el JS copia su valor a campos ocultos): `KeyLenSel`, `KeyFormatSel`, `TxKeySel`

### wizard.htm
