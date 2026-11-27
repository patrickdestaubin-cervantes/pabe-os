# Compartir a PABE desde cualquier app

Cuando compartes algo a PABE (un PDF, un Word, una foto, un enlace de Google Sheets, un texto…), PABE crea **una nota nueva** con ello, con el área **«Compartido»**. El título sale solo (el nombre del archivo o del enlace) y el archivo queda guardado también en tu Drive.

Cada aparato lo hace a su manera, porque Apple no deja que una web aparezca en su menú «Compartir». Solo hay que prepararlo **una vez** en cada aparato.

---

## iPad y iPhone: el atajo «PABE» (5 minutos, una sola vez)

Lo que hace el atajo: guarda lo que compartes en una carpeta de tu Drive, y PABE lo recoge solo en un par de minutos (o al momento, si tienes PABE abierto).

**Antes:** ten la app **Google Drive** instalada con tu cuenta personal, y abre PABE una vez (así PABE crea la carpeta «Compartir con PABE»).

1. Abre la app **Atajos** → pulsa **+** (arriba a la derecha).
2. Arriba, ponle de nombre **PABE** (y si quieres, un icono y un color).
3. Pulsa la **ⓘ** (abajo, o en el nombre → «Detalles») y activa **«Mostrar en la hoja para compartir»**. Cierra.
4. Arriba aparece «Recibir **Cualquiera** de **Hoja para compartir**». Pulsa **Cualquiera** y deja marcados solo **Archivos, Imágenes, PDF, URL y Texto** (quita «Páginas web de Safari» y «Texto con formato»: así Safari manda el enlace).
5. Añade la acción **«Obtener tipo»** (búscala en la barra de abajo). Quedará: «Obtener tipo de *Entrada del atajo*».
6. Añade la acción **«Si»**: «Si *Tipo* **contiene** `URL`».
   - Dentro del «Si», añade **«Texto»** y en su caja pon la variable **Entrada del atajo**.
   - Debajo, añade **«Guardar archivo»** (guardar *Texto*).
7. En el **«De lo contrario»**, añade otra vez **«Guardar archivo»** (guardar *Entrada del atajo*).
8. En **cada** «Guardar archivo»: pulsa la flecha **›**, **desactiva «Preguntar dónde guardar»**, y en *Carpeta* elige **Drive → Mi unidad → 06 PABE OS → Notas → Compartir con PABE**.
9. (Opcional) Al final, fuera del «Si», añade **«Mostrar notificación»**: `Guardado en PABE`.
10. Pulsa **OK**. Listo.

**Para usarlo:** en cualquier app pulsa **Compartir** → **PABE** (si no lo ves, desliza hasta el final de la fila de apps o pulsa «Más» y arrástralo al principio).

> Si algún día el atajo falla, hay un plan B sin atajo: **Compartir → Guardar en Archivos → Drive → 06 PABE OS → Notas → Compartir con PABE**. PABE lo recoge igual.

## Mac

El mismo atajo aparece solo en el Mac (Atajos se sincroniza por iCloud) en **Compartir → PABE**, si tienes **Google Drive para ordenador** instalado. Si la carpeta no aparece al elegirla en el paso 8, ábrelo en el Mac y vuelve a elegir la carpeta (Google Drive → Mi unidad → 06 PABE OS → Notas → Compartir con PABE).

También puedes **arrastrar** cualquier archivo a esa carpeta en el Finder: el resultado es el mismo.

## Móvil Android

1. Abre PABE en **Chrome** → menú **⋮** → **Instalar aplicación** (si ya estaba instalado antes de este cambio, quítalo y vuelve a instalarlo para que aparezca en Compartir).
2. En cualquier app: **Compartir → PABE**. Se abre PABE con la nota nueva ya hecha.

## Ordenador con Windows

Instala PABE como app desde **Microsoft Edge** (menú **…** → Aplicaciones → Instalar este sitio como aplicación). Después, en el menú **Compartir** de Windows (por ejemplo, botón derecho sobre un archivo → Compartir) aparece **PABE**.

---

### Qué pasa con cada cosa
- **PDF**: se ve dentro de la nota, página a página.
- **Fotos**: se ven en la nota.
- **Word, Excel, PowerPoint, otros**: quedan como archivo adjunto (se abre con un toque y está en Drive).
- **Enlace** (Google Sheets, una web…): queda escrito en la nota; el título dice «Hoja de Google», «Documento de Google» o la web.
- **Varias fotos a la vez**: van todas a la misma nota.
- Los archivos quedan en Drive en «06 PABE OS/Notas/Compartir con PABE/Importados» (por el atajo) o «06 PABE OS/Notas/Compartido» (Android/Windows).
