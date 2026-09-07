const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/api-settings.js'), 'utf8');
const closeFunction = source.slice(source.indexOf('async function closeApiTransferPassword('), source.indexOf('function submitApiTransferPassword('));
const submitFunction = source.slice(source.indexOf('function submitApiTransferPassword('), source.indexOf('function requestApiTransferPassword('));

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
  for (const [confirmPassword, password, confirmation, expectedError] of [
    [true, 'test-password', 'different-password', 'api.passwordMismatch'],
    [true, 'test-password', 'test-password', null],
    [false, 'test-password', '', null],
    [false, 'short', '', 'api.passwordMin'],
    [false, 'a'.repeat(257), '', 'api.passwordMax'],
  ]) {
    let error = null;
    let submitted = null;
    const scope = vm.createContext({
      document: {getElementById: id => ({value: id === 'apiTransferPassword' ? password : confirmation})},
      apiTransferCopy: {confirmPassword},
      tr: key => key,
      showError: value => { error = value; },
      closeApiTransferPassword: value => { submitted = value; },
    });
    vm.runInContext(submitFunction, scope);
    scope.submitApiTransferPassword();
    assert.equal(error, expectedError);
    assert.equal(submitted, expectedError ? null : password);
  }
  console.log('API backup dialog: 2 sequencing and 5 password validation cases passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
