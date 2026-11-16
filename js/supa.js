// Conexión con la base de datos en la nube de PABE (Supabase), sin librerías externas:
// inicio de sesión con Google (una vez por dispositivo), llamadas a la base de datos y tiempo real.
import { CONFIG } from './config.js';

const S = CONFIG.supabase;
const LS = 'pabe:sb';
const listeners = new Set();
let session = null; // { access_token, refresh_token, expires_at (s), user:{id,email} }
try { session = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}

// Identificador de este dispositivo (para no aplicar dos veces los cambios propios)
export const DEVICE = (() => { try { let d = localStorage.getItem('pabe:device'); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem('pabe:device', d); } return d; } catch (e) { return 'x'; } })();

function save() { try { session ? localStorage.setItem(LS, JSON.stringify(session)) : localStorage.removeItem(LS); } catch (e) {} listeners.forEach(f => f(!!session)); }

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) return false;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const r = await fetch(`${S.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: S.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        // otra pestaña pudo renovarla ya: probar con la guardada antes de rendirse
        let other = null; try { other = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
        if (other && other.refresh_token !== session.refresh_token && other.expires_at * 1000 > Date.now() + 60000) { session = other; return true; }
        session = null; save(); return false;
      }
      if (!r.ok) return false; // red: se reintentará
      const j = await r.json();
      session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + j.expires_in, user: { id: j.user?.id, email: j.user?.email } };
      save(); rt.auth(); return true;
    } catch (e) { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export const supa = {
  get signedIn() { return !!session; },
  get user() { return session?.user || null; },
  onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Inicia sesión con Google (una sola vez por dispositivo). Pide Drive + Calendar con permiso permanente.
  login() {
    const back = location.origin + location.pathname;
    try { sessionStorage.setItem('pabe:afterLogin', location.hash || ''); } catch (e) {}
    const q = new URLSearchParams({ provider: 'google', redirect_to: back, scopes: CONFIG.scope, access_type: 'offline', prompt: 'consent' });
    location.href = `${S.url}/auth/v1/authorize?${q}`;
  },

  // Al volver de Google: la sesión llega en la dirección (#access_token=…). Devuelve el permiso de Google recibido.
  async handleRedirect() {
    const h = location.hash;
    if (!/access_token=|error_description=/.test(h)) return null;
    const p = new URLSearchParams(h.slice(1));
    let back = ''; try { back = sessionStorage.getItem('pabe:afterLogin') || ''; sessionStorage.removeItem('pabe:afterLogin'); } catch (e) {}
    history.replaceState(null, '', location.pathname + back);
    if (p.get('error_description')) return { error: p.get('error_description') };
    session = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_at: +p.get('expires_at') || Math.floor(Date.now() / 1000) + +p.get('expires_in'), user: null };
    try { const u = await (await fetch(`${S.url}/auth/v1/user`, { headers: { apikey: S.key, Authorization: 'Bearer ' + session.access_token } })).json(); session.user = { id: u.id, email: u.email }; } catch (e) {}
    save();
    const prt = p.get('provider_refresh_token');
    if (prt) await this.rest('/google_tokens?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ refresh_token: prt, updated_at: new Date().toISOString() }) }).catch(e => console.error(e));
    return { google: p.get('provider_token'), expires_in: 3500 };
  },

  logout() { session = null; save(); rt.close(); },

  async token() {
    if (!session) return null;
    if (session.expires_at * 1000 < Date.now() + 60000) await refresh();
    return session?.access_token || null;
  },

  // Llamada a la base de datos (PostgREST)
  async rest(path, opt = {}, retry = true) {
    const t = await this.token(); if (!t) throw Object.assign(new Error('auth'), { code: 'auth' });
    const r = await fetch(`${S.url}/rest/v1${path}`, { cache: 'no-store', ...opt, headers: { apikey: S.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 401 && retry) { await refresh(); return this.rest(path, opt, false); }
    if (!r.ok) throw Object.assign(new Error('db ' + r.status), { code: r.status === 401 ? 'auth' : r.status, body: await r.text().catch(() => '') });
    return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json().catch(() => null);
  },

  // Permiso de Google fresco desde el servidor (sin ventanas ni toques)
  async googleToken() {
    const t = await this.token(); if (!t) return { error: 'auth' };
    try {
      const r = await fetch(`${S.url}/functions/v1/google-token`, { method: 'POST', headers: { apikey: S.key, Authorization: 'Bearer ' + t } });
      const j = await r.json().catch(() => ({}));
      return r.ok ? j : { error: j.error || 'http ' + r.status };
    } catch (e) { return { error: 'net' }; }
  },
};

/* ---------- tiempo real (cambios de otros dispositivos al instante) ---------- */
const rt = (() => {
  let ws = null, hb = null, ref = 0, retry = 0, wanted = false, handlers = new Set(), stateFns = new Set(), up = false;
  const topic = 'realtime:pabe';
  const send = m => { if (ws?.readyState === 1) ws.send(JSON.stringify({ ...m, ref: String(++ref) })); };
  const setUp = v => { if (up !== v) { up = v; stateFns.forEach(f => f(v)); } };
  async function open() {
    if (!wanted || ws) return;
    const t = await supa.token(); if (!t) return;
    ws = new WebSocket(`${S.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${S.key}&vsn=1.0.0`);
    ws.onopen = () => {
      retry = 0;
      send({ topic, event: 'phx_join', join_ref: '1', payload: { config: { broadcast: { self: false }, presence: { key: '' }, private: false, postgres_changes: [{ event: '*', schema: 'public', table: 'items' }, { event: '*', schema: 'public', table: 'kvs' }] }, access_token: t } });
      clearInterval(hb); hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {} }), 25000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.payload?.status === 'ok' && m.payload?.response?.postgres_changes) setUp(true);
      else if (m.event === 'system' && m.payload?.status === 'ok') setUp(true);
      else if (m.event === 'postgres_changes') { const d = m.payload?.data; if (d) handlers.forEach(f => f(d)); }
      else if (m.event === 'phx_error' || m.event === 'phx_close' || (m.event === 'system' && m.payload?.status === 'error')) { try { ws.close(); } catch (x) {} }
    };
    ws.onclose = () => {
      clearInterval(hb); ws = null; setUp(false);
      if (wanted) setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
    };
  }
  return {
    get up() { return up; },
    start() { wanted = true; open(); },
    close() { wanted = false; try { ws?.close(); } catch (e) {} },
    async auth() { const t = session?.access_token; if (t && ws?.readyState === 1) send({ topic, event: 'access_token', payload: { access_token: t } }); },
    on(fn) { handlers.add(fn); },
    onState(fn) { stateFns.add(fn); },
    kick() { if (wanted && !ws) { retry = 0; open(); } },
  };
})();
export const realtime = rt;

// renovar la sesión antes de que caduque (también si la pestaña estuvo dormida)
setInterval(() => { if (session && session.expires_at * 1000 < Date.now() + 5 * 60000) refresh(); }, 60000);
addEventListener('online', () => rt.kick());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (session && session.expires_at * 1000 < Date.now() + 5 * 60000) refresh(); rt.kick(); } });
