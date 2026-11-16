// Configuración de PABE OS (web propia)
export const CONFIG = {
  // ID de cliente OAuth de Google Cloud (cuenta personal). Se rellena cuando Patrick lo envíe.
  clientId: '482689674333-4q2ba33h5kf6t461l6nndcvchv54koun.apps.googleusercontent.com',
  // Carpeta raíz «06 PABE OS» del Drive personal
  rootFolder: '1gMrgZDv9D6FcV3AbP1cXAN9GaQkmXDvz',
  // Un solo permiso de Google para todo PABE: Drive (06 PABE OS) + Google Calendar
  scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar',
  version: '1.2.0',
  // Cambiar esta fecha = «borrón y cuenta nueva» de los datos guardados en cada dispositivo
  epoch: '2026-11-16-reset2'
};
