/*
 * Smart Canvas Generation Failure Feedback
 *
 * Stable error classification, safe diagnostic-report formatting, and
 * Generation Run aggregation. Localized copy is resolved by callers.
 */
(function(){
    const RULES = Object.freeze([
        {category:'reference_upload_rejected', retryability:'modify_then_retry', statuses:[], signals:['reference_upload_rejected','apimart 上传失败(413)']},
        {category:'reference_upload_failed', retryability:'retry_later', statuses:[], signals:['reference_upload_failed']},
        {category:'provider_account_restricted', retryability:'retry_later', statuses:[], signals:['provider account is temporarily restricted','account temporarily restricted']},
        {category:'credential_missing', retryability:'modify_then_retry', statuses:[], signals:['api key is not configured','api key not configured','missing api key','未配置 api key']},
        {category:'credential_invalid', retryability:'modify_then_retry', statuses:[401], signals:['invalid api key','incorrect api key','unauthorized api key','authentication failed']},
        {category:'quota_insufficient', retryability:'modify_then_retry', statuses:[], signals:['insufficient quota','quota exceeded','insufficient balance','balance insufficient','credits insufficient']},
        {category:'rate_limited', retryability:'retry_later', statuses:[429], signals:['rate-limiting requests','rate limit','too many requests']},
        {category:'provider_busy', retryability:'retry_later', statuses:[503], signals:['service busy','provider busy','all channels failed','no available channel']},
        {category:'processing_timeout', retryability:'retry_later', statuses:[], signals:['maximum processing time','exceeded 15 minutes','processing timeout','task timed out']},
        {category:'network_timeout', retryability:'retry_later', statuses:[408,504], signals:['gateway timeout','context deadline exceeded','network timeout','read timeout','connect timeout']},
        {category:'connection_interrupted', retryability:'retry_later', statuses:[], signals:['provider_connection_interrupted','disconnected','connection reset','connection aborted','tls error','broken pipe']},
        {category:'prompt_too_long', retryability:'modify_then_retry', statuses:[], signals:['prompt too long','prompt length exceeds','maximum prompt length','提示词过长','提示词长度','超过稳定上限']},
        {category:'unsupported_size', retryability:'modify_then_retry', statuses:[], signals:['aspect ratio','resolution invalid','invalid resolution','size invalid','unsupported size','image size must be auto','invalid value \'1k\' for \'--size','所选画幅或分辨率已不可用','画幅或分辨率已不可用','分辨率已不可用','画幅已不可用']},
        {category:'safety_blocked', retryability:'modify_then_retry', statuses:[], signals:['moderation','safety violation','content policy','content filtered']},
        {category:'empty_output', retryability:'retry_later', statuses:[], signals:['no image data','no images returned','empty output','没有返回图片数据']},
        {category:'local_dependency_missing', retryability:'modify_then_retry', statuses:[], signals:['未找到 gpt image 2 helper','gpt-image-2-skill','cli image generation is disabled','cli 生图已禁用']},
        {category:'application_internal_error', retryability:'unknown', statuses:[], signals:['unexpected keyword','invalid adapter output','generation provider returned an invalid result']},
        {category:'provider_internal_error', retryability:'retry_later', statuses:[500,502], signals:['upstream internal error','provider internal error','internal server error']},
        {category:'cancelled_or_replaced', retryability:'not_needed', statuses:[409], signals:['cancelled','canceled','run was replaced','任务被新运行替换','目标节点已删除']},
        {category:'invalid_parameter', retryability:'modify_then_retry', statuses:[400,422], signals:['invalid parameter','unsupported parameter','bad request']},
    ]);
    const SECRET_PATTERN = /(?:api[_-]?key|token|authorization|cookie|password|secret|credential)/i;

    function safeText(value){
        return String(value || '')
            .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1[REDACTED]')
            .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
            .replace(/data:[^\s,;]+;base64,[a-z0-9+/=]+/gi, '[BASE64 OMITTED]')
            .replace(/https?:\/\/[^\s]+/gi, '[URL OMITTED]')
            .replace(/(?:[a-z]:\\|\/(?:Users|home|private|var|tmp)\/)[^\s]+/gi, '[PATH OMITTED]')
            .slice(0, 16000);
    }
    function safeScalar(value){
        if(value == null || typeof value === 'boolean' || typeof value === 'number') return value;
        return typeof value === 'string' ? safeText(value) : undefined;
    }
    function safeObject(value, depth=0){
        if(depth > 5) return undefined;
        const scalar = safeScalar(value);
        if(scalar !== undefined) return scalar;
        if(Array.isArray(value)) return value.slice(0, 100).map(item => safeObject(item, depth + 1)).filter(item => item !== undefined);
        if(!value || typeof value !== 'object') return undefined;
        return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
            if(SECRET_PATTERN.test(key) || /(?:url|base64|raw|response|headers?)/i.test(key)) return [];
            const safe = safeObject(item, depth + 1);
            return safe === undefined ? [] : [[key, safe]];
        }));
    }
    function billingEvidence(input){
        const source = input && typeof input === 'object' ? input : {};
        const allowed = ['cost','fee','charged','charge','credits','currency','refund','refunded','auto_refunded','billing_status'];
        const evidence = {};
        const visit = (value, depth=0) => {
            if(depth > 4 || !value) return;
            if(Array.isArray(value)){
                value.slice(0, 32).forEach(item => visit(item, depth + 1));
                return;
            }
            if(typeof value !== 'object') return;
            Object.entries(value).forEach(([key, item]) => {
                const normalized = key.toLowerCase();
                if(allowed.includes(normalized)){
                    const safe = safeScalar(item);
                    if(safe !== undefined && safe !== '') evidence[normalized] = safe;
                } else if(item && typeof item === 'object') visit(item, depth + 1);
            });
        };
        visit(source);
        return evidence;
    }
    function classify(input={}){
        const technicalError = safeText(input.technicalError || input.technical_error || input.error || input.message || '');
        const httpStatus = Number(input.httpStatus || input.http_status || input.statusCode || input.status_code || 0);
        const errorCode = safeText(input.errorCode || input.error_code || input.upstream_error_code || '');
        const haystack = `${technicalError}\n${errorCode}`.toLowerCase();
        const rule = RULES.find(candidate =>
            candidate.statuses.includes(httpStatus)
            || candidate.signals.some(signal => haystack.includes(signal))
        );
        const category = rule?.category || 'unknown';
        const providerId = safeText(input.providerId || input.provider_id || '');
        const providerKey = category === 'provider_account_restricted'
            && providerId.toLowerCase() === 'apimart'
            ? '.apimart'
            : '';
        return {
            category,
            matchSignals:[httpStatus ? `http:${httpStatus}` : '', errorCode ? `code:${errorCode}` : ''].filter(Boolean),
            titleKey:`smart.error.${category}${providerKey}.title`,
            descriptionKey:`smart.error.${category}${providerKey}.description`,
            actionKey:`smart.error.${category}${providerKey}.action`,
            retryability:rule?.retryability || 'unknown',
            billingEvidence:{
                ...billingEvidence(input.billingEvidence || input.billing_evidence || {}),
                ...billingEvidence(input)
            },
            technicalError,
            httpStatus,
            errorCode,
            providerId,
        };
    }
    function localize(error, translate){
        const tr = typeof translate === 'function' ? translate : key => key;
        const value = error?.category ? error : classify(error);
        return {
            ...value,
            title:tr(value.titleKey),
            description:tr(value.descriptionKey),
            action:tr(value.actionKey),
        };
    }
    function actionName(input={}, translate){
        const tr = typeof translate === 'function' ? translate : key => key;
        if(typeof input === 'string') input = {kind:input};
        const explicit = safeText(input?.actionName || input?.action_name || '').trim();
        if(explicit) return explicit;
        const kind = String(
            input?.actionKind || input?.action_kind || input?.kind
            || input?.outputKind || input?.output_kind || ''
        ).toLowerCase();
        if(kind === 'video') return tr('smart.action.generateVideo');
        if(['text','prompt','chat'].includes(kind)) return tr('smart.action.generateText');
        if(['matting','cutout','background-removal'].includes(kind)) return tr('smart.action.matting');
        if(kind === 'image') return tr('smart.action.generateImage');
        return tr('smart.action.generate');
    }
    function aggregate(tasks=[], translate, format, options={}){
        const tr = typeof translate === 'function' ? translate : key => key;
        const trf = typeof format === 'function' ? format : (key, values) => `${tr(key)} ${JSON.stringify(values)}`;
        const operation = safeText(options.actionName || options.action_name || actionName(options, tr));
        const normalized = (tasks || []).map((task, index) => {
            const status = String(task?.status || (task?.error ? 'failed' : 'succeeded'));
            return {
                ...task,
                index:Number(task?.index ?? index),
                status,
                error:status === 'failed' ? classify(task?.errorDetail || task) : null,
            };
        });
        const successful = normalized.filter(task => task.status === 'succeeded');
        const failed = normalized.filter(task => task.status === 'failed');
        const groups = new Map();
        const technicalDetails = new Map();
        failed.forEach(task => {
            const category = task.error.category;
            const group = groups.get(category) || {count:0, error:task.error};
            group.count += 1;
            groups.set(category, group);
            const detail = task.error.technicalError.trim() || tr(task.error.titleKey);
            const detailGroup = technicalDetails.get(detail) || {count:0, label:detail};
            detailGroup.count += 1;
            technicalDetails.set(detail, detailGroup);
        });
        const reasons = [...groups.entries()].map(([category, group]) => ({
            category,
            count:group.count,
            label:tr(group.error.titleKey),
        }));
        const status = failed.length
            ? (successful.length ? 'partial' : 'failed')
            : 'success';
        const detailText = [...technicalDetails.values()].map(item => item.count > 1
            ? trf('smart.failureReasonCount', item)
            : item.label
        ).join(tr('smart.listSeparator'));
        let title = '';
        let message = '';
        if(!failed.length){
            title = trf('smart.generationSuccessSummary', {count:successful.length});
        } else if(successful.length){
            title = trf('smart.generationPartialTitle', {
                action_name:operation,
                success:successful.length,
                failed:failed.length,
            });
            message = trf('smart.generationFailureReasons', {reasons:detailText});
        } else {
            title = trf('smart.generationActionFailedTitle', {action_name:operation});
            message = trf('smart.generationFailureReasons', {reasons:detailText});
        }
        const summary = [title, message].filter(Boolean).join(tr('smart.sentenceSeparator'));
        return {tasks:normalized, successfulCount:successful.length, failedCount:failed.length, totalCount:normalized.length, reasons, status, title, message, summary};
    }
    function referenceSummary(refs=[]){
        return (refs || []).slice(0, 32).map(ref => {
            const sourceUrl = String(ref?.url || ref?.src || '');
            const urlName = sourceUrl.startsWith('data:')
                ? ''
                : sourceUrl.split(/[?#]/)[0].split('/').pop() || '';
            const rawName = String(ref?.name || ref?.filename || urlName);
            const name = rawName.split(/[\\/]/).pop() || '';
            return {
                name:safeText(name),
                kind:safeText(ref?.kind || ref?.type || ''),
                width:Number(ref?.width || 0),
                height:Number(ref?.height || 0),
            };
        });
    }
    function diagnosticReport(log={}, options={}){
        const tr = typeof options.translate === 'function' ? options.translate : key => key;
        const trf = typeof options.format === 'function' ? options.format : (key, values) => `${tr(key)} ${JSON.stringify(values)}`;
        const aggregateValue = aggregate(log.tasks || [], tr, trf);
        const primaryTask = aggregateValue.tasks.find(task => task.status === 'failed') || aggregateValue.tasks[0] || {};
        const storedError = log.errorDetail || log.error_detail || (log.error ? {technicalError:log.error} : null);
        const primaryError = primaryTask.error
            ? localize(primaryTask.error, tr)
            : storedError
                ? localize(storedError.category ? storedError : classify(storedError), tr)
                : null;
        const upstreamTaskId = primaryTask.upstreamTaskId || primaryTask.upstream_task_id || log.upstreamTaskId || log.upstream_task_id || '-';
        const durationMs = Number(log.durationMs ?? log.duration_ms ?? log.runMs ?? primaryTask.runMs ?? 0);
        const lines = [
            tr('smart.diagnosticReportTitle'),
            `${tr('smart.diagnosticVersion')}: ${safeText(options.version || log.version || '-')}`,
            `${tr('smart.diagnosticLanguage')}: ${safeText(options.language || log.language || '-')}`,
            `${tr('smart.diagnosticGeneratedAt')}: ${new Date(log.createdAt || Date.now()).toISOString()}`,
            `${tr('smart.diagnosticStatus')}: ${tr(`smart.runStatus.${log.status || aggregateValue.status || 'failed'}`)}`,
            `${tr('smart.diagnosticDuration')}: ${Number.isFinite(durationMs) ? durationMs : 0} ms`,
            `${tr('smart.diagnosticTask')}: ${safeText(options.task || '-')}`,
            `${tr('smart.diagnosticNode')}: ${safeText(options.node || '-')}`,
            `${tr('smart.diagnosticRunId')}: ${safeText(log.generationRunId || log.runId || log.run_id || log.id || '-')}`,
            `${tr('smart.diagnosticUpstreamTaskId')}: ${safeText(upstreamTaskId)}`,
            `${tr('smart.diagnosticRequestFingerprint')}: ${safeText(log.requestHash || '-')}`,
            `${tr('smart.diagnosticRecoverable')}: ${Boolean(log.recoverable)}`,
            `${tr('smart.platform')}: ${safeText(log.platform || '-')}`,
            `${tr('smart.model')}: ${safeText(log.model || '-')}`,
            `${tr('smart.diagnosticOutputSettings')}: ${safeText(options.outputSettings || '-')}`,
            `${tr('smart.diagnosticCategory')}: ${safeText(primaryError?.category || '-')}`,
            `${tr('smart.diagnosticUserMessage')}: ${primaryError ? safeText(`${primaryError.title} — ${primaryError.description} ${primaryError.action}`) : '-'}`,
            `${tr('smart.diagnosticHttpStatus')}: ${primaryError?.httpStatus || '-'}`,
            `${tr('smart.diagnosticErrorCode')}: ${safeText(primaryError?.errorCode || '-')}`,
            `${tr('smart.diagnosticTechnicalError')}: ${safeText(primaryError?.technicalError || log.error || '-')}`,
            `${tr('smart.diagnosticReferenceCount')}: ${Number((log.refs || []).length)}`,
            `${tr('smart.diagnosticParameters')}: ${JSON.stringify(safeObject(log.request || {}))}`,
            `${tr('smart.diagnosticCounts')}: ${aggregateValue.successfulCount}/${aggregateValue.failedCount}/${aggregateValue.totalCount}`,
            '',
            tr('smart.diagnosticTasks'),
        ];
        aggregateValue.tasks.forEach((task, index) => {
            const error = task.error ? localize(task.error, tr) : null;
            lines.push(
                `#${index + 1}`,
                `${tr('smart.diagnosticLocalTaskId')}: ${safeText(task.localTaskId || task.taskId || '-')}`,
                `${tr('smart.diagnosticUpstreamTaskId')}: ${safeText(task.upstreamTaskId || task.upstream_task_id || '-')}`,
                `${tr('smart.diagnosticStatus')}: ${safeText(task.status || '-')}`,
                `${tr('smart.diagnosticDuration')}: ${Number(task.runMs || 0)} ms`,
            );
            if(error){
                lines.push(
                    `${tr('smart.diagnosticCategory')}: ${error.category}`,
                    `${tr('smart.diagnosticUserMessage')}: ${error.title} — ${error.description} ${error.action}`,
                    `${tr('smart.diagnosticTechnicalError')}: ${safeText(error.technicalError)}`,
                    `${tr('smart.diagnosticErrorCode')}: ${safeText(error.errorCode || '-')}`,
                    `${tr('smart.diagnosticHttpStatus')}: ${error.httpStatus || '-'}`,
                    `${tr('smart.diagnosticBilling')}: ${Object.keys(error.billingEvidence).length ? JSON.stringify(error.billingEvidence) : tr('smart.billingUnknown')}`,
                );
            }
            lines.push('');
        });
        return safeText(lines.join('\n')).replace(/\[URL OMITTED\][^\n]*/g, '[URL OMITTED]');
    }

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.generationFailureFeedback = Object.freeze({
        rules:RULES,
        classify,
        localize,
        actionName,
        aggregate,
        diagnosticReport,
        safeText,
        safeObject,
        billingEvidence,
        referenceSummary,
    });
})();
