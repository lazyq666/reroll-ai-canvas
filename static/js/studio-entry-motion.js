(() => {
  const STORAGE_KEY = 'studio_brand_entry_seen';
  const REVEAL_TO_DOCK_MS = 2400;
  const DOCK_TO_FINISH_MS = 1040;
  const MEDIA_WATCHDOG_MS = 6500;
  const REMOVE_AFTER_FADE_MS = 720;
  const LARGE_SCALE = 2.986;
  const root = document.getElementById('studioEntryMotion');
  const video = document.getElementById('studioEntryLogoMotion');
  if (!root || !video) return;

  let completed = false;
  let revealStarted = false;
  let mediaWatchdog = 0;
  const timers = new Set();
  const later = (callback, delay) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
    return timer;
  };

  function alreadySeen() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) { return false; }
  }

  function isReloadNavigation() {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    return navigation?.type === 'reload' || performance.navigation?.type === 1;
  }

  function rememberSeen() {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
  }

  function routeIsReady() {
    return !document.documentElement.classList.contains('studio-route-booting');
  }

  function afterRouteReady(callback) {
    if (routeIsReady()) {
      callback();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!routeIsReady()) return;
      observer.disconnect();
      callback();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  function finish() {
    if (completed) return;
    completed = true;
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
    rememberSeen();
    root.dataset.entryState = 'finished';
    window.dispatchEvent(new CustomEvent('studio-entry-motion-complete'));
    later(() => root.remove(), REMOVE_AFTER_FADE_MS);
  }

  function finishWhenReady() {
    afterRouteReady(finish);
  }

  function twoPaints() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function cancelLater(timer) {
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(timer);
  }

  async function resolveVideoToStaticMark() {
    cancelLater(mediaWatchdog);
    video.removeEventListener('error', mediaFailed);
    video.querySelector('source')?.removeEventListener('error', mediaFailed);
    root.classList.add('has-resolved-mark');
    video.pause();
    video.remove();
    await twoPaints();
  }

  function setTerminalGeometry(target) {
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const factor = rect.width / 112;
    const mark = 30.07 * factor;
    const gap = 8.14 * factor;
    const wordWidth = 73.68 * factor;
    const wordHeight = 22.69 * factor;
    const values = {
      '--entry-target-x': `${rect.left}px`,
      '--entry-target-y': `${rect.top}px`,
      '--entry-mark-size': `${mark}px`,
      '--entry-word-gap': `${gap}px`,
      '--entry-word-width': `${wordWidth}px`,
      '--entry-word-height': `${wordHeight}px`,
      '--entry-large-mark-size': `${mark * LARGE_SCALE}px`,
      '--entry-large-word-gap': `${gap * LARGE_SCALE}px`,
      '--entry-large-word-width': `${wordWidth * LARGE_SCALE}px`,
      '--entry-large-word-height': `${wordHeight * LARGE_SCALE}px`,
    };
    Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
    return true;
  }

  async function prepareDesktopTarget() {
    if (!matchMedia('(min-width: 721px)').matches) return;
    window.dispatchEvent(new CustomEvent('studio-entry-motion-dock'));
    await twoPaints();
    const target = document.querySelector('.sidebar-logo-image.sidebar-logo-wordmark');
    if (target) setTerminalGeometry(target);
  }

  async function reveal({ fast = false } = {}) {
    if (revealStarted || completed) return;
    revealStarted = true;
    await resolveVideoToStaticMark();
    await prepareDesktopTarget();
    root.dataset.entryState = 'wordmark';
    later(() => {
      root.dataset.entryState = 'docked';
      later(finishWhenReady, fast ? 360 : DOCK_TO_FINISH_MS);
    }, fast ? 180 : REVEAL_TO_DOCK_MS);
  }

  function mediaFailed() {
    root.classList.add('has-media-error');
    reveal({ fast: true });
  }

  function showReducedMotion() {
    root.dataset.entryState = 'reduced';
    later(finishWhenReady, 220);
  }

  if (isReloadNavigation() || alreadySeen()) {
    root.remove();
    return;
  }

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showReducedMotion();
    return;
  }

  video.addEventListener('ended', () => reveal(), { once: true });
  video.addEventListener('error', mediaFailed, { once: true });
  video.querySelector('source')?.addEventListener('error', mediaFailed, { once: true });
  mediaWatchdog = later(mediaFailed, MEDIA_WATCHDOG_MS);
  const playback = video.play();
  if (playback?.catch) playback.catch(mediaFailed);
})();
