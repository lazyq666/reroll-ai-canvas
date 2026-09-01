'use strict';

const fs = require('fs');
const vm = require('vm');

function readStdin() {
    return new Promise((resolve, reject) => {
        let value = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { value += chunk; });
        process.stdin.on('end', () => resolve(value));
        process.stdin.on('error', reject);
    });
}

(async () => {
    const promptAuthoringPath = process.argv[2];
    if (!promptAuthoringPath) throw new Error('Prompt Authoring source path is required');
    const payload = JSON.parse(await readStdin());
    const canvas = payload?.canvas;
    if (!canvas || typeof canvas !== 'object') throw new Error('Canvas payload is required');
    const sandbox = {
        window: {
            SmartCanvasModules: {
                smartContainer: { isGroup: node => node?.type === 'smart-group' },
            },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(promptAuthoringPath, 'utf8'), sandbox, {
        filename: promptAuthoringPath,
    });
    const authoring = sandbox.window.SmartCanvasModules.promptAuthoring;
    const resultNodes = (canvas.nodes || []).filter(node => authoring.isMigrationResultNode(node));
    const snapshots = resultNodes.map(node => authoring.migrationSnapshot({ canvas, node }));
    process.stdout.write(JSON.stringify({ snapshots }));
})().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
});
