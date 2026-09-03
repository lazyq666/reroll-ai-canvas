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

    const BATCH_GAP = 48;
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
        let primaryAxisCursor = 0;
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
                y = primaryAxisCursor;
                primaryAxisCursor += footprint.height + BATCH_GAP;
            } else if (arrangement === 'horizontal-batch') {
                x = primaryAxisCursor;
                primaryAxisCursor += footprint.width + BATCH_GAP;
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
            return {id:String(node.id),index,x,y,visibleRect,interactionRect};
        });
        const visibleBounds = boundsOf(visible);
        const interactionBounds = boundsOf(interaction);
        return {members,visibleBounds,interactionBounds};
    }

    function containingFrame(measuredSnapshot, intent) {
        const requestedId = String(intent?.frameId || '');
        const sourceId = String(intent?.anchor?.sourceNodeId || '');
        const sourceIds = intent?.anchor?.sourceNodeIds || [sourceId];
        const frames = measuredSnapshot.filter(({measurement}) => measurement.spatialContainer);
        return frames.find(({node}) => String(node.id) === requestedId)
            || frames.find(({node}) => Array.isArray(node.items) && sourceIds.length && sourceIds.every(id => node.items.includes(id)))
            || null;
    }

    function previousGenerationBatch(measuredSnapshot, measuredDrafts, intent) {
        const arrangement = String(intent?.arrangement || '');
        if (!['horizontal-batch','vertical-batch'].includes(arrangement)) return null;
        const draft = measuredDrafts[0]?.node || {};
        const sourceNodeId = String(
            draft.generationBatchSourceNodeId
            || intent?.anchor?.sourceNodeId
            || ''
        );
        const layout = arrangement === 'vertical-batch' ? 'vertical' : 'horizontal';
        if (!sourceNodeId) return null;
        const batches = new Map();
        measuredSnapshot.forEach(item => {
            const node = item.node || {};
            const batchId = String(node.generationBatchId || '');
            if (
                !batchId
                || String(node.generationBatchSourceNodeId || '') !== sourceNodeId
                || String(node.generationBatchLayout || 'vertical') !== layout
            ) return;
            if (!batches.has(batchId)) batches.set(batchId,[]);
            batches.get(batchId).push(item);
        });
        const ordered = [...batches.entries()].sort((left,rightValue) => {
            const created = values => Math.max(...values.map(({node}) => number(node.created_at)));
            return created(rightValue[1]) - created(left[1])
                || String(rightValue[0]).localeCompare(String(left[0]));
        });
        if (!ordered.length) return null;
        const previousBounds = boundsOf(ordered[0][1].map(({measurement}) =>
            rect(measurement.footprint)
        ));
        return layout === 'horizontal'
            ? {
                x:previousBounds.x,
                y:bottom(previousBounds) + BATCH_GAP,
                batchDirection:'horizontal'
            }
            : {
                x:right(previousBounds) + BATCH_GAP,
                y:previousBounds.y,
                batchDirection:'vertical'
            };
    }

    function preferredPosition(collectionValue, measuredSnapshot, measuredDrafts, intent) {
        const previousBatch = previousGenerationBatch(measuredSnapshot, measuredDrafts, intent);
        if (previousBatch) return previousBatch;
        const anchor = intent?.anchor || {};
        const kind = String(anchor.kind || 'viewport');
        if (kind === 'source') {
            const sourceIds = anchor.sourceNodeIds || [String(anchor.sourceNodeId || '')];
            const sources = sourceIds.map(id => measuredSnapshot.find(({node}) => String(node?.id || '') === String(id)));
            if (!sources.length || sources.some(source => !source?.measurement?.supported)) return null;
            const rectangles = sources.map(source => rect(source.measurement.footprint));
            const left = Math.min(...rectangles.map(value => value.x));
            const top = Math.min(...rectangles.map(value => value.y));
            const sourceRect = {x:left,y:top,width:Math.max(...rectangles.map(right))-left,height:Math.max(...rectangles.map(bottom))-top};
            const relation = intent?.relation === 'upstream' ? 'upstream' : 'downstream';
            return {
                x:relation === 'upstream'
                    ? sourceRect.x - 200 - collectionValue.visibleBounds.width
                    : right(sourceRect) + 200,
                y:sourceRect.y,
                sourceRect,
                relation
            };
        }
        const x = number(anchor.x);
        const y = number(anchor.y);
        return {
            x:x - collectionValue.visibleBounds.width / 2,
            y:y - collectionValue.visibleBounds.height / 2,
            point:{x,y}
        };
    }

    function candidateKey(candidate) {
        return `${candidate.x}:${candidate.y}`;
    }

    function initialCandidates(preferred, collectionValue, obstacles, frameValue) {
        const xValues = new Set([preferred.x]);
        const yValues = new Set([preferred.y]);
        const local = collectionValue.interactionBounds;
        obstacles.forEach(obstacle => {
            xValues.add(right(obstacle) - local.x);
            xValues.add(obstacle.x - right(local));
            yValues.add(bottom(obstacle) - local.y);
            yValues.add(obstacle.y - bottom(local));
        });
        if (frameValue) {
            const frameRect = rect(frameValue.measurement.footprint);
            xValues.add(frameRect.x - collectionValue.visibleBounds.x);
            xValues.add(right(frameRect) - right(collectionValue.visibleBounds));
            yValues.add(frameRect.y - collectionValue.visibleBounds.y);
            yValues.add(bottom(frameRect) - bottom(collectionValue.visibleBounds));
        }
        const candidates = [];
        xValues.forEach(x => yValues.forEach(y => candidates.push({x,y})));
        return candidates;
    }

    function score(candidate, preferred) {
        const dx = candidate.x - preferred.x;
        const dy = candidate.y - preferred.y;
        return [
            dx * dx + dy * dy,
            Math.abs(dy),
            Math.abs(dx),
            candidate.x,
            candidate.y < preferred.y ? 1 : 0,
            candidate.y
        ];
    }

    function compareCandidates(left, rightValue, preferred) {
        const leftScore = score(left, preferred);
        const rightScore = score(rightValue, preferred);
        for (let index = 0; index < leftScore.length; index += 1) {
            if (leftScore[index] !== rightScore[index]) return leftScore[index] - rightScore[index];
        }
        return 0;
    }

    function directionCompatible(candidate, collectionValue, preferred) {
        if (preferred.batchDirection === 'horizontal') {
            return candidate.x === preferred.x && candidate.y >= preferred.y;
        }
        if (preferred.batchDirection === 'vertical') {
            return candidate.y === preferred.y && candidate.x >= preferred.x;
        }
        if (!preferred.sourceRect) return true;
        if (preferred.relation === 'upstream') {
            return candidate.x + collectionValue.visibleBounds.width
                <= preferred.sourceRect.x - 200;
        }
        return candidate.x >= right(preferred.sourceRect) + 200;
    }

    function frameCompatible(candidate, collectionValue, frames, preferredFrame, preferInside) {
        const visible = translated(collectionValue.visibleBounds, candidate.x, candidate.y);
        if (preferredFrame) {
            const frameRect = rect(preferredFrame.measurement.footprint);
            if (preferInside && !contains(frameRect, visible)) return false;
            if (!preferInside && overlaps(frameRect, visible)) return false;
        }
        return frames.every(frameValue => {
            const frameRect = rect(frameValue.measurement.footprint);
            if (preferredFrame?.node?.id === frameValue.node?.id) return true;
            return !overlaps(frameRect, visible) || contains(frameRect, visible);
        });
    }

    function legal(candidate, collectionValue, obstacles, frames, preferred, preferredFrame, preferInside) {
        if (!directionCompatible(candidate, collectionValue, preferred)) return false;
        if (!frameCompatible(candidate, collectionValue, frames, preferredFrame, preferInside)) return false;
        const interaction = translated(collectionValue.interactionBounds, candidate.x, candidate.y);
        return !obstacles.some(obstacle => overlaps(interaction, obstacle));
    }

    function search(collectionValue, obstacles, frames, preferred, preferredFrame, preferInside) {
        const seen = new Set();
        const candidates = initialCandidates(preferred, collectionValue, obstacles, preferredFrame);
        const inspect = values => {
            const ordered = values
                .filter(candidate => Number.isFinite(candidate.x) && Number.isFinite(candidate.y))
                .filter(candidate => {
                    const key = candidateKey(candidate);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort((left, rightValue) => compareCandidates(left, rightValue, preferred));
            return ordered.find(candidate => legal(
                candidate, collectionValue, obstacles, frames,
                preferred, preferredFrame, preferInside
            )) || null;
        };
        const initial = inspect(candidates);
        if (initial) return initial;
        if (preferInside) return null;

        const stepX = Math.max(1, collectionValue.interactionBounds.width);
        const stepY = Math.max(1, collectionValue.interactionBounds.height);
        for (let ring = 1; ; ring += 1) {
            const ringCandidates = [];
            for (let offset = -ring; offset <= ring; offset += 1) {
                ringCandidates.push(
                    {x:preferred.x + offset * stepX,y:preferred.y - ring * stepY},
                    {x:preferred.x + offset * stepX,y:preferred.y + ring * stepY},
                    {x:preferred.x - ring * stepX,y:preferred.y + offset * stepY},
                    {x:preferred.x + ring * stepX,y:preferred.y + offset * stepY}
                );
            }
            const found = inspect(ringCandidates);
            if (found) return found;
        }
    }

    function plan(request = {}) {
        const snapshotNodes = Array.isArray(request?.snapshot?.nodes)
            ? request.snapshot.nodes.filter(Boolean)
            : [];
        const drafts = Array.isArray(request?.drafts) ? request.drafts.filter(Boolean) : [];
        if (!drafts.length) {
            return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{code:'missing-drafts',nodeId:'',path:'drafts'}]});
        }
        const arrangement = ['single','horizontal-batch','vertical-batch','rigid'].includes(request?.intent?.arrangement)
            ? request.intent.arrangement
            : (drafts.length > 1 ? 'rigid' : 'single');
        const {measuredSnapshot, measuredDrafts} = measureNodes(snapshotNodes, drafts);
        const diagnostics = diagnosticsFor(measuredSnapshot, measuredDrafts);
        if (diagnostics.length) {
            return Object.freeze({ok:false,placements:[],bounds:null,diagnostics});
        }
        const collectionValue = collection(measuredDrafts, arrangement);
        const preferred = preferredPosition(
            collectionValue,
            measuredSnapshot,
            measuredDrafts,
            request.intent || {}
        );
        if (!preferred) {
            return Object.freeze({ok:false,placements:[],bounds:null,diagnostics:[{
                code:'missing-source-node',
                nodeId:String(request?.intent?.anchor?.sourceNodeId || ''),
                path:'intent.anchor.sourceNodeId'
            }]});
        }
        const obstacles = measuredSnapshot
            .filter(({measurement}) => measurement.supported && measurement.placementObstacle)
            .map(({measurement}) => rect(measurement.interactionFootprint));
        const frames = measuredSnapshot.filter(({measurement}) => measurement.spatialContainer);
        const preferredFrame = containingFrame(measuredSnapshot, request.intent || {});
        const inside = preferredFrame
            ? search(collectionValue, obstacles, frames, preferred, preferredFrame, true)
            : null;
        const chosen = inside || search(
            collectionValue, obstacles, frames, preferred,
            preferredFrame, false
        );
        const placements = collectionValue.members.map(member => ({
            id:member.id,
            x:Math.round((chosen.x + member.x) * 1000) / 1000,
            y:Math.round((chosen.y + member.y) * 1000) / 1000
        }));
        const bounds = translated(collectionValue.visibleBounds, chosen.x, chosen.y);
        return Object.freeze({
            ok:true,
            placements,
            bounds:{
                x:Math.round(bounds.x * 1000) / 1000,
                y:Math.round(bounds.y * 1000) / 1000,
                width:Math.round(bounds.width * 1000) / 1000,
                height:Math.round(bounds.height * 1000) / 1000
            },
            diagnostics:[]
        });
    }

    return Object.freeze({plan});
});
