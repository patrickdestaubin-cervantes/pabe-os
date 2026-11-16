// Arranque de la web de pruebas del Calendario: módulo + Drive (etiquetas y propiedades propias) + asistente
import { drive } from './drive.js';
import { on, sync, syncNow } from './store.js';
import * as cal from './modules/calendario.js';
import { agente, mountAgent, pullSettings } from './agente.js';

const $ = s => document.querySelector(s);
function paintSync() {
  const b = $('#drv'), s = sync.state;
  b.className = 'drv ' + s;
  b.textContent = !drive.configured ? 'Solo en este dispositivo' : s === 'auth' || !drive.ready ? 'Conectar Drive' : s === 'syncing' ? 'Guardando…' : s === 'error' ? (sync.msg || 'Error al guardar') : 'Guardado en Drive';
  b.title = 'Etiquetas y columnas propias del Calendario: se guardan en 06 PABE OS/Calendario';
}

async function boot() {
  await cal.mount($('[data-view=calendario]'));
  $('#plus').onclick = () => cal.newEvent();
  agente.register('calendario', cal.agentDef); agente.setCurrent(() => 'calendario'); mountAgent();
  on('sync', paintSync); drive.onAuth(ok => { paintSync(); if (ok) { syncNow(); pullSettings(); } });
  paintSync();
  $('#drv').onclick = async () => {
    if (!drive.ready) { const ok = await drive.signIn(drive.hadSession()); if (!ok && !(await drive.signIn(false))) return; }
    syncNow();
  };
  if (drive.configured) { await drive.load().catch(() => {}); if (drive.ready) { syncNow(); pullSettings(); } paintSync(); }
}
boot();
