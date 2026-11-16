// PABE OS — carcasa: carril de módulos, botón +, estado de Drive
import { drive } from './drive.js';
import { CONFIG } from './config.js';
import { on, sync, syncNow } from './store.js';
import * as notas from './modules/notas.js';
import * as finanzas from './modules/finanzas.js';
import { agente, mountAgent, pullSettings } from './agente.js';

const $ = s => document.querySelector(s);
// Módulos de PABE. «mod»: módulo ya integrado en esta web. «url»: módulo que aún vive en su propia web de pruebas.
// Para añadir uno nuevo: una línea aquí + su botón en el carril (index.html).
const MODULOS = [
  { id: 'notas', nombre: 'Notas', mod: notas },
  { id: 'finanzas', nombre: 'Finanzas', descripcion: 'Movimientos, cuentas y patrimonio', mod: finanzas },
  { id: 'calendario', nombre: 'Calendario', descripcion: 'En construcción. Pulsa + para abrir una nota.' },
  { id: 'viajes', nombre: 'Viajes', descripcion: 'En construcción. Pulsa + para abrir una nota.' },
];
const MODS = Object.fromEntries(MODULOS.map(m => [m.id, m]));
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function paintModulo(m) {
  const icon = document.querySelector(`.mod[data-m="${m.id}"] svg`)?.outerHTML.replace(/width="20" height="20"/, 'width="44" height="44"') || '';
  $('#soonBody').innerHTML = `<div class="soon-ic">${icon}</div><h2>${escH(m.nombre)}</h2><p>${escH(m.descripcion || '')}</p>${m.url ? `<a class="soon-go" href="${escH(m.url)}" target="_blank" rel="noopener">Abrir ${escH(m.nombre)}</a>` : ''}`;
}
let current = null;

function go(m, keep) {
  if (!MODS[m]) m = 'notas';
  if (current && current !== m) MODS[current].mod?.leave?.();
  const entering = current !== m; current = m;
  document.querySelectorAll('.mod').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== (MODS[m].mod ? m : 'soon'); });
  if (!MODS[m].mod) paintModulo(MODS[m]);
  if (location.hash !== '#' + m) history.replaceState(null, '', '#' + m);
  if (entering && !keep) MODS[m].mod?.enter?.();
}

/* ---------- estado de Drive (punto + botón) ---------- */
function paintSync() {
  const b = $('#drv'), s = sync.state;
  b.className = 'drv ' + s;
  b.textContent = !drive.configured ? 'Solo en este dispositivo' : s === 'auth' || !drive.ready ? 'Conectar Drive' : s === 'syncing' ? 'Guardando…' : s === 'error' ? (sync.msg || 'Error al guardar') : 'Guardado en Drive';
  b.title = !drive.configured ? 'Falta configurar el acceso a Google: de momento se guarda solo aquí' : s === 'ok' ? 'Todo guardado en tu Drive personal (06 PABE OS). Toca para sincronizar ahora.' : '';
}

// Borrón y cuenta nueva: si cambia CONFIG.epoch, se vacía la copia local de este dispositivo (Drive manda)
async function resetIfNeeded() {
  let cur = null; try { cur = localStorage.getItem('pabe:epoch'); } catch (e) {}
  if (cur === CONFIG.epoch) return;
  await new Promise(ok => { try { const r = indexedDB.deleteDatabase('pabe-os'); r.onsuccess = r.onerror = r.onblocked = () => ok(); } catch (e) { ok(); } });
  try { Object.keys(localStorage).filter(k => k.startsWith('pabe:') && !k.startsWith('pabe:ag:') && !k.startsWith('pabe:kind') && !k.startsWith('pabe:pen') && !k.startsWith('pabe:shapes') && k !== 'pabe:sawPen').forEach(k => localStorage.removeItem(k)); localStorage.setItem('pabe:epoch', CONFIG.epoch); } catch (e) {}
}

async function boot() {
  await resetIfNeeded();
  $('#rail').addEventListener('click', e => { const b = e.target.closest('.mod'); if (b) go(b.dataset.m); });
  $('#plus').onclick = () => { if (current !== 'notas') go('notas'); else notas.enter(); };
  addEventListener('hashchange', () => go(location.hash.slice(1)));
  notas.setActiveCheck(() => current === 'notas');
  await notas.mount(document.querySelector('[data-view=notas]'));
  await finanzas.mount(document.querySelector('[data-view=finanzas]'));
  agente.register('finanzas', finanzas.agentDef);
  agente.register('notas', notas.agentDef); agente.setCurrent(() => current || 'notas'); mountAgent();
  go(location.hash.slice(1) || 'notas');

  on('sync', paintSync); drive.onAuth(ok => { paintSync(); if (ok) { syncNow(); pullSettings(); } });
  paintSync();
  $('#drv').onclick = async () => {
    if (!drive.configured) { const t = document.getElementById('toast'); t.textContent = 'Aún no está conectado a tu Drive: cada dispositivo guarda solo lo suyo'; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 4000); return; }
    if (!drive.ready) { const ok = await drive.signIn(!drive.hadSession() ? false : true); if (!ok) { const ok2 = await drive.signIn(false); if (!ok2) return; } }
    syncNow();
  };
  if (drive.configured) { await drive.load().catch(() => {}); if (drive.ready) { syncNow(); pullSettings(); } paintSync(); }

  // Renovar el permiso de Google solo, sin botón: en el primer toque cuando quedan menos de 10 min o ya caducó.
  // (Google exige que la ventanita de renovación salga de un toque; con la cuenta ya elegida, se cierra sola.)
  let renewing = false, lastTry = 0;
  const autoRenew = () => {
    if (!drive.configured || !drive.hadSession() || !drive.needsRenew || renewing || Date.now() - lastTry < 60000) return;
    renewing = true; lastTry = Date.now();
    drive.signIn(true).then(ok => { renewing = false; if (ok) syncNow(); });
  };
  addEventListener('pointerdown', autoRenew, true); addEventListener('keydown', autoRenew, true);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (!sessionStorage.getItem('pabe:reloaded')) { sessionStorage.setItem('pabe:reloaded', '1'); location.reload(); } });
}
boot();
