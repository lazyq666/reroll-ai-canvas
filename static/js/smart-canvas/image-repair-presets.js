/* Workspace repair presets; factory prompt content is owned by shared i18n. */
(function(root){
    'use strict';
    const keys=Object.freeze(['hand','fingers','limbs','smearing','fabric','noise']);
    const defaults=key=>root.StudioI18n.t(`smart.repair.default.${key}`);
    const legacyKeys=Object.freeze({hand:'legacyHand',fingers:'legacyFingers',smearing:'legacySmearing',suffix:'legacySuffix'});
    const resolve=config=>Object.fromEntries([...keys,'suffix'].map(key=>[key,
        legacyKeys[key]&&config?.[key]===defaults(legacyKeys[key])?defaults(key):config?.[key] ?? defaults(key)]));
    const prompt=(config,key)=>{const values=resolve(config);return [values[key],values.suffix].filter(value=>value.trim()).join('\n\n');};
    root.SmartCanvasModules=root.SmartCanvasModules||{};
    root.SmartCanvasModules.imageRepairPresets=Object.freeze({keys,defaults,resolve,prompt});
})(window);
