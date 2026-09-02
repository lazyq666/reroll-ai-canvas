import './core.js?v=ic-ui-c087c3d218de';

await customElements.whenDefined('ic-icon');
await customElements.whenDefined('ic-empty-state');
await new Promise(resolve => requestAnimationFrame(resolve));

const promptSkeleton = document.querySelector('.far-prompt-skeleton');
const promptNodeHeight = promptSkeleton?.closest('.image-node')?.getBoundingClientRect().height || 0;
const promptLineCount = Math.min(24, Math.max(1, Math.floor((promptNodeHeight - 2 - 40 + 10) / 19)));
if (promptSkeleton) {
  promptSkeleton.dataset.lineCount = String(promptLineCount);
  promptSkeleton.replaceChildren(...Array.from({ length:promptLineCount }, () => {
    const line = document.createElement('span');
    line.className = 'far-prompt-skeleton-line';
    line.setAttribute('aria-hidden', 'true');
    return line;
  }));
}

const samples = [...document.querySelectorAll('[data-component-name]')];
const visible = samples.length === 7 && samples.every(sample => {
  const node = sample.querySelector('.image-node, ic-empty-state');
  if (!node) return false;
  const nodeRect = node.getBoundingClientRect();
  return nodeRect.width > 0 && nodeRect.height > 0;
});
const emptyStatesReady = [...document.querySelectorAll('ic-empty-state')]
  .every(emptyState => emptyState.dataset.icContractStatus === 'ready');
const audioSample = document.querySelector('[data-component-name="smart-canvas-far-audio-placeholder"]');
const audioNode = audioSample?.querySelector('.image-node');
const audioBodyRect = audioSample?.querySelector('.node-body')?.getBoundingClientRect();
const audioPlaceholderRect = audioSample?.querySelector('.far-node-audio')?.getBoundingClientRect();
const audioFillsNode = Boolean(
  audioNode && audioBodyRect && audioPlaceholderRect
  && Math.abs(audioNode.clientWidth - audioBodyRect.width) < 1
  && Math.abs(audioNode.clientHeight - audioBodyRect.height) < 1
  && Math.abs(audioBodyRect.width - audioPlaceholderRect.width) < 1
  && Math.abs(audioBodyRect.height - audioPlaceholderRect.height) < 1
);
const mediaBoundariesClip = [
  'smart-canvas-far-audio-placeholder',
  'smart-canvas-far-video-placeholder',
].every(componentName => {
  const node = document.querySelector(`[data-component-name="${componentName}"] .image-node`);
  if (!node) return false;
  const style = getComputedStyle(node);
  return style.borderStyle !== 'none' && style.borderRadius !== '0px' && style.overflow === 'hidden';
});
const promptLinesAdaptToHeight = Boolean(
  promptSkeleton
  && promptSkeleton.children.length === promptLineCount
  && promptLineCount >= 1
);
const emptyUploadNode = document.querySelector('[data-component-name="smart-canvas-far-empty-upload"] .image-node');
const emptyUploadMarker = emptyUploadNode?.querySelector('.far-node-marker');
const emptyUploadUsesSurface = Boolean(
  emptyUploadNode
  && emptyUploadMarker
  && getComputedStyle(emptyUploadMarker).backgroundColor === getComputedStyle(emptyUploadNode).backgroundColor
  && getComputedStyle(emptyUploadMarker).backgroundColor !== 'rgba(0, 0, 0, 0)'
);

document.documentElement.dataset.emptyStatesStatus = visible
  && emptyStatesReady
  && audioFillsNode
  && mediaBoundariesClip
  && promptLinesAdaptToHeight
  && emptyUploadUsesSurface
  ? 'ready'
  : 'failed';
