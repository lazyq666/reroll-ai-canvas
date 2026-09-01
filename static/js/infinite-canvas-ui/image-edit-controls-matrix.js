const root = document.documentElement;
const status = document.querySelector('[data-image-edit-controls-live-status]');
const themeToggle = document.querySelector('[data-image-edit-theme-toggle]');
const modeButtons = [...document.querySelectorAll('[data-image-edit-demo-mode]')];
const previewTools = document.getElementById('imageEditLibraryPreviewTools');
const resizeTools = document.getElementById('imageEditLibraryResizeTools');
const gridTools = document.getElementById('imageEditLibraryGridTools');
const commitActions = document.getElementById('imageEditLibraryCommitActions');
const brushSlider = document.getElementById('imageEditLibraryBrush');
const brushValue = document.getElementById('imageEditLibraryBrushValue');

function setTheme(theme) {
  root.dataset.uiTheme = theme;
  root.classList.toggle('theme-dark', theme === 'dark');
  root.classList.toggle('studio-theme-dark', theme === 'dark');
  themeToggle.textContent = theme === 'dark' ? '切换浅色' : '切换深色';
  themeToggle.toggleAttribute('pressed', theme === 'dark');
}

function setMode(mode) {
  previewTools.toggleAttribute('hidden', mode !== 'preview');
  resizeTools.toggleAttribute('hidden', mode !== 'resize');
  gridTools.toggleAttribute('hidden', mode !== 'grid');
  commitActions.toggleAttribute('hidden', mode === 'preview');
  for (const button of modeButtons) {
    const active = button.dataset.imageEditDemoMode === mode;
    button.setAttribute('hierarchy', active ? 'primary' : 'quiet');
    button.toggleAttribute('pressed', active);
  }
  status.textContent = `${mode === 'preview' ? '预览' : mode === 'resize' ? '缩放' : '宫格'}模式 · Live`;
}

themeToggle.addEventListener('click', () => setTheme(root.dataset.uiTheme === 'dark' ? 'light' : 'dark'));
modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.imageEditDemoMode)));
brushSlider?.addEventListener('input', event => {
  brushValue.textContent = String(event.target.value || 24);
});

await customElements.whenDefined('ic-image-edit-dock');
setTheme('light');
setMode('preview');
root.dataset.imageEditControlsStatus = 'ready';
