// Acceso a Google Calendar (cuenta personal). Usa el mismo inicio de sesión que el Drive: un solo «Conectar Google» para todo PABE.
import { drive } from './drive.js';

const API = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
export const gcal = {
  get ready() { return drive.has('calendar'); },
  get configured() { return drive.configured; },
  onAuth(fn) { return drive.onAuth(() => fn(this.ready)); },
  hadSession() { return drive.hadSession(); },
  load() { return drive.load(); },
  signIn() { return drive.signIn().then(() => this.ready); },
  signOut() { drive.signOut(); },

  async req(path, opt = {}, retry = true) {
    if (!this.ready) await drive.ensure();
    if (!this.ready) throw Object.assign(new Error('auth'), { code: 'auth' });
    const r = await fetch(API + path, { cache: 'no-store', ...opt, headers: { ...(opt.headers || {}), Authorization: 'Bearer ' + drive.token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (r.status === 401) { if (retry) { await drive.ensure(true); if (this.ready) return this.req(path, opt, false); } drive.expire(); throw Object.assign(new Error('auth'), { code: 'auth' }); }
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
