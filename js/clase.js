// Grabar clase / webconferencia: captura de audio (pestaña + micrófono en Chrome de ordenador), importación de grabaciones
// (iPad y móvil: grabación de pantalla, vídeo o audio), preparación del audio para Whisper y transcripción.
import { gcal } from './gcal.js';

export const WHISPER_MAX = 24.5e6;          // OpenAI acepta hasta 25 MB por petición
const RATE = 16000;                          // Whisper trabaja a 16 kHz mono
const CHUNK_S = 600;                         // trozos de 10 minutos (≈19 MB en WAV)
const WHISPER_OK = /\.(webm|m4a|mp4|mp3|mpeg|mpga|wav|ogg|oga|flac)$/i;
const norm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* ---------- qué puede hacer este dispositivo ---------- */
const touch = () => matchMedia('(pointer: coarse)').matches || /iPad|iPhone|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Grabar una pestaña con su audio solo funciona en Chrome/Edge de ordenador
export const canRecord = () => !!navigator.mediaDevices?.getDisplayMedia && !!window.MediaRecorder && !touch() && /Chrome|Edg\//.test(navigator.userAgent);
export function recMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  return (window.MediaRecorder && opts.find(m => MediaRecorder.isTypeSupported?.(m))) || '';
}
export const extOf = mime => /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';

/* ---------- grabar (ordenador, Chrome) ---------- */
// Pide la pestaña de la clase (con su audio) y el micrófono, los mezcla y graba solo el audio en Opus mono 24 kbps
// (una hora ≈ 11 MB: cabe entera en una petición a Whisper). Cada minuto deja una copia de seguridad (onBackup).
export async function startRecording({ onEnd, onWarn, onBackup } = {}) {
  const disp = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false
  });
  let mic = null;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { onWarn?.('Sin micrófono: solo se graba el audio de la pestaña.'); }
  if (!disp.getAudioTracks().length) {
    if (!mic) { disp.getTracks().forEach(t => t.stop()); throw Object.assign(new Error('sin-audio'), { code: 'sin-audio' }); }
    onWarn?.('La pestaña se compartió sin audio: solo se graba tu micrófono. Para el audio de la clase, vuelve a empezar y marca «Compartir también el audio de la pestaña».');
  }
  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination(); dest.channelCount = 1;
  const an = ctx.createAnalyser(); an.fftSize = 512;
  for (const s of [disp, mic]) if (s && s.getAudioTracks().length) { const src = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())); src.connect(dest); src.connect(an); }
  const mime = recMime(), rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 24000 });
  const parts = [], started = Date.now(); let lastBk = Date.now(), done;
  const finished = new Promise(r => { done = r; });
  rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data); if (onBackup && Date.now() - lastBk > 60000) { lastBk = Date.now(); onBackup(new Blob(parts, { type: mime }), started); } };
  rec.onstop = () => { disp.getTracks().forEach(t => t.stop()); mic?.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); const b = new Blob(parts, { type: rec.mimeType || mime }); done(b); onEnd?.(b, started); };
  // si dejas de compartir la pestaña desde Chrome, la grabación termina
  disp.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop(); }));
  disp.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop(); }));
  rec.start(10000);
  const buf = new Uint8Array(an.frequencyBinCount);
  return {
    started, mime,
    get secs() { return Math.round((Date.now() - started) / 1000); },
    level() { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; },
    stop() { if (rec.state !== 'inactive') rec.stop(); return finished; },
  };
}

/* ---------- preparar el audio para Whisper ---------- */
// Devuelve { save, saveName?, chunks:[{blob,name,offset}], duration }.
//  · Audio que ya cabe (≤ 24,5 MB, formato aceptado): se envía tal cual y se guarda el original.
//  · Si no (vídeo de grabación de pantalla, .mov, audios largos): se decodifica a 16 kHz mono y se parte en trozos WAV de 10 min;
//    a Drive va el audio extraído (WAV 16 kHz mono) en vez del vídeo.
//  · Si el archivo es demasiado grande para decodificarlo en este dispositivo, lanza { code: 'realtime' }.
export async function prepareAudio(file, onStep) {
  const name = file.name || 'grabacion.' + extOf(file.type || '');
  const isAudio = /^audio\//.test(file.type) || /\.(m4a|mp3|wav|webm|ogg|oga|flac|aac)$/i.test(name);
  if (file.size <= WHISPER_MAX && WHISPER_OK.test(name) && (isAudio || file.size <= 8e6)) {
    return { save: file, chunks: [{ blob: file, name, offset: 0 }], duration: await mediaDuration(file) };
  }
  const limit = touch() ? 380e6 : 1.6e9;
  if (file.size > limit) throw Object.assign(new Error('grande'), { code: 'realtime' });
  onStep?.('Extrayendo el audio…');
  let pcm;
  try { pcm = await decode16k(file); }
  catch (e) { console.warn('decodificar', e); throw Object.assign(new Error('decode'), { code: 'realtime' }); }
  const duration = pcm.length / RATE, chunks = [];
  for (let s = 0, k = 1; s < pcm.length; s += CHUNK_S * RATE, k++) chunks.push({ blob: wav(pcm.subarray(s, Math.min(pcm.length, s + CHUNK_S * RATE))), name: `parte-${k}.wav`, offset: s / RATE });
  // si el original es un audio, se guarda el original (más ligero); si es vídeo, el audio extraído
  const save = isAudio ? file : wav(pcm);
  return { save, saveExt: isAudio ? null : 'wav', chunks, duration };
}
async function decode16k(blob) {
  const ab = await blob.arrayBuffer();
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new AC(1, RATE, RATE);
  const buf = await new Promise((ok, ko) => { const p = ctx.decodeAudioData(ab, ok, ko); if (p?.then) p.then(ok, ko); });
  const n = buf.length, ch = buf.numberOfChannels, out = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
  if (buf.sampleRate === RATE) return out;
  const f = buf.sampleRate / RATE, m = Math.floor(n / f), r = new Float32Array(m); // por si el navegador no remuestrea
  for (let i = 0; i < m; i++) r[i] = out[Math.floor(i * f)];
  return r;
}
function wav(pcm) {
  const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0, o = 44; i < pcm.length; i++, o += 2) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([b], { type: 'audio/wav' });
}
export function mediaDuration(blob) {
  return new Promise(ok => {
    const a = document.createElement(/^video/.test(blob.type) ? 'video' : 'audio'), u = URL.createObjectURL(blob), end = d => { URL.revokeObjectURL(u); ok(d); };
    a.preload = 'metadata'; a.onloadedmetadata = () => { if (a.duration === Infinity) { a.currentTime = 1e7; a.ontimeupdate = () => { a.ontimeupdate = null; end(a.duration); }; } else end(a.duration || 0); };
    a.onerror = () => end(0); setTimeout(() => end(0), 8000); a.src = u;
  });
}

/* ---------- plan B: escuchar el vídeo en tiempo real (vídeos enormes en el iPad) ---------- */
// Reproduce el archivo en silencio y graba su audio comprimido. Tarda lo que dura la grabación.
// Hay que llamarlo directamente desde un toque (el navegador solo deja reproducir con sonido tras un gesto).
export function realtimeExtract(file, onProgress) {
  const el = document.createElement(/^video/.test(file.type) ? 'video' : 'audio');
  el.playsInline = true; el.preload = 'auto'; el.src = URL.createObjectURL(file);
  const ctx = new AudioContext(), src = ctx.createMediaElementSource(el), dest = ctx.createMediaStreamDestination(); dest.channelCount = 1; src.connect(dest);
  const playing = el.play(); ctx.resume();
  const mime = recMime(), rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 24000 }), parts = [];
  let stopFn;
  const p = new Promise((ok, ko) => {
    rec.ondataavailable = e => e.data?.size && parts.push(e.data);
    rec.onstop = () => { URL.revokeObjectURL(el.src); ctx.close().catch(() => {}); ok(new Blob(parts, { type: rec.mimeType || mime })); };
    el.onended = () => rec.state !== 'inactive' && rec.stop();
    el.ontimeupdate = () => onProgress?.(el.currentTime, el.duration);
    el.onerror = () => ko(new Error('no-se-puede-reproducir'));
    playing.then(() => rec.start(10000)).catch(ko);
    stopFn = () => { el.pause(); if (rec.state !== 'inactive') rec.stop(); };
  });
  p.cancel = () => stopFn?.();
  return p;
}

/* ---------- Whisper ---------- */
const PROMPT = 'Cours de français A1 en ligne. Le professeur parle français et explique parfois en espagnol. Bonjour à tous ! Aujourd\'hui on va voir le verbe être : je suis, tu es, il est. ¿Cómo se dice «mesa» en francés? On dit « la table ». D\'accord, très bien.';
export async function transcribe(chunks, key, onStep) {
  const segs = []; let tail = PROMPT, lang = '';
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onStep?.(chunks.length > 1 ? `Transcribiendo (${i + 1} de ${chunks.length})…` : 'Transcribiendo…');
    const j = await whisper(c.blob, c.name, key, tail);
    lang = lang || j.language || '';
    for (const s of j.segments || [{ start: 0, text: j.text || '' }]) { const t = String(s.text || '').trim(); if (t) segs.push({ t: c.offset + (s.start || 0), s: t }); }
    tail = (PROMPT.slice(0, 120) + ' ' + segs.slice(-6).map(s => s.s).join(' ')).slice(-800);
  }
  return { segments: segs, language: lang, text: segs.map(s => `[${clock(s.t)}] ${s.s}`).join('\n') };
}
async function whisper(blob, name, key, prompt, retry = true) {
  const fd = new FormData();
  fd.append('file', blob, name); fd.append('model', 'whisper-1'); fd.append('response_format', 'verbose_json'); fd.append('prompt', prompt); fd.append('temperature', '0');
  let r;
  try { r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd }); }
  catch (e) { if (retry) { await new Promise(s => setTimeout(s, 3000)); return whisper(blob, name, key, prompt, false); } throw Object.assign(new Error('red'), { code: 'red' }); }
  if ((r.status === 429 || r.status >= 500) && retry) { await new Promise(s => setTimeout(s, 4000)); return whisper(blob, name, key, prompt, false); }
  if (!r.ok) { const t = await r.text().catch(() => ''); let m = ''; try { m = JSON.parse(t).error?.message || ''; } catch (e) {} throw Object.assign(new Error('whisper ' + r.status), { code: r.status, msg: m }); }
  return r.json();
}
export const clock = t => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60, p = x => String(x).padStart(2, '0'); return (h ? h + ':' : '') + p(m) + ':' + p(s); };
export function whisperError(e) {
  if (e.code === 401) return 'La clave de OpenAI no es válida. Revísala en ⚙ del asistente.';
  if (e.code === 429) return 'OpenAI: sin saldo o demasiadas peticiones. Revisa el saldo en platform.openai.com y reintenta.';
  if (e.code === 413) return 'El audio es demasiado grande para Whisper.';
  if (e.code === 'red') return 'Sin conexión con OpenAI. Reintenta cuando tengas conexión.';
  return 'Whisper no pudo transcribir (' + (e.code || 'error') + ')' + (e.msg ? ': ' + e.msg : '.');
}

/* ---------- calendario «Français A1» ---------- */
// Busca el evento de la clase: el que se solapa con la grabación; si no, el más cercano de ese día.
export async function classEvents(day) {
  if (!gcal.ready) return { cal: null, events: [] };
  const cals = await gcal.calendars();
  const cal = cals.find(c => norm(c.summaryOverride || c.summary) === 'francais a1') || cals.find(c => /francais\s*a1/.test(norm(c.summaryOverride || c.summary)));
  if (!cal) return { cal: null, events: [] };
  const d0 = new Date(day + 'T00:00'), d1 = new Date(d0.getTime() + 864e5);
  const ev = (await gcal.events(cal.id, d0, d1)).filter(e => e.status !== 'cancelled');
  return { cal, events: ev };
}
export const evStart = e => new Date(e.start?.dateTime || e.start?.date + 'T00:00').getTime();
export const evEnd = e => new Date(e.end?.dateTime || e.end?.date + 'T00:00').getTime();
export function bestEvent(events, from, to) {
  if (!events.length) return null;
  const ov = e => Math.max(0, Math.min(to, evEnd(e)) - Math.max(from, evStart(e)));
  const withOv = events.filter(e => ov(e) > 0).sort((a, b) => ov(b) - ov(a));
  if (withOv.length) return withOv[0];
  return events.slice().sort((a, b) => Math.abs(evStart(a) - from) - Math.abs(evStart(b) - from))[0];
}
// Deja en el evento el enlace a la nota (en la descripción y como dato privado de PABE)
export async function linkEvent(cal, ev, noteId, url) {
  const desc = ev.description || '', line = 'Nota de la clase en PABE: ' + url;
  const description = desc.includes(url) ? desc : (desc ? desc + '\n\n' : '') + line;
  return gcal.patch(cal.id, ev.id, { description, extendedProperties: { private: { ...(ev.extendedProperties?.private || {}), pabeNota: noteId } } });
}
