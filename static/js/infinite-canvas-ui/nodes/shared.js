export const CANVAS_NODE_KINDS = Object.freeze([
  'image',
  'generation',
  'prompt',
  'prompt-generation',
  'splitter',
  'loop',
  'smart-group',
  'frame',
  'text-annotation',
  'brush-stroke',
]);
export const CANVAS_FRAME_DEFAULT_COLOR = 'slate';

const KIND_SET = new Set(CANVAS_NODE_KINDS);

const KIND_CLASSES = Object.freeze({
  image: [],
  generation: ['reference-generation-node'],
  prompt: ['prompt-smart-node'],
  'prompt-generation': ['prompt-smart-node', 'prompt-generation-smart-node'],
  splitter: ['splitter-smart-node'],
  loop: ['loop-smart-node'],
  'smart-group': ['smart-group-node'],
  frame: ['smart-frame-node'],
  'text-annotation': ['smart-annotation-node', 'smart-text-node'],
  'brush-stroke': ['smart-annotation-node', 'smart-brush-node'],
});

const STATE_CLASSES = Object.freeze({
  far: 'canvas-lod-node-far',
  detail: 'canvas-lod-node-detail',
  empty: 'empty-node',
  referenceGeneration: 'reference-generation-node',
  mediaGroup: 'group-node',
  history: 'history-group-node',
  compact: 'smart-group-member-node',
  selected: 'selected',
  dragging: 'dragging',
  running: 'node-running',
  pending: 'node-pending',
  failed: 'node-failed',
});

export const CANVAS_NODE_STATES = Object.freeze(Object.keys(STATE_CLASSES));

export function escapeCanvasNodeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function isCanvasNodeKind(kind) {
  return KIND_SET.has(String(kind || ''));
}

export function canvasNodeClasses(kind, states = {}) {
  if (!isCanvasNodeKind(kind)) throw new Error(`Unknown Canvas Node kind: ${kind}`);
  const classes = ['image-node', ...KIND_CLASSES[kind]];
  classes.push(states.far ? STATE_CLASSES.far : STATE_CLASSES.detail);
  Object.entries(STATE_CLASSES).forEach(([state, className]) => {
    if (state === 'far' || state === 'detail') return;
    if (states[state]) classes.push(className);
  });
  return classes.join(' ');
}

export function canvasNodeStateTokens(states = {}) {
  const tokens = [states.far ? 'far' : 'detail'];
  CANVAS_NODE_STATES.forEach(state => {
    if (state === 'far' || state === 'detail') return;
    if (states[state]) tokens.push(state);
  });
  return tokens;
}

function quickAddMarkup(control, port) {
  if (!control) return '';
  const side = port === 'in' ? 'in' : 'out';
  return `<div class="smart-node-quick-add-zone smart-node-quick-add-zone--${side}">${control}</div>`;
}

function standardQuickAddControl(port, options = {}) {
  const side = port === 'in' ? 'in' : 'out';
  const label = escapeCanvasNodeAttribute(options.label || (side === 'in' ? '添加上游输入' : '添加下游节点'));
  const menuId = escapeCanvasNodeAttribute(options.menuId || '');
  const controls = menuId ? ` aria-controls="${menuId}"` : '';
  const i18n = options.i18nLabel
    ? ` data-i18n-label="${escapeCanvasNodeAttribute(options.i18nLabel)}"`
    : '';
  return `<ic-icon-button class="smart-node-quick-add" type="button" size="m" hierarchy="quiet" icon="add" label="${label}"${i18n} tooltip-disabled data-port="${side}" data-node-quick-add aria-haspopup="menu"${controls} aria-expanded="false"></ic-icon-button>`;
}

function canvasNodeStandardControls(controls = {}) {
  const quickAdd = controls.quickAdd || {};
  return {
    resizeControl: controls.resizable
      ? '<div class="node-resize-handle" data-resize="1"><svg class="node-resize-handle-shape" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M1.5 16.5H2A13.5 13.5 0 0 0 16.5 2v-.5"></path></svg></div>'
      : '',
    quickAdd: {
      out: quickAdd.out ? standardQuickAddControl('out', quickAdd.out) : '',
      in: quickAdd.in ? standardQuickAddControl('in', quickAdd.in) : '',
    },
  };
}

export function renderCanvasNodeMarkup({
  id,
  kind,
  title = '',
  body = '',
  layout = {},
  position = {},
  states = {},
  frameColor = '',
  focusControl = '',
  runtimeStatus = '',
  annotationSelection = '',
  compactGrab = '',
  hint = '',
  controls = {},
} = {}) {
  if (!String(id || '').trim()) throw new Error('Canvas Node id is required');
  if (!isCanvasNodeKind(kind)) throw new Error(`Unknown Canvas Node kind: ${kind}`);
  const width = Math.max(1, Number(layout.width) || 1);
  const height = Math.max(1, Number(layout.height) || 1);
  const left = Number(position.x) || 0;
  const top = Number(position.y) || 0;
  const safeId = escapeCanvasNodeAttribute(id);
  const safeKind = escapeCanvasNodeAttribute(kind);
  const frameAttribute = kind === 'frame'
    ? ` data-frame-color="${escapeCanvasNodeAttribute(frameColor || CANVAS_FRAME_DEFAULT_COLOR)}"`
    : '';
  const head = states.far && (kind === 'frame' || kind === 'smart-group')
    ? ''
    : `<div class="node-head"><div class="node-title">${title}</div><div class="node-actions"></div></div>`;

  const stateTokens = canvasNodeStateTokens(states);
  const publicFrameAttribute = kind === 'frame'
    ? ` frame-color="${escapeCanvasNodeAttribute(frameColor || CANVAS_FRAME_DEFAULT_COLOR)}"`
    : '';
  const standardControls = canvasNodeStandardControls(controls);
  return `<ic-canvas-node class="${canvasNodeClasses(kind, states)}" kind="${safeKind}" state="${stateTokens.join(' ')}" data-id="${safeId}" aria-label="${escapeCanvasNodeAttribute(String(title).replace(/<[^>]*>/g, ''))}"${publicFrameAttribute}${frameAttribute} style="left:${left}px;top:${top}px;width:${width}px;height:${height}px">
    ${head}
    ${focusControl}
    ${runtimeStatus}
    <div class="node-body">${body}</div>
    ${annotationSelection}
    ${compactGrab}
    ${hint ? `<div class="node-hint">${hint}</div>` : ''}
    ${standardControls.resizeControl}
    ${quickAddMarkup(standardControls.quickAdd.out, 'out')}${quickAddMarkup(standardControls.quickAdd.in, 'in')}
  </ic-canvas-node>`;
}

export function renderReadOnlyPromptNodeBodyMarkup({
  content = '',
  generation = false,
  label = 'Read-only prompt',
  characterCountUnit = 'characters',
} = {}) {
  const text = String(content ?? '');
  const safeContent = escapeCanvasNodeAttribute(content);
  const safeLabel = escapeCanvasNodeAttribute(label);
  const cardClass = generation ? 'prompt-node-card prompt-node-composer' : 'prompt-node-card';
  const editorClass = generation
    ? 'prompt-node-control prompt-llm-instruction'
    : 'prompt-node-text prompt-node-control';
  const count = typeof Intl?.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity:'grapheme' }).segment(text)].length
    : [...text].length;
  const countLabel = `${count} ${String(characterCountUnit || '').trim()}`.trim();
  return `<div class="${cardClass}">
    <div class="prompt-editor-shell">
      <ic-prompt-composer class="${editorClass}" contenteditable="false" spellcheck="false" aria-label="${safeLabel}">${safeContent}</ic-prompt-composer>
      <span class="prompt-character-count" data-prompt-character-count>${escapeCanvasNodeAttribute(countLabel)}</span>
    </div>
  </div>`;
}
