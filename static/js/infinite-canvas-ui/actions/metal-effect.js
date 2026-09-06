// Native adapter for the pinned Metal renderer. The semantic button is always present.
const effects = new WeakMap();
let enginePromise;
const glowEntries = new WeakMap();

function loadEngine() {
  return enginePromise ||= import('../../../vendor/libraries-motion/999866f/metal.js').then(engine => {
    engine.setGlowCallback((instance, now) => {
      const entry = glowEntries.get(instance);
      if (entry?.glow) engine.updateGlow(entry.glow, instance, now, 0.75, entry.theme);
    });
    return engine;
  });
}

export function disconnectMetalEffect(host) {
  const effect = effects.get(host);
  if (!effect) return;
  effects.delete(host);
  effect.resize.disconnect();
  effect.intersection.disconnect();
  effect.environment.disconnect();
  effect.motion.removeEventListener('change', effect.sync);
  document.removeEventListener('visibilitychange', effect.sync);
  if (effect.instance) effect.engine.destroyInstance(effect.instance);
  effect.layer.remove();
  effect.style.remove();
  delete host.dataset.metalState;
}

export function syncMetalEffect(host) {
  if (host.effect !== 'metal' || !host.isConnected) {
    disconnectMetalEffect(host);
    return;
  }
  if (effects.has(host)) { effects.get(host).sync(); return; }
  const layer = document.createElement('span');
  layer.className = 'ic-metal-effect';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<canvas></canvas><span class="ic-metal-glow"></span>';
  const style = document.createElement('style');
  style.textContent = `
    :host([effect="metal"]) { position:relative; overflow:visible; }
    .ic-metal-effect { position:absolute; inset:0; pointer-events:none; border-radius:50%; overflow:hidden; clip-path:circle(50% at 50% 50%); z-index:1; }
    :host([effect="metal"]) [part~="base"] { position:relative; }
    .ic-metal-effect[hidden] { display:none; }
    .ic-metal-effect canvas { position:absolute; inset:0; width:100%; height:100%; border-radius:50%; pointer-events:none; }
    .ic-metal-glow { position:absolute; inset:0; pointer-events:none; }
  `;
  host.shadowRoot.append(style);
  host.shadowRoot.querySelector('[part~="base"]').append(layer);
  const effect = {
    layer, style, instance:null, engine:null, glow:null, visible:false, failed:false,
    motion:matchMedia('(prefers-reduced-motion: reduce)'), theme:'light',
  };
  effect.sync = () => {
    const reduced = effect.motion.matches || Boolean(host.closest('[data-ui-motion="reduced"]'));
    const active = !reduced && !host.disabled && !host.loading && effect.visible && !document.hidden;
    layer.hidden = reduced || host.disabled || host.loading || effect.failed;
    host.dataset.metalState = effect.failed ? 'fallback' : reduced ? 'static' : active ? 'running' : 'paused';
    if (!effect.engine || effect.failed) return;
    try {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      const theme = document.documentElement.dataset.uiTheme === 'dark' ? 'dark' : 'light';
      if (!effect.instance) {
        if (!active) return;
        effect.engine.setSharedPreset('chromatic', theme);
        effect.instance = effect.engine.createInstance({hostCanvas:layer.querySelector('canvas'),
          cssWidth:width, cssHeight:height, cornerRadius:Math.min(width,height)/2,
          kind:'circle', ringCssPx:2, opacityMul:0.9});
        glowEntries.set(effect.instance, effect);
        effect.engine.registerGlowInstance(effect.instance);
      }
      if (theme !== effect.theme) effect.engine.setSharedPreset('chromatic', theme);
      effect.theme = theme;
      effect.engine.setInstanceVisible(effect.instance, active);
      effect.engine.updateInstance(effect.instance, {paused:!active, cssWidth:width, cssHeight:height, cornerRadius:Math.min(width,height)/2});
      if (!effect.glow || effect.glow.width !== width || effect.glow.height !== height) {
        const container = layer.querySelector('.ic-metal-glow');
        container.replaceChildren();
        effect.glow = effect.engine.injectGlow(container, {width,height,cornerRadius:Math.min(width,height)/2,kind:'circle'});
      }
    } catch {
      // Unsupported / denied WebGL2 must never break submission or focus.
      if (effect.instance) effect.engine.destroyInstance(effect.instance);
      effect.instance = null;
      effect.failed = true;
      layer.hidden = true;
      host.dataset.metalState = 'fallback';
    }
  };
  effect.resize = new ResizeObserver(effect.sync);
  effect.intersection = new IntersectionObserver(entries => {
    effect.visible = entries.some(entry => entry.isIntersecting);
    effect.sync();
  });
  effect.environment = new MutationObserver(effect.sync);
  effects.set(host, effect);
  effect.resize.observe(host);
  effect.intersection.observe(host);
  effect.environment.observe(document.documentElement, {attributes:true, attributeFilter:['data-ui-theme','data-ui-motion']});
  effect.motion.addEventListener('change', effect.sync);
  document.addEventListener('visibilitychange', effect.sync);
  effect.sync();
  loadEngine().then(engine => {
    if (effects.get(host) !== effect) return;
    effect.engine = engine;
    effect.sync();
  }).catch(() => {
    if (effects.get(host) !== effect) return;
    effect.failed = true;
    effect.sync();
  });
}
