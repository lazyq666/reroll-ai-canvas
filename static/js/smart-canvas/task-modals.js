(function(){
    const taskModalText = (key, fallback) => {
        const translated = window.StudioI18n?.t?.(key);
        return translated && translated !== key ? translated : fallback;
    };

    function formatBytes(bytes){
        const value = Math.max(0,Number(bytes) || 0);
        if(value < 1024) return `${value} B`;
        if(value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        const megabytes = value / 1024 / 1024;
        return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
    }
    function focusControl(control){
        control?.focus?.();
        control?.input?.focus?.();
        control?.button?.focus?.();
    }
    async function validateNodePackageFile(file, maxBytes=0){
        if(!file) throw new Error(taskModalText('smart.nodePackageFileRequired', 'Choose a Node Package file'));
        if(!/\.(json|zip)$/i.test(file.name || '')) throw new Error(taskModalText('smart.nodePackageTypeRequired', 'Choose a JSON or ZIP Node Package'));
        if(!file.size) throw new Error(taskModalText('smart.nodePackageEmpty', 'The Node Package is empty and cannot be read'));
        const configuredMaxBytes = Number(maxBytes);
        if(Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0 && file.size > configuredMaxBytes){
            const maxSize = formatBytes(configuredMaxBytes);
            const message = taskModalText('smart.nodePackageTooLarge', 'The Node Package exceeds the {maxSize} upload limit');
            throw new Error(message.replaceAll('{maxSize}', maxSize));
        }
        if(/\.zip$/i.test(file.name || '')){
            const signature = new Uint8Array(await file.slice(0,4).arrayBuffer());
            if(signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error(taskModalText('smart.nodePackageZipInvalid', 'The ZIP Node Package is invalid'));
        } else {
            let payload;
            try { payload = JSON.parse(await file.text()); }
            catch(error){ throw new Error(taskModalText('smart.nodePackageJsonInvalid', 'Could not parse the JSON Node Package')); }
            const nodes = Array.isArray(payload) ? payload : payload?.nodes ?? payload?.workflow?.nodes;
            if(!Array.isArray(nodes)) throw new Error(taskModalText('smart.nodePackageNodesMissing', 'The JSON Node Package is missing nodes'));
            if(!nodes.length) throw new Error(taskModalText('smart.nodePackageNoNodes', 'The Node Package contains no nodes to import'));
        }
        return file;
    }
    function create(options){
        const shortcutDialog = options.shortcutDialog;
        const shortcutTrigger = options.shortcutTrigger;
        const shortcutSearch = document.getElementById('smartShortcutSearch');
        const shortcutClear = document.getElementById('smartShortcutSearchClear');
        const shortcutEmpty = document.getElementById('smartShortcutEmpty');
        const importDialog = options.importDialog;
        const importLauncher = options.importLauncher;
        const fileInput = options.fileInput;
        const modalDropzone = document.getElementById('smartNodePackageDropzone');
        const limitCopy = document.getElementById('smartNodePackageLimits');
        const browseButton = document.getElementById('smartNodePackageBrowse');
        const selectedCard = document.getElementById('smartNodePackageSelected');
        const selectedName = document.getElementById('smartNodePackageFileName');
        const selectedMeta = document.getElementById('smartNodePackageFileMeta');
        const secondaryAction = document.getElementById('smartNodePackageSecondaryAction');
        const clearButton = document.getElementById('smartNodePackageClear');
        const chooseError = document.getElementById('smartNodePackageChooseError');
        const reviewName = document.getElementById('smartNodePackageReviewFileName');
        const reviewMeta = document.getElementById('smartNodePackageReviewFileMeta');
        const nodeCount = document.getElementById('smartNodePackageNodeCount');
        const connectionCount = document.getElementById('smartNodePackageConnectionCount');
        const resourceSize = document.getElementById('smartNodePackageResourceSize');
        const resourceCount = document.getElementById('smartNodePackageResourceCount');
        const warning = document.getElementById('smartNodePackageWarning');
        const reviewError = document.getElementById('smartNodePackageReviewError');
        const successCopy = document.getElementById('smartNodePackageSuccessCopy');
        const cancelButton = document.getElementById('smartNodePackageCancel');
        const primaryButton = document.getElementById('smartNodePackagePrimary');
        let step = 'choose';
        let file = null;
        let inspection = null;
        let importedIds = [];
        let dragDepth = 0;
        let maxNodePackageBytes = 0;

        const text = (key,fallback) => {
            const value = options.translate?.(key);
            return value && value !== key ? value : fallback;
        };
        const format = (key,values,fallback) => {
            const value = options.format?.(key,values);
            return value && value !== key ? value : fallback;
        };
        function setError(target,message){
            target.textContent = message || '';
            target.hidden = !message;
            if(message) requestAnimationFrame(() => target.focus());
        }
        function syncNodePackageLimitCopy(){
            if(!limitCopy) return;
            limitCopy.textContent = maxNodePackageBytes > 0
                ? format(
                    'smart.nodePackageLimits',
                    {maxSize:formatBytes(maxNodePackageBytes)},
                    `JSON or ZIP, up to ${formatBytes(maxNodePackageBytes)}`,
                )
                : text('smart.nodePackageFormats', 'JSON or ZIP');
        }
        async function refreshNodePackageLimits(){
            let limits = null;
            try { limits = await options.loadNodePackageLimits?.(); }
            catch(_) { limits = null; }
            const configured = Number(limits?.max_archive_bytes);
            maxNodePackageBytes = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 0;
            syncNodePackageLimitCopy();
        }
        function syncShortcutPlatform(){
            const platform = options.platform?.() || (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? 'apple' : 'standard');
            const visible = platform === 'apple'
                ? {primary:'⌘',alternate:'⌥',delete:'⌫',shift:'⇧'}
                : {primary:'Ctrl',alternate:'Alt',delete:'Del',shift:'Shift'};
            const accessible = platform === 'apple'
                ? {primary:'Command',alternate:'Option',delete:'Delete',shift:'Shift'}
                : visible;
            shortcutDialog.dataset.shortcutPlatform = platform;
            shortcutDialog.querySelectorAll('[data-shortcut-key]').forEach(key => {
                const name = key.dataset.shortcutKey;
                key.textContent = visible[name] || key.textContent;
                key.setAttribute('aria-label',accessible[name] || key.textContent);
            });
        }
        function filterShortcuts(){
            const query = String(shortcutSearch?.value || '').trim().toLocaleLowerCase();
            shortcutClear.hidden = !query;
            let visibleRows = 0;
            shortcutDialog.querySelectorAll('[data-shortcut-group]').forEach(group => {
                let groupRows = 0;
                group.querySelectorAll('[data-shortcut-row]').forEach(row => {
                    const visible = !query || row.textContent.toLocaleLowerCase().includes(query);
                    row.hidden = !visible;
                    if(visible) groupRows += 1;
                });
                group.hidden = groupRows === 0;
                visibleRows += groupRows;
            });
            shortcutEmpty.hidden = visibleRows > 0;
        }
        async function openShortcuts(){
            options.beforeShortcutOpen?.();
            syncShortcutPlatform();
            filterShortcuts();
            shortcutTrigger?.setAttribute('aria-expanded','true');
            await shortcutDialog.show();
            focusControl(shortcutSearch);
        }
        async function closeShortcuts(reason='programmatic'){
            if(shortcutDialog?.open) await shortcutDialog.hide(reason);
        }
        function syncImportView(){
            importDialog.querySelectorAll('[data-node-package-step]').forEach(section => {
                section.hidden = section.dataset.nodePackageStep !== step;
            });
            modalDropzone.hidden = Boolean(file);
            selectedCard.hidden = !file;
            secondaryAction.hidden = !file;
            if(file){
                const packageType = /\.json$/i.test(file.name || '')
                    ? text('smart.jsonNodePackage','JSON 节点包')
                    : text('smart.zipNodePackage','ZIP 节点包');
                const meta = `${formatBytes(file.size)} · ${packageType}`;
                selectedName.textContent = file.name;
                selectedMeta.textContent = meta;
                reviewName.textContent = file.name;
                reviewMeta.textContent = meta;
            }
            cancelButton.textContent = step === 'done'
                ? text('common.close','关闭')
                : step === 'review' ? text('common.back','返回') : text('common.cancel','取消');
            primaryButton.textContent = step === 'done'
                ? text('smart.locateImportedNodes','定位到新节点')
                : step === 'review'
                    ? format('smart.importNodeCount',{count:inspection?.node_count || 0},`导入 ${inspection?.node_count || 0} 个节点`)
                    : text('common.continue','继续');
            primaryButton.disabled = step === 'choose' && !file;
            primaryButton.loading = false;
        }
        function resetImport(){
            step = 'choose';
            file = null;
            inspection = null;
            importedIds = [];
            dragDepth = 0;
            fileInput.value = '';
            modalDropzone.classList.remove('is-dragging');
            setError(chooseError,'');
            setError(reviewError,'');
            warning.hidden = true;
            syncImportView();
        }
        async function chooseFile(nextFile){
            setError(chooseError,'');
            primaryButton.disabled = true;
            try {
                file = await validateNodePackageFile(nextFile,maxNodePackageBytes);
                syncImportView();
                primaryButton.disabled = false;
                focusControl(clearButton);
            } catch(error){
                file = null;
                syncImportView();
                setError(chooseError,error.message || text('smart.importNodePackageFailed','导入节点包失败'));
            }
        }
        async function openImport(nextFile=null){
            options.beforeImportOpen?.();
            resetImport();
            importLauncher?.setAttribute('aria-expanded','true');
            await importDialog.show();
            await refreshNodePackageLimits();
            if(nextFile) await chooseFile(nextFile);
            else focusControl(modalDropzone);
        }
        function showInspection(nextInspection){
            inspection = nextInspection;
            step = 'review';
            nodeCount.textContent = String(inspection.node_count || 0);
            connectionCount.textContent = String(inspection.connection_count || 0);
            resourceSize.textContent = formatBytes(inspection.resource_bytes || 0);
            resourceCount.textContent = format('smart.resourceCount',{count:inspection.resource_count || 0},`${inspection.resource_count || 0} 个资源`);
            const warningCopy = String(inspection.warning || '');
            warning.hidden = !warningCopy;
            warning.querySelector('span').textContent = warningCopy;
            syncImportView();
            focusControl(cancelButton);
        }
        async function inspectSelected(){
            if(!file) return;
            setError(chooseError,'');
            primaryButton.loading = true;
            primaryButton.disabled = true;
            try {
                showInspection(await options.inspectFile(file));
            } catch(error){
                primaryButton.loading = false;
                primaryButton.disabled = false;
                setError(chooseError,error.message || text('smart.importNodePackageFailed','导入节点包失败'));
            }
        }
        async function commitSelected(){
            if(!file || !inspection) return;
            setError(reviewError,'');
            primaryButton.loading = true;
            primaryButton.disabled = true;
            try {
                const result = await options.importFile(file);
                importedIds = result.nodeIds || [];
                step = 'done';
                successCopy.textContent = format('smart.nodePackageImportedSummary',{
                    nodes:result.nodeCount || inspection.node_count || 0,
                    connections:result.connectionCount ?? inspection.connection_count ?? 0,
                    resources:inspection.resource_count || 0,
                },`已在当前视口右侧添加 ${result.nodeCount || inspection.node_count || 0} 个节点、${result.connectionCount ?? inspection.connection_count ?? 0} 条连接和 ${inspection.resource_count || 0} 个资源。`);
                syncImportView();
                focusControl(cancelButton);
            } catch(error){
                primaryButton.loading = false;
                primaryButton.disabled = false;
                setError(reviewError,error.message || text('smart.importNodePackageFailed','导入节点包失败'));
            }
        }
        function browse(){ fileInput.click(); }
        shortcutSearch?.addEventListener('input',filterShortcuts);
        shortcutClear?.addEventListener('click',() => {
            shortcutSearch.value = '';
            if(shortcutSearch.input) shortcutSearch.input.value = '';
            filterShortcuts();
            focusControl(shortcutSearch);
        });
        shortcutDialog?.addEventListener('ic-after-hide',() => shortcutTrigger?.setAttribute('aria-expanded','false'));
        importDialog?.addEventListener('ic-after-hide',() => {
            importLauncher?.setAttribute('aria-expanded','false');
            primaryButton.loading = false;
        });
        importLauncher?.addEventListener('click',() => openImport());
        importLauncher?.addEventListener('keydown',event => {
            if(event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openImport();
        });
        browseButton?.addEventListener('click',event => { event.stopPropagation(); browse(); });
        modalDropzone?.addEventListener('click',browse);
        modalDropzone?.addEventListener('keydown',event => {
            if(event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            browse();
        });
        for(const target of [importLauncher,modalDropzone]){
            target?.addEventListener('dragenter',event => {
                event.preventDefault();
                event.stopPropagation();
                dragDepth += 1;
                modalDropzone.classList.add('is-dragging');
            });
            target?.addEventListener('dragover',event => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
            });
            target?.addEventListener('dragleave',event => {
                event.preventDefault();
                event.stopPropagation();
                dragDepth = Math.max(0,dragDepth - 1);
                if(!dragDepth) modalDropzone.classList.remove('is-dragging');
            });
            target?.addEventListener('drop',event => {
                event.preventDefault();
                event.stopPropagation();
                dragDepth = 0;
                modalDropzone.classList.remove('is-dragging');
                const dropped = event.dataTransfer?.files?.[0];
                if(target === importLauncher) openImport(dropped || null);
                else if(dropped) chooseFile(dropped);
            });
        }
        fileInput?.addEventListener('change',event => {
            const selected = event.target.files?.[0];
            if(selected) chooseFile(selected);
            event.target.value = '';
        });
        clearButton?.addEventListener('click',() => {
            file = null;
            inspection = null;
            syncImportView();
            focusControl(modalDropzone);
        });
        cancelButton?.addEventListener('click',async () => {
            if(step === 'review'){
                step = 'choose';
                setError(reviewError,'');
                syncImportView();
                focusControl(clearButton);
                return;
            }
            await importDialog.hide(step === 'done' ? 'complete' : 'cancel');
        });
        primaryButton?.addEventListener('click',async () => {
            if(step === 'choose') return inspectSelected();
            if(step === 'review') return commitSelected();
            if(step === 'done'){
                await importDialog.hide('locate');
                options.locateImported?.(importedIds);
            }
        });
        window.addEventListener('studio-lang-change',syncNodePackageLimitCopy);
        syncShortcutPlatform();
        resetImport();
        return Object.freeze({openShortcuts,closeShortcuts,openImport,chooseFile,filterShortcuts});
    }

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.taskModals = Object.freeze({create,formatBytes,validateNodePackageFile});
})();
