/* Smart Canvas media display names, real extensions, downloads and rename identity. */
(function(){
    const EXTENSIONS = new Set([
        'avif','bmp','gif','jpeg','jpg','png','svg','tif','tiff','webp',
        'm4v','mkv','mov','mp4','webm','aac','flac','m4a','mp3','ogg','opus','wav','txt'
    ]);
    const MIME_EXTENSIONS = Object.freeze({
        'image/avif':'avif','image/bmp':'bmp','image/gif':'gif','image/jpeg':'jpg',
        'image/png':'png','image/svg+xml':'svg','image/tiff':'tiff','image/webp':'webp',
        'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm',
        'audio/aac':'aac','audio/flac':'flac','audio/mp4':'m4a','audio/mpeg':'mp3',
        'audio/ogg':'ogg','audio/opus':'opus','audio/wav':'wav','audio/x-wav':'wav',
        'text/plain':'txt'
    });
    const KIND_EXTENSIONS = Object.freeze({
        image:'.png', video:'.mp4', audio:'.mp3', text:'.txt'
    });

    function extensionFromValue(value=''){
        const text = String(value || '').trim();
        if(!text) return '';
        if(text.startsWith('data:')){
            const mime = text.slice(5).split(';',1)[0].toLowerCase();
            const extension = MIME_EXTENSIONS[mime] || '';
            return extension ? `.${extension}` : '';
        }
        let path = text.split('?',1)[0].split('#',1)[0];
        try { path = decodeURIComponent(path); } catch(error) {}
        const extension = path.match(/\.([a-z0-9]{2,8})$/i)?.[1]?.toLowerCase() || '';
        return EXTENSIONS.has(extension) ? `.${extension}` : '';
    }

    function extensionFromMime(item={}){
        for(const key of ['mime','mime_type','mimeType','content_type','contentType']){
            const mime = String(item?.[key] || '').split(';',1)[0].trim().toLowerCase();
            const extension = MIME_EXTENSIONS[mime] || '';
            if(extension) return `.${extension}`;
        }
        return '';
    }

    function extensionFor(item={}, kind='image', fallback='.png'){
        const sourceExtension = extensionFromValue(item?.url) || extensionFromMime(item);
        if(sourceExtension) return sourceExtension;
        if(KIND_EXTENSIONS[kind]) return KIND_EXTENSIONS[kind];
        return extensionFromValue(item?.name) || fallback;
    }

    function nameBody(item={}, label='', kind='image'){
        const extension = extensionFor(item,kind);
        let value = String(label || '').trim();
        while(value.toLowerCase().endsWith(extension.toLowerCase())){
            value = value.slice(0,-extension.length).trimEnd();
        }
        return value || String(label || '').trim();
    }

    function validate(value, item={}, kind='image'){
        const raw = String(value || '').trim();
        const extension = extensionFor(item,kind);
        if(!raw) return {errorKey:'smart.mediaNameRequired',name:'',body:'',extension};
        if(/[\\/:*?"<>|\u0000-\u001f]/.test(raw) || raw === '.' || raw === '..'){
            return {errorKey:'smart.mediaNameInvalid',name:'',body:raw,extension};
        }
        if(raw.length > 180){
            return {errorKey:'smart.mediaNameTooLong',name:'',body:raw,extension};
        }
        let body = raw;
        while(body.toLowerCase().endsWith(extension.toLowerCase())){
            body = body.slice(0,-extension.length).trimEnd();
        }
        const typedExtension = extensionFromValue(body);
        if(typedExtension && typedExtension.toLowerCase() !== extension.toLowerCase()){
            return {errorKey:'smart.mediaNameExtensionMismatch',name:'',body,extension};
        }
        if(!body || body === '.' || body === '..'){
            return {errorKey:'smart.mediaNameRequired',name:'',body:'',extension};
        }
        return {errorKey:'',name:`${body}${extension}`,body,extension};
    }

    function downloadName(item={}, options={}){
        const fileName = options.fileNameFromUrl?.(item?.url || '') || '';
        const preferred = String(item?.name || '').trim() || fileName;
        const extension = extensionFor(item,options.kind || 'image',options.fallbackExtension || '.png');
        const fallbackPrefix = String(options.fallbackPrefix || 'canvas-output');
        const randomName = `${fallbackPrefix}_${options.now?.() ?? Date.now()}_${(options.random?.() ?? Math.random()).toString(16).slice(2,8)}${extension}`;
        let name = String(preferred || randomName);
        while(name.toLowerCase().endsWith(extension.toLowerCase())){
            name = name.slice(0,-extension.length).trimEnd();
        }
        const candidate = `${name || fallbackPrefix}${extension}`;
        return options.safeFileName?.(candidate,randomName) || candidate;
    }

    function locator(item={}, kind='image'){
        return {
            reference:item || null,
            outputId:String(item?.outputId || item?.generationOutputId || ''),
            mediaId:String(item?.media_id || item?.mediaId || ''),
            inputInstanceId:String(item?.inputInstanceId || ''),
            url:String(item?.url || ''),
            kind
        };
    }

    function findTarget(node, targetLocator, kindForItem){
        const images = node?.images || [];
        const by = predicate => {
            const matches = images.map((item,index) => ({item,index})).filter(({item}) => predicate(item));
            return matches.length === 1 ? matches[0] : null;
        };
        if(targetLocator?.outputId){
            const match = by(item => String(item?.outputId || item?.generationOutputId || '') === targetLocator.outputId);
            if(match) return match;
        }
        if(targetLocator?.mediaId){
            const match = by(item => String(item?.media_id || item?.mediaId || '') === targetLocator.mediaId);
            if(match) return match;
        }
        if(targetLocator?.inputInstanceId){
            const match = by(item => String(item?.inputInstanceId || '') === targetLocator.inputInstanceId);
            if(match) return match;
        }
        const referenceIndex = images.indexOf(targetLocator?.reference);
        if(referenceIndex >= 0) return {item:images[referenceIndex],index:referenceIndex};
        if(targetLocator?.url){
            return by(item => (
                String(item?.url || '') === targetLocator.url
                && kindForItem(item) === targetLocator.kind
            ));
        }
        return null;
    }

    // Prefixes are stable filename tokens, independent of the UI language.
    // This allocator is optimistic; Canvas Mutation assigns the final sequence
    // in server order. Provenance lets retries and user renames keep their name.
    const PREFIXES = new Set(['t2i','i2i','outpaint','angle','repair','cutout','depth','layers',
        'lighting','workflow-image','workflow-video','workflow-audio','workflow-text',
        'txt2video','img2video','frames2video','multi2video','image','video','audio','text',
        'crop','mask','paint','resize','split','join','grid-gif','video-gif',
        'frame-first','frame-last','frame-current','panorama']);
    const automaticPattern = new RegExp(`(?:^|-)(${[...PREFIXES].sort((a,b)=>b.length-a.length).join('|')})-(\\d+)(?:-r\\d+-c\\d+)?(?:\\.[a-z0-9]+)?$`, 'i');
    const sessions = new WeakMap();
    function *items(value){
        if(Array.isArray(value)){ for(const item of value) yield* items(item); }
        else if(value && typeof value === 'object'){
            if(value.url && ('name' in value || value.autoName)) yield value;
            else for(const item of Object.values(value)) yield* items(item);
        }
    }
    function generationPrefix(node={},kind='image'){
        const snapshot=node.generationInputSnapshot || {};
        if(PREFIXES.has(snapshot.namingPrefix)) return snapshot.namingPrefix;
        const settings=snapshot.settings || node.runSettings || {};
        let refs=snapshot.refs || node.runInputRefs || [];
        if(kind==='image'){
            if(node.localRepairRequest) return 'repair';
            if(node.aiProcessorKind==='outpaint') return 'outpaint';
            if(node.aiProcessorKind==='angle-control') return 'angle';
            if(node.outputKind==='depth-map' || node.depthMapSourceNodeId) return 'depth';
            if(node.mattingJob || node.mattingResult || node.mattingSourceNodeId) return 'cutout';
            if(node.lightingPrompt && node.metadata?.lightingIntent) return 'lighting';
        }
        if((settings.engine==='comfy' && settings.comfyMode==='custom')
            || (settings.engine==='runninghub' && !String(settings.rhConfigKey || '').startsWith('model:'))) return `workflow-${kind}`;
        if(kind==='video' && (node.generationInputSnapshot || node.runSettings)){
            refs=[...refs,...(settings.videoTempShLinks || []).filter(item=>item.manual && item.url)];
            if(!refs.length) return 'txt2video';
            if(settings.videoUseFrameRoles || settings.videoReferenceMode==='first_last_frames') return 'frames2video';
            if(settings.videoReferenceMode==='image_to_video' || settings.videoMultimodal===false) return 'img2video';
            return 'multi2video';
        }
        if(kind==='image' && (node.generationInputSnapshot || node.runSettings)){
            if(settings.engine==='comfy' && (settings.comfyMode || 'text')==='text') return 't2i';
            if(settings.engine==='modelscope' && (settings.msgenModel || 'zimage')==='zimage') return 't2i';
            return refs.some(ref=>(ref.kind || 'image')==='image') ? 'i2i' : 't2i';
        }
        return PREFIXES.has(kind) ? kind : 'image';
    }
    function assign(item, {prefix, canvas:document, nodes:allNodes=[], id='', source=null, suffix=''}={}){
        if(!PREFIXES.has(prefix) || !item?.url || !document) return item;
        if(item.autoName?.name) return item;
        let session=sessions.get(document);
        if(!session){session={counters:new Map(),allocations:new Map()};sessions.set(document,session);}
        for(const media of items(allNodes)){
            const match=String(media.name || '').match(automaticPattern);
            if(match) session.counters.set(match[1].toLowerCase(),Math.max(session.counters.get(match[1].toLowerCase()) || 0,Number(match[2])));
            if(media.autoName?.id && media.autoName?.name){
                const named=media.autoName.name.match(automaticPattern);
                if(named) session.allocations.set(`${media.autoName.prefix}:${media.autoName.id}`,Number(named[2]));
            }
        }
        const request=item.autoName || {
            id:id || window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
            prefix,
            pending:true,
            extension:extensionFromValue(item.url) || extensionFromMime(item) || extensionFromValue(item.name) || KIND_EXTENSIONS[item.kind || 'image'],
            source:source?.name && (!source.autoName || source.name!==source.autoName.name) && !automaticPattern.test(source.name)
                ? nameBody(source,source.name,source.kind || 'image').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'').trim().slice(0,120) : '',
            suffix
        };
        const key=`${request.prefix}:${request.id}`;
        let number=session.allocations.get(key);
        if(!number){
            number=(session.counters.get(request.prefix) || 0)+1;
            session.counters.set(request.prefix,number);session.allocations.set(key,number);
        }
        const values={prefix:`${request.source ? `${request.source}-` : ''}${request.prefix}`,number:String(number).padStart(2,'0'),suffix:request.suffix || '',extension:request.extension};
        const template=window.StudioI18n?.t?.('smart.mediaGeneratedName');
        item.name=template && template!=='smart.mediaGeneratedName'
            ? template.replace(/\{(prefix|number|suffix|extension)\}/g,(_,key)=>values[key])
            : `${values.prefix}-${values.number}${values.suffix}${values.extension}`;
        item.autoName={...request,name:item.name};
        return item;
    }

    window.SmartCanvasModules = window.SmartCanvasModules || {};
    window.SmartCanvasModules.mediaNaming = Object.freeze({
        extensionFromValue,
        extensionFor,
        nameBody,
        validate,
        downloadName,
        locator,
        findTarget,
        generationPrefix,
        assign
    });
})();
