/*
 * Smart Canvas Selection Arrangement
 *
 * Pure planning for explicit grid, horizontal, vertical and directional tree arrangement.
 * The host owns selection, Mutation history, rendering and persistence.
 */
(function installSelectionArrangement(root, factory){
    const geometry = root.SmartCanvasModules?.nodeGeometry
        || (typeof require === 'function' ? require('./node-geometry.js') : null);
    const arrangement = factory(geometry);
    if(typeof module === 'object' && module.exports) module.exports = arrangement;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.selectionArrangement = arrangement;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createSelectionArrangement(geometry){
    'use strict';

    const MODES = new Set([
        'grid','horizontal','vertical','tree-vertical','tree-horizontal'
    ]);
    const NODE_GAP = geometry.nodeGap;

    function number(value, fallback=0){
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function compareOriginal(left, right){
        return number(left.y) - number(right.y)
            || number(left.x) - number(right.x)
            || (String(left.id)<String(right.id) ? -1 : String(left.id)>String(right.id) ? 1 : 0);
    }

    function compareHorizontal(left, right){
        return number(left.x) - number(right.x)
            || number(left.y) - number(right.y)
            || (String(left.id)<String(right.id) ? -1 : String(left.id)>String(right.id) ? 1 : 0);
    }

    function compareVertical(left, right){
        return compareOriginal(left,right);
    }

    function boundsOf(items){
        const left = Math.min(...items.map(item => number(item.x)));
        const top = Math.min(...items.map(item => number(item.y)));
        const right = Math.max(...items.map(item => number(item.x) + number(item.width,1)));
        const bottom = Math.max(...items.map(item => number(item.y) + number(item.height,1)));
        return {x:left,y:top,width:right-left,height:bottom-top};
    }

    function axes(items, columnById, rowById){
        const columnCount = Math.max(...items.map(item => columnById.get(item.id))) + 1;
        const rowCount = Math.max(...items.map(item => rowById.get(item.id))) + 1;
        const columnWidths = new Array(columnCount).fill(0);
        const rowHeights = new Array(rowCount).fill(0);
        items.forEach(item => {
            const column = columnById.get(item.id);
            const row = rowById.get(item.id);
            columnWidths[column] = Math.max(columnWidths[column],number(item.width,1));
            rowHeights[row] = Math.max(rowHeights[row],number(item.height,1));
        });
        return {columnWidths,rowHeights};
    }

    function groupProjection(allNodes, selectedIds){
        const projection = new Map();
        const selectedGroups = allNodes.filter(node =>
            selectedIds.has(String(node.id)) && node.type === 'smart-group'
        );
        const byId = new Map(allNodes.map(node => [String(node.id),node]));
        const visit = (memberId, groupId, seen=new Set()) => {
            const id = String(memberId || '');
            if(!id || seen.has(id)) return;
            seen.add(id);
            projection.set(id,groupId);
            const member = byId.get(id);
            if(member?.type === 'smart-group'){
                (member.items || []).forEach(child => visit(child,groupId,seen));
            }
        };
        selectedGroups.forEach(group =>
            (group.items || []).forEach(memberId => visit(memberId,String(group.id)))
        );
        return projection;
    }

    function projectedConnections(allNodes, connections, selectedIds){
        const projection = groupProjection(allNodes,selectedIds);
        const seen = new Set();
        const result = [];
        (connections || []).forEach(connection => {
            const from = projection.get(String(connection?.from || ''))
                || String(connection?.from || '');
            const to = projection.get(String(connection?.to || ''))
                || String(connection?.to || '');
            if(!selectedIds.has(from) || !selectedIds.has(to) || from === to) return;
            const key = `${from}\u0000${to}`;
            if(seen.has(key)) return;
            seen.add(key);
            result.push({from,to});
        });
        return result;
    }

    function axisBands(items, axis){
        const positionKey = axis === 'x' ? 'x' : 'y';
        const sizeKey = axis === 'x' ? 'width' : 'height';
        const centerOf = item => number(item[positionKey]) + number(item[sizeKey],1) / 2;
        const ordered = items.slice().sort((left,right) =>
            centerOf(left) - centerOf(right)
            || number(left[positionKey]) - number(right[positionKey])
            || compareOriginal(left,right)
        );
        const bands = [];
        ordered.forEach(item => {
            let best = null;
            bands.forEach(band => {
                const candidates = band.items.concat(item);
                const starts = candidates.map(candidate => number(candidate[positionKey]));
                const centers = candidates.map(centerOf);
                const smallestSize = Math.min(...candidates.map(candidate =>
                    number(candidate[sizeKey],1)
                ));
                const tolerance = Math.max(16,smallestSize / 2);
                const startSpread = Math.max(...starts) - Math.min(...starts);
                const centerSpread = Math.max(...centers) - Math.min(...centers);
                if(Math.min(startSpread,centerSpread) > tolerance) return;
                const meanStart = starts.reduce((total,value) => total + value,0) / starts.length;
                const meanCenter = centers.reduce((total,value) => total + value,0) / centers.length;
                const score = Math.min(
                    Math.abs(number(item[positionKey]) - meanStart),
                    Math.abs(centerOf(item) - meanCenter)
                );
                if(!best || score < best.score) best = {band,score};
            });
            if(best) best.band.items.push(item);
            else bands.push({items:[item]});
        });
        bands.sort((left,right) => {
            const mean = band => band.items.reduce(
                (total,item) => total + centerOf(item),0
            ) / band.items.length;
            return mean(left) - mean(right);
        });
        return bands;
    }

    function existingGridSlots(items){
        const rowBands = axisBands(items,'y');
        const columnBands = axisBands(items,'x');
        const columnById = new Map();
        const rowById = new Map();
        const occupied = new Set();
        let duplicateSlot = false;
        rowBands.forEach((band,row) => band.items.forEach(item => rowById.set(item.id,row)));
        columnBands.forEach((band,column) => band.items.forEach(item => columnById.set(item.id,column)));
        items.forEach(item => {
            const key = `${rowById.get(item.id)}:${columnById.get(item.id)}`;
            if(occupied.has(key)) duplicateSlot = true;
            occupied.add(key);
        });
        if(duplicateSlot) return null;

        const columns = columnBands.length;
        const rows = rowBands.length;
        const rowMajorPrefix = items.every((_,index) =>
            occupied.has(`${Math.floor(index / columns)}:${index % columns}`)
        );
        const hasOnlyPrefix = rowMajorPrefix && occupied.size === items.length
            && items.length <= columns * rows;
        if(!hasOnlyPrefix) return null;
        return {columnById,rowById,cycleFallback:false};
    }

    function gridSlots(items, mode){
        const columns = mode === 'horizontal'
            ? items.length
            : mode === 'vertical'
                ? 1
                : Math.max(1,Math.ceil(Math.sqrt(items.length)));
        if(mode === 'grid'){
            const existing = existingGridSlots(items);
            if(existing) return existing;
        }
        const columnById = new Map();
        const rowById = new Map();
        items.forEach((item,index) => {
            columnById.set(item.id,index % columns);
            rowById.set(item.id,Math.floor(index / columns));
        });
        return {columnById,rowById,cycleFallback:false};
    }

    function treeSlots(items, allNodes, connections){
        const selectedIds = new Set(items.map(item => String(item.id)));
        const internal = projectedConnections(allNodes,connections,selectedIds);
        const outgoing = new Map(items.map(item => [item.id,[]]));
        const incoming = new Map(items.map(item => [item.id,[]]));
        const indegree = new Map(items.map(item => [item.id,0]));
        internal.forEach(({from,to}) => {
            outgoing.get(from).push(to);
            incoming.get(to).push(from);
            indegree.set(to,(indegree.get(to) || 0) + 1);
        });
        const byId = new Map(items.map(item => [item.id,item]));
        outgoing.forEach(children => children.sort((left,right) =>
            compareOriginal(byId.get(left),byId.get(right))
        ));
        const queue = items.filter(item => indegree.get(item.id) === 0).sort(compareOriginal);
        const layer = new Map(items.map(item => [item.id,0]));
        const ordered = [];
        while(queue.length){
            queue.sort(compareOriginal);
            const item = queue.shift();
            ordered.push(item.id);
            (outgoing.get(item.id) || []).forEach(childId => {
                layer.set(childId,Math.max(layer.get(childId) || 0,(layer.get(item.id) || 0) + 1));
                indegree.set(childId,(indegree.get(childId) || 0) - 1);
                if(indegree.get(childId) === 0) queue.push(byId.get(childId));
            });
        }
        const cycleFallback = ordered.length !== items.length;
        if(cycleFallback){
            const unresolved = items.filter(item => !ordered.includes(item.id))
                .sort((left,right) => number(left.x) - number(right.x) || compareOriginal(left,right));
            unresolved.forEach(item => {
                const parents = internal.filter(connection => connection.to === item.id)
                    .map(connection => layer.get(connection.from))
                    .filter(value => Number.isFinite(value));
                layer.set(item.id,parents.length ? Math.max(...parents) + 1 : layer.get(item.id) || 0);
            });
        }
        const layers = new Map();
        items.forEach(item => {
            const column = layer.get(item.id) || 0;
            if(!layers.has(column)) layers.set(column,[]);
            layers.get(column).push(item);
        });
        layers.forEach(values => values.sort(compareOriginal));
        const columnById = new Map();
        const rowById = new Map();
        [...layers.keys()].sort((left,right) => left-right).forEach((column,index) => {
            layers.get(column).forEach((item,row) => {
                columnById.set(item.id,index);
                rowById.set(item.id,row);
            });
        });

        const adjacent = new Map(items.map(item => [item.id,new Set()]));
        internal.forEach(({from,to}) => {
            adjacent.get(from).add(to);
            adjacent.get(to).add(from);
        });
        const visited = new Set();
        const components = [];
        items.slice().sort(compareOriginal).forEach(item => {
            if(visited.has(item.id)) return;
            const ids = [];
            const pending = [item.id];
            visited.add(item.id);
            while(pending.length){
                const id = pending.shift();
                ids.push(id);
                [...(adjacent.get(id) || [])]
                    .sort((left,right) => compareOriginal(byId.get(left),byId.get(right)))
                    .forEach(neighbor => {
                        if(visited.has(neighbor)) return;
                        visited.add(neighbor);
                        pending.push(neighbor);
                    });
            }
            components.push(ids.map(id => byId.get(id)).sort(compareOriginal));
        });
        if(!cycleFallback){
            rowById.clear();
            let rowBase = 0;
            components.forEach(component => {
                const componentLayers = new Map();
                component.forEach(item => {
                    const column = columnById.get(item.id);
                    if(!componentLayers.has(column)) componentLayers.set(column,[]);
                    componentLayers.get(column).push(item);
                });
                let componentRows = 1;
                componentLayers.forEach(layerItems => {
                    layerItems.sort(compareOriginal);
                    componentRows = Math.max(componentRows,layerItems.length);
                    layerItems.forEach((item,row) => rowById.set(item.id,rowBase + row));
                });
                rowBase += componentRows;
            });
        }
        return {columnById,rowById,cycleFallback,incoming,outgoing,components};
    }

    function orderedCenters(items, desiredById, gap){
        const desired = items.map(item => number(desiredById.get(item.id)));
        const centers = desired.slice();
        for(let index=1;index<items.length;index += 1){
            const separation = Math.max(0,
                (items[index - 1].height + items[index].height) / 2 + gap
            );
            centers[index] = Math.max(centers[index],centers[index - 1] + separation);
        }
        const desiredMean = desired.reduce((total,value) => total + value,0) / desired.length;
        const centerMean = centers.reduce((total,value) => total + value,0) / centers.length;
        const correction = desiredMean - centerMean;
        return new Map(items.map((item,index) => [item.id,centers[index] + correction]));
    }

    function treePlacements(items, slots, columnWidths, columnOffsets, gap, originalBounds){
        const relativeY = new Map();
        let componentCursor = 0;
        let forestBottom = 0;

        slots.components.forEach(component => {
            const layers = new Map();
            component.forEach(item => {
                const column = slots.columnById.get(item.id);
                if(!layers.has(column)) layers.set(column,[]);
                layers.get(column).push(item);
            });
            layers.forEach(layerItems => layerItems.sort(compareOriginal));
            const columns = [...layers.keys()].sort((left,right) => left-right);
            const centers = new Map();
            columns.forEach(column => {
                const layerItems = layers.get(column);
                const initial = new Map(layerItems.map(item => [item.id,0]));
                orderedCenters(layerItems,initial,gap).forEach((value,id) => centers.set(id,value));
            });

            for(let iteration=0;iteration<6;iteration += 1){
                columns.forEach(column => {
                    const layerItems = layers.get(column);
                    const desired = new Map(layerItems.map(item => {
                        const parents = (slots.incoming.get(item.id) || [])
                            .filter(id => centers.has(id));
                        const value = parents.length
                            ? parents.reduce((total,id) => total + centers.get(id),0) / parents.length
                            : centers.get(item.id);
                        return [item.id,value];
                    }));
                    orderedCenters(layerItems,desired,gap)
                        .forEach((value,id) => centers.set(id,value));
                });
                columns.slice().reverse().forEach(column => {
                    const layerItems = layers.get(column);
                    const desired = new Map(layerItems.map(item => {
                        const children = (slots.outgoing.get(item.id) || [])
                            .filter(id => centers.has(id));
                        const value = children.length
                            ? children.reduce((total,id) => total + centers.get(id),0) / children.length
                            : centers.get(item.id);
                        return [item.id,value];
                    }));
                    orderedCenters(layerItems,desired,gap)
                        .forEach((value,id) => centers.set(id,value));
                });
            }

            const top = Math.min(...component.map(item => centers.get(item.id) - item.height / 2));
            const bottom = Math.max(...component.map(item => centers.get(item.id) + item.height / 2));
            const height = bottom - top;
            component.forEach(item => {
                relativeY.set(item.id,componentCursor + centers.get(item.id) - item.height / 2 - top);
            });
            forestBottom = Math.max(forestBottom,componentCursor + height);
            componentCursor += Math.max(0,height + gap);
        });

        const startY = originalBounds.y + originalBounds.height / 2 - forestBottom / 2;
        const placements = items.map(item => {
            const column = slots.columnById.get(item.id);
            return {
                id:item.id,
                x:Math.round(originalBounds.x + columnOffsets.values[column]
                    + (columnWidths[column] - item.width) / 2),
                y:Math.round(startY + relativeY.get(item.id))
            };
        });
        return {
            placements,
            bounds:{
                x:originalBounds.x,
                y:startY,
                width:columnOffsets.total,
                height:forestBottom
            }
        };
    }

    function horizontalBranchSlots(items, slots){
        const byId = new Map(items.map(item => [item.id,item]));
        const sourceIdOf = item => String(
            item.generationBatchSourceNodeId || item.sourceNodeId || ''
        );
        const explicitParentIdsOf = item => [...new Set([
            ...(slots.incoming.get(item.id) || []),
            ...(item.inputNodeIds || []).map(id => String(id || ''))
        ])].filter(id => byId.has(id) && id !== item.id);
        const parentIdsByNode = new Map(items.map(item => {
            const explicit = explicitParentIdsOf(item);
            if(explicit.length) return [item.id,explicit];
            const sourceId = sourceIdOf(item);
            if(
                sourceId
                && sourceId !== item.id
                && byId.has(sourceId)
            ){
                return [item.id,[sourceId]];
            }
            return [item.id,[]];
        }));
        const parentIds = new Set([...parentIdsByNode.values()].flat());
        const batchParentById = new Map();
        items.filter(item => parentIds.has(item.id) && item.generationBatchId)
            .sort(compareOriginal)
            .forEach(item => {
                const batchId = String(item.generationBatchId);
                if(!batchParentById.has(batchId)){
                    batchParentById.set(batchId,item.id);
                }
            });

        const rowsByKey = new Map();
        const rowByParentId = new Map();
        const ensureRow = (key, parent=null) => {
            if(!rowsByKey.has(key)){
                const row = {key,parents:parent ? [parent] : [],children:[]};
                rowsByKey.set(key,row);
                if(parent) rowByParentId.set(parent.id,row);
            }
            return rowsByKey.get(key);
        };
        [...parentIds].map(id => byId.get(id)).sort(compareOriginal)
            .forEach(parent => ensureRow(`parent:${parent.id}`,parent));

        items.filter(item => !parentIds.has(item.id)).sort(compareOriginal)
            .forEach(item => {
                const batchId = String(item.generationBatchId || '');
                const batchParentId = batchParentById.get(batchId) || '';
                const incomingParents = (parentIdsByNode.get(item.id) || [])
                    .filter(id => parentIds.has(id))
                    .map(id => byId.get(id))
                    .sort(compareOriginal);
                let key = '';
                if(incomingParents.length){
                    key = `parent:${incomingParents[0].id}`;
                } else if(batchParentId){
                    key = `parent:${batchParentId}`;
                } else if(batchId){
                    key = `batch:${batchId}`;
                } else {
                    key = `node:${item.id}`;
                }
                ensureRow(key).children.push(item);
            });

        rowsByKey.forEach(row => row.children.sort(compareHorizontal));
        [...parentIds].map(id => byId.get(id))
            .sort((left,right) =>
                number(slots.columnById.get(left.id)) - number(slots.columnById.get(right.id))
                || compareOriginal(left,right)
            )
            .forEach(parent => {
                const row = rowByParentId.get(parent.id);
                const incomingParents = (parentIdsByNode.get(parent.id) || [])
                    .filter(id => parentIds.has(id))
                    .map(id => byId.get(id))
                    .filter(candidate => {
                        const candidateRow = rowByParentId.get(candidate.id);
                        return candidateRow
                            && candidateRow !== row
                            && candidateRow.children.length === 0
                            && candidateRow.parents.at(-1)?.id === candidate.id;
                    })
                    .sort((left,right) => {
                        const center = item => number(item.y) + item.height / 2;
                        return Math.abs(center(left) - center(parent))
                            - Math.abs(center(right) - center(parent))
                            || compareOriginal(left,right);
                    });
                if(!incomingParents.length) return;
                const upstreamRow = rowByParentId.get(incomingParents[0].id);
                upstreamRow.parents.push(...row.parents);
                upstreamRow.children = row.children;
                row.parents.forEach(item => rowByParentId.set(item.id,upstreamRow));
                rowsByKey.delete(row.key);
            });

        const compactedColumns = new Map(items.map(item => [
            item.id,number(slots.columnById.get(item.id))
        ]));
        if(!slots.cycleFallback){
            items.slice().sort((left,right) =>
                compactedColumns.get(right.id) - compactedColumns.get(left.id)
                || compareOriginal(left,right)
            ).forEach(item => {
                const childColumns = (slots.outgoing.get(item.id) || [])
                    .filter(id => compactedColumns.has(id))
                    .map(id => compactedColumns.get(id));
                if(!childColumns.length) return;
                compactedColumns.set(item.id,Math.max(
                    compactedColumns.get(item.id),
                    Math.min(...childColumns) - 1
                ));
            });
        }

        const rowOrigin = row => {
            const rowItems = [...row.parents,...row.children];
            return {
                id:rowItems[0]?.id || '',
                x:Math.min(...rowItems.map(item => number(item.x))),
                y:Math.min(...rowItems.map(item => number(item.y)))
            };
        };
        const orderedRows = [...rowsByKey.values()].sort(
            (left,right) => compareOriginal(rowOrigin(left),rowOrigin(right))
        );
        const columnById = new Map();
        const rowById = new Map();
        orderedRows.forEach((row,rowIndex) => {
            const rowItems = [...row.parents,...row.children];
            let column = row.parents.length
                ? compactedColumns.get(row.parents[0].id)
                : 0;
            rowItems.forEach(item => {
                column = Math.max(column,compactedColumns.get(item.id) || 0);
                columnById.set(item.id,column);
                rowById.set(item.id,rowIndex);
                column += 1;
            });
        });
        return {columnById,rowById};
    }

    function horizontalBranchPlacements(items, slots, originalBounds){
        const branchSlots = horizontalBranchSlots(items,slots);
        const {columnWidths,rowHeights} = axes(
            items,branchSlots.columnById,branchSlots.rowById
        );
        const gap = NODE_GAP;
        const columnOffsets = geometry.layoutOffsets(columnWidths);
        const rowOffsets = geometry.layoutOffsets(rowHeights);
        const startY = originalBounds.y + originalBounds.height / 2 - rowOffsets.total / 2;
        return {
            placements:items.map(item => {
                const column = branchSlots.columnById.get(item.id);
                const row = branchSlots.rowById.get(item.id);
                return {
                    id:item.id,
                    x:Math.round(originalBounds.x + columnOffsets.values[column]
                        + (columnWidths[column] - item.width) / 2),
                    y:Math.round(startY + rowOffsets.values[row]
                        + (rowHeights[row] - item.height) / 2)
                };
            }),
            bounds:{
                x:originalBounds.x,
                y:startY,
                width:columnOffsets.total,
                height:rowOffsets.total
            },
            gap
        };
    }

    function plan(request={}){
        const mode = MODES.has(request.mode) ? request.mode : 'grid';
        const treeMode = ['tree-vertical','tree-horizontal'].includes(mode);
        const allNodes = Array.isArray(request.nodes) ? request.nodes.filter(Boolean) : [];
        const selectedIds = new Set((request.selectedIds || []).map(value => String(value)));
        const items = allNodes.filter(node => selectedIds.has(String(node.id)))
            .filter(node => node.type !== 'smart-frame')
            .map(node => ({
                ...node,
                id:String(node.id),
                x:number(node.x),
                y:number(node.y),
                width:Math.max(1,number(node.width ?? node.w,1)),
                height:Math.max(1,number(node.height ?? node.h,1))
            }))
            .sort(mode === 'horizontal'
                ? compareHorizontal
                : mode === 'vertical'
                    ? compareVertical
                    : compareOriginal);
        if(items.length < 2){
            return Object.freeze({ok:false,placements:[],bounds:null,gap:0,diagnostics:[{code:'insufficient-selection'}]});
        }
        const originalBounds = boundsOf(items);
        const slots = treeMode
            ? treeSlots(items,allNodes,request.connections || [])
            : gridSlots(items,mode);
        if(mode === 'tree-horizontal'){
            const tree = horizontalBranchPlacements(items,slots,originalBounds);
            return Object.freeze({
                ok:true,
                placements:tree.placements,
                bounds:tree.bounds,
                gap:tree.gap,
                diagnostics:slots.cycleFallback ? [{code:'cycle-fallback'}] : []
            });
        }
        const {columnWidths,rowHeights} = axes(
            items,slots.columnById,slots.rowById
        );
        const gap = NODE_GAP;
        const columnOffsets = geometry.layoutOffsets(columnWidths);
        const rowOffsets = geometry.layoutOffsets(rowHeights);
        const startX = originalBounds.x;
        if(treeMode && !slots.cycleFallback){
            const tree = treePlacements(
                items,slots,columnWidths,columnOffsets,gap,originalBounds
            );
            return Object.freeze({
                ok:true,
                placements:tree.placements,
                bounds:tree.bounds,
                gap,
                diagnostics:[]
            });
        }
        const startY = treeMode
            ? originalBounds.y + originalBounds.height / 2 - rowOffsets.total / 2
            : originalBounds.y;
        const placements = items.map(item => {
            const column = slots.columnById.get(item.id);
            const row = slots.rowById.get(item.id);
            return {
                id:item.id,
                x:Math.round(startX + columnOffsets.values[column] + (columnWidths[column] - item.width) / 2),
                y:Math.round(startY + rowOffsets.values[row] + (rowHeights[row] - item.height) / 2)
            };
        });
        const bounds = {
            x:startX,y:startY,width:columnOffsets.total,height:rowOffsets.total
        };
        return Object.freeze({
            ok:true,
            placements,
            bounds,
            gap,
            diagnostics:slots.cycleFallback ? [{code:'cycle-fallback'}] : []
        });
    }

    return Object.freeze({plan});
});
