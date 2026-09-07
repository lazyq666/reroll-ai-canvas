const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/api-settings.js'), 'utf8');
const closeFunction = source.slice(source.indexOf('async function closeApiTransferPassword('), source.indexOf('function submitApiTransferPassword('));

(async () => {
  for (const result of ['test-password', null]) {
    let finishHide;
    let resolved = false;
    const elements = {
      apiTransferDialog: {
        open: true,
        hide: () => new Promise(resolve => {
          finishHide = () => { elements.apiTransferDialog.open = false; resolve(); };
        }),
      },
      apiTransferPassword: {value: 'test-password'},
      apiTransferPasswordConfirm: {value: 'test-password'},
    };
    const scope = vm.createContext({
      document: {getElementById: id => elements[id]},
      apiTransferNeedsConfirmation: true,
      apiTransferCopy: {},
      apiTransferPasswordResolve: value => {
        // Opening the next dialog while this one is open would be rejected.
        assert.equal(elements.apiTransferDialog.open, false);
        assert.equal(value, result);
        resolved = true;
      },
    });
    vm.runInContext(closeFunction, scope);
    const closing = scope.closeApiTransferPassword(result);
    assert.equal(resolved, false);
    assert.equal(elements.apiTransferPassword.value, '');
    assert.equal(elements.apiTransferPasswordConfirm.value, '');
    finishHide();
    await closing;
    assert.equal(resolved, true);
  }
  console.log('API backup dialog sequencing: 2 passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
