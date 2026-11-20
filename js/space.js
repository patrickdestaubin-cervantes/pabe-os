// PABE para varias personas: quién eres y qué compartes.
// · El dueño (Patrick) decide quién entra (tabla «members» de la nube) y qué módulos comparte con cada uno (p. ej. Finanzas con Berna).
// · Cada persona tiene sus notas, su calendario y su Drive; lo compartido vive en la cuenta del dueño y lo editan los dos.
import { supa } from './supa.js';
import { kv } from './store.js';

export const OWNER_EMAIL = 'patrick.destaubin@gmail.com';
export const space = {
  loaded: false, me: '', uid: '', mine: [], members: [],
  get isOwner() { return this.me === OWNER_EMAIL; },
  get allowed() { return this.isOwner || this.mine.length > 0; },
  // dueño (uid) del módulo compartido «col» que estoy usando, o null si es mío
  ownerFor(col) { const m = this.mine.find(r => (r.cols || []).includes(col)); return m ? m.owner : null; },
  finFolder() { return this.mine.find(r => (r.cols || []).includes('finanzas'))?.fin_folder || null; },
  // personas con las que puedo compartir una nota
  partners() { const s = new Set(); this.members.forEach(m => s.add(m.email.toLowerCase())); this.mine.forEach(m => s.add(m.owner_email.toLowerCase())); s.delete(this.me); return [...s]; },
  async load() {
    if (!supa.signedIn) return this;
    this.me = (supa.user?.email || '').toLowerCase(); this.uid = supa.user?.id || '';
    try {
      const rows = (await supa.rest('/members?select=*')) || [];
      this.mine = rows.filter(r => r.email.toLowerCase() === this.me);
      this.members = rows.filter(r => r.owner === this.uid);
      await kv.set('space', { mine: this.mine, members: this.members, me: this.me, uid: this.uid });
    } catch (e) { const c = await kv.get('space'); if (c && c.uid === this.uid) { this.mine = c.mine; this.members = c.members; } }
    this.loaded = true; return this;
  },
};
