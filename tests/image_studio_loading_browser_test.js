/* Real production Image Studio, controlled image latency, disposable canvas. */
(async () => {
    const results = [];
    const waitFor = async (predicate, message) => {
        const start = performance.now();
        while (!predicate()) {
            if (performance.now() - start > 10000) throw new Error(message);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    };
    const check = (condition, message) => {
        if (!condition) throw new Error(message);
        results.push(message);
    };
    try {
        await waitFor(() => window.SmartCanvasModules?.imageStudio
            && document.getElementById('imageEditModal')?.dataset.icContractStatus === 'ready'
            && document.documentElement.dataset.canvasOpeningPhase === 'ready', 'Studio and canvas ready');
        const query = new URLSearchParams(location.search);
        if (query.get('theme') === 'dark') {
            document.documentElement.dataset.uiTheme = 'dark';
            document.body.classList.add('theme-dark');
        }
        const modal = document.getElementById('imageEditModal');
        const loading = document.getElementById('imageStudioLoading');
        const notice = document.getElementById('imageStudioResolutionNotice');
        const node = {id:'loading-acceptance', type:'smart-image', x:80, y:80, w:200, h:300,
            images:[{url:'', kind:'image', natural_w:800, natural_h:1200}]};
        nodes.push(node);
        let sequence = 0;
        const open = (delay, fail=false) => {
            nodes.find(item => item.id === node.id).images[0].url = `/__image-studio-source.svg?delay=${delay}&fail=${Number(fail)}&case=${++sequence}`;
            openImageEditor(node.id);
        };
        open(query.has('hold') ? 60 : 0.7);
        await waitFor(() => modal.open, 'Dialog open');
        check(loading && !loading.hidden && loading.querySelector('ic-skeleton[shape="rectangle"]'), 'Uses shared rectangle skeleton while loading');
        check(getComputedStyle(loading).visibility === 'visible', 'Loading skeleton is visibly rendered in the dialog');
        check(notice.hidden, 'No loading message overlaps the toolbar');
        check(getComputedStyle(document.querySelector('.image-edit-stage-inner')).visibility === 'hidden', 'Previous image stays hidden while switching');
        const box = loading.querySelector('ic-skeleton').getBoundingClientRect();
        check(box.width > 50 && box.height > 50 && Math.abs(box.width / box.height - 2 / 3) < 0.02, 'Skeleton preserves source aspect ratio');
        const shine = loading.querySelector('ic-skeleton').shadowRoot.querySelector('.shine').getBoundingClientRect();
        check(shine.width > 50 && shine.height > 50, 'Shared skeleton shimmer occupies the placeholder');
        const toolbar = document.getElementById('imageEditModeToolbar').getBoundingClientRect();
        check(box.top >= toolbar.bottom - 1, 'Skeleton stays below the toolbar');
        window.StudioI18n.set('en');
        check(loading.getAttribute('aria-label') === 'Loading original image…', 'Loading accessible label switches to English');
        window.StudioI18n.set('zh');
        check(loading.getAttribute('aria-label') === '正在加载原图…', 'Loading accessible label switches to Chinese');
        for (const mode of ['local-repair-mode', 'layer-decomposition-edit-mode']) {
            modal.classList.add(mode);
            check(getComputedStyle(loading).display === 'none', `${mode} retains its own loading presentation`);
            modal.classList.remove(mode);
        }
        if (query.has('hold')) return;
        await waitFor(() => modal.dataset.sourceState === 'original-ready', 'Original ready');
        check(loading.hidden && notice.hidden, 'Successful image removes loading feedback');
        check(getComputedStyle(document.querySelector('.image-edit-stage-inner')).visibility === 'visible', 'Successful image becomes visible');
        setImageEditMode('crop');
        check(!document.getElementById('imageEditApplyBtn').disabled, 'Editing enabled only after the original is ready');
        open(0.4, true);
        setImageEditMode('crop');
        check(document.getElementById('imageEditApplyBtn').disabled, 'Editing disabled while a new original loads');
        await waitFor(() => modal.dataset.sourceState === 'failed', 'Image failure');
        check(loading.hidden && !notice.hidden, 'Failure removes skeleton and shows the existing error');
        open(1.0, true);
        open(0.1);
        await waitFor(() => modal.dataset.sourceState === 'original-ready', 'Replacement ready');
        await new Promise(resolve => setTimeout(resolve, 1100));
        check(modal.dataset.sourceState === 'original-ready' && loading.hidden && notice.hidden, 'Late failure cannot replace the newly loaded image');
        open(0.5);
        closeImageEditor();
        await new Promise(resolve => setTimeout(resolve, 650));
        check(modal.dataset.sourceState === 'idle' && loading.hidden, 'Closing clears loading and ignores late responses');
        await fetch('/__image-studio-results', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:'passed', results})});
    } catch (error) {
        await fetch('/__image-studio-results', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:'failed', results, error:String(error.stack || error)})});
    }
})();
