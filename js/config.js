// Configuración de PABE OS (web propia)
export const CONFIG = {
  // ID de cliente OAuth de Google Cloud (cuenta personal). Se rellena cuando Patrick lo envíe.
  clientId: '482689674333-4q2ba33h5kf6t461l6nndcvchv54koun.apps.googleusercontent.com',
  // Carpeta raíz «06 PABE OS» del Drive personal
  rootFolder: '1gMrgZDv9D6FcV3AbP1cXAN9GaQkmXDvz',
  // Un solo permiso de Google para todo PABE: Drive (06 PABE OS) + Google Calendar
  scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/calendar',
  // Base de datos en la nube (Supabase, proyecto «pabe-os»). Esta clave es pública: los datos los protege el inicio de sesión.
  supabase: { url: 'https://sngtorjlgjhnkgoajfly.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuZ3RvcmpsZ2pobmtnb2FqZmx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4MzY1NzcsImV4cCI6MjExMDQxMjU3N30.YlWSt25Pb74XKV_FzJelloFG8WfAbYN7oWFb3rHDpmE' },
  version: '2.0.0',
  // Cambiar esta fecha = «borrón y cuenta nueva» de los datos guardados en cada dispositivo
  epoch: '2026-11-16-reset2'
};
