(() => {
  const variants = [
    { key: 'a', label: 'A · 横向锁定' },
    { key: 'b', label: 'B · 节点排字' },
    { key: 'c', label: 'C · 画布展开' },
  ];
  const scenarios = {
    launch: {
      eyebrow: 'AI CREATIVE STUDIO',
      message: '把想法连接成无限画布',
      status: '正在准备你的创作空间',
      workspace: '准备你的创作空间',
    },
    login: {
      eyebrow: 'WELCOME BACK',
      message: '继续你的创作',
      status: '正在进入工作台',
      workspace: '欢迎回来，继续创作',
    },
  };

  const shell = document.querySelector('.prototype-shell');
  const stage = document.querySelector('#brandStage');
  const video = document.querySelector('#logoMotion');
  const variantLabel = document.querySelector('#variantLabel');
  const brandEyebrow = document.querySelector('#brandEyebrow');
  const brandMessage = document.querySelector('#brandMessage');
  const statusCopy = document.querySelector('#statusCopy');
  const workspaceGreeting = document.querySelector('#workspaceGreeting');
  let finishTimer = 0;
  let dockTimer = 0;

  const query = new URLSearchParams(location.search);
  let variantIndex = Math.max(0, variants.findIndex(item => item.key === query.get('variant')));
  let scenario = scenarios[query.get('scenario')] ? query.get('scenario') : 'launch';

  function writeQuery() {
    const next = new URL(location.href);
    next.searchParams.set('variant', variants[variantIndex].key);
    next.searchParams.set('scenario', scenario);
    history.replaceState({}, '', next);
  }

  function applyState() {
    const activeVariant = variants[variantIndex];
    const copy = scenarios[scenario];
    document.body.dataset.variant = activeVariant.key;
    document.body.dataset.scenario = scenario;
    variantLabel.textContent = activeVariant.label;
    brandEyebrow.textContent = copy.eyebrow;
    brandMessage.textContent = copy.message;
    statusCopy.textContent = copy.status;
    workspaceGreeting.textContent = copy.workspace;
    document.querySelectorAll('[data-scenario]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario));
    });
    writeQuery();
  }

  function replay() {
    clearTimeout(finishTimer);
    clearTimeout(dockTimer);
    stage.classList.remove('is-wordmark');
    shell.classList.remove('is-docked');
    shell.classList.remove('is-finished');
    void stage.offsetWidth;
    video.currentTime = 0;
    const playback = video.play();
    if (playback?.catch) playback.catch(() => stage.classList.add('is-wordmark'));
  }

  function revealWordmark() {
    stage.classList.add('is-wordmark');
    if (variants[variantIndex].key === 'c') {
      dockTimer = window.setTimeout(() => shell.classList.add('is-docked'), 2400);
    }
    const finishDelay = variants[variantIndex].key === 'c' ? 3300 : 2600;
    finishTimer = window.setTimeout(() => shell.classList.add('is-finished'), finishDelay);
  }

  function cycle(delta) {
    variantIndex = (variantIndex + delta + variants.length) % variants.length;
    applyState();
    replay();
  }

  video.addEventListener('ended', revealWordmark);
  document.querySelector('#previousVariant').addEventListener('click', () => cycle(-1));
  document.querySelector('#nextVariant').addEventListener('click', () => cycle(1));
  document.querySelector('#replayMotion').addEventListener('click', replay);
  document.querySelectorAll('[data-scenario]').forEach(button => {
    button.addEventListener('click', () => {
      scenario = button.dataset.scenario;
      applyState();
      replay();
    });
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,[contenteditable]')) return;
    if (event.key === 'ArrowLeft') cycle(-1);
    if (event.key === 'ArrowRight') cycle(1);
    if (event.key.toLowerCase() === 'r') replay();
  });

  applyState();
  replay();
})();
