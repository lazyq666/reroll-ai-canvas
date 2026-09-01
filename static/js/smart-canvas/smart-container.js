/*
 * Smart Container Module
 *
 * Owns Smart Group membership and Frame spatial membership. The Interface
 * exposes container queries and domain operations while hiding Node
 * absorption, Connection rerouting, layout, selection and persistence effects.
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
function smartContainerGroupMembers(node){
    if(!smartContainerIsGroup(node)) return [];
    const ids = Array.isArray(node.items) ? node.items : [];
    const seen = new Set([node.id]);
    return ids.map(id => nodes.find(item => item.id === id))
        .filter(member => {
            if(!member || seen.has(member.id) || smartContainerIsGroup(member)){
                return false;
            }
            seen.add(member.id);
            return true;
        });
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
function smartContainerMembers(node){
    if(smartContainerIsFrame(node)) return smartContainerFrameMembers(node);
    if(smartContainerIsGroup(node)) return smartContainerGroupMembers(node);
    return [];
}
function smartContainerDescendantIds(node, seen=new Set()){
    if(!node || seen.has(node.id)) return [];
    seen.add(node.id);
    const descendants = [];
    smartContainerMembers(node).forEach(member => {
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
function smartContainerScope(nodeId){
    const group = smartContainerGroupFor(nodeId);
    if(group) return group.id;
    const node = nodes.find(item => item.id === nodeId);
    return smartContainerIsGroup(node) ? node.id : '';
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
function smartContainerCompactMembers(node){
    return smartContainerGroupMembers(node).filter(member =>
        !isSmartImageNode(member)
    );
}
function smartContainerIsCompactMember(node){
    return Boolean(
        node
        && !isSmartImageNode(node)
        && smartContainerGroupFor(node.id)
    );
}
function smartContainerZoom(node){
    const zoom = Number(node?._memberZoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}
function smartContainerScaleMember(group, member, zoom){
    if(!member || !(zoom > 0) || zoom === 1) return;
    const rect = nodeRect(member);
    member.w = Math.max(
        40,
        Math.round((Number(rect.width) || 0) * zoom)
    );
    member.h = Math.max(
        40,
        Math.round((Number(rect.height) || 0) * zoom)
    );
    if(isSmartImageNode(member)) member.scale = 1;
}
function smartContainerRerouteConnections(fromId, toId){
    if(canvas){
        canvas.connections = (canvas.connections || []).map(connection => {
            let next = connection;
            if(connection.from === fromId) next = {...next,from:toId};
            if(connection.to === fromId) next = {...next,to:toId};
            return next;
        }).filter((connection, index, all) =>
            connection.from !== connection.to
            && all.findIndex(candidate =>
                candidate.from === connection.from
                && candidate.to === connection.to
                && (candidate.kind || 'flow')
                    === (connection.kind || 'flow')
            ) === index
        );
    }
    nodes.forEach(node => {
        if(!Array.isArray(node.inputNodeIds)) return;
        node.inputNodeIds = Array.from(new Set(
            node.inputNodeIds
                .map(id => id === fromId ? toId : id)
                .filter(id => id !== node.id)
        ));
    });
}
function smartContainerAbsorbImage(group, child){
    const images = (child.images || []).map(image =>
        stripImageGenerationMeta({...image})
    );
    if(!images.length) return false;
    group.images = [...(group.images || []),...images];
    delete group.w;
    delete group.h;
    smartContainerRerouteConnections(child.id, group.id);
    smartContainerMutationModule.remove({
        nodeIds:[child.id],
        options:{skipUndo:true,render:false,save:false}
    });
    return true;
}
function smartContainerAddNode(group, child){
    if(
        !smartContainerIsGroup(group)
        || !child
        || child.id === group.id
        || smartContainerIsFrame(child)
    ){
        return false;
    }
    const items = Array.isArray(group.items)
        ? group.items.slice()
        : [];
    const zoom = smartContainerZoom(group);
    if(smartContainerIsGroup(child)){
        const images = (child.images || []).map(image =>
            stripImageGenerationMeta({...image})
        );
        group.images = [...(group.images || []),...images];
        if(images.length){
            delete group.w;
            delete group.h;
        }
        const childMemberIds = smartContainerGroupMembers(child)
            .map(member => member.id)
            .filter(id => id !== group.id && !items.includes(id));
        group.items = [...items,...childMemberIds];
        childMemberIds.forEach(id => {
            const member = nodes.find(node => node.id === id);
            if(member) smartContainerScaleMember(group, member, zoom);
        });
        smartContainerRerouteConnections(child.id, group.id);
        smartContainerMutationModule.remove({
            nodeIds:[child.id],
            options:{skipUndo:true,render:false,save:false}
        });
        return true;
    }
    if(isSmartImageNode(child)){
        return smartContainerAbsorbImage(group, child);
    }
    if(items.includes(child.id)) return false;
    group.items = [...items,child.id];
    smartContainerScaleMember(group, child, zoom);
    return true;
}
function smartContainerImageRefs(group){
    if(!smartContainerIsGroup(group)) return [];
    const refs = [];
    (group.images || []).forEach((image, index) => {
        const item = imageForDisplay(image);
        if(item?.url){
            refs.push({
                nodeId:group.id,
                index,
                source:image,
                item
            });
        }
    });
    const members = smartContainerGroupMembers(group)
        .filter(isSmartImageNode)
        .slice()
        .sort((left, right) => {
            const leftRect = nodeRect(left);
            const rightRect = nodeRect(right);
            const deltaY = (Number(leftRect.y) || 0)
                - (Number(rightRect.y) || 0);
            if(Math.abs(deltaY) > 24) return deltaY;
            return (Number(leftRect.x) || 0)
                - (Number(rightRect.x) || 0);
        });
    members.forEach(node => {
        (node.images || []).forEach((image, index) => {
            const item = imageForDisplay(image);
            if(item?.url){
                refs.push({
                    nodeId:node.id,
                    index,
                    source:image,
                    item
                });
            }
        });
    });
    return refs;
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
    const refs = smartContainerImageRefs(node)
        .filter(ref => ref.item?.url);
    if(!refs.length) return null;
    const compactMembers = smartContainerCompactMembers(node);
    const count = refs.length + compactMembers.length;
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
        const single = singleImageLayout(refs[0].item, {}, scale);
        return {
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
        const layoutItems = [
            ...images,
            ...compactMembers.map(() => null)
        ];
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
        [...images,...compactMembers.map(() => null)],
        cols,
        thumb,
        gap
    );
    const gridH = metrics.rowHeights
        .slice(0,visibleRows)
        .reduce((total,height) => total + height,0)
        + Math.max(0,visibleRows - 1) * gap;
    return {
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
function smartContainerArrange(group, options={}){
    if(!smartContainerIsGroup(group)) return false;
    const hasThumbImages = smartContainerImageRefs(group)
        .some(ref => ref.item?.url);
    if(hasThumbImages){
        const compactMembers = smartContainerCompactMembers(group);
        if(!options.skipUndo){
            smartContainerMutationModule.history({action:'push'});
        }
        const layout = smartContainerThumbLayout(group);
        if(!layout) return true;
        const refs = layout.refs || [];
        const thumb = Math.max(
            28,
            Math.round(Number(layout.thumb) || 96)
        );
        const gap = 8;
        const cols = Math.max(1,Number(layout.cols) || 1);
        const gridW = cols * thumb + Math.max(0,cols - 1) * gap;
        const contentW = Math.max(
            0,
            Math.round(
                Number(layout.width)
                || SMART_GROUP_DEFAULT_WIDTH
            ) - 32
        );
        const originX = (Number(group.x) || 0)
            + 16
            + Math.max(0,Math.round((contentW - gridW) / 2));
        const originY = (Number(group.y) || 0) + 44;
        group.w = Math.max(
            SMART_GROUP_MIN_WIDTH,
            Math.round(
                Number(layout.width)
                || SMART_GROUP_DEFAULT_WIDTH
            )
        );
        const requiredHeight = compactMembers.length
            && Number(layout.fullGridHeight) > 0
            ? Math.max(
                Number(layout.height) || 0,
                Number(layout.fullGridHeight) + 32 + 28
            )
            : Number(layout.height);
        group.h = Math.max(
            SMART_GROUP_MIN_HEIGHT,
            Math.round(
                requiredHeight
                || SMART_GROUP_DEFAULT_HEIGHT
            )
        );
        const ordered = compactMembers.slice().sort((left, right) => {
            const leftRect = nodeRect(left);
            const rightRect = nodeRect(right);
            const deltaY = (Number(leftRect.y) || 0)
                - (Number(rightRect.y) || 0);
            if(Math.abs(deltaY) > 24) return deltaY;
            return (Number(leftRect.x) || 0)
                - (Number(rightRect.x) || 0);
        });
        ordered.forEach((member, memberIndex) => {
            const index = refs.length + memberIndex;
            const col = index % cols;
            const row = Math.floor(index / cols);
            member.x = Math.round(originX + col * (thumb + gap));
            member.y = Math.round(
                originY
                + (Number(layout.rowOffsets?.[row]) || row * (thumb + gap))
            );
            member.w = thumb;
            member.h = thumb;
            member.scale = 1;
        });
        if(group._memberZoom !== undefined) group._memberZoom = 1;
        if(options.syncDom) syncSmartGroupMemberElements(group);
        return true;
    }
    const members = smartContainerGroupMembers(group);
    if(!members.length) return false;
    if(!options.skipUndo){
        smartContainerMutationModule.history({action:'push'});
    }
    const ordered = members.slice().sort((left, right) => {
        const leftRect = nodeRect(left);
        const rightRect = nodeRect(right);
        const deltaY = (Number(leftRect.y) || 0)
            - (Number(rightRect.y) || 0);
        if(Math.abs(deltaY) > 24) return deltaY;
        return (Number(leftRect.x) || 0)
            - (Number(rightRect.x) || 0);
    });
    ordered.forEach(node => {
        if(isSmartImageNode(node)){
            delete node.w;
            delete node.h;
        }
    });
    const sizes = ordered.map(node => {
        const rect = nodeRect(node);
        return {
            node,
            width:Math.max(40,Number(rect.width) || 120),
            height:Math.max(40,Number(rect.height) || 120)
        };
    });
    const count = sizes.length;
    const padding = SMART_CONTAINER_ARRANGE_PADDING;
    const gap = SMART_CONTAINER_ARRANGE_GAP;
    const header = SMART_CONTAINER_ARRANGE_HEADER;
    const cols = Math.max(
        1,
        Math.min(count,Math.round(Math.sqrt(count)) || 1)
    );
    const rows = Math.ceil(count / cols);
    const columnWidths = new Array(cols).fill(0);
    const rowHeights = new Array(rows).fill(0);
    sizes.forEach((size, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        columnWidths[col] = Math.max(
            columnWidths[col],
            size.width
        );
        rowHeights[row] = Math.max(rowHeights[row],size.height);
    });
    const columnX = [];
    let accumulatedX = 0;
    for(let col = 0; col < cols; col += 1){
        columnX[col] = accumulatedX;
        accumulatedX += columnWidths[col] + gap;
    }
    const rowY = [];
    let accumulatedY = 0;
    for(let row = 0; row < rows; row += 1){
        rowY[row] = accumulatedY;
        accumulatedY += rowHeights[row] + gap;
    }
    const originX = (Number(group.x) || 0) + padding;
    const originY = (Number(group.y) || 0) + header + padding;
    sizes.forEach((size, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        size.node.x = Math.round(
            originX
            + columnX[col]
            + (columnWidths[col] - size.width) / 2
        );
        size.node.y = Math.round(
            originY
            + rowY[row]
            + (rowHeights[row] - size.height) / 2
        );
    });
    const totalWidth = columnWidths.reduce(
        (total, width) => total + width,
        0
    ) + gap * (cols - 1) + padding * 2;
    const totalHeight = rowHeights.reduce(
        (total, height) => total + height,
        0
    ) + gap * (rows - 1) + padding * 2 + header;
    group.w = Math.max(
        SMART_GROUP_MIN_WIDTH,
        Math.round(totalWidth)
    );
    group.h = Math.max(
        SMART_GROUP_MIN_HEIGHT,
        Math.round(totalHeight)
    );
    if(group._memberZoom !== undefined) group._memberZoom = 1;
    return true;
}
function smartContainerAdd(targetId, nodeIds=[], options={}){
    const group = nodes.find(node => node.id === targetId);
    if(!smartContainerIsGroup(group)) return false;
    const requested = nodeIds.map(id =>
        nodes.find(node => node.id === id)
    ).filter(Boolean);
    if(requested.some(smartContainerIsFrame)) return false;
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
    groups.forEach(group => {
        group.items = (group.items || [])
            .filter(id => !targetIds.has(id));
    });
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
        group.items = group.items.filter(id => id !== nodeId);
        changed = true;
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
    const memberIds = smartContainerGroupMembers(group)
        .map(member => member.id);
    const images = (group.images || [])
        .filter(image => image?.url);
    const created = [];
    if(images.length){
        const layout = imageLayout(
            group.images || [],
            nodeScale(group),
            group
        );
        const padding = 16;
        const gap = 8;
        const cell = Math.max(28,Math.round(layout.thumb || 96));
        const cols = Math.max(1,layout.cols || 1);
        images.forEach((image, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            const size = thumbDisplaySize(image,cell);
            const x = Math.round(
                Number(group.x || 0)
                + padding
                + col * (cell + gap)
                + Math.max(0,(cell - size.width) / 2)
            );
            const y = Math.round(
                Number(group.y || 0)
                + padding
                + row * (cell + gap)
                + Math.max(0,(cell - size.height) / 2)
            );
            const node = {
                id:uid('smart'),
                type:'smart-image',
                x,
                y,
                w:size.width,
                h:size.height,
                title:'Image',
                images:[stripImageGenerationMeta({...image})],
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
            created.push(node);
        });
    }
    smartContainerMutationModule.remove({
        nodeIds:[group.id],
        options:{skipUndo:true,render:false,save:false}
    });
    selectedIds = [...created.map(node => node.id),...memberIds]
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
    if(!options.preserveFrameContents){
        nodeIds.forEach(id => {
            const node = nodes.find(item => item.id === id);
            if(smartContainerIsFrame(node)){
                smartContainerDescendantIds(node)
                    .forEach(memberId => expanded.add(memberId));
            }
        });
    }
    return smartContainerMutationModule.remove({
        nodeIds:[...expanded],
        options
    });
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.smartContainer = Object.freeze({
    isGroup:smartContainerIsGroup,
    isFrame:smartContainerIsFrame,
    layout:smartContainerLayout,
    groupMembers:smartContainerGroupMembers,
    frameMembers:smartContainerFrameMembers,
    members:smartContainerMembers,
    descendantIds:smartContainerDescendantIds,
    expand:smartContainerExpand,
    groupFor:smartContainerGroupFor,
    frameFor:smartContainerFrameFor,
    scope:smartContainerScope,
    reconcileFrames:smartContainerReconcileFrames,
    compactMembers:smartContainerCompactMembers,
    isCompactMember:smartContainerIsCompactMember,
    zoom:smartContainerZoom,
    imageRefs:smartContainerImageRefs,
    thumbLayout:smartContainerThumbLayout,
    arrange:smartContainerArrange,
    add:smartContainerAdd,
    release:smartContainerRelease,
    prune:smartContainerPrune,
    dragTarget:smartContainerDragTarget,
    group:smartContainerGroup,
    ungroup:smartContainerUngroup,
    remove:smartContainerRemove
});
