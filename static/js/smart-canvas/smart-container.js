/*
 * Smart Container Module
 *
 * Owns Smart Group membership and Frame spatial membership. The Interface
 * exposes container queries and domain operations while hiding ordered member
 * compatibility, presentation layout, selection and persistence effects.
 */
const smartContainerMutationModule = window.SmartCanvasModules?.canvasMutation;
if(!smartContainerMutationModule){
    throw new Error('Canvas Mutation Module failed to load');
}
const smartContainerPersistenceModule =
    window.SmartCanvasModules?.canvasPersistence;
if(!smartContainerPersistenceModule){
    throw new Error('Canvas Persistence Module failed to load');
}

const SMART_CONTAINER_ARRANGE_PADDING = 18;
const SMART_CONTAINER_ARRANGE_GAP = 16;
const SMART_CONTAINER_ARRANGE_HEADER = 44;
const SMART_GROUP_MEMBER_ORDER_VERSION = 1;

function smartContainerIsGroup(node){
    return Boolean(node && node.type === 'smart-group');
}
function smartContainerIsFrame(node){
    return Boolean(node && node.type === 'smart-frame');
}
function smartContainerGroupLayout(node){
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    const width = Number.isFinite(explicitW)
        && explicitW >= SMART_GROUP_MIN_WIDTH
        ? explicitW
        : SMART_GROUP_DEFAULT_WIDTH;
    const height = !Number.isFinite(explicitH)
        || explicitH === SMART_GROUP_LEGACY_HEIGHT
        ? SMART_GROUP_DEFAULT_HEIGHT
        : Math.max(explicitH, SMART_GROUP_MIN_HEIGHT);
    return {
        width:Math.round(width),
        height:Math.round(height)
    };
}
function smartContainerFrameLayout(node){
    return {
        width:Math.max(
            SMART_FRAME_MIN_WIDTH,
            Math.round(Number(node?.w) || SMART_FRAME_DEFAULT_WIDTH)
        ),
        height:Math.max(
            SMART_FRAME_MIN_HEIGHT,
            Math.round(Number(node?.h) || SMART_FRAME_DEFAULT_HEIGHT)
        )
    };
}
function smartContainerLayout(node){
    if(smartContainerIsFrame(node)) return smartContainerFrameLayout(node);
    if(smartContainerIsGroup(node)) return smartContainerGroupLayout(node);
    return null;
}
function smartContainerLegacyMediaId(group, index){
    return `legacy:${String(group?.id || 'group')}:${index}`;
}
function smartContainerMediaId(group, image, index){
    return String(
        image?.groupMemberId
        || smartContainerLegacyMediaId(group,index)
    );
}
function smartContainerOrderedEntries(group){
    if(!smartContainerIsGroup(group)) return [];
    const itemIds = [...new Set(
        (Array.isArray(group.items) ? group.items : [])
            .map(id => String(id || ''))
            .filter(Boolean)
    )];
    const itemSet = new Set(itemIds);
    const media = (Array.isArray(group.images) ? group.images : [])
        .map((image,index) => ({
            kind:'media',
            id:smartContainerMediaId(group,image,index),
            image,
            index
        }));
    const mediaById = new Map(media.map(entry => [entry.id,entry]));
    const ordered = [];
    const seenNodes = new Set();
    const seenMedia = new Set();
    if(Array.isArray(group.memberOrder)){
        group.memberOrder.forEach(raw => {
            const kind = String(raw?.kind || '');
            const id = String(raw?.id || '');
            if(kind === 'node' && itemSet.has(id) && !seenNodes.has(id)){
                const node = nodes.find(candidate => candidate.id === id);
                if(node && node.id !== group.id && !smartContainerIsFrame(node)){
                    ordered.push({kind,id,node});
                    seenNodes.add(id);
                }
            } else if(kind === 'media' && mediaById.has(id) && !seenMedia.has(id)){
                ordered.push(mediaById.get(id));
                seenMedia.add(id);
            }
        });
    }
    media.forEach(entry => {
        if(seenMedia.has(entry.id)) return;
        ordered.push(entry);
        seenMedia.add(entry.id);
    });
    itemIds.forEach(id => {
        if(seenNodes.has(id)) return;
        const node = nodes.find(candidate => candidate.id === id);
        if(!node || node.id === group.id || smartContainerIsFrame(node)) return;
        ordered.push({kind:'node',id,node});
        seenNodes.add(id);
    });
    return ordered;
}
function smartContainerNormalizeOrder(group){
    if(!smartContainerIsGroup(group)) return false;
    let changed = false;
    group.images = Array.isArray(group.images) ? group.images : [];
    group.items = [...new Set(
        (Array.isArray(group.items) ? group.items : [])
            .map(id => String(id || ''))
            .filter(Boolean)
    )];
    group.images.forEach(image => {
        if(image?.groupMemberId) return;
        image.groupMemberId = uid('group-media');
        changed = true;
    });
    const previous = Array.isArray(group.memberOrder)
        ? JSON.stringify(group.memberOrder)
        : '';
    const entries = smartContainerOrderedEntries(group);
    group.memberOrderVersion = SMART_GROUP_MEMBER_ORDER_VERSION;
    group.memberOrder = entries.map(entry => ({
        kind:entry.kind,
        id:entry.kind === 'media'
            ? String(entry.image?.groupMemberId || entry.id)
            : entry.id
    }));
    group.items = group.memberOrder
        .filter(entry => entry.kind === 'node')
        .map(entry => entry.id);
    if(previous !== JSON.stringify(group.memberOrder)) changed = true;
    return changed;
}
function smartContainerGroupMembers(node){
    return smartContainerOrderedEntries(node)
        .filter(entry => entry.kind === 'node')
        .map(entry => entry.node);
}
function smartContainerFrameMembers(node){
    if(!smartContainerIsFrame(node)) return [];
    const ids = Array.isArray(node.items) ? node.items : [];
    const seen = new Set([node.id]);
    return ids.map(id => nodes.find(item => item.id === id))
        .filter(member => {
            if(!member || seen.has(member.id)) return false;
            seen.add(member.id);
            return true;
        });
}
function smartContainerDescendantIds(node, seen=new Set()){
    if(!node || seen.has(node.id)) return [];
    seen.add(node.id);
    const descendants = [];
    const members = smartContainerIsFrame(node)
        ? smartContainerFrameMembers(node)
        : smartContainerGroupMembers(node);
    members.forEach(member => {
        if(seen.has(member.id)) return;
        descendants.push(member.id);
        descendants.push(...smartContainerDescendantIds(member, seen));
    });
    return descendants;
}
function smartContainerExpand(nodeIds=[]){
    const expanded = new Set();
    nodeIds.forEach(id => {
        const node = nodes.find(item => item.id === id);
        if(!node) return;
        expanded.add(node.id);
        smartContainerDescendantIds(node)
            .forEach(memberId => expanded.add(memberId));
    });
    return [...expanded];
}
function smartContainerGroupFor(nodeId){
    if(!nodeId) return null;
    return nodes.find(node =>
        smartContainerIsGroup(node)
        && Array.isArray(node.items)
        && node.items.includes(nodeId)
    ) || null;
}
function smartContainerFrameFor(nodeId){
    if(!nodeId) return null;
    return nodes.find(node =>
        smartContainerIsFrame(node)
        && Array.isArray(node.items)
        && node.items.includes(nodeId)
    ) || null;
}
function smartContainerReconcileFrames(){
    const frames = nodes.filter(smartContainerIsFrame);
    if(!frames.length) return false;
    const groupOwned = new Set();
    nodes.filter(smartContainerIsGroup).forEach(group => {
        (group.items || []).forEach(id => groupOwned.add(id));
    });
    const frameRects = new Map(
        frames.map(frame => [frame.id, nodeRect(frame)])
    );
    const nextItems = new Map(frames.map(frame => [frame.id, []]));
    nodes.forEach(node => {
        if(groupOwned.has(node.id)) return;
        const rect = nodeRect(node);
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        const candidates = frames.filter(frame => {
            if(frame.id === node.id) return false;
            const frameRect = frameRects.get(frame.id);
            if(
                smartContainerIsFrame(node)
                && frameRect.width * frameRect.height
                    <= rect.width * rect.height + 1
            ){
                return false;
            }
            return centerX >= frameRect.x
                && centerX <= frameRect.x + frameRect.width
                && centerY >= frameRect.y
                && centerY <= frameRect.y + frameRect.height;
        }).sort((left, right) => {
            const leftRect = frameRects.get(left.id);
            const rightRect = frameRects.get(right.id);
            return leftRect.width * leftRect.height
                - rightRect.width * rightRect.height;
        });
        if(candidates[0]) nextItems.get(candidates[0].id).push(node.id);
    });
    let changed = false;
    frames.forEach(frame => {
        const next = nextItems.get(frame.id) || [];
        const current = Array.isArray(frame.items)
            ? frame.items.filter(id =>
                nodes.some(node => node.id === id)
            )
            : [];
        if(
            current.length !== next.length
            || current.some((id, index) => id !== next[index])
        ){
            frame.items = next;
            changed = true;
        }
    });
    return changed;
}
function smartContainerMemberHasDisplayMedia(member){
    return Boolean(
        isSmartImageNode(member)
        && (member.images || []).some(image => imageForDisplay(image)?.url)
    );
}
function smartContainerCompactMembers(node){
    return smartContainerGroupMembers(node).filter(member =>
        !smartContainerMemberHasDisplayMedia(member)
    );
}
function smartContainerIsCompactMember(node){
    return Boolean(
        node
        && !smartContainerMemberHasDisplayMedia(node)
        && smartContainerGroupFor(node.id)
    );
}
function smartContainerIsImageMember(node){
    return Boolean(
        node
        && smartContainerMemberHasDisplayMedia(node)
        && smartContainerGroupFor(node.id)
    );
}
function smartContainerRemoveNodeReference(group, nodeId){
    if(!smartContainerIsGroup(group) || !nodeId) return false;
    const before = Array.isArray(group.items) ? group.items.length : 0;
    group.items = (group.items || []).filter(id => id !== nodeId);
    if(Array.isArray(group.memberOrder)){
        group.memberOrder = group.memberOrder.filter(entry =>
            !(entry?.kind === 'node' && entry.id === nodeId)
        );
    }
    return group.items.length !== before;
}
function smartContainerAddNode(group, child){
    if(
        !smartContainerIsGroup(group)
        || !child
        || child.id === group.id
        || smartContainerIsFrame(child)
        || smartContainerIsGroup(child)
    ){
        return false;
    }
    if((group.items || []).includes(child.id)) return false;
    nodes.filter(candidate =>
        smartContainerIsGroup(candidate) && candidate.id !== group.id
    ).forEach(owner => smartContainerRemoveNodeReference(owner,child.id));
    smartContainerNormalizeOrder(group);
    group.items = [...(group.items || []),child.id];
    group.memberOrder.push({kind:'node',id:child.id});
    return true;
}
function smartContainerPresentationItems(group){
    return smartContainerOrderedEntries(group).flatMap(entry => {
        if(entry.kind === 'media'){
            const item = imageForDisplay(entry.image);
            return item?.url ? [{
                kind:'media',
                memberKind:'media',
                memberId:entry.id,
                nodeId:group.id,
                index:entry.index,
                source:entry.image,
                item
            }] : [];
        }
        if(smartContainerMemberHasDisplayMedia(entry.node)){
            return (entry.node.images || []).flatMap((image,index) => {
                const item = imageForDisplay(image);
                return item?.url ? [{
                    kind:'media',
                    memberKind:'node',
                    memberId:entry.id,
                    nodeId:entry.node.id,
                    index,
                    source:image,
                    item
                }] : [];
            });
        }
        return [{kind:'node',memberKind:'node',memberId:entry.id,node:entry.node}];
    }).map((entry,slotIndex) => ({...entry,slotIndex}));
}
function smartContainerImageRefs(group){
    if(!smartContainerIsGroup(group)) return [];
    return smartContainerPresentationItems(group)
        .filter(entry => entry.kind === 'media');
}
function smartContainerGridMetrics(items, cols, thumb, gap=8){
    const safeCols = Math.max(1,Math.round(Number(cols) || 1));
    const safeThumb = Math.max(28,Math.round(Number(thumb) || 96));
    const rowHeights = [];
    (items || []).forEach((item,index) => {
        let aspect = 1;
        if(item){
            if(typeof mediaAspectRatio === 'function'){
                aspect = Number(mediaAspectRatio(item)) || 1;
            } else {
                const width = Number(
                    item.natural_w || item.width || item.w || 0
                );
                const height = Number(
                    item.natural_h || item.height || item.h || 0
                );
                if(width > 0 && height > 0) aspect = width / height;
            }
        }
        const itemHeight = item
            ? Math.max(28,Math.round(safeThumb / Math.max(.05,aspect))) + 20
            : safeThumb;
        const row = Math.floor(index / safeCols);
        rowHeights[row] = Math.max(rowHeights[row] || 0,itemHeight);
    });
    const rowOffsets = [];
    let gridHeight = 0;
    rowHeights.forEach((height,row) => {
        if(row > 0) gridHeight += gap;
        rowOffsets[row] = gridHeight;
        gridHeight += height;
    });
    return {rowHeights,rowOffsets,gridHeight};
}
function smartContainerThumbLayout(node){
    const slots = smartContainerPresentationItems(node);
    if(!slots.length) return null;
    const refs = slots.filter(entry => entry.kind === 'media');
    const compactMembers = slots
        .filter(entry => entry.kind === 'node')
        .map(entry => entry.node);
    const count = slots.length;
    const layoutItems = slots.map(entry =>
        entry.kind === 'media' ? entry.item : null
    );
    const images = refs.map(ref => ref.item);
    const explicitW = Number(node?.w);
    const explicitH = Number(node?.h);
    const hasExplicit = Number.isFinite(explicitW)
        && explicitW >= SMART_GROUP_MIN_WIDTH
        && Number.isFinite(explicitH)
        && explicitH >= SMART_GROUP_MIN_HEIGHT;
    const scale = mediaNodeDefaultScale({
        type:'smart-image',
        images,
        scale:node?.scale
    });
    const summarySpace = 28;
    const outerPad = 32;
    if(count === 1){
        if(hasExplicit){
            return {
                slots,
                refs,
                compactMembers,
                cols:1,
                rows:1,
                visibleRows:1,
                width:Math.round(explicitW),
                height:Math.round(explicitH),
                thumb:Math.round(96 * scale),
                single:true,
                innerW:Math.max(24,Math.round(explicitW - outerPad)),
                innerH:Math.max(
                    24,
                    Math.round(explicitH - outerPad - summarySpace)
                )
            };
        }
        const single = refs[0]
            ? singleImageLayout(refs[0].item, {}, scale)
            : {
                cols:1,
                rows:1,
                visibleRows:1,
                thumb:96,
                width:96,
                height:96,
                single:true
            };
        return {
            slots,
            refs,
            compactMembers,
            ...single,
            width:Math.max(
                SMART_GROUP_MIN_WIDTH,
                Math.round(single.width + outerPad)
            ),
            height:Math.max(
                SMART_GROUP_MIN_HEIGHT,
                Math.round(single.height + outerPad + summarySpace)
            ),
            innerW:single.width,
            innerH:single.height
        };
    }
    const gap = 8;
    const maxVisibleRows = compactMembers.length
        ? count
        : SMART_GROUP_MAX_VISIBLE_ROWS;
    if(hasExplicit){
        const fitted = typeof boundedMultiMediaGridLayout === 'function'
            ? boundedMultiMediaGridLayout(
                layoutItems,
                explicitW,
                explicitH,
                {pad:outerPad,summarySpace,gap}
            )
            : groupImageGridLayout(
                count,
                Math.max(72,explicitW - outerPad),
                Math.max(56,explicitH - outerPad - summarySpace),
                Math.round(MEDIA_GROUP_THUMB_BASE * scale),
                0,
                gap,
                maxVisibleRows
            );
        const metrics = smartContainerGridMetrics(
            layoutItems,
            fitted.cols,
            fitted.thumb,
            gap
        );
        return {
            ...fitted,
            ...metrics,
            gridHeight:Math.min(
                metrics.gridHeight,
                Math.max(1,explicitH - outerPad - summarySpace)
            ),
            fullGridHeight:metrics.gridHeight,
            slots,
            refs,
            compactMembers,
            width:Math.round(explicitW),
            height:Math.round(explicitH)
        };
    }
    const thumb = Math.min(
        typeof mediaGroupThumbWidthPx === 'function'
            ? mediaGroupThumbWidthPx()
            : Math.round(MEDIA_GROUP_THUMB_BASE * scale),
        Math.round(MEDIA_GROUP_THUMB_BASE * scale)
    );
    const cols = Math.min(4,Math.max(2,Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const visibleRows = Math.min(maxVisibleRows,rows);
    const gridW = cols * thumb + (cols - 1) * gap;
    const metrics = smartContainerGridMetrics(
        layoutItems,
        cols,
        thumb,
        gap
    );
    const gridH = metrics.rowHeights
        .slice(0,visibleRows)
        .reduce((total,height) => total + height,0)
        + Math.max(0,visibleRows - 1) * gap;
    return {
        slots,
        refs,
        compactMembers,
        ...metrics,
        cols,
        rows,
        visibleRows,
        thumb,
        width:Math.max(
            SMART_GROUP_MIN_WIDTH,
            Math.round(gridW + outerPad)
        ),
        height:Math.max(
            SMART_GROUP_MIN_HEIGHT,
            Math.round(gridH + outerPad + summarySpace)
        )
    };
}
function smartContainerPresentation(node){
    if(!node?.id) return null;
    const group = smartContainerGroupFor(node.id);
    if(!group || smartContainerIsImageMember(node)) return null;
    const layout = smartContainerThumbLayout(group);
    const slot = layout?.slots?.find(entry =>
        entry.kind === 'node' && entry.node?.id === node.id
    );
    if(!layout || !slot) return null;
    const thumb = Math.max(28,Math.round(Number(layout.thumb) || 96));
    const gap = 8;
    const cols = Math.max(1,Number(layout.cols) || 1);
    const gridW = cols * thumb + Math.max(0,cols - 1) * gap;
    const contentW = Math.max(
        0,
        Math.round(Number(layout.width) || SMART_GROUP_DEFAULT_WIDTH) - 32
    );
    const originX = (Number(group.x) || 0)
        + 16
        + Math.max(0,Math.round((contentW - gridW) / 2));
    const originY = (Number(group.y) || 0) + SMART_CONTAINER_ARRANGE_HEADER;
    const col = slot.slotIndex % cols;
    const row = Math.floor(slot.slotIndex / cols);
    return {
        x:Math.round(originX + col * (thumb + gap)),
        y:Math.round(
            originY
            + (Number(layout.rowOffsets?.[row]) || row * (thumb + gap))
        ),
        width:thumb,
        height:thumb
    };
}
function smartContainerArrange(group, options={}){
    if(!smartContainerIsGroup(group)) return false;
    if(!options.skipUndo){
        smartContainerMutationModule.history({action:'push'});
    }
    smartContainerNormalizeOrder(group);
    const layout = smartContainerThumbLayout(group);
    if(!layout) return false;
    group.w = Math.max(
        SMART_GROUP_MIN_WIDTH,
        Math.round(Number(layout.width) || SMART_GROUP_DEFAULT_WIDTH)
    );
    group.h = Math.max(
        SMART_GROUP_MIN_HEIGHT,
        Math.round(Number(layout.height) || SMART_GROUP_DEFAULT_HEIGHT)
    );
    if(options.syncDom) syncSmartGroupMemberElements(group);
    return true;
}
function smartContainerAdd(targetId, nodeIds=[], options={}){
    const group = nodes.find(node => node.id === targetId);
    if(!smartContainerIsGroup(group)) return false;
    const requested = nodeIds.map(id =>
        nodes.find(node => node.id === id)
    ).filter(Boolean);
    if(requested.some(node =>
        smartContainerIsFrame(node) || smartContainerIsGroup(node)
    )) return false;
    const members = requested.filter(node =>
        node
        && node.id !== group.id
    );
    if(!members.length) return false;
    if(!options.skipUndo){
        smartContainerMutationModule.history({action:'push'});
    }
    let changed = false;
    members.forEach(member => {
        if(smartContainerAddNode(group, member)) changed = true;
    });
    if(!changed) return false;
    if(options.arrange){
        smartContainerArrange(group,{skipUndo:true,syncDom:options.syncDom});
    }
    if(options.select){
        selectedIds = [];
        const survivingSingle = members.length === 1
            && nodes.some(node => node.id === members[0].id)
            ? members[0].id
            : '';
        selectedId = survivingSingle || group.id;
        selectedImage = {nodeId:'',index:-1};
    }
    if(options.reconcileFrames) smartContainerReconcileFrames();
    if(options.render) render();
    if(options.save) smartContainerPersistenceModule.schedule();
    return true;
}
function smartContainerAddMedia(targetId, images=[], options={}){
    const group = nodes.find(node => node.id === targetId);
    if(!smartContainerIsGroup(group)) return false;
    const additions = (Array.isArray(images) ? images : [])
        .filter(image => image && typeof image === 'object')
        .map(image => {
            const copy = stripImageGenerationMeta({...image});
            copy.groupMemberId = uid('group-media');
            return copy;
        });
    if(!additions.length) return false;
    if(!options.skipUndo){
        smartContainerMutationModule.history({action:'push'});
    }
    smartContainerNormalizeOrder(group);
    group.images.push(...additions);
    group.memberOrder.push(...additions.map(image => ({
        kind:'media',
        id:image.groupMemberId
    })));
    if(options.arrange !== false){
        smartContainerArrange(group,{skipUndo:true,syncDom:options.syncDom});
    }
    if(options.select){
        selectedIds = [];
        selectedId = group.id;
        selectedImage = {
            nodeId:group.id,
            index:group.images.length - additions.length
        };
    }
    if(options.render !== false) render();
    if(options.save !== false) smartContainerPersistenceModule.schedule();
    return additions;
}
function smartContainerTakeMedia(group, index){
    if(!smartContainerIsGroup(group)) return null;
    const safeIndex = Number(index);
    if(
        !Number.isInteger(safeIndex)
        || safeIndex < 0
        || safeIndex >= (group.images || []).length
    ) return null;
    smartContainerNormalizeOrder(group);
    const [image] = group.images.splice(safeIndex,1);
    const mediaId = String(image?.groupMemberId || '');
    group.memberOrder = (group.memberOrder || []).filter(entry =>
        !(entry?.kind === 'media' && entry.id === mediaId)
    );
    return image || null;
}
function smartContainerReorderMedia(group, fromIndex, toIndex){
    if(!smartContainerIsGroup(group)) return false;
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if(
        !Number.isInteger(from)
        || !Number.isInteger(to)
        || from < 0
        || to < 0
        || from >= (group.images || []).length
        || to >= (group.images || []).length
        || from === to
    ) return false;
    smartContainerNormalizeOrder(group);
    const movingId = group.images[from]?.groupMemberId;
    const targetId = group.images[to]?.groupMemberId;
    const [moving] = group.images.splice(from,1);
    group.images.splice(to,0,moving);
    const movingOrderIndex = group.memberOrder.findIndex(entry =>
        entry.kind === 'media' && entry.id === movingId
    );
    const targetOrderIndex = group.memberOrder.findIndex(entry =>
        entry.kind === 'media' && entry.id === targetId
    );
    if(movingOrderIndex < 0 || targetOrderIndex < 0) return true;
    const [movingEntry] = group.memberOrder.splice(movingOrderIndex,1);
    const nextTargetIndex = group.memberOrder.findIndex(entry =>
        entry.kind === 'media' && entry.id === targetId
    );
    group.memberOrder.splice(
        from < to ? nextTargetIndex + 1 : nextTargetIndex,
        0,
        movingEntry
    );
    return true;
}
function smartContainerRelease(nodeIds=[], groupId='', options={}){
    const targetIds = new Set(nodeIds.filter(Boolean));
    const groups = nodes.filter(group =>
        smartContainerIsGroup(group)
        && (!groupId || group.id === groupId)
    );
    if(!groups.some(group =>
        (group.items || []).some(id => targetIds.has(id))
    )){
        return false;
    }
    if(!options.skipUndo){
        smartContainerMutationModule.history({action:'push'});
    }
    groups.forEach(group => targetIds.forEach(id =>
        smartContainerRemoveNodeReference(group,id)
    ));
    if(options.select !== false){
        selectedIds = [...targetIds]
            .filter(id => nodes.some(node => node.id === id));
        selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
        selectedImage = {nodeId:'',index:-1};
    }
    smartContainerReconcileFrames();
    if(options.render !== false) render();
    if(options.save !== false){
        smartContainerPersistenceModule.schedule();
    }
    if(options.message !== false){
        toast(
            selectedIds.length > 1
                ? tr('smart.removedSelectedFromGroup')
                : tr('smart.removedFromGroup')
        );
    }
    return true;
}
function smartContainerPrune(nodeId){
    if(!nodeId) return false;
    let changed = false;
    nodes.forEach(group => {
        if(
            !smartContainerIsGroup(group)
            || !Array.isArray(group.items)
            || !group.items.includes(nodeId)
        ){
            return;
        }
        if(smartContainerRemoveNodeReference(group,nodeId)) changed = true;
    });
    return changed;
}
function smartContainerDragTarget(node, excludeIds=[]){
    if(!node || smartContainerIsFrame(node)) return null;
    const rect = nodeRect(node);
    const excluded = new Set([node.id,...excludeIds]);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const groups = nodes.filter(candidate =>
        smartContainerIsGroup(candidate)
        && !excluded.has(candidate.id)
    ).map(group => ({
        group,
        rect:nodeRect(group)
    })).filter(item =>
        centerX >= item.rect.x
        && centerX <= item.rect.x + item.rect.width
        && centerY >= item.rect.y
        && centerY <= item.rect.y + item.rect.height
    );
    if(!groups.length) return null;
    groups.sort((left, right) =>
        nodes.indexOf(right.group) - nodes.indexOf(left.group)
    );
    return groups[0].group;
}
function smartContainerGroup(nodeIds=[]){
    const selected = nodeIds.map(id =>
        nodes.find(node => node.id === id)
    ).filter(node =>
        node
        && !smartContainerIsGroup(node)
        && !smartContainerIsFrame(node)
    );
    if(!selected.length){
        toast(tr('smart.selectNodesForGroup'));
        return null;
    }
    selected.sort((left,right) => {
        const leftRect = nodeRect(left);
        const rightRect = nodeRect(right);
        return leftRect.y - rightRect.y
            || leftRect.x - rightRect.x
            || String(left.id).localeCompare(String(right.id));
    });
    smartContainerMutationModule.history({action:'push'});
    const rects = selected.map(nodeRect);
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(
        ...rects.map(rect => rect.x + rect.width)
    );
    const maxY = Math.max(
        ...rects.map(rect => rect.y + rect.height)
    );
    const group = smartContainerMutationModule.create({
        kind:'group',
        data:{
            x:Math.round(minX - 18),
            y:Math.round(minY - 44)
        },
        options:{
            skipUndo:true,
            select:false,
            render:false,
            save:false,
            positionMode:'exact'
        }
    });
    group.w = Math.max(340,Math.round(maxX - minX + 36));
    group.h = Math.max(220,Math.round(maxY - minY + 72));
    group.images = [];
    group.memberOrderVersion = SMART_GROUP_MEMBER_ORDER_VERSION;
    group.memberOrder = [];
    selected.forEach(node => smartContainerAddNode(group,node));
    smartContainerArrange(group,{skipUndo:true});
    selectedIds = [];
    selectedId = group.id;
    selectedImage = {nodeId:'',index:-1};
    smartContainerReconcileFrames();
    render();
    smartContainerPersistenceModule.schedule();
    return group;
}
function smartContainerUngroup(nodeId){
    const group = nodes.find(node => node.id === nodeId);
    if(!smartContainerIsGroup(group)) return false;
    smartContainerMutationModule.history({action:'push'});
    const ordered = smartContainerOrderedEntries(group);
    const selectedInOrder = [];
    let mediaX = Math.round(Number(group.x) || 0);
    let mediaY = Math.round(
        (Number(group.y) || 0)
        + smartContainerGroupLayout(group).height
        + SMART_CONTAINER_ARRANGE_GAP
    );
    const rowStartX = mediaX;
    const rowLimitX = rowStartX + Math.max(
        SMART_GROUP_DEFAULT_WIDTH,
        smartContainerGroupLayout(group).width
    );
    let rowHeight = 0;
    ordered.forEach(entry => {
        if(entry.kind === 'node'){
            selectedInOrder.push(entry.id);
            return;
        }
        const image = entry.image;
        if(!image?.url) return;
        const detachedImage = stripImageGenerationMeta({...image});
        delete detachedImage.groupMemberId;
        const size = singleImageLayout(
            detachedImage,
            {},
            MEDIA_NODE_DEFAULT_SCALE
        );
        if(mediaX > rowStartX && mediaX + size.width > rowLimitX){
            mediaX = rowStartX;
            mediaY += rowHeight + SMART_CONTAINER_ARRANGE_GAP;
            rowHeight = 0;
        }
        const node = {
            id:uid('smart'),
            type:'smart-image',
            x:mediaX,
            y:mediaY,
            w:size.width,
            h:size.height,
            title:tr('smart.kindImage'),
            images:[detachedImage],
            scale:MEDIA_NODE_DEFAULT_SCALE,
            created_at:Date.now()
        };
        inheritNodeMetaFromImage(node);
        clearDetachedRunInputRefs(node);
        smartContainerMutationModule.create({
            kind:'prepared',
            data:{node},
            options:{
                skipUndo:true,
                select:false,
                render:false,
                save:false,
                positionMode:'exact'
            }
        });
        selectedInOrder.push(node.id);
        mediaX += size.width + SMART_CONTAINER_ARRANGE_GAP;
        rowHeight = Math.max(rowHeight,size.height);
    });
    smartContainerMutationModule.remove({
        nodeIds:[group.id],
        options:{skipUndo:true,render:false,save:false}
    });
    selectedIds = selectedInOrder
        .filter(id => nodes.some(node => node.id === id));
    selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
    selectedImage = {nodeId:'',index:-1};
    smartContainerReconcileFrames();
    render();
    smartContainerPersistenceModule.schedule();
    return true;
}
function smartContainerRemove(nodeIds=[], options={}){
    const expanded = new Set(nodeIds);
    nodeIds.forEach(id => {
        const node = nodes.find(item => item.id === id);
        if(
            (smartContainerIsFrame(node) && !options.preserveFrameContents)
            || (smartContainerIsGroup(node) && !options.preserveGroupContents)
        ){
            smartContainerDescendantIds(node)
                .forEach(memberId => expanded.add(memberId));
        }
    });
    return smartContainerMutationModule.remove({
        nodeIds:[...expanded],
        options
    });
}
function smartContainerRemapCopy(copy, source, idMap){
    if(!smartContainerIsGroup(copy) || !smartContainerIsGroup(source)){
        return copy;
    }
    const mediaIdMap = new Map();
    copy.images = (copy.images || []).map((image,index) => {
        const cloned = {...image};
        const sourceId = smartContainerMediaId(source,source.images?.[index],index);
        cloned.groupMemberId = uid('group-media');
        mediaIdMap.set(sourceId,cloned.groupMemberId);
        return cloned;
    });
    const sourceMediaIds = (source.images || []).map((image,index) =>
        smartContainerMediaId(source,image,index)
    );
    const sourceNodeIds = [...new Set((source.items || []).map(String))];
    const seenSourceMedia = new Set();
    const seenSourceNodes = new Set();
    const sourceOrder = [];
    (Array.isArray(source.memberOrder) ? source.memberOrder : []).forEach(entry => {
        const kind = String(entry?.kind || '');
        const id = String(entry?.id || '');
        if(
            kind === 'media'
            && sourceMediaIds.includes(id)
            && !seenSourceMedia.has(id)
        ){
            sourceOrder.push({kind,id});
            seenSourceMedia.add(id);
        } else if(
            kind === 'node'
            && sourceNodeIds.includes(id)
            && !seenSourceNodes.has(id)
        ){
            sourceOrder.push({kind,id});
            seenSourceNodes.add(id);
        }
    });
    sourceMediaIds.forEach(id => {
        if(!seenSourceMedia.has(id)) sourceOrder.push({kind:'media',id});
    });
    sourceNodeIds.forEach(id => {
        if(!seenSourceNodes.has(id)) sourceOrder.push({kind:'node',id});
    });
    copy.memberOrderVersion = SMART_GROUP_MEMBER_ORDER_VERSION;
    copy.memberOrder = sourceOrder.map(entry => ({
        kind:entry.kind,
        id:entry.kind === 'node'
            ? String(idMap.get(entry.id) || '')
            : String(mediaIdMap.get(entry.id) || '')
    })).filter(entry => entry.id);
    copy.items = copy.memberOrder
        .filter(entry => entry.kind === 'node')
        .map(entry => entry.id);
    return copy;
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.smartContainer = Object.freeze({
    isGroup:smartContainerIsGroup,
    isFrame:smartContainerIsFrame,
    layout:smartContainerLayout,
    groupMembers:smartContainerGroupMembers,
    frameMembers:smartContainerFrameMembers,
    descendantIds:smartContainerDescendantIds,
    expand:smartContainerExpand,
    groupFor:smartContainerGroupFor,
    frameFor:smartContainerFrameFor,
    reconcileFrames:smartContainerReconcileFrames,
    compactMembers:smartContainerCompactMembers,
    isCompactMember:smartContainerIsCompactMember,
    isImageMember:smartContainerIsImageMember,
    presentation:smartContainerPresentation,
    imageRefs:smartContainerImageRefs,
    thumbLayout:smartContainerThumbLayout,
    arrange:smartContainerArrange,
    add:smartContainerAdd,
    addMedia:smartContainerAddMedia,
    takeMedia:smartContainerTakeMedia,
    reorderMedia:smartContainerReorderMedia,
    release:smartContainerRelease,
    prune:smartContainerPrune,
    dragTarget:smartContainerDragTarget,
    group:smartContainerGroup,
    ungroup:smartContainerUngroup,
    remove:smartContainerRemove,
    remapCopy:smartContainerRemapCopy
});
