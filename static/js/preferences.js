(function () {
    const tr = (key) => window.StudioI18n?.t?.(key) || key;
    const tf = (key, values) => window.StudioI18n?.format?.(key, values) || tr(key);
    const state = {
        open: false,
        loading: false,
        saving: false,
        active: {},
        configured: {},
        intent: "",
        selected: {},
        summary: null,
        message: "",
        error: "",
    };

    function escapeHtml(value = "") {
        return String(value ?? "").replace(
            /[&<>"']/g,
            (character) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[character],
        );
    }

    async function apiJson(url, options = {}) {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.detail || data.message || tr("preferences.operationFailed"));
        }
        return data;
    }

    function formatBytes(value) {
        let size = Math.max(0, Number(value || 0));
        const units = ["B", "KB", "MB", "GB", "TB"];
        let unit = 0;
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024;
            unit += 1;
        }
        const digits = unit === 0 || size >= 10 ? 0 : 1;
        return `${size.toFixed(digits)} ${units[unit]}`;
    }

    function formatDate(value) {
        const date = new Date(value || "");
        if (!value || Number.isNaN(date.getTime())) return tr("preferences.noRecord");
        return new Intl.DateTimeFormat(window.StudioI18n?.lang?.() === "en" ? "en-US" : "zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    }

    function actionLabel() {
        return state.intent === "move"
            ? tr("preferences.move")
            : tr("preferences.open");
    }

    function renderSummary() {
        const summary = state.summary;
        if (!summary) return "";
        const warnings = (summary.warnings || [])
            .map((warning) => `<li>${escapeHtml(warning)}</li>`)
            .join("");
        if (summary.operation === "move") {
            return `
                <ic-card class="preferences-summary" label="${tr("preferences.moveConfirmation")}" tone="subtle" size="small">
                    <div class="preferences-summary-head">
                        <div>
                            <span class="preferences-eyebrow">${tr("preferences.moveConfirmation")}</span>
                            <h3 id="workspaceSummaryTitle">${tr("preferences.move")}</h3>
                        </div>
                        <ic-badge kind="status" tone="success">${tr("preferences.canContinue")}</ic-badge>
                    </div>
                    <div class="preferences-move-paths">
                        <span><b>${tr("preferences.sourceDirectory")}</b>${escapeHtml(summary.source_workspace_directory || "")}</span>
                        <span><b>${tr("preferences.targetDirectory")}</b>${escapeHtml(summary.target_workspace_directory || "")}</span>
                    </div>
                    <div class="preferences-summary-grid">
                        <div><b>${Number(summary.file_count || 0)}</b><span>${tr("preferences.fileCount")}</span></div>
                        <div><b>${escapeHtml(formatBytes(summary.total_bytes))}</b><span>${tr("preferences.totalSize")}</span></div>
                        <div><b>${Number(summary.active_generation_tasks || 0)}</b><span>${tr("preferences.activeTasks")}</span></div>
                        <div><b>${escapeHtml(summary.storage_label || tr("preferences.localStorage"))}</b><span>${tr("preferences.targetLocation")}</span></div>
                    </div>
                    <div class="preferences-warnings">
                        <b>${tr("preferences.reminders")}</b>
                        <ul>${warnings || `<li>${tr("preferences.reviewBeforeMove")}</li>`}</ul>
                    </div>
                </ic-card>
            `;
        }
        return `
            <ic-card class="preferences-summary" label="${tr("preferences.directorySummary")}" tone="subtle" size="small">
                <div class="preferences-summary-head">
                    <div>
                        <span class="preferences-eyebrow">${tr("preferences.directorySummary")}</span>
                        <h3 id="workspaceSummaryTitle">${escapeHtml(summary.type_label || tr("preferences.workspaceDirectory"))}</h3>
                    </div>
                    <ic-badge kind="status" tone="${summary.can_continue ? "success" : "danger"}">
                        ${summary.can_continue ? tr("preferences.canContinue") : tr("preferences.chooseAgain")}
                    </ic-badge>
                </div>
                <div class="preferences-summary-grid">
                    <div><b>${Number(summary.smart_canvas_count || 0)}</b><span>Smart Canvas</span></div>
                    <div><b>${Number(summary.managed_media_count || 0)}</b><span>${tr("preferences.media")}</span></div>
                    <div><b>${Number(summary.file_count || 0)}</b><span>${tr("preferences.fileCount")}</span></div>
                    <div><b>${escapeHtml(formatBytes(summary.total_bytes))}</b><span>${tr("preferences.size")}</span></div>
                    <div><b>${escapeHtml(formatDate(summary.recent_modified_at))}</b><span>${tr("preferences.recentlyModified")}</span></div>
                </div>
                <div class="preferences-warnings">
                    <b>${tr("preferences.reminders")}</b>
                    <ul>${warnings || `<li>${tr("preferences.reviewDirectory")}</li>`}</ul>
                </div>
            </ic-card>
        `;
    }

    function render() {
        let dialog = document.getElementById("preferencesDialog");
        if (!state.open) {
            if (dialog?.open) void dialog.hide("close").finally(() => dialog.remove());
            else dialog?.remove();
            return;
        }
        const dialogWasMissing = !dialog;
        if (!dialog) {
            dialog = document.createElement("ic-dialog");
            dialog.id = "preferencesDialog";
            dialog.className = "preferences-dialog";
            dialog.setAttribute("size", "medium");
            dialog.setAttribute("dismiss-policy", "explicit");
            dialog.addEventListener("ic-after-hide", () => {
                if (state.open) closePreferencesModal();
            });
            document.body.appendChild(dialog);
        }
        dialog.setAttribute("label", tr("preferences.title"));
        const busy = state.loading || state.saving;
        const selectedDirectory = state.selected.workspace_directory || "";
        const confirmLabel =
            state.intent === "move"
                ? tr("preferences.confirmMove")
                : tr("preferences.confirmOpen");
        dialog.innerHTML = `
                <div slot="label" class="preferences-head">
                    <strong>${tr("preferences.title")}</strong>
                    <span>${tr("preferences.subtitle")}</span>
                </div>
                <div class="preferences-body">
                    <section class="preferences-section">
                        <h3>${tr("preferences.currentWorkspace")}</h3>
                        <div class="preferences-active-paths">
                            <span id="workspaceDirectory">${escapeHtml(state.active.workspace_directory || tr("preferences.loading"))}</span>
                        </div>
                    </section>
                    <section class="preferences-section preferences-operation-section">
                        <h3>${tr("preferences.chooseAction")}</h3>
                        <p class="preferences-note">${tr("preferences.inspectNote")}</p>
                        <ic-toolbar class="preferences-intents" label="${tr("preferences.chooseAction")}" appearance="plain">
                            <ic-button type="button" hierarchy="secondary" toggle data-preferences-intent="open" ${state.intent === "open" ? "pressed" : ""} ${busy ? "disabled" : ""}>
                                ${tr("preferences.open")}
                            </ic-button>
                            <ic-button type="button" hierarchy="secondary" toggle data-preferences-intent="move" ${state.intent === "move" ? "pressed" : ""} ${busy ? "disabled" : ""}>
                                ${tr("preferences.move")}
                            </ic-button>
                        </ic-toolbar>
                        ${
                            state.intent
                                ? `
                                    <div class="preferences-selection">
                                        <ic-button type="button" hierarchy="secondary" data-preferences-choose ${busy ? "disabled" : ""}>
                                            ${tf("preferences.chooseForAction", { action:actionLabel() })}
                                        </ic-button>
                                        ${
                                            selectedDirectory
                                                ? `<span><b>${tr("preferences.selectedDirectory")}</b>${escapeHtml(selectedDirectory)}</span>`
                                                : `<span>${tr("preferences.pickerLocation")}</span>`
                                        }
                                    </div>
                                `
                                : ""
                        }
                        ${renderSummary()}
                        ${state.error ? `<ic-alert class="preferences-message" tone="danger">${escapeHtml(state.error)}</ic-alert>` : ""}
                        ${state.message ? `<ic-alert class="preferences-message" tone="info">${escapeHtml(state.message)}</ic-alert>` : ""}
                    </section>
                </div>
                <ic-button slot="footer" hierarchy="secondary" type="button" data-preferences-close>${state.summary ? tr("preferences.exitNoChanges") : tr("common.close")}</ic-button>
                    ${
                        state.summary
                            ? `<ic-button slot="footer" hierarchy="primary" type="button" data-preferences-confirm ${busy || !state.summary.can_continue ? "disabled" : ""}>${confirmLabel}</ic-button>`
                            : ""
                    }
        `;
        if (dialogWasMissing) {
            customElements.whenDefined("ic-dialog").then(() => {
                if (state.open && !dialog.open) void dialog.show();
            });
        }
    }

    async function loadPreferences() {
        state.loading = true;
        state.error = "";
        render();
        try {
            const data = await apiJson("/api/workspace-storage-settings");
            state.active = data.active || {};
            state.configured = data.configured || {};
        } catch (error) {
            state.error = error.message || tr("preferences.readFailed");
        } finally {
            state.loading = false;
            render();
        }
    }

    function chooseIntent(intent) {
        state.intent = intent === "move" ? "move" : "open";
        state.selected = {};
        state.summary = null;
        state.message = "";
        state.error = "";
        render();
    }

    async function chooseDirectory() {
        if (!state.intent) {
            state.error = tr("preferences.chooseActionFirst");
            render();
            return;
        }
        state.loading = true;
        state.error = "";
        state.summary = null;
        state.message = tr("preferences.openingPicker");
        render();
        try {
            const selected = await apiJson(
                "/api/workspace-storage-settings/select-directory",
                { method: "POST" },
            );
            const workspaceDirectory = selected.workspace_directory || "";
            state.selected = { workspace_directory: workspaceDirectory };
            state.message = tr("preferences.readingSummary");
            render();
            state.summary = await apiJson(
                state.intent === "move"
                    ? "/api/workspace-storage-settings/plan-move"
                    : "/api/workspace-storage-settings/inspect",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        state.intent === "move"
                            ? {
                                  workspace_directory: workspaceDirectory,
                              }
                            : {
                                  workspace_directory: workspaceDirectory,
                                  intent: state.intent,
                              },
                    ),
                },
            );
            state.message = "";
        } catch (error) {
            state.message = "";
            state.error = error.message || tr("preferences.selectedReadFailed");
        } finally {
            state.loading = false;
            render();
        }
    }

    async function confirmWorkspaceAction() {
        const workspaceDirectory =
            state.selected.workspace_directory || "";
        const migrate = state.intent === "move";
        if (!workspaceDirectory || !state.summary?.can_continue) {
            state.error = tr("preferences.chooseUsable");
            render();
            return;
        }
        state.saving = true;
        state.error = "";
        state.message = migrate
            ? tr("preferences.preparingMove")
            : tr("preferences.preparingOpen");
        render();
        try {
            if (!migrate) {
                const opening = await apiJson(
                    "/api/workspace-storage-settings/open",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            workspace_directory: workspaceDirectory,
                            cancel_active: false,
                        }),
                    },
                );
                state.message =
                    opening.stage === "restart_waiting"
                        ? tf("preferences.waitingOpen", { count:opening.blocking_generation_runs || 0 })
                        : tr("preferences.restarting");
                render();
                window.location.assign("/startup");
                return;
            }
            const moving = await apiJson(
                "/api/workspace-storage-settings/move",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        workspace_directory: workspaceDirectory,
                        cancel_active: false,
                        return_url:
                            window.location.pathname +
                            window.location.search +
                            window.location.hash,
                    }),
                },
            );
            state.message =
                moving.stage === "waiting_for_generation_tasks"
                    ? tf("preferences.waitingMove", { count:moving.blocking_generation_tasks || 0 })
                    : tr("preferences.moveStarted");
            render();
            window.location.assign(
                moving.progress_url || "/workspace-move",
            );
            return;
        } catch (error) {
            state.message = "";
            state.error = error.message || tr("preferences.workspaceFailed");
        } finally {
            state.saving = false;
            render();
        }
    }

    function closePreferencesModal() {
        state.open = false;
        state.intent = "";
        state.selected = {};
        state.summary = null;
        state.message = "";
        state.error = "";
        render();
    }

    async function openPreferencesModal() {
        state.open = true;
        state.message = "";
        state.error = "";
        render();
        await loadPreferences();
    }

    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-preferences-close]")) {
            closePreferencesModal();
            return;
        }
        const intentButton = target.closest("[data-preferences-intent]");
        if (intentButton) {
            chooseIntent(intentButton.dataset.preferencesIntent);
            return;
        }
        if (target.closest("[data-preferences-choose]")) {
            chooseDirectory();
            return;
        }
        if (target.closest("[data-preferences-confirm]")) {
            confirmWorkspaceAction();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.open) {
            event.preventDefault();
            closePreferencesModal();
        }
    });

    window.openPreferencesModal = openPreferencesModal;
    window.closePreferencesModal = closePreferencesModal;
    window.addEventListener("studio-lang-change", () => { if (state.open) render(); });
})();
