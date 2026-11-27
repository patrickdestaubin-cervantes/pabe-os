# PABE OS

Sistema operativo personal de Patrick, organizado por módulos. Web estática (GitHub Pages) que se instala en el iPad y el ordenador como una app.

- **Datos**: en el Drive personal, carpeta «06 PABE OS» (una subcarpeta por módulo; los datos de la app en `<Módulo>/_datos`). Copia local en el dispositivo para funcionar sin conexión.
- **Acceso**: inicio de sesión con la cuenta personal de Google (ID de cliente en `js/config.js`).
- **Tabla PABE** (`js/tabla.js`): tabla tipo Notion compartida por todos los módulos. Un cambio aquí cambia la tabla en todos.
- **Módulos**: `js/modules/` (Notas listo; Finanzas, Calendario y Viajes por conectar).
- **Calendario (en pruebas)**: `calendario.html` — conectado a Google Calendar de la cuenta personal (`js/gcal.js`), vistas día/semana/mes y Tabla PABE.

Reglas completas: documento «PABE_OS_reglas_y_arquitectura» del proyecto PABE OS en Claude.
- **Compartir a PABE** desde cualquier app → nota nueva (área «Compartido»). Android/Windows: `share_target` del manifest + `sw.js`. iPad/iPhone/Mac: atajo que guarda en Drive «06 PABE OS/Notas/Compartir con PABE/». Guía: `COMPARTIR.md`.
