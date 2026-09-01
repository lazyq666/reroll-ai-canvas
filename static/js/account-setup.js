(() => {
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const title = document.getElementById('setup-title');
  const subtitle = document.getElementById('setup-subtitle');
  const setupCard = document.querySelector('.setup-card');
  const selectionStep = document.getElementById('workspace-selection-step');
  const form = document.getElementById('initial-setup-form');
  const setupError = document.getElementById('setup-error');
  const directoryError = document.getElementById('directory-error');
  const completeMessage = document.getElementById('setup-complete');
  const workspaceStatus = document.getElementById('workspace-status');
  const inspectionResult = document.getElementById('workspace-inspection-result');
  const selectedWorkspace = document.getElementById('selected-workspace');
  const workspaceInput = document.getElementById('workspace-directory');
  const chooseButton = document.getElementById('choose-workspace-directory');
  const inspectButton = document.getElementById('inspect-workspace');
  const existingActions = document.getElementById('existing-workspace-actions');
  const openExistingButton = document.getElementById('open-existing-workspace');
  const backButton = document.getElementById('workspace-back');
  const completeButton = document.getElementById('complete-initial-setup');
  const setupUsername = document.getElementById('setup-username');
  const setupDisplayName = document.getElementById('setup-display-name');
  const setupPassword = document.getElementById('setup-password');
  const setupPasswordConfirm = document.getElementById('setup-password-confirm');
  let inspectedDirectory = '';

  const setupMessageKeys = {
    local_client_required: 'auth.localClientRequired',
    cross_site_rejected: 'auth.crossSiteRejected',
    setup_already_complete: 'auth.setupAlreadyComplete',
    invalid_username: 'auth.usernameInvalid',
    password_too_short: 'auth.passwordTooShort',
    workspace_setup_unavailable: 'auth.workspaceSetupUnavailable',
    workspace_setup_failed: 'auth.setupFailed',
    directory_picker_unavailable: 'auth.openPickerFailed',
    directory_picker_failed: 'auth.chooseDirectoryFailed',
    directory_required: 'auth.directoryRequired',
    workspace_inspection_unavailable: 'auth.inspectFailed',
    workspace_inspection_failed: 'auth.inspectRetry',
    workspace_open_unavailable: 'auth.openWorkspaceFailed',
    workspace_open_failed: 'auth.openWorkspaceRetry',
    previous_workspace_unavailable: 'auth.previousWorkspaceUnavailableGeneric',
    workspace_directory_required: 'auth.directoryRequired',
    workspace_directory_unavailable: 'auth.directoryUnavailable',
    workspace_storage_unknown: 'auth.workspaceStorageUnknown',
    workspace_storage_network_unsupported: 'auth.workspaceNetworkUnsupported',
    workspace_storage_unsupported: 'auth.workspaceStorageUnsupported',
    workspace_directory_empty: 'auth.workspaceEmptyReady',
    workspace_directory_non_empty: 'auth.workspaceNonEmpty',
    workspace_directory_incomplete: 'auth.workspaceIncomplete',
    workspace_existing: 'auth.workspaceExisting',
    setup_workspace_empty: 'auth.workspaceEmptyAdmin',
    setup_workspace_existing_accounts: 'auth.workspaceExistingAccounts',
    setup_workspace_invalid_accounts: 'auth.workspaceInvalidAccounts',
    setup_workspace_existing_needs_admin: 'auth.workspaceExistingNeedsAdmin',
  };
  const containsHan = value => /[\u3400-\u9fff]/u.test(String(value || ''));

  const localizedPayloadMessage = (payload, fallbackKey) => {
    const code = String(payload?.reason || payload?.message_code || '').trim();
    const message = typeof payload?.detail === 'string'
      ? payload.detail
      : (typeof payload?.message === 'string' ? payload.message : '');
    const isEnglish = window.StudioI18n?.lang?.() === 'en';
    if (message && !isEnglish) return message;
    const translatedKey = setupMessageKeys[code];
    if (translatedKey) return tr(translatedKey);
    if (message && !containsHan(message)) return message;
    return tr(fallbackKey);
  };

  const showMessage = (element, message) => {
    element.textContent = message;
    element.hidden = !message;
  };

  const setBusy = (button, busy) => {
    button.disabled = busy;
    button.loading = busy;
  };

  const applyTranslatedComponentLabels = () => {
    setupCard.setAttribute('label', tr('auth.localWorkspaceSetup'));
    document.getElementById('workspace-directory-field').setAttribute('label', tr('auth.workspaceDirectory'));
    document.getElementById('workspace-directory-field').setAttribute('hint', tr('auth.inspectOnly'));
    document.getElementById('setup-username-field').setAttribute('label', tr('auth.loginAccount'));
    document.getElementById('setup-username-field').setAttribute('hint', tr('auth.usernameHelp'));
    document.getElementById('setup-display-name-field').setAttribute('label', `${tr('auth.displayName')} · ${tr('auth.optional')}`);
    document.getElementById('setup-password-field').setAttribute('label', tr('auth.password'));
    document.getElementById('setup-password-confirm-field').setAttribute('label', tr('auth.confirmPassword'));
  };

  const showWorkspaceSelection = () => {
    form.hidden = true;
    selectionStep.hidden = false;
    title.dataset.i18n = 'auth.chooseWorkspace';
    subtitle.dataset.i18n = 'auth.workspaceSubtitle';
    title.textContent = tr('auth.chooseWorkspace');
    subtitle.textContent = tr('auth.workspaceSubtitle');
    showMessage(setupError, '');
    requestAnimationFrame(() => workspaceInput.focus());
  };

  const refreshSetupStatus = () => {
    fetch('/api/setup/status', { cache: 'no-store', credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : null)
      .then(status => {
        if (status && !status.required) window.location.replace('/login');
        if (!status) return;
        const suggestedWorkspace = status.configured_workspace_directory;
        if (suggestedWorkspace) workspaceInput.value = suggestedWorkspace;
        const messages = [];
        if (status.workspace_error && status.workspace_error_reason !== 'workspace_not_configured') {
          messages.push(localizedPayloadMessage({
            reason: status.workspace_error_reason,
            detail: status.workspace_error,
          }, 'auth.previousWorkspaceUnavailableGeneric'));
        }
        showMessage(workspaceStatus, messages.join(' '));
      })
      .catch(() => {});
  };

  window.addEventListener('studio-lang-change', applyTranslatedComponentLabels);
  applyTranslatedComponentLabels();
  Promise.all([
    customElements.whenDefined('ic-input'),
    customElements.whenDefined('ic-button'),
  ]).then(refreshSetupStatus);

  chooseButton.addEventListener('click', async () => {
    setBusy(chooseButton, true);
    showMessage(directoryError, '');
    try {
      const response = await fetch('/api/setup/select-directory', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizedPayloadMessage(payload, 'auth.openPickerFailed'));
      workspaceInput.value = payload.workspace_directory || '';
      inspectedDirectory = '';
      showMessage(inspectionResult, '');
      existingActions.hidden = true;
    } catch (reason) {
      showMessage(directoryError, reason.message || tr('auth.chooseDirectoryFailed'));
    } finally {
      setBusy(chooseButton, false);
    }
  });

  inspectButton.addEventListener('click', async () => {
    showMessage(directoryError, '');
    showMessage(inspectionResult, '');
    existingActions.hidden = true;
    const workspaceDirectory = String(workspaceInput.value || '').trim();
    if (!workspaceDirectory) {
      showMessage(directoryError, tr('auth.directoryRequired'));
      return;
    }
    setBusy(inspectButton, true);
    chooseButton.disabled = true;
    try {
      const response = await fetch('/api/setup/inspect-workspace', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_directory: workspaceDirectory }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizedPayloadMessage(payload, 'auth.inspectFailed'));
      inspectedDirectory = payload.workspace_directory || workspaceDirectory;
      workspaceInput.value = inspectedDirectory;
      showMessage(inspectionResult, localizedPayloadMessage(payload, 'auth.directoryUnavailable'));
      if (payload.next_step === 'create_admin') {
        selectionStep.hidden = true;
        form.hidden = false;
        title.dataset.i18n = 'auth.createAdmin';
        subtitle.dataset.i18n = 'auth.adminSubtitle';
        title.textContent = tr('auth.createAdmin');
        subtitle.textContent = tr('auth.adminSubtitle');
        showMessage(selectedWorkspace, tf('auth.workspacePath', { path: inspectedDirectory }));
        requestAnimationFrame(() => setupUsername.focus());
        return;
      }
      if (payload.next_step === 'login') {
        existingActions.hidden = false;
        return;
      }
      showMessage(
        directoryError,
        localizedPayloadMessage(payload, 'auth.directoryUnavailable'),
      );
    } catch (reason) {
      inspectedDirectory = '';
      showMessage(directoryError, reason.message || tr('auth.inspectRetry'));
    } finally {
      setBusy(inspectButton, false);
      chooseButton.disabled = false;
    }
  });

  openExistingButton.addEventListener('click', async () => {
    if (!inspectedDirectory) return;
    setBusy(openExistingButton, true);
    inspectButton.disabled = true;
    chooseButton.disabled = true;
    showMessage(directoryError, '');
    try {
      const response = await fetch('/api/setup/open-workspace', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_directory: inspectedDirectory }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizedPayloadMessage(payload, 'auth.openWorkspaceFailed'));
      showMessage(inspectionResult, tr('auth.workspaceConnected'));
      window.location.replace('/startup');
    } catch (reason) {
      showMessage(directoryError, reason.message || tr('auth.openWorkspaceRetry'));
      setBusy(openExistingButton, false);
      inspectButton.disabled = false;
      chooseButton.disabled = false;
    }
  });

  backButton.addEventListener('click', () => {
    inspectedDirectory = '';
    showWorkspaceSelection();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    showMessage(setupError, '');
    showMessage(completeMessage, '');
    if (!inspectedDirectory) {
      showWorkspaceSelection();
      return;
    }
    const nextPassword = String(setupPassword.value || '');
    if (nextPassword !== String(setupPasswordConfirm.value || '')) {
      showMessage(setupError, tr('auth.passwordMismatch'));
      return;
    }
    setBusy(completeButton, true);
    backButton.disabled = true;
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(setupUsername.value || '').trim(),
          display_name: String(setupDisplayName.value || '').trim(),
          password: nextPassword,
          workspace_directory: inspectedDirectory,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(localizedPayloadMessage(payload, 'auth.setupFailed'));
      form.reset();
      showMessage(
        completeMessage,
        tr('auth.setupSaved'),
      );
      completeButton.dataset.i18n = 'auth.setupDone';
      completeButton.textContent = tr('auth.setupDone');
      const restart = await fetch('/api/runtime/restart', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel_active: false }),
      });
      if (!restart.ok) throw new Error(tr('auth.restartFailed'));
      window.location.replace('/startup');
    } catch (reason) {
      showMessage(setupError, reason.message || tr('auth.setupRetry'));
      setBusy(completeButton, false);
      backButton.disabled = false;
    }
  });
})();
