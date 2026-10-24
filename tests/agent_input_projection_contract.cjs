// Compare server projection fixtures with the editor's actual reference resolver,
// without a browser, a user canvas, a Provider or a rewritten JS implementation.
const fs = require('node:fs');
const vm = require('node:vm');
const fixture = JSON.parse(fs.readFileSync(0, 'utf8'));
const main = fs.readFileSync('static/js/smart-canvas.js', 'utf8');
const containers = fs.readFileSync('static/js/smart-canvas/smart-container.js', 'utf8');
function declaration(source, name) {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing function ${name}`);
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end < 0 ? undefined : end);
}
const ctx = {
    window: {SmartCanvasModules: {}}, nodes: fixture.canvas.nodes,
    canvas: fixture.canvas, settings: fixture.node.runSettings, smartLoopContext: null,
    canvasPersistence: {schedule() {}},
    tr: key => key, trf: (key, values) => `${key}:${values.number}`,
    mediaKindForItem: item => item.kind || 'image',
    isSmartImageNode: node => node?.type === 'smart-image',
    composerTextReferenceNodesFor: () => [],
    fixture,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('static/js/smart-canvas/reference-instances.js', 'utf8'), ctx);
for (const name of ['smartContainerIsGroup', 'smartContainerIsFrame', 'smartContainerMediaId',
    'smartContainerOrderedEntries', 'smartContainerMemberHasDisplayMedia',
    'smartContainerPresentationItems', 'smartContainerImageRefs']) {
    vm.runInContext(declaration(containers, name), ctx);
}
ctx.smartContainer = {isGroup: ctx.smartContainerIsGroup, imageRefs: ctx.smartContainerImageRefs};
ctx.window.SmartCanvasModules.smartContainer = ctx.smartContainer;
for (const name of ['localDisplayUrlForMediaItem', 'imageForDisplay', 'imagesForNode',
    'upstreamConnectionsForKinds',
    'outputImagesForNode', 'outputImagesForConnection', 'selfReferenceImagesForNode',
    'inputImagesFor', 'inputRefKey', 'blockedInputRefKeys', 'orderReferenceImagesForNode',
    'manualReferenceImagesFor', 'isInputRefBlocked', 'activeInputImagesFor',
    'defaultReferenceImagesFor', 'uniqueReferenceImages', 'smartImageUsesWorkflowInput']) {
    vm.runInContext(declaration(main, name), ctx);
}
vm.runInContext(fs.readFileSync('static/js/smart-canvas/prompt-authoring.js', 'utf8'), ctx);
vm.runInContext('collectPromptAuthoringParts = () => fixture.parts;', ctx);
const result = ctx.resolvePromptAuthoring(fixture.node, null, false, null, fixture.node.runSettings);
process.stdout.write(JSON.stringify(result));
