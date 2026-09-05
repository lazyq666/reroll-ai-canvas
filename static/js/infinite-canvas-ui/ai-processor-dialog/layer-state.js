/** Pure authoring state. Geometry is always in source-image pixels. */
export const LAYER_PRESETS = ['auto', 'subject-background', 'text-subject-background', 'objects'];
export const MAX_LAYER_REGIONS = 16;
export const clone = value => JSON.parse(JSON.stringify(value));
export function layerDraft(value) {
  const input = value?.version === 1 ? value : {};
  const prompts = {};
  for (const key of [...LAYER_PRESETS, 'custom']) if (typeof input.prompts?.[key] === 'string') prompts[key] = input.prompts[key];
  // Preserve text from the retired Custom option in the editable automatic draft.
  if (input.preset === 'custom' && typeof prompts.custom === 'string') prompts.auto = prompts.custom;
  return {
    version: 1, mode: input.mode === 'regions' ? 'regions' : 'intelligent',
    preset: LAYER_PRESETS.includes(input.preset) ? input.preset : 'auto', prompts,
    sourceWidth: Number(input.sourceWidth) || 0, sourceHeight: Number(input.sourceHeight) || 0,
    regions: Array.isArray(input.regions) ? clone(input.regions) : [],
    supplement: typeof input.supplement === 'string' ? input.supplement : '',
  };
}
export function normalizedBBox(region, width, height) {
  const values = [region?.x, region?.y, region?.width, region?.height, width, height];
  if (!values.every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
      || region.x + region.width > width + 1e-6 || region.y + region.height > height + 1e-6) return null;
  const box = [region.x / width, region.y / height, (region.x + region.width) / width, (region.y + region.height) / height]
    .map(value => Math.max(0, Math.min(1000, Math.round(value * 1000))));
  return box[0] < box[2] && box[1] < box[3] ? box : null;
}
