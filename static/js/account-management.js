(() => {
  const ALL_PROJECTS_VALUE = '__all_projects__';
  const tr = (key) => window.StudioI18n?.t?.(key) || key;
  const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
  const applicationsHost = document.getElementById('account-applications');
  const usersHost = document.getElementById('account-users');
  const pendingCount = document.getElementById('pending-count');
  const capacity = document.getElementById('capacity-value');
  const message = document.getElementById('page-message');
  const passwordDialog = document.getElementById('temporary-password-dialog');
  const confirmationDialog = document.getElementById('account-confirmation-dialog');
  const confirmationCopy = document.getElementById('account-confirmation-copy');
  const passwordInput = document.getElementById('temporary-password');
  const passwordAccount = document.getElementById('password-account');
  const roleLabels = { admin: 'auth.admin', designer: 'auth.designer', guest: 'auth.guest' };
  const statusLabels = { active: 'auth.active', disabled: 'auth.disabled' };
  let currentUserId = '';
  let pendingConfirmation = null;
  let projects = [];

  const setMessage = (text, isError = false) => {
    message.textContent = text || '';
    message.setAttribute('tone', isError ? 'danger' : 'success');
    message.hidden = !text;
  };
  const showRefreshToast = async (text) => {
    await customElements.whenDefined('ic-toast');
    customElements.get('ic-toast').notify(text, { tone: 'success' });
  };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || tr('auth.operationRetry'));
    return payload;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, hierarchy, action, { tone = 'neutral', actionName = '' } = {}) => {
    const node = element('ic-button', '', label);
    node.type = 'button';
    node.hierarchy = hierarchy;
    node.tone = tone;
    if (actionName) node.dataset.action = actionName;
    node.addEventListener('click', async () => {
      node.loading = true;
      setMessage('');
      try { await action(); } catch (reason) { setMessage(reason.message || tr('auth.operationFailed'), true); }
      finally { node.loading = false; }
    });
    return node;
  };
  const badge = (label, tone = 'neutral', kind = 'status') => {
    const node = element('ic-badge', '', label);
    node.setAttribute('kind', kind);
    node.setAttribute('tone', tone);
    return node;
  };
  const labeledAccountField = (label, value) => {
    const host = element('div', 'account-field');
    host.append(
      element('span', 'account-field-label', label),
      element('strong', 'account-field-value', value || '—'),
    );
    return host;
  };
  const formatTime = (seconds) => seconds
    ? new Date(seconds * 1000).toLocaleString(window.StudioI18n?.lang?.() === 'en' ? 'en-US' : 'zh-CN', { hour12: false })
    : '—';

  const renderProjectPermissions = (user) => {
    const cell = document.createElement('td');
    cell.className = 'project-permissions-cell';
    if (user.role !== 'designer') {
      cell.appendChild(element('span', 'project-access-all', tr('auth.allProjects')));
      return cell;
    }

    const selectedIds = Array.isArray(user.project_ids)
      ? new Set(user.project_ids)
      : new Set(projects.map((project) => project.id));
    const allProjectIds = projects.map((project) => project.id);
    const hasAllProjects = allProjectIds.every((projectId) => selectedIds.has(projectId));
    const select = element('ic-select', 'project-permission-select');
    select.name = `project-permissions-${user.id}`;
    select.setAttribute('aria-label', tf('auth.projectPermissionsFor', { username: user.username }));
    select.setAttribute('hierarchy', 'quiet');
    select.multiple = true;
    const allProjectsOption = element('option', '', tr('auth.allProjects'));
    allProjectsOption.value = ALL_PROJECTS_VALUE;
    allProjectsOption.selected = hasAllProjects;
    select.appendChild(allProjectsOption);
    projects.forEach((project) => {
      const option = element('option', '', project.name);
      option.value = project.id;
      option.selected = !hasAllProjects && selectedIds.has(project.id);
      select.appendChild(option);
    });
    let permissionsDirty = false;
    let previousValues = new Set(hasAllProjects ? [ALL_PROJECTS_VALUE] : selectedIds);
    select.addEventListener('change', () => {
      const values = Array.isArray(select.value) ? select.value : [];
      const selectedAll = values.includes(ALL_PROJECTS_VALUE);
      if (selectedAll && !previousValues.has(ALL_PROJECTS_VALUE)) {
        select.value = [ALL_PROJECTS_VALUE];
      } else if (selectedAll && values.length > 1) {
        select.value = values.filter((value) => value !== ALL_PROJECTS_VALUE);
      }
      previousValues = new Set(Array.isArray(select.value) ? select.value : []);
      permissionsDirty = true;
    });
    select.addEventListener('ic-after-hide', async () => {
      if (!permissionsDirty) return;
      permissionsDirty = false;
      select.disabled = true;
      setMessage('');
      try {
        const values = Array.isArray(select.value) ? select.value : [];
        const projectIds = values.includes(ALL_PROJECTS_VALUE)
          ? allProjectIds
          : values.filter((value) => value !== ALL_PROJECTS_VALUE);
        await request(`/api/admin/accounts/${encodeURIComponent(user.id)}/project-permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_ids: projectIds }),
        });
        setMessage(tf('auth.projectPermissionsSaved', { username: user.username }));
      } catch (reason) {
        setMessage(reason.message || tr('auth.operationFailed'), true);
        await load();
      } finally {
        select.disabled = false;
      }
    });
    cell.appendChild(select);
    return cell;
  };

  const confirmAction = ({ label, description, confirmLabel, consequence = 'neutral' }) => new Promise((resolve) => {
    pendingConfirmation?.(false);
    pendingConfirmation = resolve;
    confirmationDialog.label = label;
    confirmationDialog.description = description;
    confirmationCopy.textContent = description;
    confirmationDialog.confirmLabel = confirmLabel;
    confirmationDialog.cancelLabel = tr('common.cancel');
    confirmationDialog.consequence = consequence;
    confirmationDialog.show();
  });

  confirmationDialog.addEventListener('ic-confirm', async () => {
    const resolve = pendingConfirmation;
    pendingConfirmation = null;
    await confirmationDialog.hide('confirm');
    resolve?.(true);
  });
  confirmationDialog.addEventListener('ic-cancel', () => {
    const resolve = pendingConfirmation;
    pendingConfirmation = null;
    resolve?.(false);
  });

  const renderApplications = (applications) => {
    applicationsHost.replaceChildren();
    const pending = applications.filter((item) => item.status === 'pending');
    pendingCount.textContent = String(pending.length);
    if (!applications.length) {
      const empty = element('ic-empty-state');
      empty.title = tr('auth.noApplications');
      empty.label = tr('auth.applications');
      applicationsHost.appendChild(empty);
      return;
    }
    applications.forEach((application) => {
      const card = element('article', `application-card${application.status === 'rejected' ? ' is-rejected' : ''}`);
      const identity = element('div', 'application-identity');
      identity.append(
        labeledAccountField(tr('auth.loginAccount'), application.username),
        labeledAccountField(tr('auth.displayName'), application.display_name),
        element('div', 'application-meta', `${tr(application.status === 'pending' ? 'auth.pendingReview' : 'auth.rejected')} · ${formatTime(application.requested_at)}`),
      );
      card.appendChild(identity);
      const actions = element('div', 'application-actions');
      if (application.status === 'pending') {
        actions.append(
          button(tr('auth.reject'), 'secondary', async () => {
            const confirmed = await confirmAction({
              label: tr('auth.reject'),
              description: tf('auth.rejectConfirm', { username: application.username }),
              confirmLabel: tr('auth.reject'),
              consequence: 'destructive',
            });
            if (!confirmed) return;
            await request(`/api/admin/account-applications/${encodeURIComponent(application.id)}/reject`, { method: 'POST' });
            setMessage(tf('auth.rejectedApplication', { username: application.username }));
            await load();
          }, { tone: 'danger', actionName: `reject-${application.id}` }),
          button(tr('auth.approve'), 'primary', async () => {
            await request(`/api/admin/account-applications/${encodeURIComponent(application.id)}/approve`, { method: 'POST' });
            setMessage(tf('auth.approvedApplication', { username: application.username }));
            await load();
          }, { actionName: `approve-${application.id}` }),
        );
      } else {
        actions.appendChild(badge(tr('auth.rejected'), 'danger'));
      }
      card.appendChild(actions);
      applicationsHost.appendChild(card);
    });
  };

  const renderUsers = (users) => {
    usersHost.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement('tr');
      row.dataset.userId = user.id;
      const username = document.createElement('td');
      const identity = element('div', 'account-user-identity');
      const identityCopy = element('div', 'account-user-copy');
      identityCopy.appendChild(element('div', 'account-name', user.username));
      if (user.id === currentUserId) identityCopy.appendChild(element('div', 'account-meta', tr('auth.currentAccount')));
      identity.append(
        window.InfiniteCanvasAccountAvatar?.create?.(user) || element('span', 'ic-account-avatar'),
        identityCopy,
      );
      username.appendChild(identity);
      const displayName = document.createElement('td');
      displayName.appendChild(element('div', 'account-display-name', user.display_name || '—'));
      const role = document.createElement('td');
      role.appendChild(badge(roleLabels[user.role] ? tr(roleLabels[user.role]) : user.role, 'neutral', 'label'));
      const projectPermissions = renderProjectPermissions(user);
      const status = document.createElement('td');
      status.appendChild(badge(statusLabels[user.status] ? tr(statusLabels[user.status]) : user.status, user.status === 'active' ? 'success' : 'neutral'));
      const actionsCell = document.createElement('td');
      actionsCell.className = 'user-actions';
      const actions = element('div', 'user-actions-content');
      const remove = button(tr('common.delete'), 'secondary', async () => {
        const confirmed = await confirmAction({
          label: tr('common.delete'),
          description: tf('auth.deleteAccountConfirm', { username: user.username }),
          confirmLabel: tr('common.delete'),
          consequence: 'destructive',
        });
        if (!confirmed) return;
        await request(`/api/admin/accounts/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        setMessage(tf('auth.deletedAccount', { username: user.username }));
        await load();
      }, { tone: 'danger', actionName: `delete-${user.id}` });
      remove.disabled = user.id === currentUserId;
      remove.title = user.id === currentUserId ? tr('auth.cannotDeleteCurrent') : '';
      actions.append(
        remove,
        button(tr('auth.resetPassword'), 'secondary', async () => {
          const confirmed = await confirmAction({
            label: tr('auth.resetPassword'),
            description: tf('auth.resetConfirm', { username: user.username }),
            confirmLabel: tr('common.confirm'),
          });
          if (!confirmed) return;
          const payload = await request(`/api/admin/accounts/${encodeURIComponent(user.id)}/reset-password`, { method: 'POST' });
          passwordAccount.textContent = user.username;
          passwordInput.value = payload.temporary_password;
          passwordDialog.show();
        }, { actionName: `reset-${user.id}` }),
      );
      actionsCell.appendChild(actions);
      row.append(username, displayName, role, projectPermissions, status, actionsCell);
      usersHost.appendChild(row);
    });
  };

  const load = async () => {
    const [accounts, me, projectPayload] = await Promise.all([
      request('/api/admin/accounts', { cache: 'no-store' }),
      request('/api/auth/me', { cache: 'no-store' }),
      request('/api/projects', { cache: 'no-store' }),
    ]);
    currentUserId = me.user.id;
    projects = projectPayload.projects || [];
    const registration = accounts.registration || {};
    const reserved = (registration.active_accounts || 0) + (registration.pending_applications || 0);
    capacity.textContent = `${reserved} / ${registration.max_accounts || 40}`;
    renderApplications(accounts.applications || []);
    renderUsers(accounts.users || []);
  };

  document.getElementById('refresh-accounts').addEventListener('click', async (event) => {
    const refreshButton = event.currentTarget;
    refreshButton.loading = true;
    setMessage('');
    try {
      await load();
      await showRefreshToast(tr('auth.accountsRefreshed'));
    } catch (reason) {
      setMessage(reason.message || tr('auth.loadFailed'), true);
    } finally {
      refreshButton.loading = false;
    }
  });
  document.getElementById('copy-password').addEventListener('click', async (event) => {
    try {
      await navigator.clipboard.writeText(passwordInput.value);
      event.currentTarget.textContent = tr('auth.copied');
      window.setTimeout(() => { event.currentTarget.textContent = tr('auth.copy'); }, 1200);
    } catch (_) {
      passwordInput.select();
      document.execCommand('copy');
    }
  });
  document.getElementById('close-password-dialog').addEventListener('click', () => passwordDialog.hide('saved'));
  passwordDialog.addEventListener('ic-after-hide', () => { passwordInput.value = ''; });

  window.addEventListener('studio-lang-change', () => {
    setMessage('');
    load().catch((reason) => setMessage(reason.message || tr('auth.accountInfoFailed'), true));
  });
  load().catch((reason) => setMessage(reason.message || tr('auth.accountInfoFailed'), true));
})();
