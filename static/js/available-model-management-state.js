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
    let changed = false;
    Object.entries(models || {}).forEach(([kind, entries]) => {
      const currentById = new Map(entries.map((entry) => [entry.id, entry]));
      const next = (savedModels?.[kind] || []).map((saved) => {
        const current = currentById.get(saved.id);
        if (current) Object.assign(current, saved);
        return current || saved;
      });
      changed ||= entries.length !== next.length || entries.some((entry, index) => entry.id !== next[index]?.id);
      entries.splice(0, entries.length, ...next);
    });
    return changed;
  },
}));
