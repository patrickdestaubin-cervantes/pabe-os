// Configuración de PABE OS (web propia)
export const CONFIG = {
  // ID de cliente OAuth de Google Cloud (cuenta personal). Se rellena cuando Patrick lo envíe.
  clientId: '482689674333-4q2ba33h5kf6t461l6nndcvchv54koun.apps.googleusercontent.com',
  // Carpeta raíz «06 PABE OS» del Drive personal
  rootFolder: '1gMrgZDv9D6FcV3AbP1cXAN9GaQkmXDvz',
  // Acceso completo a Drive: necesario para trabajar dentro de «06 PABE OS», que ya existe
  scope: 'https://www.googleapis.com/auth/drive',
  version: '1.1.0',
  // Cambiar esta fecha = «borrón y cuenta nueva» de los datos guardados en cada dispositivo
  epoch: '2026-11-16-reset2'
};
