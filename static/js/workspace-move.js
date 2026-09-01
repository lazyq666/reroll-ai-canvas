(() => {
  const tr = key => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const message = document.getElementById('move-message');
  const progress = document.getElementById('move-progress');
  const stageBadge = document.getElementById('move-stage');
  const alert = document.getElementById('move-alert');
  const files = document.getElementById('move-files');
  const size = document.getElementById('move-size');
  const cancelGeneration = document.getElementById('cancel-generation');
  const enterProduct = document.getElementById('enter-product');
  const operationId = new URLSearchParams(location.search).get('operation_id') || '';
  const operationQuery = operationId ? `?operation_id=${encodeURIComponent(operationId)}` : '';
  let moveFinished = false;
  let returnUrl = '/';

  function formatBytes(value) {
    let amount = Math.max(0, Number(value || 0));
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount.toFixed(index && amount < 10 ? 1 : 0)} ${units[index]}`;
  }

  function setStageBadge(state) {
    const failed = state.stage === 'failed';
    const completed = state.stage === 'completed' || Boolean(state.finished);
    const tone = failed ? 'danger' : (completed ? 'success' : 'info');
    const loading = !failed && !completed;
    if(stageBadge.getAttribute('tone') !== tone) stageBadge.setAttribute('tone', tone);
    if(stageBadge.hasAttribute('loading') !== loading) stageBadge.toggleAttribute('loading', loading);
    stageBadge.textContent = failed
      ? tr('runtime.moveStatusFailed')
      : completed
        ? tr('runtime.moveStatusComplete')
        : state.stage === 'waiting_for_generation_tasks'
          ? tr('runtime.moveStatusWaiting')
          : tr('runtime.moveStatusActive');
  }

  function applyProgress(state) {
    const stageMessages = {
      waiting_for_generation_tasks: tf('runtime.moveWaitingTasks', {count:Number(state.blocking_generation_tasks || 0)}),
      preparing: tr('runtime.movePreparing'),
      copying: tr('runtime.moveCopying'),
      verifying: tr('runtime.moveVerifying'),
      prepared: tr('runtime.movePrepared'),
      switching: tr('runtime.movePrepared'),
      restarting: tr('runtime.moveRestarting'),
      completed: tr('runtime.moveCompleted'),
    };
    const nextMessage = state.stage === 'failed'
      ? (state.message || tr('runtime.readMoveFailed'))
      : (stageMessages[state.stage] || state.message || tr('runtime.movingSafely'));
    message.textContent = nextMessage;
    setStageBadge(state);

    const totalFiles = Math.max(0, Number(state.file_count || 0));
    const copiedFiles = Math.max(0, Number(state.copied_files || 0));
    const totalBytes = Math.max(0, Number(state.total_bytes || 0));
    const copiedBytes = Math.max(0, Number(state.copied_bytes || 0));
    const percent = totalBytes
      ? Math.min(100, Math.round(copiedBytes * 100 / totalBytes))
      : (state.finished ? 100 : 0);
    progress.setAttribute('value', String(percent));
    progress.setAttribute('value-text', `${percent}%`);
    files.textContent = tf('runtime.filesProgress', {copied:copiedFiles, total:totalFiles});
    size.textContent = tf('runtime.sizeProgress', {copied:formatBytes(copiedBytes), total:formatBytes(totalBytes)});

    const waitingForTasks = state.stage === 'waiting_for_generation_tasks'
      && Number(state.blocking_generation_tasks || 0) > 0;
    cancelGeneration.hidden = !waitingForTasks;
    moveFinished = Boolean(state.finished);
    returnUrl = state.return_url || '/';
    enterProduct.hidden = !moveFinished;
    alert.hidden = state.stage !== 'failed';
    if(state.stage === 'failed') alert.textContent = nextMessage;
  }

  async function readProgress() {
    try {
      const response = await fetch(`/api/workspace-move/status${operationQuery}`, {cache:'no-store'});
      const state = await response.json();
      if(!response.ok) throw new Error(state.detail || tr('runtime.readMoveFailed'));
      applyProgress(state);
      if(!moveFinished) setTimeout(readProgress, 900);
    } catch (error) {
      const detail = error.message || tr('runtime.serviceRestarting');
      message.textContent = detail;
      alert.textContent = detail;
      alert.hidden = false;
      setTimeout(readProgress, 900);
    }
  }

  function connectProgress() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws/workspace-move${operationQuery}`);
    socket.addEventListener('message', event => {
      try { applyProgress(JSON.parse(event.data)); } catch (_) {}
    });
    socket.addEventListener('close', () => {
      if(!moveFinished) setTimeout(connectProgress, 900);
    });
  }

  cancelGeneration.addEventListener('click', async () => {
    cancelGeneration.disabled = true;
    message.textContent = tr('runtime.cancelingGeneration');
    await fetch('/api/runtime/restart', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({cancel_active:true}),
    });
    setTimeout(readProgress, 200);
  });
  enterProduct.addEventListener('click', () => location.assign(returnUrl));
  connectProgress();
  readProgress();
})();
