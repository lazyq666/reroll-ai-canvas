(function(){
    'use strict';

    /* ---------------------------------------------------------------------
     * HistoryBulkManager
     * 历史图片批量管理：进入管理模式后可多选 / 全选 / 批量删除。
     * ZImage 与 Enhance 共用同一套 Reroll UI 契约：
     *   - 卡片含 [data-history-ts] 属性 与 id="history-{ts}"
     *   - 卡片 onclick 在 body.history-bulk-selecting 时提前 return
     *   - 删除走 POST /api/history/delete {timestamp}
     * 用法：window.HistoryBulkManager.attach({ masonry:'#masonry' })
     * ------------------------------------------------------------------- */

    function tr(key){
        return (window.StudioI18n && StudioI18n.t) ? StudioI18n.t(key) : key;
    }
    function fmt(key, vars){
        let s = tr(key);
        if(vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
        return s;
    }

    function attach(opts){
        opts = opts || {};
        const masonrySel = opts.masonry || '#masonry';
        const masonry = document.querySelector(masonrySel);
        if(!masonry) return null;
        if(masonry.dataset.hbmAttached === '1') return masonry._hbm || null;
        masonry.dataset.hbmAttached = '1';

        let selecting = false;

        /* -------- 工具条 -------- */
        const bar = document.createElement('div');
        bar.className = 'hbm-toolbar';

        function actionButton(className, hierarchy, icon, tone){
            const button = document.createElement('ic-button');
            button.type = 'button';
            button.className = className;
            button.setAttribute('hierarchy', hierarchy);
            if(tone) button.setAttribute('tone', tone);
            if(icon){
                const actionIcon = document.createElement('ic-icon');
                actionIcon.slot = 'start';
                actionIcon.setAttribute('name', icon);
                button.append(actionIcon);
            }
            const label = document.createElement('span');
            button.append(label);
            return { button, label };
        }

        const manageAction = actionButton('hbm-btn', 'secondary', 'check');
        const manageBtn = manageAction.button;
        const manageLabel = manageAction.label;

        const spacer = document.createElement('div');
        spacer.className = 'hbm-spacer';

        const countEl = document.createElement('span');
        countEl.className = 'hbm-count hbm-hide';

        const selectAllAction = actionButton('hbm-btn hbm-hide', 'secondary');
        const selectAllBtn = selectAllAction.button;
        const selectAllLabel = selectAllAction.label;

        const deleteAction = actionButton('hbm-btn hbm-danger hbm-hide', 'secondary', 'delete', 'danger');
        const deleteBtn = deleteAction.button;
        const deleteLabel = deleteAction.label;

        const exitAction = actionButton('hbm-btn hbm-primary hbm-hide', 'primary');
        const exitBtn = exitAction.button;
        const exitLabel = exitAction.label;

        bar.append(manageBtn, spacer, countEl, selectAllBtn, deleteBtn, exitBtn);
        masonry.parentNode.insertBefore(bar, masonry);

        function cards(){
            return Array.from(masonry.querySelectorAll('[data-history-ts]'));
        }
        function selectedCards(){
            return cards().filter(c => c.classList.contains('hbm-selected'));
        }

        function refreshLabels(){
            manageLabel.textContent = tr('bulk.manage');
            const all = cards();
            const sel = selectedCards();
            countEl.textContent = fmt('bulk.selectedCount', { n: sel.length });
            const allSelected = all.length > 0 && sel.length === all.length;
            selectAllLabel.textContent = allSelected ? tr('bulk.deselectAll') : tr('bulk.selectAll');
            deleteLabel.textContent = tr('bulk.deleteSelected');
            deleteBtn.disabled = sel.length === 0;
            exitLabel.textContent = tr('bulk.exit');
        }

        function enter(){
            selecting = true;
            document.body.classList.add('history-bulk-selecting');
            manageBtn.classList.add('hbm-hide');
            [countEl, selectAllBtn, deleteBtn, exitBtn].forEach(el => el.classList.remove('hbm-hide'));
            refreshLabels();
        }
        function exit(){
            selecting = false;
            document.body.classList.remove('history-bulk-selecting');
            cards().forEach(c => c.classList.remove('hbm-selected'));
            manageBtn.classList.remove('hbm-hide');
            [countEl, selectAllBtn, deleteBtn, exitBtn].forEach(el => el.classList.add('hbm-hide'));
            refreshLabels();
        }

        manageBtn.addEventListener('click', enter);
        exitBtn.addEventListener('click', exit);

        selectAllBtn.addEventListener('click', () => {
            const all = cards();
            const allSelected = all.length > 0 && selectedCards().length === all.length;
            all.forEach(c => c.classList.toggle('hbm-selected', !allSelected));
            refreshLabels();
        });

        /* 选择模式下点击卡片 = 切换选中（捕获阶段拦截，避免触发卡片自身逻辑） */
        masonry.addEventListener('click', (e) => {
            if(!selecting) return;
            const card = e.target.closest('[data-history-ts]');
            if(!card || !masonry.contains(card)) return;
            e.preventDefault();
            e.stopPropagation();
            card.classList.toggle('hbm-selected');
            refreshLabels();
        }, true);

        async function doDelete(){
            const sel = selectedCards();
            if(sel.length === 0) return;
            const message = fmt('bulk.deleteConfirm', { n: sel.length });
            if(typeof opts.confirmDelete !== 'function') return;
            const confirmed = await opts.confirmDelete(sel.length, message);
            if(!confirmed) return;

            deleteBtn.disabled = true;
            deleteLabel.textContent = tr('bulk.deleting');

            const results = await Promise.allSettled(sel.map(card => {
                const ts = card.dataset.historyTs;
                return fetch('/api/history/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timestamp: ts })
                }).then(r => r.json()).then(res => {
                    if(res && res.success){ card.remove(); return true; }
                    throw new Error('delete failed');
                });
            }));

            const failed = results.filter(r => r.status === 'rejected').length;
            if(failed > 0){
                const message = failed + ' / ' + sel.length + ' ✗';
                if(typeof opts.notify === 'function') opts.notify(message, 'danger');
            }

            refreshLabels();
            if(selectedCards().length === 0 && cards().length === 0){ exit(); }
            else { deleteBtn.disabled = selectedCards().length === 0; deleteLabel.textContent = tr('bulk.deleteSelected'); }
        }
        deleteBtn.addEventListener('click', doDelete);

        /* 语言切换时刷新文案 */
        window.addEventListener('studio-lang-change', refreshLabels);

        refreshLabels();

        const api = { enter, exit, refresh: refreshLabels, isSelecting: () => selecting };
        masonry._hbm = api;
        return api;
    }

    window.HistoryBulkManager = { attach };
})();
