/*
 * Node Placement external interface
 *
 * plan(request) is a deterministic, pure in-process calculation. Callers
 * provide an immutable Smart Canvas snapshot, draft Nodes and semantic intent;
 * candidate generation, interaction clearance, collection layout, Frame
 * policy and tie-breaking remain private implementation details.
 */
(function installNodePlacement(root, factory) {
    const geometry = root.SmartCanvasModules?.nodeGeometry
        || (typeof require === 'function' ? require('./node-geometry.js') : null);
    const placement = factory(geometry);
    if (typeof module === 'object' && module.exports) module.exports = placement;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.nodePlacement = placement;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createNodePlacement(geometry) {
    'use strict';

    if (!geometry?.createSession) throw new Error('Node Geometry Module failed to load');

    const GAP = geometry.nodeGap;
    const FATAL_DIAGNOSTICS = new Set([
        'invalid-node-position',
        'invalid-node-dimensions',
        'invalid-persisted-dimensions'
    ]);

    function number(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function rect(value = {}) {
        return {
            x:number(value.x),
            y:number(value.y),
            width:Math.max(0, number(value.width ?? value.w)),
            height:Math.max(0, number(value.height ?? value.h))
        };
    }

    function right(value) {
        return value.x + value.width;
    }

    function bottom(value) {
        return value.y + value.height;
    }

    function overlaps(left, rightValue) {
        return left.x < right(rightValue)
            && right(left) > rightValue.x
            && left.y < bottom(rightValue)
            && bottom(left) > rightValue.y;
    }

    function contains(outer, inner) {
        return inner.x >= outer.x
            && inner.y >= outer.y
            && right(inner) <= right(outer)
            && bottom(inner) <= bottom(outer);
    }

    function translated(value, x, y) {
        return {...value, x:value.x + x, y:value.y + y};
    }

    function boundsOf(values) {
        if (!values.length) return {x:0,y:0,width:0,height:0};
        const minX = Math.min(...values.map(value => value.x));
        const minY = Math.min(...values.map(value => value.y));
        const maxX = Math.max(...values.map(right));
        const maxY = Math.max(...values.map(bottom));
        return {x:minX,y:minY,width:maxX - minX,height:maxY - minY};
    }

    function measureNodes(snapshotNodes, drafts) {
        const stagedDrafts = drafts.map((draft, index) => ({
            ...draft,
            id:String(draft?.id || `__placement_draft_${index}`),
            x:number(draft?.x),
            y:number(draft?.y)
        }));
        const allNodes = [...snapshotNodes, ...stagedDrafts];
        const session = geometry.createSession({nodes:allNodes,connections:[]});
        const measuredSnapshot = snapshotNodes.map(node => ({
            node,
            measurement:session.measure(node?.id)
        }));
        const measuredDrafts = stagedDrafts.map(node => ({
            node,
            measurement:session.measure(node.id)
        }));
        return {measuredSnapshot, measuredDrafts};
    }

    function diagnosticsFor(measuredSnapshot, measuredDrafts) {
        const diagnostics = [];
        [...measuredSnapshot, ...measuredDrafts].forEach(({node, measurement}) => {
            if (!measurement.supported) {
                diagnostics.push({
                    code:'unsupported-node-geometry',
                    nodeId:String(node?.id || ''),
                    path:'type'
                });
                return;
            }
            (measurement.diagnostics || []).forEach(item => {
                if (FATAL_DIAGNOSTICS.has(item.code)) diagnostics.push({...item});
            });
        });
        return diagnostics;
    }

    function collection(measuredDrafts, arrangement) {
        const visible = [];
        const interaction = [];
        const horizontal = arrangement === 'horizontal-batch';
        const linear = ['horizontal-batch','vertical-batch'].includes(arrangement)
            ? geometry.layoutOffsets(measuredDrafts.map(({measurement}) =>
                horizontal ? measurement.footprint.width : measurement.footprint.height
            )).values : [];
        let rigidMinX = 0;
        let rigidMinY = 0;
        if (arrangement === 'rigid' && measuredDrafts.length) {
            rigidMinX = Math.min(...measuredDrafts.map(({node}) => number(node.x)));
            rigidMinY = Math.min(...measuredDrafts.map(({node}) => number(node.y)));
        }
        const members = measuredDrafts.map(({node, measurement}, index) => {
            const footprint = rect(measurement.footprint);
            let x = 0;
            let y = 0;
            if (arrangement === 'vertical-batch') {
                y = linear[index];
            } else if (arrangement === 'horizontal-batch') {
                x = linear[index];
            } else if (arrangement === 'rigid') {
                x = number(node.x) - rigidMinX;
                y = number(node.y) - rigidMinY;
            }
            const visibleRect = {x,y,width:footprint.width,height:footprint.height};
            const localInteraction = rect(measurement.interactionFootprint);
            const interactionRect = {
                x:x + localInteraction.x - footprint.x,
                y:y + localInteraction.y - footprint.y,
                width:localInteraction.width,
                height:localInteraction.height
            };
            visible.push(visibleRect);
            interaction.push(interactionRect);
            return {id:String(node.id),x,y};
        });
        const visibleBounds = boundsOf(visible);
        const interactionBounds = boundsOf(interaction);
        return {members,visibleBounds,interactionBounds};
    }

    function containingFrame(measured, intent) {
        const frames = measured.filter(item => item.measurement.spatialContainer);
        if (Object.prototype.hasOwnProperty.call(intent,'frameId')) {
            return frames.find(item=>String(item.node.id)===String(intent.frameId)) || null;
        }
        const anchor = intent.anchor || {};
        const ids = anchor.sourceNodeIds || [anchor.sourceNodeId].filter(Boolean);
        const candidates = frames.filter(({node,measurement}) => anchor.kind==='point'
            ? contains(measurement.footprint,{x:anchor.x,y:anchor.y,width:0,height:0})
            : ids.length && ids.every(id=>(node.items || []).includes(id)));
        candidates.sort((a,b) => {
            const area = item=>item.measurement.footprint.width*item.measurement.footprint.height;
            return area(a)-area(b) || (String(a.node.id)<String(b.node.id) ? -1 : 1);
        });
        return candidates[0] || null;
    }

    function previousGenerationBatch(measured, drafts, intent) {
        if (!['horizontal-batch','vertical-batch'].includes(intent.arrangement)) return null;
        const sourceId = String(drafts[0]?.node.generationBatchSourceNodeId || intent.anchor?.sourceNodeId || '');
        const layout = intent.arrangement==='horizontal-batch' ? 'horizontal' : 'vertical';
        const batches = new Map();
        measured.forEach(item => {
            const node = item.node;
            if (!sourceId || !node.generationBatchId || String(node.generationBatchSourceNodeId)!==sourceId
                || (node.generationBatchLayout || 'vertical')!==layout) return;
            if (!batches.has(node.generationBatchId)) batches.set(node.generationBatchId,[]);
            batches.get(node.generationBatchId).push(item);
        });
        const ordered = [...batches.entries()].sort((a,b)=>
            Math.max(...b[1].map(item=>number(item.node.created_at)))-Math.max(...a[1].map(item=>number(item.node.created_at)))
            || (String(a[0])<String(b[0]) ? -1 : String(a[0])>String(b[0]) ? 1 : 0));
        if (!ordered.length) return null;
        const bounds = boundsOf(ordered[0][1].map(item=>rect(item.measurement.footprint)));
        return layout==='horizontal'
            ? {x:bounds.x,y:bottom(bounds)+GAP,horizontal:true}
            : {x:right(bounds)+GAP,y:bounds.y,horizontal:false};
    }

    function preferredPosition(value, measured, intent) {
        const anchor = intent.anchor || {};
        if (anchor.kind==='source') {
            const ids = anchor.sourceNodeIds || [anchor.sourceNodeId];
            const sources = ids.map(id=>measured.find(item=>String(item.node.id)===String(id)));
            if (!sources.length || sources.some(item=>!item?.measurement.supported)) return null;
            const sourceRect = boundsOf(sources.map(item=>rect(item.measurement.footprint)));
            const upstream = intent.relation==='upstream';
            return {x:upstream ? sourceRect.x-GAP-value.visibleBounds.width : right(sourceRect)+GAP,
                y:intent.alignment==='center'
                    ? sourceRect.y+(sourceRect.height-value.visibleBounds.height)/2 : sourceRect.y,
                sourceRect,upstream};
        }
        const attachment = anchor.attachment || 'center';
        return {
            x:number(anchor.x)-(attachment==='left-middle' || attachment==='top-left' ? 0
                : attachment==='right-middle' ? value.visibleBounds.width : value.visibleBounds.width/2),
            y:number(anchor.y)-(attachment==='top-left' ? 0 : value.visibleBounds.height/2)
        };
    }

    function search(value, obstacles, preferred, viewport, previousBatch) {
        const local = value.interactionBounds;
        const visible = value.visibleBounds;
        const xs = new Set([preferred.x]);
        const ys = new Set([preferred.y]);
        obstacles.forEach(obstacle => {
            xs.add(right(obstacle)-local.x); xs.add(obstacle.x-right(local));
            ys.add(bottom(obstacle)-local.y); ys.add(obstacle.y-bottom(local));
        });
        if (viewport) {
            xs.add(viewport.x); xs.add(right(viewport)-visible.width);
            ys.add(viewport.y); ys.add(bottom(viewport)-visible.height);
        }
        if (previousBatch) { xs.add(previousBatch.x); ys.add(previousBatch.y); }
        if (preferred.sourceRect) ys.add(preferred.sourceRect.y+(preferred.sourceRect.height-visible.height)/2);
        const distance = candidate=>Math.hypot(candidate.x-preferred.x,candidate.y-preferred.y);
        const legal = candidate=>Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
            && (!preferred.sourceRect || (preferred.upstream
                ? candidate.x+visible.width<=preferred.sourceRect.x-GAP
                : candidate.x>=right(preferred.sourceRect)+GAP))
            && !obstacles.some(obstacle=>overlaps(translated(local,candidate.x,candidate.y),obstacle));
        const candidates = [];
        xs.forEach(x=>ys.forEach(y=>{if(legal({x,y})) candidates.push({x,y});}));
        // The finite scene's obstacle boundaries include its outermost free positions.
        // Search grows with actual geometry, never with a fixed attempt/overlap fallback.
        if (!candidates.length) return null;
        let nearest = Infinity;
        candidates.forEach(candidate=>{nearest=Math.min(nearest,distance(candidate));});
        const useViewport = viewport && preferred.sourceRect;
        const budget = nearest+(useViewport ? GAP : 0);
        if (useViewport) {
            // Include partially visible positions at the distance limit when a
            // viewport edge itself would require more than the permitted G.
            const onCircle = (delta,axis)=>{
                if (Math.abs(delta)>budget) return;
                const reach = Math.sqrt(Math.max(0,budget*budget-delta*delta));
                [-reach,reach].forEach(offset=>{
                    const candidate=axis==='x' ? {x:preferred.x+delta,y:preferred.y+offset}
                        : {x:preferred.x+offset,y:preferred.y+delta};
                    if(legal(candidate)) candidates.push(candidate);
                });
            };
            xs.forEach(x=>onCircle(x-preferred.x,'x'));
            ys.forEach(y=>onCircle(y-preferred.y,'y'));
        }
        const visibility = candidate=>{
            if(!useViewport) return 0;
            const box=translated(visible,candidate.x,candidate.y);
            return Math.max(0,Math.min(right(box),right(viewport))-Math.max(box.x,viewport.x))
                *Math.max(0,Math.min(bottom(box),bottom(viewport))-Math.max(box.y,viewport.y))
                /Math.max(1,box.width*box.height);
        };
        const aligned = candidate=>!previousBatch ? 0 : Number(previousBatch.horizontal
            ? candidate.x!==previousBatch.x : candidate.y!==previousBatch.y);
        return candidates.filter(candidate=>distance(candidate)<=budget+1e-9).sort((a,b)=>
            visibility(b)-visibility(a) || distance(a)-distance(b) || aligned(a)-aligned(b)
            || Math.abs(a.y-preferred.y)-Math.abs(b.y-preferred.y) || a.x-b.x || a.y-b.y)[0];
    }

    function plan(request={}) {
        const anchor=request.intent?.anchor;
        if(['point','viewport'].includes(anchor?.kind)
            && (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))){
            return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'invalid-anchor-position'}]});
        }
        let snapshotNodes = (request.snapshot?.nodes || []).filter(Boolean);
        const drafts = (request.drafts || []).filter(Boolean);
        if(!drafts.length) return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'missing-drafts'}]});
        const intent = JSON.parse(JSON.stringify(request.intent || {}));
        const owners = new Map();
        snapshotNodes.filter(node=>node.type==='smart-group').forEach(group=>
            (group.items || []).forEach(id=>owners.set(String(id),String(group.id))));
        if(intent.anchor?.kind==='source') {
            const resolve = id=>{
                const seen=new Set();
                while(owners.has(String(id)) && !seen.has(String(id))) {
                    seen.add(String(id)); id=owners.get(String(id));
                }
                return String(id);
            };
            intent.anchor.sourceNodeIds=[...new Set((intent.anchor.sourceNodeIds
                || [intent.anchor.sourceNodeId]).filter(Boolean).map(resolve))];
        }
        snapshotNodes=snapshotNodes.filter(node=>!owners.has(String(node.id)));
        const arrangement=['single','horizontal-batch','vertical-batch','rigid'].includes(intent.arrangement)
            ? intent.arrangement : drafts.length>1 ? 'rigid' : 'single';
        const {measuredSnapshot,measuredDrafts}=measureNodes(snapshotNodes,drafts);
        const diagnostics=diagnosticsFor(measuredSnapshot,measuredDrafts);
        if(diagnostics.length) return Object.freeze({ok:false,placements:[],bounds:null,diagnostics});
        const draftOwned=new Set(drafts.filter(node=>node.type==='smart-group').flatMap(node=>node.items || []));
        const outerDrafts=measuredDrafts.filter(item=>!draftOwned.has(item.node.id));
        if(!outerDrafts.length) return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'invalid-group-owner'}]});
        const value=collection(outerDrafts,arrangement);
        const preferred=preferredPosition(value,measuredSnapshot,intent);
        if(!preferred) return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'missing-source-node'}]});
        const frame=containingFrame(measuredSnapshot,intent);
        const obstacles=measuredSnapshot.filter(item=>item.measurement.placementObstacle)
            .map(item=>rect(item.measurement.interactionFootprint));
        const viewport=intent.viewport && Number(intent.viewport.width)>0 && Number(intent.viewport.height)>0
            ? rect(intent.viewport) : null;
        const chosen=intent.anchor?.kind==='point' ? preferred
            : search(value,obstacles,preferred,viewport,previousGenerationBatch(measuredSnapshot,measuredDrafts,intent));
        if(!chosen) return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'invalid-node-dimensions'}]});
        // Do not round away the clearance or the user's exact attachment point.
        const placements=value.members.map(member=>({id:member.id,x:chosen.x+member.x,y:chosen.y+member.y}));
        if(arrangement==='rigid' && draftOwned.size){
            const left=Math.min(...outerDrafts.map(item=>number(item.node.x)));
            const top=Math.min(...outerDrafts.map(item=>number(item.node.y)));
            drafts.filter(node=>draftOwned.has(node.id)).forEach(node=>placements.push({
                id:node.id,x:number(node.x)+chosen.x-left,y:number(node.y)+chosen.y-top
            }));
        }
        const bounds=translated(value.visibleBounds,chosen.x,chosen.y);
        const frameUpdates=frame ? [{id:String(frame.node.id),...geometry.expandFrame(rect(frame.measurement.footprint),[bounds])}] : [];
        return Object.freeze({ok:true,placements,bounds,frameUpdates,frameId:String(frame?.node.id || ''),diagnostics:[]});
    }

    return Object.freeze({plan});
});
