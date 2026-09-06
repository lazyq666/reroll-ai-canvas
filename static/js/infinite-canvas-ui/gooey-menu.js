// Native adaptation of liquid-gooey's silhouette / crisp-content split.
// Upstream MIT notice: static/vendor/libraries-motion/999866f/liquid-gooey.LICENSE.
let nextFilterId = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const GOOEY_MENU_STYLES = `
  :host([variant="reference-generate"]) [part="surface"] {
    width:152px; height:108px; min-width:0; max-width:calc(100vw - 24px); padding:0; border:0;
    background:transparent; box-shadow:none; backdrop-filter:none; overflow:visible;
    transform:none !important; transition:none; pointer-events:none;
  }
  :host([variant="reference-generate"]) .menu-content { position:relative; width:152px; height:108px; z-index:1; pointer-events:none; }
  :host([variant="reference-generate"]) ::slotted(ic-menu-item) { position:absolute; top:30px; }
  :host([variant="reference-generate"]) ::slotted(ic-menu-item[value="text"]) { left:0; }
  :host([variant="reference-generate"]) ::slotted(ic-menu-item[value="image"]) { left:54px; top:0; }
  :host([variant="reference-generate"]) ::slotted(ic-menu-item[value="video"]) { left:108px; }
  :host([variant="reference-generate"]) .quick-add-close { position:absolute; left:54px; top:64px; width:44px; height:44px; padding:0; display:grid; place-items:center; border:1px solid var(--ic-quick-add-border,var(--ui-color-border-secondary)); border-radius:50%; background:var(--ic-quick-add-background,var(--ui-color-surface-floating)); box-shadow:var(--ic-quick-add-shadow,var(--ui-shadow-raised)); color:inherit; cursor:pointer; pointer-events:auto; }
  .quick-add-close ic-icon { --ic-icon-size:20px; }
  .quick-add-close:hover { background:var(--ic-quick-add-background,var(--ui-color-action-tertiary-hover)); }
  .quick-add-close:focus-visible { outline:var(--ic-quick-add-focus-ring,var(--ui-focus-ring)); outline-offset:var(--ui-focus-ring-offset); }
  :host([data-fan-direction="down"]) ::slotted(ic-menu-item) { top:34px; }
  :host([data-fan-direction="down"]) ::slotted(ic-menu-item[value="image"]) { top:64px; }
  :host([data-fan-direction="down"]) .quick-add-close { top:0; }
  :host([variant="reference-generate"]) ::slotted(ic-menu-item) { flex:0 0 44px; width:44px; height:44px; pointer-events:auto; }
  :host([variant="reference-generate"]) ::slotted(.reference-generate-label) { display:none; }
  :host([variant="reference-generate"]) [data-liquid] { --ic-quick-add-background:transparent; --ic-quick-add-border:transparent; --ic-quick-add-shadow:none; }
  :host(:is([data-fan-direction="right"],[data-fan-direction="left"])) [part="surface"],
  :host(:is([data-fan-direction="right"],[data-fan-direction="left"])) .menu-content { width:108px; height:152px; }
  :host([data-fan-direction="right"]) ::slotted(ic-menu-item[value="text"]) { left:34px; top:0; }
  :host([data-fan-direction="right"]) ::slotted(ic-menu-item[value="image"]) { left:64px; top:54px; }
  :host([data-fan-direction="right"]) ::slotted(ic-menu-item[value="video"]) { left:34px; top:108px; }
  :host([data-fan-direction="right"]) .quick-add-close { left:0; top:54px; }
  :host([data-fan-direction="left"]) ::slotted(ic-menu-item[value="text"]) { left:30px; top:0; }
  :host([data-fan-direction="left"]) ::slotted(ic-menu-item[value="image"]) { left:0; top:54px; }
  :host([data-fan-direction="left"]) ::slotted(ic-menu-item[value="video"]) { left:30px; top:108px; }
  :host([data-fan-direction="left"]) .quick-add-close { left:64px; top:54px; }
  :host([variant="reference-generate"]) [data-gooey] { --ic-quick-add-focus-ring:none; }
  .gooey-silhouette { position:absolute; display:block; pointer-events:none; overflow:visible; }
  :host([variant="reference-generate"][data-motion-state="entering"]) [part="surface"] { opacity:0; }
  :host([variant="reference-generate"][data-motion-state="exiting"]) [part="surface"] { opacity:1; }
`;

// Match PlusMenu's timing curves, including its overshoot (do not clamp the result).
function bezier(x1, y1, x2, y2) {
  const sample = (t, a, b) => 3*(1-t)*(1-t)*t*a + 3*(1-t)*t*t*b + t*t*t;
  return value => {
    if (value <= 0 || value >= 1) return value;
    let low = 0, high = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (low+high)/2;
      if (sample(mid,x1,x2) < value) low = mid; else high = mid;
    }
    return sample((low+high)/2,y1,y2);
  };
}
const bouncy = bezier(.34,1.56,.64,1);
const snappy = bezier(.22,1,.36,1);

export function animateGooeyMenu(host, phase) {
  host._cancelGooey?.();
  const surface = host.surface;
  if (!surface || host.getAttribute('variant') !== 'reference-generate'
    || reducedMotion.matches || host.closest('[data-ui-motion="reduced"]') || document.hidden) return;
  const box = surface.getBoundingClientRect();
  const items = [...host.querySelectorAll('ic-menu-item')];
  if (!box.width || !box.height || !items.length) return;
  const fromPoint = Boolean(host._anchorPoint);
  const seedDuration = phase === 'enter' && fromPoint ? 120 : 0;
  const closeButton = surface.querySelector('.quick-add-close');
  const close = closeButton.getBoundingClientRect();
  const x = close.left - box.left + close.width/2;
  const y = close.top - box.top + close.height/2;
  const targets = items.map(item => { const r = item.getBoundingClientRect(); return {x:r.left-box.left+r.width/2,y:r.top-box.top+r.height/2,r:r.width/2}; });
  const icons = items.map(item => item.shadowRoot.querySelector('.icon'));
  const closeIcon = closeButton.querySelector('ic-icon');
  const styles = getComputedStyle(surface);
  const fill = styles.getPropertyValue('--ui-color-surface-floating').trim();
  const border = styles.getPropertyValue('--ui-color-border-secondary').trim();
  const pad = 48;
  const id = `ic-gooey-${++nextFilterId}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('gooey-silhouette');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${box.width + pad*2} ${box.height + pad*2}`);
  svg.style.cssText = `left:${-pad}px;top:${-pad}px;width:${box.width+pad*2}px;height:${box.height+pad*2}px;filter:drop-shadow(0 3px 6px rgb(0 0 0 / .13))`;
  // All circles share one alpha union. Paint the border on that union, never on
  // the native buttons: their independent outlines would cut through the neck.
  svg.innerHTML = `<defs><filter id="${id}" x="-35%" y="-50%" width="170%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/><feColorMatrix in="blur" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape"/><feMorphology in="goo" operator="erode" radius="1" result="inside"/><feComposite in="goo" in2="inside" operator="out" result="edge"/><feFlood result="border"/><feComposite in="border" in2="edge" operator="in" result="outline"/><feMerge><feMergeNode in="shape"/><feMergeNode in="outline"/></feMerge></filter></defs><g filter="url(#${id})">${items.map(() => '<circle/>').join('')}<circle class="origin"/></g>`;
  const silhouette = svg.querySelector('g');
  silhouette.setAttribute('fill', fill);
  svg.style.transformOrigin = `${pad+x}px ${pad+y}px`;
  svg.querySelector('feFlood').setAttribute('flood-color', border);
  const circles = [...svg.querySelectorAll('circle')];
  surface.prepend(svg);
  surface.dataset.liquid = '';
  surface.dataset.gooey = phase;
  items.forEach(item => item.shadowRoot.querySelector('ic-tooltip')?.hide());
  // Reference PlusMenu: 550ms bouncy / 40ms stagger; 250ms snappy close
  // with a 5px, 700ms anticipation on the whole liquid layer and main button.
  const duration = phase === 'enter' ? seedDuration + 550 + (items.length-1)*40 : 700;
  let frame = 0, start, resolve, completed = false;
  const finished = new Promise(done => { resolve = done; });
  const environment = new MutationObserver(() => cleanup());
  const clearContentMotion = () => {
    items.forEach(item => item.style.removeProperty('transform'));
    icons.forEach(icon => { icon?.style.removeProperty('opacity'); icon?.style.removeProperty('filter'); });
    closeButton.style.removeProperty('transform');
    closeIcon.style.removeProperty('transform');
  };
  const cleanup = () => {
    cancelAnimationFrame(frame); environment.disconnect();
    reducedMotion.removeEventListener('change', cleanup);
    document.removeEventListener('visibilitychange', cleanup);
    svg.remove(); clearContentMotion();
    delete surface.dataset.gooey; delete surface.dataset.liquid;
    if (host._cancelGooey === cleanup) host._cancelGooey = null;
    completed = true;
    resolve();
  };
  const settle = () => {
    completed = true;
    delete surface.dataset.gooey;
    clearContentMotion();
    // Keep the same silhouette at rest, with no RAF, to avoid a visual handoff.
    // Position, theme, visibility, close and disconnect still own its cleanup.
    if (phase === 'exit') { cleanup(); return; }
    const focused = items.find(item => item.shadowRoot.querySelector('button')?.matches(':focus-visible'));
    focused?.shadowRoot.querySelector('ic-tooltip')?.show();
    resolve();
  };
  host._cancelGooey = cleanup;
  environment.observe(document.documentElement, {attributes:true,attributeFilter:['data-ui-theme','data-ui-motion']});
  reducedMotion.addEventListener('change', cleanup);
  document.addEventListener('visibilitychange', cleanup);
  function draw(now) {
    if (completed) return;
    start ??= now;
    const elapsed = Math.max(0,now-start);
    // A point anchor has no existing button: grow from the retained line's
    // endpoint before separating full-size circles. Button anchors skip this.
    const seedProgress = seedDuration ? snappy(clamp(elapsed/seedDuration,0,1)) : 1;
    const seedScale = .08 + .92*seedProgress;
    const spreadElapsed = Math.max(0,elapsed-seedDuration);
    const nudgeTime = clamp(elapsed/700,0,1);
    const nudge = phase === 'enter' ? 0 : nudgeTime < .3
      ? 5*snappy(nudgeTime/.3) : 5*(1-snappy((nudgeTime-.3)/.7));
    svg.style.transform = `translateY(${nudge}px) scale(${seedScale})`;
    if (seedDuration) silhouette.setAttribute('fill', seedProgress < 1
      ? `color-mix(in srgb, ${styles.getPropertyValue('--ui-palette-blue-400').trim()} ${(1-seedProgress)*100}%, ${fill})` : fill);
    closeButton.style.transform = `translateY(${nudge}px) scale(${seedScale})`;
    closeIcon.style.transform = fromPoint ? 'none' : `rotate(${phase === 'enter' ? -45*(1-clamp(elapsed/250,0,1)) : -45*clamp(elapsed/250,0,1)}deg)`;
    targets.forEach((target,index) => {
      const progress = phase === 'enter'
        ? bouncy(clamp((spreadElapsed-index*40)/550,0,1))
        : 1-snappy(clamp(elapsed/250,0,1));
      const cx = x+(target.x-x)*progress, cy = y+(target.y-y)*progress;
      circles[index].setAttribute('cx', cx);
      circles[index].setAttribute('cy', cy);
      circles[index].setAttribute('r', target.r);
      items[index].style.transform = `translate(${cx-target.x}px,${cy-target.y+nudge}px)`;
      const opacity = phase === 'enter' ? clamp((spreadElapsed-120-index*40)/180,0,1) : 1-clamp(elapsed/180,0,1);
      if (icons[index]) {
        icons[index].style.opacity = String(opacity);
        icons[index].style.filter = `blur(${2*(1-opacity)}px)`;
      }
    });
    const originCircle = circles.at(-1);
    originCircle.setAttribute('cx', x); originCircle.setAttribute('cy', y);
    originCircle.setAttribute('r', close.width/2);
    if (elapsed < duration) frame = requestAnimationFrame(draw); else settle();
  }
  draw(performance.now());
  return finished;
}


export function positionGooeyMenu(host, anchor) {
  if (host.getAttribute('variant') !== 'reference-generate') return false;
  const x = anchor.left + anchor.width/2, y = anchor.top + anchor.height/2;
  const token = getComputedStyle(host).getPropertyValue('--ui-space-3').trim();
  const margin = parseFloat(token) * (token.endsWith('rem') ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1) || 12;
  const candidates = [
    {direction:'up',width:152,height:108,cx:76,cy:86},
    {direction:'down',width:152,height:108,cx:76,cy:22},
    {direction:'right',width:108,height:152,cx:22,cy:76},
    {direction:'left',width:108,height:152,cx:86,cy:76},
  ].map(candidate => ({...candidate,left:x-candidate.cx,top:y-candidate.cy}));
  const overflow = c => Math.max(0,margin-c.left) + Math.max(0,margin-c.top)
    + Math.max(0,c.left+c.width+margin-innerWidth) + Math.max(0,c.top+c.height+margin-innerHeight);
  const best = candidates.sort((a,b)=>overflow(a)-overflow(b))[0];
  host.dataset.fanDirection = best.direction;
  const hintSides = {
    up:{text:'inline-start',image:'block-start',video:'inline-end'},
    down:{text:'inline-start',image:'block-end',video:'inline-end'},
    right:{text:'block-start',image:'inline-end',video:'block-end'},
    left:{text:'block-start',image:'inline-start',video:'block-end'},
  }[best.direction];
  host.querySelectorAll('ic-menu-item').forEach(item => {
    const tooltip = item.shadowRoot?.querySelector('ic-tooltip');
    const side = hintSides[item.getAttribute('value')];
    if (tooltip && side && tooltip.getAttribute('placement') !== side) tooltip.setAttribute('placement', side);
  });
  host.surface.style.left = `${Math.round(clamp(best.left,margin,Math.max(margin,innerWidth-best.width-margin)))}px`;
  host.surface.style.top = `${Math.round(clamp(best.top,margin,Math.max(margin,innerHeight-best.height-margin)))}px`;
  host.surface.dataset.motionSide = {up:'top',down:'bottom',left:'left',right:'right'}[best.direction];
  return true;
}

export function syncGooeyInvoker(host, open) {
  const previous = host._gooeyInvoker;
  if (previous && (!open || host._anchorPoint || host.getAttribute('variant') !== 'reference-generate' || previous.element !== host._invoker)) {
    previous.element.setAttribute('icon', previous.icon);
    const key = previous.element.getAttribute('data-i18n-label');
    previous.element.setAttribute('label', key && window.StudioI18n ? window.StudioI18n.t(key) : previous.label);
    previous.element.removeEventListener('mousedown', previous.stopDrag, true);
    previous.element.removeEventListener('click', previous.close, true);
    host._gooeyInvoker = null;
  }
  if (!open || host._anchorPoint || host.getAttribute('variant') !== 'reference-generate' || host._invoker?.localName !== 'ic-icon-button') return;
  if (!host._gooeyInvoker) {
    const element = host._invoker;
    const stopDrag = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const close = event => { event.preventDefault(); event.stopImmediatePropagation(); host.hide('toggle'); };
    host._gooeyInvoker = {element,icon:element.getAttribute('icon'),label:element.getAttribute('label'),stopDrag,close};
    element.addEventListener('mousedown', stopDrag, true);
    element.addEventListener('click', close, true);
  }
  host._invoker.setAttribute('icon', 'close');
  host._invoker.setAttribute('label', host.getAttribute('close-label') || host.getAttribute('label'));
}
