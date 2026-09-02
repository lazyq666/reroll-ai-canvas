import { INFINITE_CANVAS_UI_SCROLLBAR } from './core.js?v=ic-ui-b0dd1bc6845c';

const status = document.querySelector('[data-scrollbar-status]');
const vertical = document.querySelector('[data-scrollbar-vertical]');
const horizontal = document.querySelector('[data-scrollbar-horizontal]');
const hidden = document.querySelector('[data-scrollbar-hidden]');
const shadowMount = document.querySelector('[data-scrollbar-shadow-mount]');
const shadowHost = document.createElement('div');
shadowHost.dataset.scrollbarShadowHost = '';

const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
shadowRoot.innerHTML = `
  <style>
    :host { display: block; color: var(--ui-color-text-primary); font-family: var(--ui-font-sans); }
    * { box-sizing: border-box; }
    [data-shadow-scroll] { height: 11rem; overflow-y: scroll; border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary); background: var(--ui-color-surface); }
    ol { display: grid; gap: var(--ui-space-2); margin: 0; padding: var(--ui-space-2); list-style: none; }
    li { min-height: 3rem; display: grid; align-content: center; gap: var(--ui-space-1); padding: var(--ui-space-2); border-radius: var(--ui-radius-s); background: var(--ui-color-surface-subtle); }
    strong { font-size: var(--ui-font-size-2); }
    span { color: var(--ui-color-text-tertiary); font-size: var(--ui-font-size-1); }
    [data-shadow-scroll]:focus-visible { outline: var(--ui-focus-ring); outline-offset: var(--ui-focus-ring-offset); }
  </style>
  <div data-shadow-scroll tabindex="0" aria-label="Shadow DOM 纵向滚动内容">
    <ol>
      <li><strong>Component shell</strong><span>开放 Shadow Root</span></li>
      <li><strong>Shared foundation</strong><span>由 Core 自动注入</span></li>
      <li><strong>Semantic color</strong><span>随 Light / Dark 切换</span></li>
      <li><strong>Native scrolling</strong><span>保留 Pointer 与 Keyboard</span></li>
      <li><strong>Late mount</strong><span>MutationObserver 自动发现</span></li>
    </ol>
  </div>
`;
const shadowScroll = shadowRoot.querySelector('[data-shadow-scroll]');
shadowMount.replaceChildren(shadowHost);

const targetForAction = Object.freeze({ vertical, horizontal, shadow: shadowScroll, hidden });
document.querySelectorAll('[data-scrollbar-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = targetForAction[button.dataset.scrollbarAction];
    const atEnd = target.scrollTop > 0 || target.scrollLeft > 0;
    target.scrollTo({
      top: atEnd ? 0 : target.scrollHeight,
      left: atEnd ? 0 : target.scrollWidth,
      behavior: 'smooth',
    });
    button.textContent = atEnd ? '滚动到末尾' : '回到起点';
  });
});

function pseudo(element, selector) {
  return getComputedStyle(element, selector);
}

await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const diagnostics = Object.freeze({
  contract: INFINITE_CANVAS_UI_SCROLLBAR,
  verticalWidth: pseudo(vertical, '::-webkit-scrollbar').width,
  horizontalHeight: pseudo(horizontal, '::-webkit-scrollbar').height,
  shadowWidth: pseudo(shadowScroll, '::-webkit-scrollbar').width,
  hiddenDisplay: pseudo(hidden, '::-webkit-scrollbar').display,
  verticalScrollable: vertical.scrollHeight > vertical.clientHeight,
  horizontalScrollable: horizontal.scrollWidth > horizontal.clientWidth,
  shadowScrollable: shadowScroll.scrollHeight > shadowScroll.clientHeight,
  hiddenScrollable: hidden.scrollHeight > hidden.clientHeight,
  shadowFoundationInstalled: shadowRoot.adoptedStyleSheets.length > 0
    || Boolean(shadowRoot.querySelector('[data-ic-scrollbar-foundation]')),
});

const ready = diagnostics.contract.size === '4px'
  && diagnostics.verticalWidth === '4px'
  && diagnostics.horizontalHeight === '4px'
  && diagnostics.shadowWidth === '4px'
  && diagnostics.hiddenDisplay === 'none'
  && diagnostics.verticalScrollable
  && diagnostics.horizontalScrollable
  && diagnostics.shadowScrollable
  && diagnostics.hiddenScrollable
  && diagnostics.shadowFoundationInstalled;

globalThis.__icScrollbarLibraryDiagnostics = diagnostics;
document.documentElement.dataset.scrollbarCaseStatus = ready ? 'ready' : 'failed';
status.textContent = ready ? '4 个真实情境已就绪' : '公共样式验证失败';
status.dataset.tone = ready ? 'success' : 'danger';
