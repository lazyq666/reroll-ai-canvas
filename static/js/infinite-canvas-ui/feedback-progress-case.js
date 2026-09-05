import './core.js?v=ic-ui-0e81b6afe7d8';
import { createStackedFeedbackQueue } from './feedback-progress/stacked-feedback-queue.js?v=ic-ui-0e81b6afe7d8';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const locale = params.get('locale') === 'en' ? 'en' : 'zh-CN';
const long = params.get('content') === 'long';
document.documentElement.dataset.uiTheme = theme;
document.documentElement.dataset.uiMotion = params.get('motion') === 'reduced' ? 'reduced' : 'standard';
document.documentElement.lang = locale;
if (params.get('viewport') === 'narrow') document.body.dataset.viewport = 'narrow';

const copy = locale === 'en' ? {
  alertVariants: 'Alert variants', alertNeutralTrigger: 'Default Alert', alertInfoTrigger: 'Info Alert', alertSuccessTrigger: 'Success Alert', alertWarningTrigger: 'Warning Alert', alertDangerTrigger: 'Error Alert', alertButtonTrigger: 'Alert with button', alertNeutralTitle: 'Default alert', alertNeutralMessage: 'There are no changes requiring attention in this view.', alertInfoTitle: 'Sync update', alertInfoMessage: long ? 'Your changes are saved in this workspace and will remain available while collaborators reconnect across an unusually constrained panel.' : 'Changes are saved in this workspace.', alertSuccessTitle: 'Export complete', alertSuccessMessage: 'You can continue with the next task.', alertWarningTitle: 'Upload in progress', alertWarningMessage: 'Some assets are still uploading. Keep this page open.', alertDangerTitle: 'Connection failed', alertDangerMessage: 'Check the network and try again.',
  successMessage: 'Export completed. You can continue with the next task.', warningMessage: 'Some assets are still uploading. Keep this page open.', dangerMessage: 'Connection failed. Check the network and try again.', actionMessage: 'GPT Image 2 component missing', badgeSizes: 'Badge sizes', badgeKinds: 'Label & Count', badgeStatuses: 'Status badges', badgeLabel: 'Label', recommended: 'Recommended', processing: 'Processing', completed: 'Completed', needsAttention: 'Needs attention', failed: 'Failed', nodeRuntimeStatus: 'Node runtime status · Domain pattern', nodeRuntimeRunning: 'Generation node in progress', nodeRuntimeComplete: 'Completed generation node', generationPending: 'Generation pending node · Domain pattern', generationPendingImage: 'Image · Generating · Multiple outputs', generationPendingVideo: 'Video · Queued · Single output', generationPendingText: 'Text · Generating · Single output', generationRecovery: 'Generation recovery node · Domain pattern', generationRecoveryImage: 'Image · Recoverable', generationRecoveryVideo: 'Video · Cloud queue', generationRecoveryText: 'Text · Querying', toasts: 'Transient feedback · Toast', toastNeutralTrigger: 'Default Toast', toastInfoTrigger: 'Info Toast', toastSuccessTrigger: 'Success Toast', toastWarningTrigger: 'Warning Toast', toastDangerTrigger: 'Error Toast', toastNeutral: 'Settings updated.', toastInfo: 'Synchronization will continue in the background.', toastSuccess: 'File saved.', toastWarning: 'Storage is almost full.', toastDanger: 'Save failed. Try again.', emptyDescription: long ? 'Complete a generation to place its output here; filters and loading have already finished, so this is a genuine empty result.' : 'Complete a generation and its output will appear here.', emptyAction: 'Start generation', emptyNoneDescription: 'Adjust the filters and try again.',
} : {
  alertVariants: 'Alert 变体', alertNeutralTrigger: '默认 Alert', alertInfoTrigger: '信息 Alert', alertSuccessTrigger: '成功 Alert', alertWarningTrigger: '警告 Alert', alertDangerTrigger: '错误 Alert', alertButtonTrigger: '带按钮 Alert', alertNeutralTitle: '默认提醒', alertNeutralMessage: '当前视图没有需要处理的变更。', alertInfoTitle: '同步提示', alertInfoMessage: long ? '更改已保存在当前工作区；即使协作者正在重新连接，这段异常长的状态说明也必须在窄面板内自然换行。' : '更改已保存在当前工作区。', alertSuccessTitle: '导出完成', alertSuccessMessage: '可以继续处理下一项任务。', alertWarningTitle: '资源仍在上传', alertWarningMessage: '请勿关闭当前页面。', alertDangerTitle: '连接失败', alertDangerMessage: '请检查网络后重试。',
  successMessage: '已完成导出，可继续处理下一项任务。', warningMessage: '部分资源仍在上传，请勿关闭页面。', dangerMessage: '连接失败，请检查网络后重试。', actionMessage: '缺少 GPT Image 2 组件', badgeSizes: '徽标尺寸 · Badge sizes', badgeKinds: '标签与数量 · Label & Count', badgeStatuses: '状态徽标 · Status badges', badgeLabel: '标签', recommended: '推荐', processing: '进行中', completed: '已完成', needsAttention: '需处理', failed: '失败', nodeRuntimeStatus: '节点运行耗时状态 · 产品模式', nodeRuntimeRunning: '运行中的生成节点', nodeRuntimeComplete: '已完成的生成节点', toasts: '瞬时反馈 · Toast', toastNeutralTrigger: '默认 Toast', toastInfoTrigger: '信息 Toast', toastSuccessTrigger: '成功 Toast', toastWarningTrigger: '警告 Toast', toastDangerTrigger: '错误 Toast', toastNeutral: '设置已更新。', toastInfo: '同步将在后台继续。', toastSuccess: '文件已保存。', toastWarning: '存储空间即将用尽。', toastDanger: '保存失败，请重试。', emptyDescription: long ? '完成一次生成后，结果会显示在这里；筛选与加载均已结束，因此这是确切的空结果，而不是仍在处理。' : '完成一次生成后，结果会显示在这里。', emptyAction: '开始生成', emptyNoneDescription: '调整筛选条件后再试一次。',
};
for (const node of document.querySelectorAll('[data-copy]')) {
  const key = node.dataset.copy.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  if (copy[key]) node.textContent = copy[key];
}
document.querySelector('[data-copy-aria-label="toast-preview-actions"]')?.setAttribute('aria-label', locale === 'en' ? 'Toast preview actions' : 'Toast 预览操作');
document.querySelector('[data-copy-aria-label="alert-preview-actions"]')?.setAttribute('aria-label', locale === 'en' ? 'Alert preview actions' : 'Alert 预览操作');
document.querySelector('[data-alert-queue-stage]')?.setAttribute('aria-label', locale === 'en' ? 'Alert queue preview' : 'Alert 队列预览');
if (locale === 'en') {
  document.querySelector('#loading-inline').setAttribute('label', 'Preparing preview');
  document.querySelector('#loading-region').setAttribute('label', 'Loading workspace');
  document.querySelector('#loading-content').setAttribute('label', 'Loading content');
  document.querySelector('#progress-batch').setAttribute('label', 'Batch generation');
  document.querySelector('#progress-upload').setAttribute('label', 'Uploading assets');
  document.querySelector('#generation-pending-image').setAttribute('label', 'Generating 4 images');
  document.querySelector('#generation-pending-video').setAttribute('label', 'Video waiting to generate');
  document.querySelector('#generation-pending-text').setAttribute('label', 'Generating text');
  document.querySelector('#generation-recovery-image').setAttribute('title', 'Generation can continue');
  document.querySelector('#generation-recovery-image').setAttribute('description', 'Task image-42 is still available');
  document.querySelector('#generation-recovery-image').setAttribute('action-label', 'Query result');
  document.querySelector('#generation-recovery-video').setAttribute('title', 'Queued with 2 tasks ahead');
  document.querySelector('#generation-recovery-video').setAttribute('description', 'The task can be recovered; wait or query it manually');
  document.querySelector('#generation-recovery-video').setAttribute('action-label', 'Query result');
  document.querySelector('#generation-recovery-text').setAttribute('title', 'Querying');
  document.querySelector('#generation-recovery-text').setAttribute('description', 'Recovering the text generation task');
  document.querySelector('#generation-recovery-text').setAttribute('action-label', 'Querying...');
}
await customElements.whenDefined('ic-generation-pending');
await customElements.whenDefined('ic-generation-recovery');
await customElements.whenDefined('ic-button');
await customElements.whenDefined('ic-alert');
await customElements.whenDefined('ic-toast');
const alertStage = document.querySelector('[data-alert-queue-stage]');
const alertStack = createStackedFeedbackQueue({
  edge: 'start',
  visibleCount: 3,
  stackStepPx: 19,
  scaleStep: 0.045,
  exitDuration: 200,
  setPresented(alert, visible) {
    alert.toggleAttribute('data-ic-stack-hidden', !visible);
  },
  onChange({ items, visible }) {
    alertStage.dataset.activeTone = items[0]?.getAttribute('tone') || '';
    alertStage.dataset.queueLength = String(items.length);
    alertStage.dataset.visibleCount = String(visible.length);
  },
});
function createAlert(tone, { withButton = false } = {}) {
  const name = tone[0].toUpperCase() + tone.slice(1);
  const alert = document.createElement('ic-alert');
  if (withButton) alert.dataset.componentName = 'ic-alert';
  alert.setAttribute('tone', tone);
  alert.setAttribute('heading', withButton
    ? (locale === 'en' ? 'Image generation failed' : '生成图片失败')
    : copy[`alert${name}Title`]);
  alert.setAttribute('dismissible', '');
  if (withButton) alert.setAttribute('action-label', locale === 'en' ? 'View details' : '查看详情');
  alert.textContent = withButton ? copy.actionMessage : copy[`alert${name}Message`];
  alert.addEventListener('ic-dismiss', () => {
    alert.hidden = false;
    alertStack.dismiss(alert);
  }, { once: true });
  return alert;
}
function enqueueAlert(tone, options) {
  const alert = createAlert(tone, options);
  alertStage.prepend(alert);
  alertStack.enqueue(alert);
}
for (const button of document.querySelectorAll('[data-alert-trigger]')) {
  button.addEventListener('click', () => enqueueAlert(button.dataset.alertTrigger, {
    withButton: button.hasAttribute('data-alert-with-button'),
  }));
}
enqueueAlert('danger', { withButton: true });
enqueueAlert('neutral');
const Toast = customElements.get('ic-toast');
function toastPresenter() {
  if (document.documentElement.dataset.uiLibraryLayout === 'compact' && window.parent !== window) {
    try {
      const ParentToast = window.parent.customElements.get('ic-toast');
      if (typeof ParentToast?.notify === 'function') return ParentToast;
    } catch (_) {
      // A standalone or cross-origin fixture keeps its Toast in the current document.
    }
  }
  return Toast;
}
for (const button of document.querySelectorAll('[data-toast-trigger]')) {
  button.addEventListener('click', () => {
    const tone = button.dataset.toastTrigger;
    const key = `toast${tone[0].toUpperCase()}${tone.slice(1)}`;
    toastPresenter().notify(copy[key], { tone });
  });
}
await Promise.all([...document.querySelectorAll('ic-alert,ic-badge,ic-button,ic-loading,ic-progress,ic-skeleton,ic-generation-pending,ic-generation-recovery')].map(element => new Promise(resolve => requestAnimationFrame(resolve))));
const ready = [...document.querySelectorAll('ic-alert,ic-badge,ic-button,ic-loading,ic-progress,ic-skeleton,ic-generation-pending,ic-generation-recovery')].every(element => element.dataset.icContractStatus === 'ready');
document.documentElement.dataset.feedbackProgressCaseStatus = ready ? 'ready' : 'failed';
await import('./component-name-tag.js');
