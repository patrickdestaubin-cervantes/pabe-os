// PABE OS — carcasa: carril de módulos, botón +, estado de Drive
import { drive } from './drive.js';
import { CONFIG } from './config.js';
import { on, sync, syncNow, startSync } from './store.js';
import { supa, realtime } from './supa.js';
import * as notas from './modules/notas.js';
import * as finanzas from './modules/finanzas.js';
import * as calendario from './modules/calendario.js';
import * as dia from './modules/dia.js';
import { agente, mountAgent, pullSettings } from './agente.js';
import { plainClick } from './ui.js';
import { OWNER_EMAIL, space } from './space.js';

const $ = s => document.querySelector(s);
// Módulos de PABE. «mod»: módulo ya integrado en esta web. «url»: módulo que aún vive en su propia web de pruebas.
// Para añadir uno nuevo: una línea aquí + su botón en el carril (index.html).
const MODULOS = [
  { id: 'dia', nombre: 'Orden del día', descripcion: 'Lo importante de cada día', mod: dia },
  { id: 'notas', nombre: 'Notas', mod: notas },
  { id: 'calendario', nombre: 'Calendario', descripcion: 'Tu Google Calendar: Personal e I&S Homes', mod: calendario },
  { id: 'finanzas', nombre: 'Finanzas', descripcion: 'Movimientos, cuentas y patrimonio', mod: finanzas },
  { id: 'viajes', nombre: 'Viajes', descripcion: 'En construcción. Pulsa + para abrir una nota.' },
];
const MODS = Object.fromEntries(MODULOS.map(m => [m.id, m]));
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function paintModulo(m) {
  const icon = document.querySelector(`.mod[data-m="${m.id}"] svg`)?.outerHTML.replace(/width="20" height="20"/, 'width="44" height="44"') || '';
  $('#soonBody').innerHTML = `<div class="soon-ic">${icon}</div><h2>${escH(m.nombre)}</h2><p>${escH(m.descripcion || '')}</p>${m.url ? `<a class="soon-go" href="${escH(m.url)}" target="_blank" rel="noopener">Abrir ${escH(m.nombre)}</a>` : ''}`;
}
let current = null;

// Rutas con dirección propia (#módulo/subruta): así cualquier botón se puede abrir en otra pestaña
// (clic derecho → «Abrir en pestaña nueva», Ctrl/⌘+clic o clic con la rueda). Ej.: #notas/nueva, #notas/<id>, #calendario/semana, #finanzas/ctas
const PLUS = { calendario: ['#calendario/nuevo', 'Evento nuevo'], dia: ['#dia/nuevo', 'Compromiso nuevo'] };
function go(m, keep, sub) {
  if (!MODS[m]) m = 'notas';
  if (current && current !== m) MODS[current].mod?.leave?.();
  const entering = current !== m; current = m;
  document.querySelectorAll('.mod').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== (MODS[m].mod ? m : 'soon'); });
  if (!MODS[m].mod) paintModulo(MODS[m]);
  const [href, label] = PLUS[m] || ['#notas/nueva', 'Nota nueva']; const pl = $('#plus'); pl.href = href; pl.title = label; pl.setAttribute('aria-label', label);
  if (entering && !keep && !(m === 'notas' && sub && sub !== 'todas')) MODS[m].mod?.enter?.();
  if (sub) MODS[m].mod?.route?.(sub);
  const h = location.hash.slice(1), base = h.split('/')[0];
  if (base !== m || (sub && ['nueva', 'nuevo'].includes(sub))) history.replaceState(null, '', '#' + m + (sub && !['nueva', 'nuevo', 'todas'].includes(sub) ? '/' + sub : ''));
}
const fromHash = () => { const [m, ...r] = location.hash.slice(1).split('/'); go(m || 'notas', false, r.join('/') || null); };

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

// Cada persona empieza en su propio PABE: si en este dispositivo entra otra cuenta, se vacía la copia local de la anterior
async function switchUser() {
  const u = supa.user; if (!u?.id) return false;
  let prev = null; try { prev = localStorage.getItem('pabe:uid'); } catch (e) {}
  const other = prev ? prev !== u.id : (u.email || '').toLowerCase() !== OWNER_EMAIL;
  try { localStorage.setItem('pabe:uid', u.id); } catch (e) {}
  if (!other || (!prev && !(await hasLocalData()))) return false;
  await new Promise(ok => { try { const r = indexedDB.deleteDatabase('pabe-os'); r.onsuccess = r.onerror = r.onblocked = () => ok(); } catch (e) { ok(); } });
  try { Object.keys(localStorage).filter(k => k.startsWith('pabe:') && !['pabe:sb', 'pabe:device', 'pabe:uid', 'pabe:epoch', 'pabe:tok'].includes(k)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  location.reload(); return true;
}
async function hasLocalData() { try { const dbs = await indexedDB.databases?.(); return !dbs || dbs.some(d => d.name === 'pabe-os'); } catch (e) { return true; } }

async function boot() {
  await resetIfNeeded();
  // vuelta del inicio de sesión con Google: la sesión llega en la dirección
  const login = await supa.handleRedirect();
  if (login?.error) toast('No se pudo iniciar sesión: ' + login.error);
  else if (login?.google) drive.use(login.google, login.expires_in, CONFIG.scope);
  if (await switchUser()) return;
  if (supa.signedIn) await Promise.race([space.load(), new Promise(ok => setTimeout(ok, 4000))]);
  $('#rail').addEventListener('click', e => { const b = e.target.closest('.mod'); if (!b || !plainClick(e)) return; e.preventDefault(); go(b.dataset.m); });
  // «+»: en Calendario crea un evento; en el resto, una nota nueva (clic derecho → abrirlo en otra pestaña)
  $('#plus').onclick = e => { if (!plainClick(e)) return; e.preventDefault(); if (current === 'calendario') return calendario.newEvent(); if (current === 'dia') return dia.newItem(); if (current !== 'notas') go('notas'); else notas.enter(); };
  addEventListener('hashchange', fromHash);
  // ⟳ bajo el «+»: guarda lo que haya pendiente, busca la última versión de PABE y recarga esta pestaña (se queda en el mismo sitio)
  $('#reload').onclick = async () => {
    const b = $('#reload'); b.classList.add('spin');
    try { MODS[current]?.mod?.leave?.(); } catch (_) {}
    try { syncNow(); } catch (_) {}
    try { const r = await navigator.serviceWorker?.getRegistration(); await Promise.race([r?.update(), new Promise(ok => setTimeout(ok, 1500))]); } catch (_) {}
    setTimeout(() => location.reload(), 300);
  };
  notas.setActiveCheck(() => current === 'notas');
  await notas.mount(document.querySelector('[data-view=notas]'));
  await finanzas.mount(document.querySelector('[data-view=finanzas]'));
  await calendario.mount(document.querySelector('[data-view=calendario]'));
  await dia.mount(document.querySelector('[data-view=dia]'));
  agente.register('finanzas', finanzas.agentDef);
  agente.register('calendario', calendario.agentDef);
  agente.register('dia', dia.agentDef);
  agente.register('notas', notas.agentDef); agente.setCurrent(() => current || 'notas'); mountAgent();
  fromHash();

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
