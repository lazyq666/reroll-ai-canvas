const INSTALLED_DOCUMENTS = new WeakSet();


export const IC_INPUT_MODALITIES = Object.freeze({
  keyboard: 'keyboard',
  pointer: 'pointer',
});


export function installFocusPolicy(documentRoot = document) {
  if (!documentRoot?.documentElement || INSTALLED_DOCUMENTS.has(documentRoot)) return;
  INSTALLED_DOCUMENTS.add(documentRoot);

  const root = documentRoot.documentElement;
  const setModality = modality => {
    root.dataset.icInputModality = modality;
  };

  if (!root.dataset.icInputModality) setModality(IC_INPUT_MODALITIES.keyboard);

  documentRoot.addEventListener(
    'pointerdown',
    () => setModality(IC_INPUT_MODALITIES.pointer),
    { capture: true, passive: true },
  );
  documentRoot.addEventListener('keydown', event => {
    if (event.metaKey || event.altKey || event.ctrlKey) return;
    setModality(IC_INPUT_MODALITIES.keyboard);
  }, { capture: true });
}
