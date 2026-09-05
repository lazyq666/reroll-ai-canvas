const LUCIDE_VERSION = '1.16.0';
const LUCIDE_SCRIPT_URL = new URL('../../vendor/js/lucide.js', import.meta.url);

export const IC_ICON_NAMES = Object.freeze({
  add: 'Plus',
  account: 'CircleUserRound',
  app: 'Sparkles',
  'angle-control': 'Orbit',
  archive: 'Archive',
  zip: 'FileArchive',
  arrange: 'LayoutGrid',
  'aspect-ratio': 'Proportions',
  audio: 'FileAudio',
  'audio-lines': 'AudioLines',
  back: 'ArrowLeft',
  'book-text': 'BookText',
  canvas: 'Layers',
  check: 'Check',
  'circle-alert': 'CircleAlert',
  'circle-check-big': 'CircleCheckBig',
  close: 'X',
  collection: 'Layers3',
  cloud: 'Cloud',
  color: 'Palette',
  'collapse-editor': 'Minimize2',
  copy: 'Copy',
  'copy-image': 'ClipboardCopy',
  'create-copy': 'CopyPlus',
  cut: 'Scissors',
  cursor: 'MousePointer2',
  credits: 'WalletCards',
  delete: 'Trash2',
  device: 'Monitor',
  disconnect: 'Unplug',
  download: 'Download',
  duplicate: 'Copy',
  detect: 'Radar',
  'depth-map': 'Layers3',
  forward: 'ArrowRight',
  file: 'File',
  generate: 'Zap',
  drag: 'GripVertical',
  edit: 'Pencil',
  'edit-text': 'TextCursorInput',
  error: 'CircleAlert',
  expand: 'ChevronDown',
  'first-last-frames': 'PanelsLeftRight',
  fit: 'Maximize',
  'focus-editor': 'Maximize2',
  freehand: 'Paintbrush',
  pencil: 'Pencil',
  info: 'Info',
  frame: 'SquareDashed',
  group: 'Group',
  hand: 'Hand',
  help: 'Terminal',
  history: 'History',
  image: 'Image',
  'image-generate': 'ImagePlus',
  'image-fail': 'ImageOff',
  'extract-frame': 'ImageDown',
  'infinite-canvas': 'MousePointerSquareDashed',
  link: 'Link2',
  loading: 'Loader2',
  log: 'ListTodo',
  language: 'Languages',
  'layout-grid': 'Grid3X3',
  'layout-horizontal': 'Columns3',
  'layout-tree': 'Network',
  'layout-vertical': 'Rows3',
  layers: 'Layers',
  light: 'Sun',
  'lighting-reference': 'Sun',
  loop: 'Repeat2',
  'external-link': 'ExternalLink',
  lock: 'Lock',
  logout: 'LogOut',
  menu: 'Menu',
  more: 'Ellipsis',
  models: 'Boxes',
  'online-generate': 'Zap',
  'omni-reference': 'Atom',
  play: 'Play',
  pause: 'Pause',
  volume: 'Volume2',
  'volume-muted': 'VolumeX',
  people: 'Users',
  pointer: 'MousePointerClick',
  prompt: 'MessageSquareText',
  'prompt-library': 'NotebookTabs',
  paste: 'ClipboardPaste',
  preview: 'Eye',
  project: 'FolderOpen',
  'project-default': 'Folder',
  random: 'Dice5',
  rectangle: 'RectangleHorizontal',
  'rectangle-horizontal': 'RectangleHorizontal',
  refresh: 'RefreshCw',
  'remove-media': 'ImageMinus',
  replace: 'Replace',
  'reverse-prompt': 'ScanText',
  restore: 'RotateCcw',
  redo: 'Redo2',
  'reset-view': 'LocateFixed',
  save: 'Save',
  'save-prompt': 'BookmarkPlus',
  scan: 'ScanLine',
  search: 'Search',
  settings: 'Settings2',
  'set-cover': 'ImageUp',
  sparkles: 'Zap',
  split: 'Split',
  brush: 'Pencil',
  ellipse: 'Circle',
  circle: 'Circle',
  'number-label': 'Hash',
  keyboard: 'Keyboard',
  text: 'Type',
  'square-text': 'SquareText',
  'text-label': 'TextCursorInput',
  theme: 'Moon',
  success: 'CircleCheck',
  stop: 'Square',
  submit: 'ArrowUp',
  'switch-horizontal': 'ArrowLeftRight',
  upload: 'Upload',
  'choose-file': 'UploadCloud',
  ungroup: 'Ungroup',
  'ungroup-frame': 'PanelTopDashed',
  unlink: 'Link2Off',
  video: 'FileVideo',
  'video-generate': 'Clapperboard',
  warning: 'TriangleAlert',
  'triangle-alert': 'TriangleAlert',
  workflow: 'Workflow',
  'join-grid': 'Grid3X3',
  'workflow-library': 'PackageOpen',
  'zoom-in': 'ZoomIn',
  'zoom-out': 'ZoomOut',
});

const CUSTOM_ICON_PATHS = Object.freeze({
  'depth-map':[
    'M12 3L20 7L12 11L4 7L12 3Z',
    'M4 12L12 16L20 12',
    'M4 17L12 21L20 17',
  ],
  'number-label':[
    'M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z',
    'M9.5 10L12.5 8V16',
  ],
  'text-label':[
    'M4 20L12 4L20 20',
    'M6.6665 14.666H17.3332',
  ],
  'square-text':[
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'M7 8h8',
    'M7 12h10',
    'M7 16h6',
  ],
});

let lucidePromise;

export function loadLucide() {
  if (globalThis.lucide?.icons && globalThis.lucide?.createElement) {
    return Promise.resolve(globalThis.lucide);
  }
  if (lucidePromise) return lucidePromise;

  lucidePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-ic-ui-icon-engine="lucide"]');
    const script = existing || document.createElement('script');
    const loaded = () => {
      if (globalThis.lucide?.icons && globalThis.lucide?.createElement) resolve(globalThis.lucide);
      else reject(new Error('Lucide loaded without its icon interface'));
    };
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', () => reject(new Error('Unable to load the local Lucide icon engine')), { once: true });
    if (!existing) {
      script.src = LUCIDE_SCRIPT_URL.href;
      script.dataset.icUiIconEngine = 'lucide';
      document.head.append(script);
    }
  });
  return lucidePromise;
}

export class IcIcon extends HTMLElement {
  static observedAttributes = ['label', 'name', 'size'];
  static engine = Object.freeze({ name: 'lucide', version: LUCIDE_VERSION });

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ic-icon-size: var(--ui-density-icon-size, 1.25rem);
          --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-m, 1.5));
          inline-size: var(--ic-icon-size);
          block-size: var(--ic-icon-size);
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          color: inherit;
          line-height: 1;
          vertical-align: middle;
        }
        :host([size="x-small"]) { --ic-icon-size: var(--ui-icon-size-xs, .75rem); --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-xs, 1.33)); }
        :host([size="small"]) { --ic-icon-size: var(--ui-icon-size-s, 1rem); --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-s, 1.33)); }
        :host([size="medium"]) { --ic-icon-size: var(--ui-icon-size-m, 1.25rem); --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-m, 1.5)); }
        :host([size="large"]) { --ic-icon-size: var(--ui-icon-size-l, 1.5rem); --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-l, 2)); }
        :host([size="x-large"]) { --ic-icon-size: var(--ui-icon-size-xl, 3rem); --ic-icon-stroke-width: var(--ic-icon-context-stroke-width, var(--ui-icon-stroke-width-xl, 2.5)); }
        svg { width: 100%; height: 100%; display: block; stroke-width: var(--ic-icon-stroke-width); }
      </style>
      <span part="icon"></span>
    `;
    this.iconRoot = this.shadowRoot.querySelector('[part="icon"]');
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  get name() { return this.getAttribute('name') || ''; }
  set name(value) { this.setAttribute('name', value); }
  get size() { return this.getAttribute('size') || 'medium'; }
  set size(value) { this.setAttribute('size', value); }
  get label() { return this.getAttribute('label') || ''; }
  set label(value) {
    if (value) this.setAttribute('label', value);
    else this.removeAttribute('label');
  }

  async render() {
    const label = this.label.trim();
    if (label) {
      this.removeAttribute('aria-hidden');
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', label);
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.setAttribute('aria-hidden', 'true');
    }

    const semanticName = this.name.trim();
    const lucideName = IC_ICON_NAMES[semanticName];
    if (!lucideName) {
      this.iconRoot.replaceChildren();
      this.dataset.iconStatus = semanticName ? 'unsupported' : 'empty';
      return;
    }

    const customPaths = CUSTOM_ICON_PATHS[semanticName];
    if (customPaths) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('part', 'svg');
      customPaths.forEach(data => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', data);
        svg.append(path);
      });
      this.iconRoot.replaceChildren(svg);
      this.dataset.iconStatus = 'ready';
      return;
    }

    const lucide = await loadLucide();
    const icon = lucide.icons[lucideName];
    if (!icon || semanticName !== this.name.trim()) return;
    const svg = lucide.createElement(icon, {
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.setAttribute('part', 'svg');
    this.iconRoot.replaceChildren(svg);
    this.dataset.iconStatus = 'ready';
  }
}
