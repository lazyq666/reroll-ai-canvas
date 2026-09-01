(() => {
  const variants = {
    A: {
      name: '安静画布',
      summary: '最贴近设计稿。默认只呈现内容，身份、连接与操作在需要时浮现。',
      rationale: '优势是内容干扰最少；代价是新用户要通过悬停/选中，才知道 Node 类型和可操作范围。'
    },
    B: {
      name: '语义卡片',
      summary: '固定显示 Node 类型、状态、输入输出端口与底部元信息。',
      rationale: '优势是状态与结构容易扫读；代价是每个 Node 多出约 26px 高度，画布密度略低。'
    },
    C: {
      name: '操作轨道',
      summary: '把 Node 类型放进左侧轨道，常用动作固定在卡片下方。',
      rationale: '优势是工作流操作最直接；代价是工具更抢眼，更适合重度用户而非纯内容浏览。'
    }
  };
  const states = {
    default:'默认', hover:'悬停', selected:'选中', editing:'编辑', running:'运行中 · 12s',
    success:'已完成 · 43s', error:'异常 · 可重试', disabled:'不可用', dragging:'拖动中'
  };
  const prompt = '你是一名视觉内容分析师与图像生成提示词编辑。把输入参考图提炼成一段可直接交给图像生成模型的中文 prompt，准确还原参考图中的主体内容、角色设定、构图关系、动作关系与场景信息。只提炼“画了什么”和“各元素如何组织”，不要输出图片分析报告。';
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const ports = '<span class="node-port in" aria-hidden="true"></span><span class="node-port out" aria-hidden="true"></span>';
  const rail = '<span class="node-status-rail" aria-hidden="true"></span>';
  const toolbar = () => `<div class="node-toolbar" aria-label="节点操作">
    <button type="button" title="创建副本">${icon('copy')}</button>
    <button type="button" title="再次生成">${icon('refresh-cw')}</button>
    <button type="button" title="展开编辑">${icon('maximize-2')}</button>
    <button type="button" title="更多">${icon('ellipsis')}</button>
  </div>`;
  const resize = '<span class="node-resize" aria-hidden="true"><img src="/static/prototypes/smart-canvas-node-resize.svg" alt=""></span>';
  const thumbs = `<div class="node-thumb-row">${[1,2,3].map(n => `<span class="node-thumb"><img src="/static/images/test/fixture.svg" alt="参考图片 ${n}"><span>图片 ${n}</span></span>`).join('')}</div>`;
  const model = `<div class="node-model"><span>${icon('bot')}gpt-5.5 ${icon('chevron-down')}</span><button class="node-run" type="button" title="运行">${icon('arrow-up')}</button></div>`;
  const emptyCopy = (kind) => kind === 'upload'
    ? '<div class="node-empty-copy"><strong>拖拽、粘贴或点击选择文件</strong><span>支持图片、视频、音频和文本，最大 500MB</span></div><button class="node-primary" type="button">+ 上传文件</button>'
    : '<div class="node-empty-copy"><strong>生成图片或视频</strong><span>选择 Node 后在 Composer 里生成图片/视频</span></div>';
  const imageNode = (inner) => `<article class="demo-node image-demo-node">${ports}${rail}${inner}${toolbar()}${resize}</article>`;

  function renderA() {
    return `<div class="canvas-flow">
      <div class="flow-column"><span class="flow-label">Input</span><article class="demo-node prompt-demo-node">${ports}${rail}<div class="node-content">${thumbs}<p class="prompt-copy" contenteditable="false">${prompt}</p>${model}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Prompt</span><article class="demo-node prompt-demo-node">${ports}${rail}<div class="node-content"><p class="prompt-copy" contenteditable="false">${prompt}</p></div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Media</span><article class="demo-node upload-demo-node">${ports}${rail}<div class="node-content node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-upload.svg" alt=""></span>${emptyCopy('upload')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Output</span><article class="demo-node generation-demo-node">${ports}${rail}<div class="node-content node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-generate.svg" alt=""></span>${emptyCopy('generate')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column">${imageNode('<div class="node-content"><img src="/static/images/test/fixture.svg" alt="几何参考图"><span class="image-meta">1076 × 704 · SVG</span></div>')}</div>
    </div>`;
  }

  function header(type, glyph) { return `<header class="node-header"><strong>${icon(glyph)}${type}</strong><small class="node-status-pill">${states[currentState]}</small></header>`; }
  function footer(copy) { return `<footer class="node-footer"><span>${copy}</span><button class="node-icon-button" type="button">${icon('ellipsis')}</button></footer>`; }
  function renderB() {
    return `<div class="canvas-flow">
      <div class="flow-column"><span class="flow-label">Input</span><article class="demo-node prompt-demo-node">${ports}${rail}${header('提示词生成','sparkles')}<div class="prompt-main">${thumbs}<p class="prompt-copy" contenteditable="false">${prompt}</p></div>${footer('gpt-5.5 · 3 个输入')}${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Prompt</span><article class="demo-node prompt-demo-node">${ports}${rail}${header('提示词','text-cursor-input')}<div class="prompt-main"><p class="prompt-copy" contenteditable="false">${prompt}</p></div>${footer('268 字 · 自动保存')}${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Media</span><article class="demo-node upload-demo-node">${ports}${rail}${header('上传','upload')}<div class="node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-upload.svg" alt=""></span>${emptyCopy('upload')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Output</span><article class="demo-node generation-demo-node">${ports}${rail}${header('生成输出','wand-sparkles')}<div class="node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-generate.svg" alt=""></span>${emptyCopy('generate')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column">${imageNode(`${header('图像','image')}<div class="node-content"><img src="/static/images/test/fixture.svg" alt="几何参考图"></div>${footer('1076 × 704 · SVG')}`)}</div>
    </div>`;
  }

  function side(type,glyph) { return `<aside class="node-side">${icon(glyph)}<span>${type}</span><button class="node-icon-button" type="button">${icon('ellipsis')}</button></aside>`; }
  function renderC() {
    return `<div class="canvas-flow">
      <div class="flow-column"><span class="flow-label">Input</span><article class="demo-node prompt-demo-node">${ports}${rail}${side('Prompt AI','sparkles')}<div class="prompt-main">${thumbs}<p class="prompt-copy" contenteditable="false">${prompt}</p>${model}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Prompt</span><article class="demo-node prompt-demo-node">${ports}${rail}${side('Prompt','text-cursor-input')}<div class="prompt-main"><p class="prompt-copy" contenteditable="false">${prompt}</p><div class="node-model"><span>268 字 · 已保存</span></div></div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Media</span><article class="demo-node upload-demo-node">${ports}${rail}${side('Upload','upload')}<div class="node-content node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-upload.svg" alt=""></span>${emptyCopy('upload')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column"><span class="flow-label">Output</span><article class="demo-node generation-demo-node">${ports}${rail}${side('Generate','wand-sparkles')}<div class="node-content node-empty"><span class="node-empty-icon"><img src="/static/prototypes/smart-canvas-node-generate.svg" alt=""></span>${emptyCopy('generate')}</div>${toolbar()}${resize}</article></div>
      <div class="flow-column">${imageNode(`${side('Image','image')}<div class="node-content"><img src="/static/images/test/fixture.svg" alt="几何参考图"><span class="image-meta">1076 × 704 · SVG</span></div>`)}</div>
    </div>`;
  }

  const renderers = { A:renderA, B:renderB, C:renderC };
  const stage = document.getElementById('prototypeStage');
  const params = new URLSearchParams(location.search);
  let currentVariant = variants[params.get('variant')] ? params.get('variant') : 'A';
  let currentState = states[params.get('state')] ? params.get('state') : 'default';

  function enhance() { if (window.lucide) window.lucide.createIcons(); }
  function render() {
    const variant = variants[currentVariant];
    stage.dataset.variant = currentVariant;
    stage.dataset.state = currentState;
    stage.innerHTML = renderers[currentVariant]();
    document.getElementById('variantEyebrow').textContent = `方案 ${currentVariant}`;
    document.getElementById('variantTitle').textContent = variant.name;
    document.getElementById('variantSummary').textContent = variant.summary;
    document.getElementById('variantRationale').textContent = variant.rationale;
    document.getElementById('switcherLabel').textContent = `${currentVariant} · ${variant.name}`;
    const dark = document.documentElement.classList.contains('theme-dark');
    document.getElementById('stateReadout').textContent = `variant=${currentVariant} / state=${currentState} / nodes=5 / theme=${dark ? 'dark' : 'light'}`;
    document.querySelector('#themeToggle span').textContent = dark ? '浅色' : '深色';
    document.querySelectorAll('[data-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === currentState)));
    const editable = stage.querySelectorAll('.prompt-copy');
    editable.forEach(node => node.contentEditable = currentState === 'editing' ? 'true' : 'false');
    if (currentState === 'editing') editable[0]?.focus();
    enhance();
  }
  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('variant', currentVariant);
    url.searchParams.set('state', currentState);
    history.replaceState({},'',url);
  }
  function setVariant(next) { currentVariant = next; syncUrl(); render(); }
  function cycle(delta) { const keys = Object.keys(variants); setVariant(keys[(keys.indexOf(currentVariant)+delta+keys.length)%keys.length]); }
  function setState(next) { currentState = next; syncUrl(); render(); }

  document.getElementById('stateControls').addEventListener('click', event => {
    const button = event.target.closest('[data-state]');
    if (button) setState(button.dataset.state);
  });
  document.getElementById('previousVariant').addEventListener('click', () => cycle(-1));
  document.getElementById('nextVariant').addEventListener('click', () => cycle(1));
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('theme-dark');
    const dark = document.documentElement.classList.contains('theme-dark');
    document.querySelector('#themeToggle span').textContent = dark ? '浅色' : '深色';
    render();
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') cycle(-1);
    if (event.key === 'ArrowRight') cycle(1);
    if (event.key === 'Escape' && currentState !== 'default') setState('default');
  });
  stage.addEventListener('dblclick', event => { if (event.target.closest('.prompt-demo-node')) setState('editing'); });
  stage.addEventListener('click', event => { if (event.target.closest('.demo-node') && currentState === 'default') setState('selected'); });
  render();
})();
