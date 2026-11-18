// PABE OS — utilidades de interfaz comunes a todos los módulos

// Clic normal: se queda en esta pestaña. Con Ctrl/⌘/Mayús o clic central, el navegador abre otra pestaña o ventana.
export const plainClick = e => !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || (e.button || 0) > 0);

// Ventanitas emergentes (etiquetas, menús): siempre dentro de la parte visible de la pantalla,
// también cuando el teclado del móvil o del iPad ocupa la mitad de abajo.
// Se recolocan solas al abrirse/cerrarse el teclado; se desenganchan al cerrarse la ventanita.
export function fitPop(pop, anchor, { gap = 6, focusBottom = false } = {}) {
  const vv = window.visualViewport;
  const place = () => {
    if (!pop.isConnected || pop.hidden) return off();
    const top0 = vv ? vv.offsetTop : 0, h0 = vv ? vv.height : innerHeight, left0 = vv ? vv.offsetLeft : 0, w0 = vv ? vv.width : innerWidth;
    pop.style.maxHeight = ''; const cssMax = parseFloat(getComputedStyle(pop).maxHeight) || Infinity;
    pop.style.maxHeight = Math.min(cssMax, Math.max(140, h0 - 16)) + 'px'; pop.style.overflowY = 'auto';
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let top = r.bottom + gap;
    if (top + h > top0 + h0 - 8) top = r.top - h - gap >= top0 + 8 ? r.top - h - gap : top0 + h0 - h - 8;
    top = Math.max(top0 + 8, Math.min(top, top0 + h0 - h - 8));
    pop.style.top = top + 'px';
    pop.style.left = Math.max(left0 + 8, Math.min(r.left, left0 + w0 - w - 8)) + 'px';
    // lo que se está escribiendo (y el botón de crear) a la vista
    const f = document.activeElement;
    if (focusBottom && pop.contains(f)) pop.scrollTop = pop.scrollHeight;
    else if (pop.contains(f)) f.scrollIntoView?.({ block: 'nearest' });
  };
  const off = () => { vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place); removeEventListener('resize', place); clearInterval(t); };
  vv?.addEventListener('resize', place); vv?.addEventListener('scroll', place); addEventListener('resize', place);
  const t = setInterval(() => { if (!pop.isConnected || pop.hidden) off(); }, 1000);
  place(); requestAnimationFrame(place); setTimeout(place, 350);
  return place;
}
