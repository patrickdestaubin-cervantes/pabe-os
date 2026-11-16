// PABE OS — carcasa: carril de módulos, botón +, estado de Drive
import { drive } from './drive.js';
import { CONFIG } from './config.js';
import { on, sync, syncNow, startSync } from './store.js';
import { supa, realtime } from './supa.js';
import * as notas from './modules/notas.js';
import * as finanzas from './modules/finanzas.js';
import * as calendario from './modules/calendario.js';
import { agente, mountAgent, pullSettings } from './agente.js';

const $ = s => document.querySelector(s);
// Módulos de PABE. «mod»: módulo ya integrado en esta web. «url»: módulo que aún vive en su propia web de pruebas.
// Para añadir uno nuevo: una línea aquí + su botón en el carril (index.html).
const MODULOS = [
  { id: 'notas', nombre: 'Notas', mod: notas },
  { id: 'finanzas', nombre: 'Finanzas', descripcion: 'Movimientos, cuentas y patrimonio', mod: finanzas },
  { id: 'calendario', nombre: 'Calendario', descripcion: 'Tu Google Calendar: Personal e I&S Homes', mod: calendario },
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

/* ---------- estado de la sincronía (punto + botón) ---------- */
const needLogin = () => !supa.signedIn || drive.missing;
function paintSync() {
  const b = $('#drv'), s = sync.state;
  if (needLogin()) { b.className = 'drv auth'; b.textContent = 'Conectar Google'; b.title = 'Inicia sesión con tu cuenta personal de Google (una sola vez en este dispositivo)'; return; }
  b.className = 'drv ' + s;
  b.textContent = s === 'syncing' ? 'Guardando…' : s === 'error' ? (sync.msg || 'Error al guardar') : s === 'auth' ? 'Conectar Google' : realtime.up ? 'Sincronizado' : 'Guardado';
  b.title = s === 'ok' ? (realtime.up ? 'Todo guardado y conectado en tiempo real con tus otros dispositivos. Copia en tu Drive (06 PABE OS).' : 'Guardado. Reconectando el tiempo real…') : '';
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 5000); }

// Borrón y cuenta nueva: si cambia CONFIG.epoch, se vacía la copia local de este dispositivo (Drive manda)
async function resetIfNeeded() {
  let cur = null; try { cur = localStorage.getItem('pabe:epoch'); } catch (e) {}
  if (cur === CONFIG.epoch) return;
  await new Promise(ok => { try { const r = indexedDB.deleteDatabase('pabe-os'); r.onsuccess = r.onerror = r.onblocked = () => ok(); } catch (e) { ok(); } });
  try { Object.keys(localStorage).filter(k => k.startsWith('pabe:') && k !== 'pabe:sb' && k !== 'pabe:device' && !k.startsWith('pabe:ag:') && !k.startsWith('pabe:kind') && !k.startsWith('pabe:pen') && !k.startsWith('pabe:shapes') && k !== 'pabe:sawPen').forEach(k => localStorage.removeItem(k)); localStorage.setItem('pabe:epoch', CONFIG.epoch); } catch (e) {}
}

async function boot() {
  await resetIfNeeded();
  // vuelta del inicio de sesión con Google: la sesión llega en la dirección
  const login = await supa.handleRedirect();
  if (login?.error) toast('No se pudo iniciar sesión: ' + login.error);
  else if (login?.google) drive.use(login.google, login.expires_in, CONFIG.scope);
  $('#rail').addEventListener('click', e => { const b = e.target.closest('.mod'); if (b) go(b.dataset.m); });
  // «+»: en Calendario crea un evento; en el resto, una nota nueva
  $('#plus').onclick = () => { if (current === 'calendario') return calendario.newEvent(); if (current !== 'notas') go('notas'); else notas.enter(); };
  addEventListener('hashchange', () => go(location.hash.slice(1)));
  notas.setActiveCheck(() => current === 'notas');
  await notas.mount(document.querySelector('[data-view=notas]'));
  await finanzas.mount(document.querySelector('[data-view=finanzas]'));
  await calendario.mount(document.querySelector('[data-view=calendario]'));
  agente.register('finanzas', finanzas.agentDef);
  agente.register('calendario', calendario.agentDef);
  agente.register('notas', notas.agentDef); agente.setCurrent(() => current || 'notas'); mountAgent();
  go(location.hash.slice(1) || 'notas');

  on('sync', paintSync); supa.onAuth(paintSync);
  drive.onAuth(ok => { paintSync(); if (ok) pullSettings(); });
  paintSync();
  $('#drv').onclick = async () => {
    if (needLogin()) return drive.signIn();   // lleva a Google y vuelve
    syncNow();
  };
  startSync();
  if (supa.signedIn) drive.load().then(ok => { if (ok) pullSettings(); else if (drive.lastError === 'no_secret') toast('Falta el secreto de Google en el servidor de PABE'); paintSync(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (!sessionStorage.getItem('pabe:reloaded')) { sessionStorage.setItem('pabe:reloaded', '1'); location.reload(); } });
}
boot();
