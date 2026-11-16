// Acceso a Google Calendar (cuenta personal): mismo ID de cliente que el Drive, permiso propio de Calendar
import { CONFIG } from './config.js';

const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
let token = null, exp = 0, client = null, waiters = [];
const listeners = new Set();
try { const t = JSON.parse(sessionStorage.getItem('pabe:caltok') || 'null'); if (t && t.exp > Date.now() + 60000) { token = t.token; exp = t.exp; } } catch (e) {}

const enc = encodeURIComponent;
export const gcal = {
  get ready() { return !!token && exp > Date.now() + 30000; },
  get configured() { return !!CONFIG.clientId; },
  onAuth(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  hadSession() { try { return localStorage.getItem('pabe:calSession') === '1'; } catch (e) { return false; } },

  async load() {
    if (!CONFIG.clientId) return false;
    if (!window.google?.accounts?.oauth2) {
      await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
    }
    client = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId, scope: SCOPE, include_granted_scopes: true,
      callback: r => {
        const ok = !!(r && r.access_token && (r.scope || SCOPE).includes('calendar'));
        if (ok) {
          token = r.access_token; exp = Date.now() + (r.expires_in || 3600) * 1000;
          try { sessionStorage.setItem('pabe:caltok', JSON.stringify({ token, exp })); localStorage.setItem('pabe:calSession', '1'); } catch (e) {}
        }
        listeners.forEach(f => f(ok)); waiters.splice(0).forEach(w => w(ok));
      },
      error_callback: () => { waiters.splice(0).forEach(w => w(false)); listeners.forEach(f => f(false)); }
    });
    return true;
  },
  signIn(silent) {
    if (!client) return Promise.resolve(false);
    return new Promise(res => { waiters.push(res); client.requestAccessToken({ prompt: silent ? '' : 'consent' }); });
  },
  signOut() { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); token = null; exp = 0; try { sessionStorage.removeItem('pabe:caltok'); localStorage.removeItem('pabe:calSession'); } catch (e) {} listeners.forEach(f => f(false)); },

  async req(path, opt = {}, retry = true) {
    if (!this.ready) throw Object.assign(new Error('auth'), { code: 'auth' });
    const r = await fetch(API + path, { cache: 'no-store', ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (r.status === 401) { token = null; exp = 0; try { sessionStorage.removeItem('pabe:caltok'); } catch (e) {} listeners.forEach(f => f(false)); throw Object.assign(new Error('auth'), { code: 'auth' }); }
    if ((r.status === 429 || r.status >= 500) && retry) { await new Promise(s => setTimeout(s, 800 + Math.random() * 1200)); return this.req(path, opt, false); }
    if (!r.ok) { const body = await r.text().catch(() => ''); throw Object.assign(new Error('calendar ' + r.status), { code: r.status, body }); }
    return r.status === 204 ? null : r.json();
  },

  async calendars() { return (await this.req('/users/me/calendarList?maxResults=250')).items || []; },
  async addCalendar(id) { return this.req('/users/me/calendarList', { method: 'POST', body: JSON.stringify({ id }) }); },
  async events(calId, timeMin, timeMax) {
    const out = []; let pt = '';
    do {
      const j = await this.req(`/calendars/${enc(calId)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${enc(new Date(timeMin).toISOString())}&timeMax=${enc(new Date(timeMax).toISOString())}${pt ? '&pageToken=' + enc(pt) : ''}`);
      out.push(...(j.items || [])); pt = j.nextPageToken || '';
    } while (pt);
    return out;
  },
  insert(calId, body) { return this.req(`/calendars/${enc(calId)}/events`, { method: 'POST', body: JSON.stringify(body) }); },
  patch(calId, id, body) { return this.req(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body) }); },
  remove(calId, id) { return this.req(`/calendars/${enc(calId)}/events/${enc(id)}`, { method: 'DELETE' }); },
  move(calId, id, dest) { return this.req(`/calendars/${enc(calId)}/events/${enc(id)}/move?destination=${enc(dest)}`, { method: 'POST' }); },
};
