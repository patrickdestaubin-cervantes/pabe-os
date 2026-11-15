// PABE OS — carcasa: carril de módulos, botón +, estado de Drive
import { drive } from './drive.js';
import { on, sync, syncNow } from './store.js';
import * as notas from './modules/notas.js';

const $ = s => document.querySelector(s);
const MODS = {
  notas: { nombre: 'Notas', mod: notas },
  finanzas: { nombre: 'Finanzas' },
  calendario: { nombre: 'Calendario' },
  viajes: { nombre: 'Viajes' },
};
let current = null;

function go(m, keep) {
  if (!MODS[m]) m = 'notas';
  if (current && current !== m) MODS[current].mod?.leave?.();
  const entering = current !== m; current = m;
  document.querySelectorAll('.mod').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== (MODS[m].mod ? m : 'soon'); });
  $('#soonT').textContent = MODS[m].nombre;
  if (location.hash !== '#' + m) history.replaceState(null, '', '#' + m);
  if (entering && !keep) MODS[m].mod?.enter?.();
}

/* ---------- estado de Drive (punto + botón) ---------- */
function paintSync() {
  const b = $('#drv'), s = sync.state;
  b.className = 'drv ' + s;
  b.textContent = !drive.configured ? 'Solo en este dispositivo' : s === 'auth' || !drive.ready ? 'Conectar Drive' : s === 'syncing' ? 'Guardando…' : s === 'error' ? (sync.msg || 'Error al guardar') : 'Guardado en Drive';
  b.title = !drive.configured ? 'Falta configurar el acceso a Google: de momento se guarda solo aquí' : s === 'ok' ? 'Todo guardado en tu Drive personal (06 PABE OS)' : '';
}

async function boot() {
  $('#rail').addEventListener('click', e => { const b = e.target.closest('.mod'); if (b) go(b.dataset.m); });
  $('#plus').onclick = () => { if (current !== 'notas') go('notas'); else notas.enter(); };
  addEventListener('hashchange', () => go(location.hash.slice(1)));
  notas.setActiveCheck(() => current === 'notas');
  await notas.mount(document.querySelector('[data-view=notas]'));
  go(location.hash.slice(1) || 'notas');

  on('sync', paintSync); drive.onAuth(ok => { paintSync(); if (ok) syncNow(); });
  paintSync();
  $('#drv').onclick = async () => {
    if (!drive.configured) return;
    if (!drive.ready) { const ok = await drive.signIn(!drive.hadSession() ? false : true); if (!ok) { const ok2 = await drive.signIn(false); if (!ok2) return; } }
    syncNow();
  };
  if (drive.configured) { await drive.load().catch(() => {}); if (drive.ready) syncNow(); paintSync(); }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
