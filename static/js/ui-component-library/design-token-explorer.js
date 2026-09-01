(() => {
  const SOURCE_URL = '/static/css/design-tokens.css';
  const WORKBENCH_URL = '/api/admin/design-tokens';
  const tokenNameCollator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base',
  });
  const categories = Object.freeze([
    { id: 'all', label: '全部' },
    { id: 'semantic-color', label: '语义颜色' },
    { id: 'palette', label: '原子色板' },
    { id: 'typography', label: '文字排版' },
    { id: 'spacing', label: '间距' },
    { id: 'shape', label: '形状层次' },
    { id: 'sizing', label: '控件尺寸' },
    { id: 'focus', label: '焦点' },
    { id: 'motion', label: '动效' },
  ]);
  const semanticColorFamilyPrefix = family => `--ui-color-${family}`;
  const familyDefinitions = Object.freeze({
    'semantic-color': [
      { id: 'action', label: 'Action', prefixes: [semanticColorFamilyPrefix('action-')] },
      { id: 'border', label: 'Border', prefixes: [semanticColorFamilyPrefix('border-')] },
      { id: 'surface', label: 'Surface', prefixes: [semanticColorFamilyPrefix('surface')] },
      { id: 'text', label: 'Text', prefixes: [semanticColorFamilyPrefix('text-')] },
      { id: 'icon', label: 'Icon', prefixes: [semanticColorFamilyPrefix('icon-')] },
      { id: 'backdrop', label: 'Backdrop', prefixes: [semanticColorFamilyPrefix('backdrop')] },
      { id: 'mask', label: 'Mask', prefixes: [semanticColorFamilyPrefix('mask')] },
      { id: 'prompt-template-placeholder', label: 'Prompt Template Placeholder', prefixes: [semanticColorFamilyPrefix('prompt-template-placeholder-')] },
    ],
    palette: [
      { id: 'gray', label: 'Gray', prefixes: ['--ui-palette-gray-'] },
      { id: 'blue', label: 'Blue', prefixes: ['--ui-palette-blue-'] },
      { id: 'green', label: 'Green', prefixes: ['--ui-palette-green-'] },
      { id: 'amber', label: 'Amber', prefixes: ['--ui-palette-amber-'] },
      { id: 'red', label: 'Red', prefixes: ['--ui-palette-red-'] },
      { id: 'transparent', label: 'Transparent', prefixes: ['--ui-palette-transparent'] },
      { id: 'brand', label: 'Brand', prefixes: ['--ui-palette-brand'] },
    ],
    typography: [
      { id: 'text-style', label: 'Text Style', prefixes: ['--ui-text-'] },
      { id: 'font', label: 'Font', exact: ['--ui-font-sans', '--ui-font-display', '--ui-font-mono'] },
      { id: 'font-size', label: 'Font Size', prefixes: ['--ui-font-size-'] },
      { id: 'font-weight', label: 'Font Weight', prefixes: ['--ui-font-weight-'] },
      { id: 'line-height', label: 'Line Height', prefixes: ['--ui-line-height-'] },
      { id: 'letter-spacing', label: 'Letter Spacing', prefixes: ['--ui-letter-spacing-'] },
    ],
    spacing: [
      { id: 'space', label: 'Space', prefixes: ['--ui-space-'] },
    ],
    shape: [
      { id: 'radius', label: 'Radius', prefixes: ['--ui-radius-'] },
      { id: 'border-width', label: 'Border Width', prefixes: ['--ui-border-width-'] },
      { id: 'shadow', label: 'Shadow', prefixes: ['--ui-shadow-'] },
      { id: 'z-index', label: 'Z Index', prefixes: ['--ui-z-'] },
    ],
    sizing: [
      { id: 'control-height', label: 'Control Height', prefixes: ['--ui-control-height-'] },
      { id: 'icon-size', label: 'Icon Size', prefixes: ['--ui-icon-size-'] },
      { id: 'icon-stroke-width', label: 'Icon Stroke Width', prefixes: ['--ui-icon-stroke-width'] },
      { id: 'density', label: 'Density', prefixes: ['--ui-density-'] },
    ],
    focus: [
      { id: 'ring', label: 'Focus Ring', prefixes: ['--ui-focus-ring'] },
      { id: 'background', label: 'Focus Background', prefixes: ['--ui-focus-background'] },
    ],
    motion: [
      { id: 'duration', label: 'Duration', prefixes: ['--ui-motion-duration-'] },
      { id: 'easing', label: 'Easing', prefixes: ['--ui-motion-ease-'] },
      { id: 'distance', label: 'Distance', prefixes: ['--ui-motion-distance-'] },
      { id: 'iteration', label: 'Iteration', prefixes: ['--ui-motion-iteration-'] },
    ],
  });
  const tokenStateSuffixes = Object.freeze([
    { suffix: '-selected-hover', rank: 3 },
    { suffix: '-hover', rank: 1 },
    { suffix: '-selected', rank: 2 },
    { suffix: '-disabled', rank: 4 },
  ]);
  const tokenFamilyOrder = new Map([
    '--ui-shadow-none',
    '--ui-shadow-raised',
    '--ui-shadow-overlay',
    '--ui-shadow-modal',
  ].map((name, rank) => [name, rank]));

  const grid = document.querySelector('[data-token-grid]');
  const results = document.querySelector('.token-results');
  const searchInput = document.querySelector('[data-token-search]');
  const filters = document.querySelector('[data-token-filters]');
  const resultsTitle = document.querySelector('[data-results-title]');
  const resultsCount = document.querySelector('[data-results-count]');
  const emptyState = document.querySelector('[data-token-empty]');
  const semanticGuide = document.querySelector('[data-semantic-color-guide]');
  const typographyGuide = document.querySelector('[data-typography-guide]');
  const toast = document.querySelector('[data-copy-toast]');
  const probe = document.querySelector('[data-token-probe]');
  const editToggle = document.querySelector('[data-token-edit-toggle]');
  const changeBar = document.querySelector('[data-token-change-bar]');
  const changeCount = document.querySelector('[data-token-change-count]');
  const validationStatus = document.querySelector('[data-token-validation-status]');
  const discardButton = document.querySelector('[data-token-discard]');
  const reviewButton = document.querySelector('[data-token-review]');
  const diffDialog = document.querySelector('[data-token-diff-dialog]');
  const diffList = document.querySelector('[data-token-diff-list]');
  const saveButton = document.querySelector('[data-token-save]');

  let tokens = [];
  let visibleTokens = [];
  let activeCategory = 'all';
  let activeFamily = '';
  let toastTimer = 0;
  let editMode = false;
  let revision = '';
  let editableByName = new Map();
  let paletteTokens = [];
  const changes = new Map();
  const validationErrors = new Map();

  const liveSource = document.createElement('style');
  liveSource.setAttribute('data-live-token-source', '');
  document.head.append(liveSource);
  const liveOverrides = document.createElement('style');
  liveOverrides.setAttribute('data-live-token-overrides', '');
  document.head.append(liveOverrides);

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function categoryFor(name) {
    if (name.startsWith('--ui-color-')) return 'semantic-color';
    if (name.startsWith('--ui-palette-')) return 'palette';
    if (/^--ui-(?:font|text|line-height|letter-spacing)-/.test(name)) return 'typography';
    if (name.startsWith('--ui-space-')) return 'spacing';
    if (/^--ui-(?:radius|border-width|shadow|z)-/.test(name)) return 'shape';
    if (/^--ui-(?:control-height|icon|density)-/.test(name)) return 'sizing';
    if (name.startsWith('--ui-focus-')) return 'focus';
    if (name.startsWith('--ui-motion-')) return 'motion';
    return 'shape';
  }

  function parseTokens(cssText) {
    const found = new Map();
    const declaration = /^[\t ]*(--[\w-]+)\s*:\s*([\s\S]*?);[\t ]*(?:\/\*[\t ]*([^\n]*?)[\t ]*\*\/)?/gm;
    for (const match of cssText.matchAll(declaration)) {
      const name = match[1];
      const rawValue = match[2].replace(/\s+/g, ' ').trim();
      const description = (match[3] || '').replace(/\s+/g, ' ').trim();
      if (!found.has(name)) {
        found.set(name, { name, rawValue, description, category: categoryFor(name), definitions: 1 });
      } else {
        found.get(name).definitions += 1;
      }
    }
    return [...found.values()].sort((a, b) => tokenNameCollator.compare(a.name, b.name));
  }

  function humanizeFamily(value) {
    return value.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  function familyFor(token) {
    const definitions = familyDefinitions[token.category] || [];
    const matchedIndex = definitions.findIndex(definition =>
      definition.exact?.includes(token.name)
      || definition.prefixes?.some(prefix => token.name.startsWith(prefix)));
    if (matchedIndex >= 0) {
      const definition = definitions[matchedIndex];
      return { ...definition, category: token.category, order: matchedIndex };
    }

    const categoryPrefix = {
      'semantic-color': '--ui-color-',
      palette: '--ui-palette-',
      typography: '--ui-',
      spacing: '--ui-',
      shape: '--ui-',
      sizing: '--ui-',
      focus: '--ui-focus-',
      motion: '--ui-motion-',
    }[token.category] || '--ui-';
    const fallbackId = token.name.slice(categoryPrefix.length).split('-')[0] || token.name.slice(5);
    return {
      id: fallbackId,
      label: humanizeFamily(fallbackId),
      category: token.category,
      order: definitions.length,
    };
  }

  function tokenState(name, familyTokenNames) {
    const matched = tokenStateSuffixes.find(state => name.endsWith(state.suffix));
    if (!matched) return { stem: name, rank: 0 };
    const stem = name.slice(0, -matched.suffix.length);
    if (!familyTokenNames.has(stem)) return { stem: name, rank: 0 };
    return { stem, rank: matched.rank };
  }

  function compareTokensWithinFamily(a, b) {
    const explicitOrder = (tokenFamilyOrder.get(a.token.name) ?? Number.MAX_SAFE_INTEGER)
      - (tokenFamilyOrder.get(b.token.name) ?? Number.MAX_SAFE_INTEGER);
    if (explicitOrder) return explicitOrder;
    const stemOrder = tokenNameCollator.compare(a.state.stem, b.state.stem);
    if (stemOrder) return stemOrder;
    if (a.state.rank !== b.state.rank) return a.state.rank - b.state.rank;
    return tokenNameCollator.compare(a.token.name, b.token.name);
  }

  function sortTokensWithinFamily(familyTokens) {
    const familyTokenNames = new Set(familyTokens.map(token => token.name));
    return familyTokens
      .map(token => ({ token, state: tokenState(token.name, familyTokenNames) }))
      .sort(compareTokensWithinFamily)
      .map(entry => entry.token);
  }

  function groupTokensByFamily(visible) {
    const grouped = new Map();
    for (const token of visible) {
      const family = familyFor(token);
      const key = `${family.category}:${family.id}`;
      if (!grouped.has(key)) {
        const category = categories.find(item => item.id === family.category);
        grouped.set(key, {
          ...family,
          key,
          categoryLabel: category?.label || family.category,
          tokens: [],
        });
      }
      grouped.get(key).tokens.push(token);
    }
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
    return [...grouped.values()]
      .sort((a, b) => (categoryOrder.get(a.category) - categoryOrder.get(b.category))
        || (a.order - b.order)
        || tokenNameCollator.compare(a.label, b.label))
      .map(group => ({ ...group, tokens: sortTokensWithinFamily(group.tokens) }));
  }

  function resolveValue(token) {
    const name = token.name;
    const category = token.category;
    probe.removeAttribute('style');
    if (name.startsWith('--ui-color-prompt-template-placeholder-')) {
      probe.style.backgroundImage = `var(${name})`;
      return getComputedStyle(probe).backgroundImage;
    }
    if (category === 'semantic-color' || category === 'palette') {
      probe.style.backgroundColor = `var(${name})`;
      return getComputedStyle(probe).backgroundColor;
    }
    if (name.startsWith('--ui-shadow-')) {
      probe.style.boxShadow = `var(${name})`;
      return getComputedStyle(probe).boxShadow;
    }
    if (name.startsWith('--ui-text-')) {
      probe.style.font = `var(${name})`;
      const style = getComputedStyle(probe);
      return `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
    }
    if (name.startsWith('--ui-font-size-') || name.includes('control-height') || name.includes('icon-size') || name.includes('inline-padding') || name.includes('density-gap') || name.startsWith('--ui-space-') || name.startsWith('--ui-radius-') || name.startsWith('--ui-border-width-') || name.includes('focus-ring-width') || name.includes('focus-ring-offset')) {
      probe.style.width = `var(${name})`;
      return getComputedStyle(probe).width;
    }
    if (name.startsWith('--ui-font-weight-')) {
      probe.style.fontWeight = `var(${name})`;
      return getComputedStyle(probe).fontWeight;
    }
    if (name.startsWith('--ui-font-')) {
      probe.style.fontFamily = `var(${name})`;
      return getComputedStyle(probe).fontFamily;
    }
    if (name.startsWith('--ui-line-height-')) {
      probe.style.lineHeight = `var(${name})`;
      return getComputedStyle(probe).lineHeight;
    }
    if (name.startsWith('--ui-letter-spacing-')) {
      probe.style.letterSpacing = `var(${name})`;
      return getComputedStyle(probe).letterSpacing;
    }
    if (name.includes('duration')) {
      probe.style.transitionDuration = `var(${name})`;
      return getComputedStyle(probe).transitionDuration;
    }
    if (name.includes('ease-')) {
      probe.style.transitionTimingFunction = `var(${name})`;
      return getComputedStyle(probe).transitionTimingFunction;
    }
    if (name.startsWith('--ui-z-')) {
      probe.style.zIndex = `var(${name})`;
      return getComputedStyle(probe).zIndex;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || token.rawValue;
  }

  function previewMarkup(token) {
    const style = `--preview-token: var(${token.name})`;
    if (token.category === 'semantic-color' || token.category === 'palette') {
      return `<div class="preview-color-pair" style="${style}" role="group" aria-label="${escapeHtml(token.name)} 浅色与深色预览">
        <span class="preview-color" data-preview-theme="light" aria-label="浅色主题"></span>
        <span class="preview-color" data-preview-theme="dark" aria-label="深色主题"></span>
      </div>`;
    }
    if (token.name.startsWith('--ui-space-')) return `<div class="preview-scale-track"><div class="preview-scale-value" style="${style}"></div></div>`;
    if (token.name.startsWith('--ui-radius-')) return `<div class="preview-radius-box" style="${style}"></div>`;
    if (token.name.startsWith('--ui-shadow-')) return `<div class="preview-shadow-box" style="${style}"></div>`;
    if (token.name.startsWith('--ui-border-width-')) return `<div class="preview-border" style="${style}"></div>`;
    if (token.name.startsWith('--ui-text-')) return `<span class="preview-type preview-text" style="${style}">Reroll Aa</span>`;
    if (token.name.startsWith('--ui-font-size-') || token.name.includes('density-font-size')) return `<span class="preview-type preview-font-size" style="${style}">Aa 字号</span>`;
    if (token.name.startsWith('--ui-font-weight-')) return `<span class="preview-type preview-font-weight" style="${style}">Aa 字重</span>`;
    if (token.name.startsWith('--ui-font-')) return `<span class="preview-type preview-font-family" style="${style}">Reroll 字体</span>`;
    if (token.name.startsWith('--ui-letter-spacing-')) return `<span class="preview-type preview-letter-spacing" style="${style}">字间距 Letter</span>`;
    if (token.name.startsWith('--ui-line-height-')) return `<span class="preview-type preview-line-height" style="${style}">行高预览<br>Line height</span>`;
    if (token.name.includes('duration')) return `<div class="preview-motion preview-motion-duration" style="${style}"></div>`;
    if (token.name.includes('ease-')) return `<div class="preview-motion" style="${style}"></div>`;
    if (token.name.startsWith('--ui-z-')) return '<div class="preview-layer"><span></span><span></span><span></span></div>';
    if (token.name.startsWith('--ui-focus-ring') && !token.name.includes('shadow')) return `<button class="preview-focus" type="button" tabindex="-1" style="${style}">Focus</button>`;
    if (/^--ui-(?:control-height|icon-size|density-(?:control-height|icon-size))/.test(token.name)) return `<div class="preview-size-box" style="${style}"></div>`;
    return `<code class="preview-generic">${escapeHtml(token.rawValue)}</code>`;
  }

  function semanticColorRule(name) {
    const suffix = name.replace('--ui-color-', '');
    const state = suffix.includes('-selected-hover') ? '已选中项目悬停时' : suffix.endsWith('-hover') ? '悬停时' : suffix.endsWith('-disabled') ? '不可用时' : suffix.endsWith('-selected') ? '已选中时' : '';
    const intent = suffix.includes('danger') ? '危险操作或错误反馈' : suffix.includes('warning') ? '警告反馈' : suffix.includes('success') ? '成功反馈' : '';

    if (suffix.startsWith('surface-')) {
      if (suffix === 'surface-canvas') return '页面与创作画布的最底层背景，不用于卡片或可交互控件。';
      if (suffix === 'surface-floating') return '菜单、Popover 等悬浮容器背景，需配合对应浮层阴影。';
      if (suffix === 'surface-subtle') return '低强调分区、嵌套区域或静态弱背景。';
      if (intent) return `${intent}的静态背景；交互操作仍使用 Action Token。`;
      return '卡片、面板等主要静态容器背景；可交互容器使用 Action Token。';
    }
    if (suffix.startsWith('text-on-action-')) return `${intent || '高强调操作'}容器上的文字与图标前景，必须与对应 Action 背景成对使用${state ? `；用于${state}` : ''}。`;
    if (suffix.startsWith('text-')) {
      if (suffix === 'text-primary') return '标题、正文和主要信息的默认前景色。';
      if (suffix === 'text-secondary') return '补充信息与次级正文，不用于关键操作标签。';
      if (suffix === 'text-tertiary') return '说明和弱化元数据，避免承载关键信息。';
      if (suffix === 'text-placeholder') return 'Input、Textarea 与可编辑 Composer 的占位提示文字，不叠加额外透明度。';
      if (suffix === 'text-disabled') return '不可用控件的文字；同时保留非颜色的禁用线索。';
      if (suffix === 'text-white') return '固定深色媒体表面上的白色文字，不随主题反转。';
      if (suffix === 'text-link') return '可点击的文本链接；必须同时具备 Hover 与 Focus 反馈。';
      if (suffix === 'text-caret') return '输入控件的文本插入光标。';
      return `${intent || '特定语义反馈'}的文字前景，不应仅靠颜色传达状态。`;
    }
    if (suffix.startsWith('icon-')) {
      if (suffix === 'icon-primary') return '无文字配对的主要图标；文字旁图标优先继承 currentColor。';
      if (suffix === 'icon-secondary') return '无文字配对的次级图标。';
      if (suffix === 'icon-tertiary') return '装饰性或弱化的独立图标。';
      if (suffix === 'icon-disabled') return '不可用控件的独立图标；同时保留非颜色的禁用线索。';
      return `${intent || '特定语义反馈'}的独立图标；配对图标优先继承文字颜色。`;
    }
    if (suffix.startsWith('border-')) {
      if (suffix === 'border-primary') return '输入框或高可见分隔的主要边界。';
      if (suffix === 'border-secondary') return '卡片、面板和列表的默认边界。';
      if (suffix === 'border-tertiary') return '最弱的装饰性分隔，不承担关键层级。';
      if (suffix === 'border-focus') return '键盘 Focus 轮廓，必须通过共享 Focus 配方使用。';
      if (suffix === 'border-selected') return '选中对象或当前选择的描边，不等同于 Focus。';
      if (suffix === 'border-canvas-grid') return 'Smart Canvas 网格线，只用于画布空间背景。';
      if (suffix === 'border-disabled') return '不可用控件的边界。';
      return `${intent || '特定状态'}的边界；配合文字、图标或说明共同表达。`;
    }
    if (suffix.startsWith('action-')) {
      const level = suffix.includes('primary') ? '最高强调操作' : suffix.includes('secondary') ? '常规操作' : '低强调操作';
      return `${intent ? `${intent}中的` : ''}${level}容器${state ? `，用于${state}` : ''}；内部前景使用对应 Text on Action Token。`;
    }
    if (suffix === 'backdrop') return 'Dialog、Drawer、Lightbox 背后的页面级阻断遮罩。';
    if (suffix === 'mask') return '媒体或局部内容上的遮罩基色，不用于阻断整个页面。';
    if (suffix === 'shadow') return '卡片、菜单等轻悬浮对象的阴影基色。';
    if (suffix === 'shadow-strong') return 'Modal 等高悬浮对象的阴影基色。';
    if (suffix.startsWith('prompt-template-placeholder-')) return '无封面 Prompt Template 的固定媒体式渐变背景，搭配白色文字。';
    return '全局语义颜色；按名称所表达的界面职责使用，不直接按色相选用。';
  }

  function usageRuleFor(token) {
    if (token.description) return token.description;
    if (token.category === 'semantic-color') return semanticColorRule(token.name);
    if (token.category === 'palette') return '仅供语义 Token 映射；组件与页面不要直接引用原子色。';
    if (token.category === 'typography') return typographyRule(token.name);
    if (token.category === 'spacing') return '布局间距阶梯，用于内边距、外边距和元素间隔。';
    if (token.category === 'sizing') return '共享控件或图标尺寸；通过组件 Size 或页面密度上下文使用。';
    if (token.category === 'focus') return '共享键盘 Focus 配方；不要在页面内另造轮廓或发光。';
    if (token.category === 'motion') return '共享动效时长或缓动；Reduced Motion 会统一降级。';
    return '共享形状与层级基础值，按名称对应的视觉属性使用。';
  }

  function typographyRule(name) {
    const rules = {
      '--ui-text-title-1': '页面主标题或高强调任务标题；一个页面通常只出现一次，不用于卡片标题。',
      '--ui-text-title-2': '页面内主要区域、Dialog 主标题；用于划分一级内容区。',
      '--ui-text-title-3': '卡片、面板与较小区域标题；同一容器内不要再叠加更重字重。',
      '--ui-text-subtitle': '紧跟标题的引导说明或摘要；不是通用次级正文，也不用于控件标签。',
      '--ui-text-body': '默认正文、表单说明和需要连续阅读的内容；优先于手动拼接字号与行高。',
      '--ui-text-body-compact': '表格、菜单、Popover 等密集界面的短正文；不用于长段阅读。',
      '--ui-text-label': '按钮、字段、导航和状态的短标签；不用于完整句子或长说明。',
      '--ui-text-caption': '时间、计数、来源和补充提示等弱化元数据；不得承载关键操作或主体内容。',
      '--ui-text-code': 'Token 名、路径、快捷键、ID 与代码片段；普通数字和正文仍使用 Body。',
      '--ui-font-sans': '中文与拉丁产品界面的默认字体栈；页面通常通过 Text Style 间接使用。',
      '--ui-font-display': '标题字体入口；目前与 Sans 一致，为未来标题字体策略保留单一切换点。',
      '--ui-font-mono': '代码与机器可读值的等宽字体栈；优先通过 Text Code 使用。',
      '--ui-font-weight-regular': '正文、说明与常规操作的默认字重；连续阅读内容优先使用。',
      '--ui-font-weight-medium': '标题和短标签的温和强调；不要与 Bold 在同一小区域反复切换。',
      '--ui-font-weight-bold': '最高文字强调与关键短标签；本项目值为 600，不额外引入 Semibold。',
      '--ui-line-height-tight': '单行或短标题的紧凑行高；不用于多段正文。',
      '--ui-line-height-compact': '标签、Caption 与密集短文本；超过两行时优先改用 Body。',
      '--ui-line-height-body': '正文和说明的默认行高，适合多行阅读。',
      '--ui-line-height-code': '等宽代码和机器可读值的行高；不用于普通正文。',
      '--ui-letter-spacing-normal': '正文、中文和大多数界面文字的默认字距。',
      '--ui-letter-spacing-tight': '中等标题的轻微收紧；不要用于小字号中文。',
      '--ui-letter-spacing-tighter': '大标题的进一步收紧；仅在 Display / 大字号场景使用。',
      '--ui-letter-spacing-wide': '短英文 Eyebrow、分类或紧凑大写标签；避免用于句子和中文正文。',
      '--ui-letter-spacing-widest': '极短的大写标记或视觉编号；谨慎使用，不用于可阅读内容。',
    };
    if (rules[name]) return rules[name];
    const size = name.match(/^--ui-font-size-(\d+)$/)?.[1];
    if (size) {
      const uses = {
        1: 'Caption 与极短辅助信息的最小字号；不得承载关键内容或长文本。',
        2: '紧凑正文、标签与控件文字；优先通过 Body Compact、Label 或 Code 使用。',
        3: '产品默认正文字号；优先通过 Body 使用。',
        4: '小区域标题或需要提高可读性的正文；优先通过 Title 3 使用。',
        5: '二级标题字号；优先通过 Title 2 使用。',
        6: '一级标题字号；优先通过 Title 1 使用。',
        7: '展示型大标题；仅用于少量营销或空状态重点，不作为常规产品层级。',
        8: '最大展示字号；仅用于独立 Hero 数字或展示文案，需单独验证响应式表现。',
      };
      return uses[size] || '排版字号基础值；产品界面优先通过对应 Text Style 使用。';
    }
    return '排版基础值；优先通过组合后的 Text Style 使用，单独覆盖时需保持原有文字角色。';
  }

  function effectiveRawValue(token) {
    const change = changes.get(token.name);
    if (!change) return token.rawValue;
    if (change.value !== undefined) return change.value;
    return `light-dark(var(${change.light}), var(${change.dark}))`;
  }

  function formatCopy(token) {
    return `var(${token.name})`;
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_error) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast(message);
  }

  function showToast(message, tone = 'success') {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function renderFilters() {
    filters.innerHTML = categories.map(category => {
      const count = category.id === 'all' ? tokens.length : tokens.filter(token => token.category === category.id).length;
      if (!count) return '';
      const categoryIsActive = category.id === activeCategory;
      const familyItems = categoryIsActive && category.id !== 'all'
        ? groupTokensByFamily(tokens.filter(token => token.category === category.id)).map(family => {
          const headingId = `token-family-${family.category}-${family.id}`;
          return `<ic-nav-item class="token-filter-family" label="${escapeHtml(family.label)}" href="#${escapeHtml(headingId)}" data-category="${escapeHtml(category.id)}" data-filter-family="${escapeHtml(family.id)}"${family.id === activeFamily ? ' current="section"' : ''}></ic-nav-item>`;
        }).join('')
        : '';
      return `<div class="token-filter-group${categoryIsActive ? ' is-active' : ''}">
        <div class="token-filter-category">
          <ic-nav-item label="${escapeHtml(category.label)}" href="#token-category-${escapeHtml(category.id)}" data-category="${escapeHtml(category.id)}"${categoryIsActive ? ' current="page"' : ''}></ic-nav-item>
          <span class="token-filter-count" aria-hidden="true">${count}</span>
        </div>
        ${familyItems ? `<div class="token-filter-families">${familyItems}</div>` : ''}
      </div>`;
    }).join('');
  }

  function paletteOptions(selected) {
    return paletteTokens.map(token => `<option value="${escapeHtml(token.name)}"${token.name === selected ? ' selected' : ''}>${escapeHtml(token.name)} · ${escapeHtml(token.value)}</option>`).join('');
  }

  function editorMarkup(token) {
    const editable = editableByName.get(token.name);
    if (!editMode || !editable) return '';
    const change = changes.get(token.name);
    if (editable.kind === 'primitive-color') {
      const value = change?.value ?? editable.value;
      const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
      return `<div class="token-edit-field" data-token-editor="primitive-color">
        <label><span>HEX 颜色</span><span class="token-color-control"><input type="color" data-token-color-picker value="${escapeHtml(pickerValue)}"><input type="text" data-token-primitive-value value="${escapeHtml(value)}" spellcheck="false" aria-label="${escapeHtml(token.name)} 的颜色值"></span></label>
      </div>`;
    }
    const light = change?.light ?? editable.light;
    const dark = change?.dark ?? editable.dark;
    return `<div class="token-edit-field semantic" data-token-editor="semantic-color">
      <label><span>浅色映射</span><select data-token-light aria-label="${escapeHtml(token.name)} 的浅色映射">${paletteOptions(light)}</select></label>
      <label><span>深色映射</span><select data-token-dark aria-label="${escapeHtml(token.name)} 的深色映射">${paletteOptions(dark)}</select></label>
    </div>`;
  }

  function renderTokenRow(token) {
    const resolved = resolveValue(token);
    const editable = editableByName.has(token.name);
    const changed = changes.has(token.name);
    return `<tr class="token-row${editable ? ' is-editable' : ''}${changed ? ' is-changed' : ''}" data-token-name="${escapeHtml(token.name)}">
      <td class="token-name-cell" data-column-label="Token Name">
        <div class="token-card-heading">
          <code class="token-name">${escapeHtml(token.name)}</code>
          <button class="token-copy" type="button" data-copy-token="${escapeHtml(token.name)}" aria-label="复制 ${escapeHtml(token.name)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
          </button>
        </div>
        ${editMode && editable ? '<span class="token-editable-badge">可编辑</span>' : ''}
        ${token.definitions > 1 ? `<span class="token-context-badge">含 ${token.definitions - 1} 个上下文覆盖</span>` : ''}
      </td>
      <td class="token-usage-cell" data-column-label="使用规则"><p>${escapeHtml(usageRuleFor(token))}</p></td>
      <td class="token-value-cell" data-column-label="Value">
        <div class="token-value-content">
          <div class="token-preview">${previewMarkup(token)}</div>
          <dl class="token-values">
            <div class="token-value-row"><dt>映射</dt><dd><code data-token-raw-value>${escapeHtml(effectiveRawValue(token))}</code></dd></div>
            <div class="token-value-row"><dt>实际值</dt><dd><code data-token-resolved>${escapeHtml(resolved)}</code></dd></div>
          </dl>
        </div>
        ${editorMarkup(token)}
      </td>
    </tr>`;
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase('zh-CN');
    visibleTokens = tokens.filter(token => {
      const matchesCategory = activeCategory === 'all' || token.category === activeCategory;
      const haystack = `${token.name} ${effectiveRawValue(token)} ${token.description}`.toLocaleLowerCase('zh-CN');
      return matchesCategory && (!query || haystack.includes(query));
    });
    const category = categories.find(item => item.id === activeCategory) || categories[0];
    resultsTitle.textContent = query ? `“${searchInput.value.trim()}”的结果` : `${category.label}参数`;
    const editableCount = visibleTokens.filter(token => editableByName.has(token.name)).length;
    resultsCount.textContent = editMode ? `${editableCount} 个可编辑 · ${visibleTokens.length} 个结果` : `${visibleTokens.length} / ${tokens.length}`;
    semanticGuide.hidden = activeCategory !== 'semantic-color' || Boolean(query);
    typographyGuide.hidden = activeCategory !== 'typography' || Boolean(query);
    emptyState.hidden = visibleTokens.length > 0;
    grid.innerHTML = groupTokensByFamily(visibleTokens).map(group => {
      const headingId = `token-family-${group.category}-${group.id}`;
      return `<section class="token-family-section" data-token-family="${escapeHtml(group.id)}" data-token-category="${escapeHtml(group.category)}" aria-labelledby="${escapeHtml(headingId)}">
        ${activeCategory === 'all' ? `<p class="token-family-category">${escapeHtml(group.categoryLabel)}</p>` : ''}
        <h2 id="${escapeHtml(headingId)}">${escapeHtml(group.label)}</h2>
        <div class="token-table-scroll">
          <table class="token-table">
            <thead><tr><th scope="col">Token Name</th><th scope="col">使用规则</th><th scope="col">Value</th></tr></thead>
            <tbody class="token-grid">${group.tokens.map(renderTokenRow).join('')}</tbody>
          </table>
        </div>
      </section>`;
    }).join('');
    results.setAttribute('aria-busy', 'false');
  }

  function selectCategory(category) {
    activeCategory = category;
    activeFamily = '';
    renderFilters();
    render();
  }

  function selectFamily(category, family) {
    activeCategory = category;
    activeFamily = family;
    searchInput.value = '';
    renderFilters();
    render();
    requestAnimationFrame(() => {
      const section = grid.querySelector(`[data-token-category="${CSS.escape(category)}"][data-token-family="${CSS.escape(family)}"]`);
      section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  function setEditMode(nextMode) {
    if (!revision) return;
    editMode = nextMode;
    document.body.toggleAttribute('data-token-editing', editMode);
    editToggle.classList.toggle('active', editMode);
    editToggle.setAttribute('aria-pressed', String(editMode));
    editToggle.textContent = editMode ? '退出编辑' : '编辑参数';
    render();
  }

  function changeMatchesOriginal(change, original) {
    if (original.kind === 'primitive-color') return change.value === original.value;
    return change.light === original.light && change.dark === original.dark;
  }

  function validateChange(change, original) {
    if (original.kind !== 'primitive-color') return '';
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(change.value)
      ? ''
      : '请输入有效的 HEX 颜色值';
  }

  function applyPreviewOverrides() {
    const declarations = [...changes.entries()]
      .filter(([name]) => !validationErrors.has(name))
      .map(([name, change]) => {
        const value = change.value !== undefined
          ? change.value
          : `light-dark(var(${change.light}), var(${change.dark}))`;
        return `${name}: ${value};`;
      });
    liveOverrides.textContent = declarations.length ? `:root {\n  ${declarations.join('\n  ')}\n}` : '';
  }

  function updateChangeBar() {
    const count = changes.size;
    changeBar.hidden = count === 0;
    changeCount.textContent = `${count} 项修改`;
    if (validationErrors.size) {
      validationStatus.textContent = `${validationErrors.size} 项需要修正后才能保存`;
      validationStatus.dataset.tone = 'danger';
    } else {
      validationStatus.textContent = '即时预览中，尚未写入 CSS';
      delete validationStatus.dataset.tone;
    }
    reviewButton.disabled = count === 0 || validationErrors.size > 0;
  }

  function setChange(name, proposed, card) {
    const original = editableByName.get(name);
    if (!original) return;
    if (changeMatchesOriginal(proposed, original)) changes.delete(name);
    else changes.set(name, proposed);
    const error = validateChange(proposed, original);
    if (changes.has(name) && error) validationErrors.set(name, error);
    else validationErrors.delete(name);
    card.classList.toggle('is-changed', changes.has(name));
    const textInput = card.querySelector('[data-token-primitive-value]');
    if (textInput) textInput.setAttribute('aria-invalid', String(Boolean(error)));
    const token = tokens.find(item => item.name === name);
    const rawValue = card.querySelector('[data-token-raw-value]');
    if (token && rawValue) rawValue.textContent = effectiveRawValue(token);
    applyPreviewOverrides();
    updateChangeBar();
    requestAnimationFrame(() => {
      const resolved = card.querySelector('[data-token-resolved]');
      if (token && resolved) resolved.textContent = resolveValue(token);
    });
  }

  function handleEditorInput(event) {
    const target = event.target;
    const card = target.closest('[data-token-name]');
    if (!card) return;
    const name = card.dataset.tokenName;
    if (target.matches('[data-token-color-picker]')) {
      const textInput = card.querySelector('[data-token-primitive-value]');
      textInput.value = target.value.toUpperCase();
      setChange(name, { name, value: textInput.value }, card);
    } else if (target.matches('[data-token-primitive-value]')) {
      const value = target.value.trim();
      const picker = card.querySelector('[data-token-color-picker]');
      if (/^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
      setChange(name, { name, value }, card);
    } else if (target.matches('[data-token-light], [data-token-dark]')) {
      setChange(name, {
        name,
        light: card.querySelector('[data-token-light]').value,
        dark: card.querySelector('[data-token-dark]').value,
      }, card);
    }
  }

  function discardChanges() {
    changes.clear();
    validationErrors.clear();
    applyPreviewOverrides();
    updateChangeBar();
    render();
    showToast('已放弃未保存的参数修改');
  }

  function formatDiffValue(change) {
    if (change.value !== undefined) return change.value;
    return `浅色 ${change.light} · 深色 ${change.dark}`;
  }

  function originalDiffValue(original) {
    if (original.kind === 'primitive-color') return original.value;
    return `浅色 ${original.light} · 深色 ${original.dark}`;
  }

  function openDiffDialog() {
    diffList.innerHTML = [...changes.entries()].map(([name, change]) => {
      const original = editableByName.get(name);
      return `<article><h3>${escapeHtml(name)}</h3><dl><div><dt>原值</dt><dd>${escapeHtml(originalDiffValue(original))}</dd></div><div><dt>新值</dt><dd>${escapeHtml(formatDiffValue(change))}</dd></div></dl></article>`;
    }).join('');
    diffDialog.showModal();
  }

  async function saveChanges() {
    if (!changes.size || validationErrors.size) return;
    saveButton.disabled = true;
    saveButton.textContent = '正在保存…';
    try {
      const response = await fetch(WORKBENCH_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_revision: revision,
          changes: [...changes.values()],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `保存失败（HTTP ${response.status}）`);
      changes.clear();
      validationErrors.clear();
      liveOverrides.textContent = '';
      diffDialog.close();
      await loadResources();
      setEditMode(true);
      updateChangeBar();
      showToast('设计参数已安全保存到 CSS');
    } catch (error) {
      showToast(error.message || '无法保存设计参数', 'danger');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = '确认保存';
    }
  }

  async function loadResources() {
    results.setAttribute('aria-busy', 'true');
    const sourceResponse = await fetch(SOURCE_URL, { cache: 'no-store' });
    if (!sourceResponse.ok) throw new Error(`HTTP ${sourceResponse.status}`);
    const cssText = await sourceResponse.text();
    liveSource.textContent = cssText;
    tokens = parseTokens(cssText);
    if (!tokens.length) throw new Error('没有识别到 CSS 自定义属性');

    try {
      const workbenchResponse = await fetch(WORKBENCH_URL, { cache: 'no-store' });
      if (!workbenchResponse.ok) throw new Error(`HTTP ${workbenchResponse.status}`);
      const workbench = await workbenchResponse.json();
      revision = workbench.revision;
      editableByName = new Map(workbench.tokens.map(token => [token.name, token]));
      paletteTokens = workbench.tokens
        .filter(token => token.kind === 'primitive-color')
        .sort((a, b) => tokenNameCollator.compare(a.name, b.name));
      editToggle.disabled = false;
      editToggle.title = `${workbench.tokens.length} 个全局颜色 Token 可编辑`;
    } catch (_error) {
      revision = '';
      editableByName = new Map();
      paletteTokens = [];
      editToggle.disabled = true;
      editToggle.title = '当前运行环境未开放设计参数保存';
    }
    renderFilters();
    render();
  }

  filters.addEventListener('click', event => {
    const item = event.target.closest('[data-category]');
    if (!item) return;
    event.preventDefault();
    if (item.dataset.filterFamily) selectFamily(item.dataset.category, item.dataset.filterFamily);
    else selectCategory(item.dataset.category);
  });
  searchInput.addEventListener('input', () => {
    activeFamily = '';
    renderFilters();
    render();
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-token]');
    if (!button) return;
    const token = tokens.find(item => item.name === button.dataset.copyToken);
    if (token) copyText(formatCopy(token), `已复制 ${token.name}`);
  });
  grid.addEventListener('input', handleEditorInput);
  grid.addEventListener('change', handleEditorInput);
  editToggle.addEventListener('click', () => setEditMode(!editMode));
  discardButton.addEventListener('click', discardChanges);
  reviewButton.addEventListener('click', openDiffDialog);
  saveButton.addEventListener('click', saveChanges);
  const themeObserver = new MutationObserver(() => requestAnimationFrame(render));
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ui-theme'],
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchInput.focus();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (!changes.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  loadResources().catch(error => {
    results.setAttribute('aria-busy', 'false');
    grid.innerHTML = `<p class="token-load-error">无法读取 ${escapeHtml(SOURCE_URL)}：${escapeHtml(error.message)}</p>`;
  });
})();
