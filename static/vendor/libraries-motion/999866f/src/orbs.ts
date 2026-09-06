// Reroll uses only the upstream 20px breathing ring.
import { frameRibbon } from './orbs/engine/ribbon';
import { resolvePreset } from './orbs/presets';
export { paintFrame } from './orbs/engine/core';

const preset = resolvePreset('breathing', 20);
export function frameBreathingRing(seconds: number) {
  return frameRibbon(20, seconds * preset.speed, preset.opts);
}
