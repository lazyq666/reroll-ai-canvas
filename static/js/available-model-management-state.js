(function exposeAvailableModelManagementState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AvailableModelManagementState = api;
})(typeof globalThis === 'object' ? globalThis : window, () => ({
  setModelVisibility(models, kind, modelId, visible) {
    const current = (models?.[kind] || []).find((entry) => entry.id === modelId);
    if (!current) return false;
    current.visible = Boolean(visible);
    return true;
  },
  applySavedModelsInPlace(models, savedModels) {
    Object.entries(models || {}).forEach(([kind, entries]) => {
      const savedById = new Map((savedModels?.[kind] || []).map((entry) => [entry.id, entry]));
      entries.forEach((current) => {
        const saved = savedById.get(current.id);
        if (saved) Object.assign(current, saved);
      });
    });
  },
}));
