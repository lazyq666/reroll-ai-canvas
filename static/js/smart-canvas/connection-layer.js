/*
 * Smart Canvas Connection Layer Module
 *
 * Owns Connection indexes, SVG materialization, incremental geometry refresh,
 * and delegated interaction. The host supplies current Canvas state through a
 * snapshot callback and does not need to know how individual SVG nodes work.
 */
const smartConnectionLayerSvgNamespace = 'http://www.w3.org/2000/svg';

function createSmartConnectionLayerModule(dependencies={}){
    const worldElement = dependencies.world;
    let nodeById = new Map();
    let materializationByKey = new Map();
    let materializationKeysByNodeId = new Map();
    let elementByKey = new Map();
    let renderedKeys = new Set();
    let lastView = null;

    function smartConnectionLayerSnapshot(){
        return dependencies.snapshot?.() || {};
    }
    function smartConnectionLayerCreateSvgElement(name){
        return document.createElementNS(smartConnectionLayerSvgNamespace,name);
    }
    function smartConnectionLayerStopEvent(event){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }
    function smartConnectionLayerControl(event){
        const target = event.target;
        if(!(target instanceof Element)) return null;
        const control = target.closest('.conn-hit,.conn-cut');
        return control?.closest('svg.connection-layer') === event.currentTarget
            ? control
            : null;
    }
    function smartConnectionLayerBindDelegatedEvents(svg){
        if(svg.dataset.connectionDelegationBound === '1') return;
        svg.dataset.connectionDelegationBound = '1';
        svg.addEventListener('mousedown', event => {
            if(smartConnectionLayerControl(event)){
                event.stopPropagation();
                event.stopImmediatePropagation?.();
            }
        });
        svg.addEventListener('click', event => {
            const control = smartConnectionLayerControl(event);
            if(!control) return;
            smartConnectionLayerStopEvent(event);
            if(control.classList.contains('conn-cut')){
                dependencies.onDisconnect?.({
                    indexes:control.dataset.connIndex || '',
                    event
                });
                return;
            }
            const key = control.closest('[data-connection-key]')
                ?.dataset.connectionKey || '';
            const point = dependencies.screenToWorld?.(event) || {x:0,y:0};
            dependencies.onSelect?.({key,x:point.x,y:point.y,event});
            smartConnectionLayerSync();
        });
        svg.addEventListener('keydown', event => {
            const control = smartConnectionLayerControl(event);
            if(
                !control?.classList.contains('conn-cut')
                || (event.key !== 'Enter' && event.key !== ' ')
            ) return;
            smartConnectionLayerStopEvent(event);
            dependencies.onDisconnect?.({
                indexes:control.dataset.connIndex || '',
                event
            });
        });
    }
    function smartConnectionLayerEnsureSvg(reduceMotion=false){
        let svg = worldElement?.querySelector(':scope > svg.connection-layer');
        if(!svg){
            svg = smartConnectionLayerCreateSvgElement('svg');
            svg.setAttribute('width','6000');
            svg.setAttribute('height','4000');
            svg.setAttribute('viewBox','0 0 6000 4000');
            worldElement?.insertAdjacentElement('afterbegin',svg);
        }
        svg.setAttribute(
            'class',
            `connection-layer ${reduceMotion ? 'conn-reduce-motion' : ''}`
        );
        smartConnectionLayerBindDelegatedEvents(svg);
        return svg;
    }
    function smartConnectionLayerRememberNodeKey(nodeId,key){
        if(!nodeId) return;
        let keys = materializationKeysByNodeId.get(nodeId);
        if(!keys){
            keys = new Set();
            materializationKeysByNodeId.set(nodeId,keys);
        }
        keys.add(key);
    }
    function smartConnectionLayerBuildView(){
        const snapshot = smartConnectionLayerSnapshot();
        const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
        const connections = Array.isArray(snapshot.connections)
            ? snapshot.connections
            : [];
        nodeById = new Map(nodes.map(node => [node.id,node]));
        const scopeByNodeId = new Map();
        nodes.filter(node => dependencies.isGroup?.(node)).forEach(group => {
            (group.items || []).forEach(nodeId => {
                if(!scopeByNodeId.has(nodeId)){
                    scopeByNodeId.set(nodeId,group.id);
                }
            });
        });
        const scopeFor = nodeId => scopeByNodeId.get(nodeId)
            || (dependencies.isGroup?.(nodeById.get(nodeId)) ? nodeId : '');
        materializationByKey = new Map();
        materializationKeysByNodeId = new Map();
        const conns = connections
            .map((connection,index) => ({...connection,index}))
            .filter(connection => (
                nodeById.has(connection.from) && nodeById.has(connection.to)
            ));
        const connectionKeys = conns.map(
            connection => `${connection.from}->${connection.to}`
        );
        const runView = dependencies.runStatus?.({connectionKeys}) || {
            cascadeConnectionKeys:[],
            connectionStates:[],
            activeConnectionCount:0
        };
        const buckets = new Map();
        const items = [];
        conns.forEach(connection => {
            const kind = connection.kind || 'flow';
            const fromScope = kind === 'history'
                ? ''
                : scopeFor(connection.from);
            const toScope = kind === 'history'
                ? ''
                : scopeFor(connection.to);
            if(fromScope && fromScope === toScope) return;
            const isMemberTarget = toScope && toScope !== connection.to;
            if(isMemberTarget){
                const bucketKey = `${connection.from}|${toScope}|${kind}`;
                let item = buckets.get(bucketKey);
                if(!item){
                    item = {
                        from:connection.from,
                        toId:toScope,
                        kind,
                        indices:[],
                        targets:[]
                    };
                    buckets.set(bucketKey,item);
                    items.push(item);
                }
                item.indices.push(connection.index);
                item.targets.push(connection.to);
                return;
            }
            items.push({
                from:connection.from,
                toId:connection.to,
                kind,
                indices:[connection.index],
                targets:[connection.to]
            });
        });
        items.forEach(item => {
            const key = `${item.from}|${item.toId}|${item.kind}`;
            item.key = key;
            materializationByKey.set(key,item);
            smartConnectionLayerRememberNodeKey(item.from,key);
            smartConnectionLayerRememberNodeKey(item.toId,key);
        });
        return {
            snapshot,
            items,
            cascadeKeys:new Set(runView.cascadeConnectionKeys || []),
            cascadeStateByKey:new Map(connectionKeys.map((key,index) => [
                key,
                runView.connectionStates?.[index]
            ])),
            reduceMotion:Number(runView.activeConnectionCount || 0) > 24,
            pinnedNodeIds:new Set(snapshot.pinnedNodeIds || []),
            interaction:snapshot.interaction || null
        };
    }
    function smartConnectionLayerGeometry(item,view){
        const fromNode = nodeById.get(item.from);
        const toNode = nodeById.get(item.toId);
        if(!fromNode || !toNode) return null;
        const fromRect = dependencies.nodeRect(fromNode);
        const toRect = dependencies.nodeRect(toNode);
        const visible = dependencies.connectionVisible?.({
            fromRect,
            toRect,
            kind:item.kind,
            pinned:view.pinnedNodeIds.has(item.from)
                || view.pinnedNodeIds.has(item.toId)
                || item.indices.some(
                    index => view.interaction?.connectionIndex === index
                )
        }) !== false;
        if(!visible) return null;
        const isHistory = item.kind === 'history';
        const fx = isHistory
            ? fromRect.x + fromRect.width / 2
            : fromRect.x + fromRect.width;
        const fy = isHistory
            ? fromRect.y + fromRect.height
            : fromRect.y + fromRect.height / 2;
        const tx = isHistory
            ? toRect.x + toRect.width / 2
            : toRect.x;
        const ty = isHistory
            ? toRect.y
            : toRect.y + toRect.height / 2;
        const dx = Math.max(50,Math.abs(tx - fx) * 0.45);
        const dy = Math.max(36,Math.abs(ty - fy) * 0.45);
        return {
            fx,fy,tx,ty,
            curve:isHistory
                ? `M${fx} ${fy} C ${fx} ${fy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`
                : `M${fx} ${fy} C ${fx + dx} ${fy}, ${tx - dx} ${ty}, ${tx} ${ty}`
        };
    }
    function smartConnectionLayerPresentation(item,view,geometry){
        const edgeKeys = item.targets.map(target => `${item.from}->${target}`);
        const states = edgeKeys
            .map(key => view.cascadeStateByKey.get(key))
            .filter(Boolean);
        let cascadeState = '';
        if(states.includes('active')) cascadeState = 'active';
        else if(states.some(state => state !== 'done')){
            cascadeState = states.find(state => state !== 'done');
        } else if(states.length) cascadeState = 'done';
        const isInsertPreview = item.indices.some(
            index => view.interaction?.connectionIndex === index
        );
        const isHistory = item.kind === 'history';
        const isCascade = !isHistory && (
            edgeKeys.some(key => view.cascadeKeys.has(key))
            || Boolean(cascadeState)
            || isInsertPreview
        );
        const isPending = !isCascade && item.targets.some(
            target => nodeById.get(target)?.pending
        );
        const isSelected = view.snapshot.selectedConnectionKey === item.key;
        const selectedPoint = isSelected
            && view.snapshot.selectedConnectionPoint?.key === item.key
            ? view.snapshot.selectedConnectionPoint
            : null;
        return {
            isSelected,
            lineClass:[
                isPending ? 'conn-pending' : '',
                isCascade ? 'conn-cascade' : '',
                isCascade && cascadeState === 'done' ? 'conn-cascade-done' : '',
                isCascade && cascadeState && cascadeState !== 'done'
                    ? 'conn-cascade-wait'
                    : '',
                isCascade && cascadeState === 'active' ? 'conn-cascade-active' : '',
                isHistory ? 'conn-history' : '',
                isSelected ? 'conn-selected' : '',
                'conn-line'
            ].filter(Boolean).join(' '),
            color:isCascade
                ? 'var(--ui-color-text-success)'
                : 'var(--ui-color-border-connections)',
            opacity:isPending
                ? '.9'
                : isHistory
                    ? '.58'
                    : item.kind === 'input' ? '.82' : '.72',
            controlX:selectedPoint?.x ?? (geometry.fx + geometry.tx) / 2,
            controlY:selectedPoint?.y ?? (geometry.fy + geometry.ty) / 2
        };
    }
    function smartConnectionLayerEnsureMaterialization(svg,item){
        let group = elementByKey.get(item.key) || null;
        if(group) return group;
        group = smartConnectionLayerCreateSvgElement('g');
        group.classList.add('connection-materialization');
        group.dataset.connectionKey = item.key;
        const line = smartConnectionLayerCreateSvgElement('path');
        line.classList.add('conn-line');
        line.setAttribute('fill','none');
        line.setAttribute('stroke-width','1.5');
        const hit = smartConnectionLayerCreateSvgElement('path');
        hit.classList.add('conn-hit');
        hit.setAttribute('stroke','transparent');
        hit.setAttribute('stroke-width','14');
        hit.setAttribute('fill','none');
        const end = smartConnectionLayerCreateSvgElement('circle');
        end.classList.add('conn-end');
        end.setAttribute('r','3.5');
        end.setAttribute('opacity','.9');
        group.append(line,hit,end);
        svg.appendChild(group);
        elementByKey.set(item.key,group);
        return group;
    }
    function smartConnectionLayerEnsureCutControl(group){
        let control = group.querySelector(':scope > .conn-cut');
        if(control) return control;
        control = smartConnectionLayerCreateSvgElement('g');
        control.classList.add('conn-cut');
        control.setAttribute('role','button');
        control.setAttribute('tabindex','0');
        const circle = smartConnectionLayerCreateSvgElement('circle');
        circle.setAttribute('r','18');
        circle.setAttribute('fill','var(--ui-color-surface)');
        circle.setAttribute('stroke','var(--ui-color-text-secondary)');
        circle.setAttribute('stroke-width','1.4');
        const icon = smartConnectionLayerCreateSvgElement('g');
        icon.classList.add('conn-cut-icon');
        icon.setAttribute('transform','scale(2)');
        icon.setAttribute('fill','none');
        icon.setAttribute('stroke','var(--ui-color-text-secondary)');
        icon.setAttribute('stroke-width','1.4');
        icon.setAttribute('stroke-linecap','round');
        icon.setAttribute('stroke-linejoin','round');
        const firstHandle = smartConnectionLayerCreateSvgElement('circle');
        firstHandle.setAttribute('cx','-3.2');
        firstHandle.setAttribute('cy','-3.2');
        firstHandle.setAttribute('r','1.8');
        const secondHandle = smartConnectionLayerCreateSvgElement('circle');
        secondHandle.setAttribute('cx','-3.2');
        secondHandle.setAttribute('cy','3.2');
        secondHandle.setAttribute('r','1.8');
        const blades = smartConnectionLayerCreateSvgElement('path');
        blades.setAttribute('d','M-1.8 -1.8 L4.8 4.8 M-1.8 1.8 L4.8 -4.8');
        icon.append(firstHandle,secondHandle,blades);
        control.append(circle,icon);
        group.appendChild(control);
        return control;
    }
    function smartConnectionLayerMaterialize(svg,item,view){
        const geometry = smartConnectionLayerGeometry(item,view);
        const existing = elementByKey.get(item.key) || null;
        if(!geometry){
            existing?.remove();
            elementByKey.delete(item.key);
            renderedKeys.delete(item.key);
            return null;
        }
        const presentation = smartConnectionLayerPresentation(item,view,geometry);
        const group = existing || smartConnectionLayerEnsureMaterialization(svg,item);
        group.setAttribute(
            'class',
            `connection-materialization ${presentation.isSelected ? 'connection-selected' : ''}`
        );
        const dataIndex = item.indices.join(',');
        const line = group.querySelector(':scope > .conn-line');
        const hit = group.querySelector(':scope > .conn-hit');
        const end = group.querySelector(':scope > .conn-end');
        line.setAttribute('class',presentation.lineClass);
        line.dataset.connIndex = dataIndex;
        line.setAttribute('d',geometry.curve);
        line.setAttribute('stroke',presentation.color);
        line.setAttribute('opacity',presentation.opacity);
        hit.dataset.connIndex = dataIndex;
        hit.setAttribute('d',geometry.curve);
        end.dataset.connIndex = dataIndex;
        end.setAttribute('cx',String(geometry.tx));
        end.setAttribute('cy',String(geometry.ty));
        end.setAttribute('fill',presentation.color);
        if(presentation.isSelected){
            const control = smartConnectionLayerEnsureCutControl(group);
            control.dataset.connIndex = dataIndex;
            control.setAttribute(
                'transform',
                `translate(${presentation.controlX} ${presentation.controlY})`
            );
            control.setAttribute(
                'aria-label',
                dependencies.translate?.('canvas.deleteLink') || 'Delete Connection'
            );
        } else {
            group.querySelector(':scope > .conn-cut')?.remove();
        }
        renderedKeys.add(item.key);
        return group;
    }
    function smartConnectionLayerSync(){
        const view = smartConnectionLayerBuildView();
        lastView = view;
        const svg = smartConnectionLayerEnsureSvg(view.reduceMotion);
        elementByKey = new Map(
            [...svg.querySelectorAll(':scope > [data-connection-key]')]
                .map(element => [element.dataset.connectionKey || '',element])
        );
        const desiredKeys = new Set();
        view.items.forEach(item => {
            desiredKeys.add(item.key);
            const group = smartConnectionLayerMaterialize(svg,item,view);
            if(group) svg.appendChild(group);
        });
        elementByKey.forEach((group,key) => {
            if(desiredKeys.has(key)) return;
            renderedKeys.delete(key);
            elementByKey.delete(key);
            group.remove();
        });
        dependencies.noteConnections?.(renderedKeys.size);
        return svg;
    }
    function smartConnectionLayerRefreshNodes(nodeIds=[]){
        if(!lastView) return smartConnectionLayerSync();
        const current = smartConnectionLayerSnapshot();
        lastView.snapshot = current;
        lastView.pinnedNodeIds = new Set(current.pinnedNodeIds || []);
        lastView.interaction = current.interaction || null;
        const svg = smartConnectionLayerEnsureSvg(lastView.reduceMotion);
        const keys = new Set();
        (nodeIds || []).forEach(nodeId => {
            (materializationKeysByNodeId.get(nodeId) || [])
                .forEach(key => keys.add(key));
        });
        keys.forEach(key => {
            const item = materializationByKey.get(key);
            if(item) smartConnectionLayerMaterialize(svg,item,lastView);
        });
        dependencies.noteConnections?.(renderedKeys.size);
        return svg;
    }
    function smartConnectionLayerDiagnostics(){
        return Object.freeze({
            indexedNodeCount:nodeById.size,
            indexedConnectionCount:materializationByKey.size,
            renderedConnectionCount:renderedKeys.size
        });
    }

    return Object.freeze({
        sync:smartConnectionLayerSync,
        refreshNodes:smartConnectionLayerRefreshNodes,
        diagnostics:smartConnectionLayerDiagnostics
    });
}

window.SmartCanvasModules = window.SmartCanvasModules || {};
window.SmartCanvasModules.connectionLayer = Object.freeze({
    create:createSmartConnectionLayerModule
});
