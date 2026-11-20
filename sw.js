// PABE OS — con conexión usa siempre la última versión; sin conexión, la copia guardada
const C = 'pabe-v49';
const SHELL = ['./', 'index.html', 'css/pabe.css', 'css/calendario.css', 'js/app.js', 'js/ui.js', 'js/config.js', 'js/drive.js', 'js/supa.js', 'js/store.js', 'js/tabla.js', 'js/hoja.js', 'js/agente.js', 'js/modules/notas.js', 'js/modules/finanzas.js', 'js/modules/calendario.js', 'js/modules/dia.js', 'js/mano.js', 'js/gcal.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) caches.open(C).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
