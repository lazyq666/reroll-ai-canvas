/*
 * Smart Canvas Generation History Modal
 *
 * Owns the production master-detail presentation for final Generation History
 * records. The page host supplies live logs, nodes, translations, safe
 * diagnostics, clipboard feedback and media URL resolution.
 */
(function initGenerationLogModal(global){
    const GENERIC_NODE_TITLES = new Set([
        '', 'image', 'images', 'video', 'videos', 'audio', 'audios', 'text', 'texts',
        'file', 'files', 'group', 'smart group', '图片', '图像', '视频', '音频', '文本',
        '提示词', '提示词生成', '图片生成', '视频生成', '生成图片或视频', '上传节点',
    ]);

    function escapeHtml(value){
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
        })[character]);
    }

    function firstSentence(prompt=''){
        const value = String(prompt || '').replace(/\r\n?/g, '\n').trim();
        if(!value) return '';
        const match = value.match(/^[\s\S]*?(?:[。！？.!?](?=\s|$|[^\w])|\n+)/u);
        return String(match?.[0] || value).replace(/\s+/g, ' ').trim();
    }

    function normalizedSize(value=''){
        const match = String(value || '').match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
        return match ? `${Number(match[1])} × ${Number(match[2])}` : String(value || '').trim();
    }

    function unique(values=[]){
        return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    }

    function create(options={}){
        const root = options.root;
        if(!root) throw new Error('Generation Log Modal root is required');
        const indexRoot = root.querySelector('[data-generation-log-index]');
        const detailRoot = root.querySelector('[data-generation-log-detail]');
        const closeButton = root.querySelector('[data-generation-log-close]');
        const lightbox = root.querySelector('[data-generation-log-lightbox]');
        const lightboxImage = lightbox?.querySelector('img');
        const sharedDialog = root.localName === 'ic-dialog';
        if(!indexRoot || !detailRoot || (!sharedDialog && !closeButton) || !lightbox || !lightboxImage){
            throw new Error('Generation Log Modal structure is incomplete');
        }

        const tr = key => options.translate?.(key) || key;
        const trf = (key, values={}) => options.format?.(key, values) || tr(key);
        const locale = () => options.language?.() === 'en' ? 'en-US' : 'zh-CN';
        let selectedId = '';
        let requestedLogId = '';
        let requestedRunId = '';
        let lastFocused = null;

        function logs(){
            return (options.getLogs?.() || []).filter(log => log && typeof log === 'object');
        }

        function nodes(){
            return options.getNodes?.() || [];
        }

        function nodeFor(log){
            const nodeId = String(log?.nodeId || log?.node_id || '');
            return nodes().find(node => String(node?.id || '') === nodeId) || null;
        }

        function logKind(log, node){
            const request = log?.request || {};
            const outputKinds = (log?.outputs || []).map(output => String(output?.kind || output?.type || '').toLowerCase());
            const explicit = String(
                log?.kind || request.kind || request.outputKind || request.output_kind
                || node?.outputKind || node?.referenceGenerationKind || ''
            ).toLowerCase();
            if(explicit === 'video' || request.duration || request.videoDuration || outputKinds.includes('video')) return 'video';
            if(explicit === 'text' || String(log?.nodeType || log?.node_type || node?.type || '') === 'smart-prompt' || outputKinds.includes('text')) return 'text';
            return 'image';
        }

        function taskType(log, node){
            const kind = logKind(log, node);
            if(kind === 'video') return tr('smart.kindVideoGeneration');
            if(kind === 'text') return tr('smart.kindTextGeneration');
            return tr('smart.kindImageGeneration');
        }

        function hasCustomNodeName(node){
            const title = String(node?.title || '').trim();
            return Boolean(title) && !GENERIC_NODE_TITLES.has(title.toLowerCase());
        }

        function taskName(log, node){
            if(hasCustomNodeName(node)) return String(node.title).trim();
            return firstSentence(log?.prompt || '') || tr('smart.generationLog.unnamedTask');
        }

        function taskTitle(log){
            const node = nodeFor(log);
            return `${taskType(log, node)} · ${taskName(log, node)}`;
        }

        function nodeTypeLabel(log, node){
            const type = String(node?.type || log?.nodeType || log?.node_type || '');
            if(type === 'smart-prompt') return node?.llmEnabled
                ? tr('smart.generationLog.promptGenerationNode')
                : tr('smart.generationLog.promptNode');
            if(type === 'smart-group') return tr('smart.generationLog.smartGroupNode');
            if(type === 'smart-loop') return tr('smart.generationLog.batchRunNode');
            return tr('smart.generationLog.imageNode');
        }

        function nodeLabel(log){
            const node = nodeFor(log);
            const id = String(log?.nodeId || log?.node_id || node?.id || '').trim();
            const shortId = id ? `…${id.slice(-4).toUpperCase()}` : tr('smart.generationLog.unknownNode');
            return `${nodeTypeLabel(log, node)} · ${shortId}`;
        }

        function logDate(log){
            const value = Number(log?.createdAt ?? log?.created_at ?? Date.now());
            const date = new Date(Number.isFinite(value) ? value : Date.now());
            return Number.isNaN(date.getTime()) ? new Date() : date;
        }

        function startOfDay(date){
            return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        }

        function dateGroup(log, now=new Date()){
            const date = logDate(log);
            const dayDifference = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
            const currentMonth = now.getFullYear() * 12 + now.getMonth();
            const logMonth = date.getFullYear() * 12 + date.getMonth();
            const dateLabel = date.toLocaleDateString(locale(), {month:'long', day:'numeric'});
            if(dayDifference === 0) return {key:'today', label:`${tr('smart.generationLog.today')} · ${dateLabel}`, rank:0};
            if(dayDifference === 1) return {key:'yesterday', label:`${tr('smart.generationLog.yesterday')} · ${dateLabel}`, rank:1};
            if(logMonth === currentMonth) return {key:'this-month', label:`${tr('smart.generationLog.thisMonth')} · ${date.toLocaleDateString(locale(), {month:'long'})}`, rank:2};
            if(logMonth === currentMonth - 1) return {key:'last-month', label:`${tr('smart.generationLog.lastMonth')} · ${date.toLocaleDateString(locale(), {month:'long'})}`, rank:3};
            return {
                key:`month-${date.getFullYear()}-${date.getMonth()}`,
                label:date.toLocaleDateString(locale(), {year:'numeric', month:'long'}),
                rank:4 + Math.max(0, currentMonth - logMonth),
            };
        }

        function indexTime(log){
            const date = logDate(log);
            const group = dateGroup(log);
            const todayOrYesterday = ['today','yesterday'].includes(group.key);
            return date.toLocaleString(locale(), todayOrYesterday
                ? {hour:'2-digit', minute:'2-digit', hour12:false}
                : {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false}
            );
        }

        function fullTime(log){
            return logDate(log).toLocaleString(locale(), {
                year:'numeric', month:'long', day:'numeric',
                hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
            });
        }

        function formatDuration(milliseconds=0){
            const value = Math.max(0, Number(milliseconds || 0));
            if(value < 1000) return `${Math.round(value)} ms`;
            if(value < 60000) return trf('smart.generationLog.seconds', {value:(value / 1000).toFixed(value < 10000 ? 1 : 0)});
            const minutes = Math.floor(value / 60000);
            const seconds = Math.round((value % 60000) / 1000);
            return trf('smart.generationLog.minutesSeconds', {minutes, seconds:String(seconds).padStart(2, '0')});
        }

        function references(log){
            return (Array.isArray(log?.refs) ? log.refs : []).map((reference, index) => {
                const item = typeof reference === 'string' ? {url:reference} : (reference || {});
                const url = String(item.url || item.src || item.path || '');
                if(!url) return null;
                return {
                    ...item,
                    url,
                    displayUrl:options.displayMediaUrl?.(item) || url,
                    label:item.name || item.filename || trf('smart.generationLog.referenceNumber', {number:index + 1}),
                };
            }).filter(Boolean);
        }

        function referenceLooksVideo(reference){
            const kind = String(reference?.kind || reference?.type || '').toLowerCase();
            const mime = String(reference?.mime || reference?.mimeType || reference?.mime_type || '').toLowerCase();
            return kind === 'video'
                || mime.startsWith('video/')
                || /\.(mp4|webm|mov|m4v|avi|mkv)(?:[?#]|$)/i.test(String(reference?.url || ''));
        }

        function referenceImageHtml(reference, size=512, alt=''){
            const video = referenceLooksVideo(reference);
            const source = video
                ? (options.previewMediaUrl?.(reference, size) || reference.displayUrl)
                : reference.displayUrl;
            const previewAttributes = video
                ? ` data-preview-src="${escapeHtml(source)}" data-original-src="${escapeHtml(reference.url)}" data-preview-size="${size}" data-preview-kind="video"`
                : '';
            return `<img src="${escapeHtml(source)}"${previewAttributes} alt="${escapeHtml(alt)}">`;
        }

        function outputSettings(log){
            const request = log?.request || {};
            const requested = normalizedSize(request.size || request.resolution || request.output_size || '');
            const actual = unique((log?.outputs || []).map(output => {
                const width = Number(output?.width || output?.natural_w || 0);
                const height = Number(output?.height || output?.natural_h || 0);
                return width > 0 && height > 0 ? `${Math.round(width)} × ${Math.round(height)}` : '';
            }));
            const parts = [];
            if(requested) parts.push(requested);
            else if(actual.length) parts.push(actual.slice(0, 3).join(', '));
            const aspect = String(request.aspect_ratio || request.aspectRatio || '').trim();
            if(aspect && !parts.some(part => part.includes(aspect))) parts.push(aspect);
            const tier = String(request.resolution_tier || request.resolutionTier || '').trim();
            if(tier && !parts.some(part => part.toLowerCase() === tier.toLowerCase())) parts.push(tier);
            const duration = String(request.duration || request.videoDuration || '').trim();
            if(duration) parts.push(/秒|s$/i.test(duration) ? duration : `${duration}s`);
            return parts.join(' · ') || tr('smart.generationLog.noOutputSettings');
        }

        function primaryTask(log){
            const tasks = Array.isArray(log?.tasks) ? log.tasks : [];
            return tasks.find(task => task?.status === 'failed') || tasks[0] || {};
        }

        function errorDetail(log){
            const feedback = options.failureFeedback;
            const task = primaryTask(log);
            const taskInput = task?.errorDetail || task?.error || (
                task?.technicalError || task?.technical_error || task?.errorCode || task?.error_code
                    ? task
                    : null
            );
            const rawInput = log?.errorDetail || log?.error_detail || taskInput || (log?.error ? {technicalError:log.error} : null);
            const input = typeof rawInput === 'string' ? {technicalError:rawInput} : rawInput;
            const classified = input?.category ? input : feedback?.classify?.(input || {});
            return classified ? (feedback?.localize?.(classified, tr) || classified) : null;
        }

        function status(log){
            const raw = String(log?.status || '').toLowerCase();
            if(raw === 'partial') return {value:'partial', tone:'failed', label:tr('smart.runStatus.partial')};
            if(raw === 'failed') return {value:'failed', tone:'failed', label:tr('smart.runStatus.failed')};
            return {value:'success', tone:'success', label:tr('smart.runStatus.success')};
        }

        function failureIcon(detail=false){
            return `<span class="generation-log-status-icon failed${detail ? ' is-detail' : ''}" aria-hidden="true"><ic-icon name="error"></ic-icon></span>`;
        }

        function indexTaskTitle(log, current=status(log)){
            const prefix = current.value === 'partial'
                ? tr('smart.generationLog.taskPartial')
                : current.value === 'failed'
                    ? tr('smart.generationLog.taskFailed')
                    : tr('smart.generationLog.taskSucceeded');
            const promptTitle = firstSentence(log?.prompt || '') || taskName(log, nodeFor(log));
            return `${prefix} · ${promptTitle}`;
        }

        function indexVisual(log){
            const reference = references(log)[0];
            if(!reference) return '';
            return `<span class="generation-log-index-visual has-reference">${referenceImageHtml(reference, 256)}</span>`;
        }

        function indexItem(log){
            const current = status(log);
            const detail = errorDetail(log);
            const selected = String(log?.id || '') === selectedId;
            const visual = indexVisual(log);
            const title = indexTaskTitle(log, current);
            return `<button class="generation-log-index-item ${current.tone}${visual ? ' has-visual' : ''}${selected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${selected}" data-generation-log-select="${escapeHtml(log?.id || '')}" data-log-id="${escapeHtml(log?.id || '')}" data-generation-run-id="${escapeHtml(log?.generationRunId || log?.runId || '')}">
                ${visual}
                <span class="generation-log-index-copy">
                    <span class="generation-log-index-heading"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><time datetime="${escapeHtml(logDate(log).toISOString())}">${escapeHtml(indexTime(log))}</time></span>
                    <span class="generation-log-index-meta" title="${escapeHtml(`${log?.model || '-'} · ${outputSettings(log)}`)}">${escapeHtml(log?.model || '-')} · ${escapeHtml(outputSettings(log))}</span>
                    ${current.tone === 'failed' && detail ? `<span class="generation-log-index-reason" title="${escapeHtml(detail.title || '')}">${failureIcon()}<span>${escapeHtml(detail.title || tr('smart.runStatus.failed'))}</span></span>` : ''}
                </span>
            </button>`;
        }

        function groupedIndex(currentLogs){
            const groups = new Map();
            currentLogs.forEach(log => {
                const group = dateGroup(log);
                if(!groups.has(group.key)) groups.set(group.key, {...group, logs:[]});
                groups.get(group.key).logs.push(log);
            });
            return [...groups.values()].sort((left, right) => left.rank - right.rank).map(group => (
                `<section class="generation-log-index-group" aria-label="${escapeHtml(group.label)}"><h2>${escapeHtml(group.label)}</h2>${group.logs.map(indexItem).join('')}</section>`
            )).join('');
        }

        function technicalDetail(log){
            const task = primaryTask(log);
            const detail = errorDetail(log) || {};
            const upstreamId = task.upstreamTaskId || task.upstream_task_id || log?.upstreamTaskId || log?.upstream_task_id || '-';
            const httpStatus = detail.httpStatus || task.httpStatus || task.http_status || '-';
            const errorCode = detail.errorCode || task.errorCode || task.error_code || '-';
            const technical = detail.technicalError || task.technicalError || task.technical_error || log?.rawError || log?.raw_error || log?.error || '';
            return `<details class="generation-log-technical">
                <summary>${escapeHtml(tr('smart.technicalDetails'))}</summary>
                <dl>
                    <div><dt>${escapeHtml(tr('smart.generationLog.runId'))}</dt><dd title="${escapeHtml(log?.generationRunId || log?.runId || log?.id || '-')}">${escapeHtml(log?.generationRunId || log?.runId || log?.id || '-')}</dd></div>
                    <div><dt>${escapeHtml(tr('smart.diagnosticUpstreamTaskId'))}</dt><dd title="${escapeHtml(upstreamId)}">${escapeHtml(upstreamId)}</dd></div>
                    <div><dt>${escapeHtml(tr('smart.generationLog.httpErrorCode'))}</dt><dd>${escapeHtml(`${httpStatus} · ${errorCode}`)}</dd></div>
                </dl>
                ${technical ? `<pre>${escapeHtml(options.failureFeedback?.safeText?.(technical) || technical)}</pre>` : ''}
            </details>`;
        }

        function referenceSection(log){
            const items = references(log);
            if(!items.length) return '';
            return `<section class="generation-log-detail-section"><h3>${escapeHtml(tr('smart.generationLog.references'))}</h3><div class="generation-log-references">${items.map((reference, index) => (
                `<button type="button" data-generation-log-preview="${index}" aria-label="${escapeHtml(trf('smart.generationLog.viewReference', {number:index + 1}))}" title="${escapeHtml(reference.label)}">${referenceImageHtml(reference, 512, reference.label)}</button>`
            )).join('')}</div></section>`;
        }

        function detail(log){
            if(!log) return `<div class="generation-log-empty">${escapeHtml(tr('canvas.noLogs'))}</div>`;
            const current = status(log);
            const failure = errorDetail(log);
            const facts = [
                outputSettings(log),
                log?.model || '-',
                log?.platform || '-',
                formatDuration(log?.runMs ?? log?.durationMs ?? log?.duration_ms ?? 0),
            ];
            return `<article class="generation-log-detail-view" data-generation-log-selected-detail data-log-id="${escapeHtml(log?.id || '')}" data-generation-run-id="${escapeHtml(log?.generationRunId || log?.runId || '')}">
                <header class="generation-log-detail-heading">
                    <div><h2>${escapeHtml(taskTitle(log))}</h2><p><span>${escapeHtml(current.label)}</span> · ${escapeHtml(nodeLabel(log))} · <time datetime="${escapeHtml(logDate(log).toISOString())}">${escapeHtml(fullTime(log))}</time></p></div>
                </header>
                <div class="generation-log-detail-facts">${facts.map(fact => `<span>${escapeHtml(fact)}</span>`).join('')}</div>
                ${current.tone === 'failed' ? `<section class="generation-log-failure-summary">${failureIcon(true)}<div class="generation-log-failure-copy"><strong>${escapeHtml(failure?.title || current.label)}</strong>${failure ? `<span>${escapeHtml([failure.description, failure.action].filter(Boolean).join(' '))}</span>` : ''}</div></section>` : ''}
                ${referenceSection(log)}
                <section class="generation-log-detail-section"><h3>${escapeHtml(tr('smart.generationLog.prompt'))}</h3><p class="generation-log-prompt">${escapeHtml(log?.prompt || '-')}</p></section>
                ${technicalDetail(log)}
            </article>
            <footer class="generation-log-actions">
                <ic-button class="generation-log-copy" data-component-name="ic-button-primary" type="button" size="s" hierarchy="primary" data-generation-log-copy="${escapeHtml(log?.id || '')}"><ic-icon slot="start" name="duplicate"></ic-icon><span>${escapeHtml(tr('smart.copyDiagnostics'))}</span></ic-button>
            </footer>`;
        }

        function resolveSelection(currentLogs){
            const requested = currentLogs.find(log => requestedLogId && String(log?.id || '') === requestedLogId)
                || currentLogs.find(log => requestedRunId && String(log?.generationRunId || log?.runId || '') === requestedRunId);
            if(requested) selectedId = String(requested.id || '');
            if(!currentLogs.some(log => String(log?.id || '') === selectedId)){
                const initial = currentLogs.find(log => status(log).tone === 'failed') || currentLogs[0];
                selectedId = String(initial?.id || '');
            }
            requestedLogId = '';
            requestedRunId = '';
            return currentLogs.find(log => String(log?.id || '') === selectedId) || currentLogs[0] || null;
        }

        function render(){
            const currentLogs = logs().slice().sort((left, right) => logDate(right) - logDate(left));
            const selected = resolveSelection(currentLogs);
            indexRoot.innerHTML = currentLogs.length ? groupedIndex(currentLogs) : `<div class="generation-log-empty">${escapeHtml(tr('canvas.noLogs'))}</div>`;
            detailRoot.innerHTML = detail(selected);
            options.bindImageFallbacks?.(root);
            options.refreshIcons?.();
            return selected;
        }

        function select(logId='', runId=''){
            requestedLogId = String(logId || '');
            requestedRunId = String(runId || '');
            return render();
        }

        function beforeOpen(){
            lastFocused = document.activeElement;
        }

        function afterOpen(){
            requestAnimationFrame(() => {
                const selected = indexRoot.querySelector('.generation-log-index-item.is-selected');
                selected?.scrollIntoView({block:'nearest'});
                selected?.classList.add('is-focused-target');
                selected?.focus();
            });
        }

        function closeLightbox(){
            lightbox.hidden = true;
            lightboxImage.removeAttribute('src');
        }

        function onClosed(){
            closeLightbox();
            if(lastFocused?.isConnected) lastFocused.focus();
            lastFocused = null;
        }

        async function copyDiagnostics(id){
            const log = logs().find(item => String(item?.id || '') === String(id || ''));
            if(!log) return;
            let version = String(log.version || options.version?.() || '');
            if(!version) version = String(await options.loadVersion?.() || '');
            const report = options.failureFeedback?.diagnosticReport?.(log, {
                translate:tr,
                format:trf,
                version,
                language:options.language?.() || '',
                task:taskTitle(log),
                node:nodeLabel(log),
                outputSettings:outputSettings(log),
            }) || '';
            const copied = await options.copyText?.(report);
            options.toast?.(
                copied ? tr('smart.diagnosticsCopied') : tr('canvas.copyFailed'),
                {tone:copied ? 'success' : 'danger'},
            );
        }

        root.addEventListener('click', event => {
            const selectButton = event.target.closest('[data-generation-log-select]');
            if(selectButton){
                selectedId = selectButton.dataset.generationLogSelect || '';
                render();
                indexRoot.querySelector(`[data-generation-log-select="${CSS.escape(selectedId)}"]`)?.focus();
                return;
            }
            const copyButton = event.target.closest('[data-generation-log-copy]');
            if(copyButton){
                void copyDiagnostics(copyButton.dataset.generationLogCopy);
                return;
            }
            const previewButton = event.target.closest('[data-generation-log-preview]');
            if(previewButton){
                const log = logs().find(item => String(item?.id || '') === selectedId);
                const reference = references(log)[Number(previewButton.dataset.generationLogPreview || 0)];
                if(reference){
                    lightboxImage.src = referenceLooksVideo(reference)
                        ? (options.previewMediaUrl?.(reference, 1200) || reference.displayUrl)
                        : reference.displayUrl;
                    lightboxImage.alt = reference.label;
                    lightbox.hidden = false;
                    lightbox.querySelector('[data-generation-log-lightbox-close]')?.focus();
                }
                return;
            }
            if(event.target === lightbox || event.target.closest('[data-generation-log-lightbox-close]')){
                closeLightbox();
                return;
            }
            if((!sharedDialog && event.target === root) || event.target.closest('[data-generation-log-close]')) options.onClose?.();
        });
        root.addEventListener('contextmenu', event => event.stopPropagation());

        indexRoot.addEventListener('keydown', event => {
            if(!['ArrowDown','ArrowUp'].includes(event.key)) return;
            const items = [...indexRoot.querySelectorAll('[data-generation-log-select]')];
            const current = items.indexOf(event.target.closest('[data-generation-log-select]'));
            if(current < 0 || !items.length) return;
            event.preventDefault();
            const offset = event.key === 'ArrowDown' ? 1 : -1;
            const next = items[(current + offset + items.length) % items.length];
            selectedId = next.dataset.generationLogSelect || '';
            render();
            indexRoot.querySelector(`[data-generation-log-select="${CSS.escape(selectedId)}"]`)?.focus();
        });

        document.addEventListener('keydown', event => {
            const open = sharedDialog ? root.hasAttribute('open') : root.classList.contains('open');
            if(!open || event.key !== 'Escape') return;
            if(sharedDialog && lightbox.hidden) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if(!lightbox.hidden) closeLightbox();
            else options.onClose?.();
        }, true);

        return Object.freeze({render, select, beforeOpen, afterOpen, onClosed, closeLightbox});
    }

    global.SmartCanvasModules = global.SmartCanvasModules || {};
    global.SmartCanvasModules.generationLogModal = Object.freeze({
        create,
        firstSentence,
        normalizedSize,
    });
})(window);
