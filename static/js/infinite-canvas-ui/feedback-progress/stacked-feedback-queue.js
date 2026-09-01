const STACK_STATE_ATTRIBUTE = 'data-ic-stack-state';

function ownerWindow(element) {
  return element.ownerDocument?.defaultView || window;
}

function reducedMotion(element) {
  const document = element.ownerDocument;
  const view = ownerWindow(element);
  return document?.documentElement?.dataset.uiMotion === 'reduced'
    || view.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function validateOptions({ edge, visibleCount, stackStepPx, scaleStep, exitDuration }) {
  if (!['start', 'end'].includes(edge)) throw new TypeError('feedback stack edge must be start or end');
  if (!Number.isInteger(visibleCount) || visibleCount < 1) throw new TypeError('feedback stack visibleCount must be a positive integer');
  if (!Number.isFinite(stackStepPx) || stackStepPx < 0) throw new TypeError('feedback stack stackStepPx must be non-negative');
  if (!Number.isFinite(scaleStep) || scaleStep < 0 || scaleStep >= 1) throw new TypeError('feedback stack scaleStep must be between 0 and 1');
  if (!Number.isFinite(exitDuration) || exitDuration < 0) throw new TypeError('feedback stack exitDuration must be non-negative');
}

export function createStackedFeedbackQueue({
  edge,
  visibleCount = 3,
  stackStepPx,
  scaleStep,
  exitDuration,
  exposeVisibleStack = false,
  setPresented = (element, visible) => { element.hidden = !visible; },
  onChange = () => {},
}) {
  validateOptions({ edge, visibleCount, stackStepPx, scaleStep, exitDuration });
  let items = [];
  const generations = new WeakMap();
  const stackSign = edge === 'start' ? 1 : -1;
  const motionSign = edge === 'start' ? -1 : 1;

  function advanceGeneration(element) {
    const generation = (generations.get(element) || 0) + 1;
    generations.set(element, generation);
    return generation;
  }

  function activeItems() {
    items = items.filter(element => element.isConnected && element.getAttribute(STACK_STATE_ATTRIBUTE) !== 'exiting');
    return items;
  }

  function sync() {
    const active = activeItems();
    active.forEach((element, index) => {
      const visible = index < visibleCount;
      const visibleIndex = Math.min(index, visibleCount - 1);
      element.dataset.icStackIndex = String(index);
      element.toggleAttribute('data-ic-stack-hidden', !visible);
      element.style.setProperty('--ic-stack-offset', `${stackSign * visibleIndex * stackStepPx}px`);
      element.style.setProperty('--ic-stack-scale', String(1 - visibleIndex * scaleStep));
      element.style.setProperty('--ic-stack-z', String(visibleCount - visibleIndex));
      element.style.setProperty('--ic-stack-motion-offset', `${motionSign * 100}%`);
      element.setAttribute('aria-hidden', visible && (exposeVisibleStack || index === 0) ? 'false' : 'true');
      setPresented(element, visible);
    });
    onChange({ items: active, visible: active.slice(0, visibleCount) });
    return active;
  }

  function enqueue(element, { animate = true } = {}) {
    advanceGeneration(element);
    items = [element, ...items.filter(item => item !== element)];
    element.setAttribute(STACK_STATE_ATTRIBUTE, animate ? 'entering' : 'active');
    sync();
    if (animate) {
      const view = ownerWindow(element);
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (element.isConnected && element.getAttribute(STACK_STATE_ATTRIBUTE) === 'entering') {
          element.setAttribute(STACK_STATE_ATTRIBUTE, 'active');
        }
      };
      element.getBoundingClientRect();
      view.queueMicrotask(settle);
      view.requestAnimationFrame(() => view.requestAnimationFrame(settle));
      view.setTimeout(settle, 50);
    }
    return element;
  }

  function dismiss(element) {
    if (!element?.isConnected || element.getAttribute(STACK_STATE_ATTRIBUTE) === 'exiting') {
      return Promise.resolve(false);
    }
    items = items.filter(item => item !== element);
    const generation = advanceGeneration(element);
    element.setAttribute(STACK_STATE_ATTRIBUTE, 'exiting');
    element.removeAttribute('data-ic-stack-hidden');
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('--ic-stack-z', '1000');
    sync();

    return new Promise(resolve => {
      const view = ownerWindow(element);
      const duration = reducedMotion(element) ? 1 : exitDuration;
      let timer = 0;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        view.clearTimeout(timer);
        element.removeEventListener('transitionend', handleTransitionEnd);
        if (generations.get(element) !== generation || element.getAttribute(STACK_STATE_ATTRIBUTE) !== 'exiting') {
          resolve(false);
          return;
        }
        setPresented(element, false);
        element.remove();
        resolve(true);
      };
      const handleTransitionEnd = event => {
        if (event.target === element && event.propertyName === 'transform') finish();
      };
      element.addEventListener('transitionend', handleTransitionEnd);
      timer = view.setTimeout(finish, duration + (duration > 1 ? 40 : 0));
    });
  }

  function disconnect(element) {
    advanceGeneration(element);
    items = items.filter(item => item !== element);
    sync();
  }

  return Object.freeze({ enqueue, dismiss, disconnect, sync });
}
