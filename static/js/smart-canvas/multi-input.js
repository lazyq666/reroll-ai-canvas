/* Pure planning for one ordered set of sources feeding one generation node. */
(function install(root, factory){
    const api = factory();
    if(typeof module === 'object' && module.exports) module.exports = api;
    root.SmartCanvasModules = root.SmartCanvasModules || {};
    root.SmartCanvasModules.multiInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function(){
    'use strict';
    const compareId = (a,b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    const fail = reason => ({ok:false,reason});
    const center = item => item.y + item.height / 2;
    const mean = (items,read) => items.reduce((sum,item) => sum + read(item),0) / items.length;

    function visualOrder(items){
        const ordered = items.slice().sort((a,b) => center(a)-center(b) || a.y-b.y || a.x-b.x || compareId(a.id,b.id));
        const bands = [];
        for(const item of ordered){
            let best = null;
            for(const band of bands){
                const candidates = [...band,item];
                const ys = candidates.map(node => node.y);
                const centers = candidates.map(center);
                const tolerance = Math.max(16,Math.min(...candidates.map(node => node.height))/2);
                if(Math.min(Math.max(...ys)-Math.min(...ys),Math.max(...centers)-Math.min(...centers)) > tolerance) continue;
                const score = Math.min(Math.abs(item.y-mean(band,node=>node.y)),Math.abs(center(item)-mean(band,center)));
                if(!best || score < best.score) best = {band,score};
            }
            if(best) best.band.push(item);
            else bands.push([item]);
        }
        const minimum = (band,key) => Math.min(...band.map(item=>item[key]));
        const firstId = band => band.map(item=>item.id).sort(compareId)[0];
        bands.sort((a,b) => mean(a,center)-mean(b,center) || minimum(a,'y')-minimum(b,'y') || minimum(a,'x')-minimum(b,'x') || compareId(firstId(a),firstId(b)));
        return bands.flatMap(band => band.sort((a,b)=>a.x-b.x || a.y-b.y || compareId(a.id,b.id))).map(item=>item.id);
    }

    function capture({nodes=[],ids=[],measure,mediaFor,textFor,running}={}){
        const byId = new Map(nodes.map(node=>[node.id,node]));
        const rawIds = [...new Set(ids)];
        if(!rawIds.length || rawIds.some(id=>!byId.has(id))) return fail('changed');
        const covered = new Set();
        const signatures = Object.create(null);
        const inspect = (id,trail=new Set()) => {
            const node = byId.get(id);
            if(!node) return 'changed';
            if(trail.has(id)) return 'unsupported';
            if(signatures[id]) return '';
            if(running(node)) return 'running';
            const type = node.type || 'smart-image';
            if(!['smart-group','smart-prompt','smart-image'].includes(type)) return 'unsupported';
            const members = type === 'smart-group' ? [...(node.items || [])] : [];
            for(const member of members){
                covered.add(member);
                const reason = inspect(member,new Set([...trail,id]));
                if(reason) return reason;
            }
            const media = type === 'smart-prompt' ? [] : mediaFor(node).filter(item=>item?.url);
            const text = type === 'smart-image' ? '' : String(textFor(node) || '').trim();
            if(!media.length && !text) return 'empty';
            signatures[id] = JSON.stringify({type,members,groupId:node.groupId || '',output:node.activeOutputId || '',media:media.map(item=>[item.outputId || '',item.media_id || item.mediaId || '',item.url])});
            return '';
        };
        for(const id of rawIds){
            const reason = inspect(id);
            if(reason) return fail(reason);
        }
        const roots = rawIds.filter(id=>!covered.has(id));
        const rectangles = roots.map(id=>({id,...measure(byId.get(id))}));
        if(rectangles.some(rect=>!['x','y','width','height'].every(key=>Number.isFinite(rect[key])) || rect.width<=0 || rect.height<=0)) return fail('changed');
        return {ok:true,ids:visualOrder(rectangles),rawIds,signatures};
    }

    function validate(snapshot,options){
        if(!snapshot?.ok) return snapshot || fail('changed');
        const current = capture({...options,ids:snapshot.rawIds});
        if(!current.ok) return current;
        const entries = Object.entries(snapshot.signatures);
        if(entries.length !== Object.keys(current.signatures).length || entries.some(([id,value])=>current.signatures[id]!==value)) return fail('changed');
        return {...snapshot};
    }

    function target({snapshot,nodes=[],connections=[],targetId,isGeneration,running}={}){
        const node = nodes.find(item=>item.id===targetId);
        if(!snapshot?.ok || !node) return fail('changed');
        const sourceIds = Object.keys(snapshot.signatures);
        if(!isGeneration(node) || sourceIds.includes(targetId)) return fail('target');
        if(running(node)) return fail('running');
        const outgoing = new Map();
        for(const connection of connections){
            const list = outgoing.get(connection.from) || [];
            list.push(connection.to);
            outgoing.set(connection.from,list);
        }
        const reached = new Set();
        const queue = [targetId];
        while(queue.length){
            const id = queue.pop();
            if(reached.has(id)) continue;
            reached.add(id);
            queue.push(...(outgoing.get(id) || []));
        }
        if(sourceIds.some(id=>reached.has(id))) return fail('cycle');
        const existing = new Set(connections.filter(connection=>connection.to===targetId && connection.kind==='input').map(connection=>connection.from));
        return {ok:true,ids:snapshot.ids.filter(id=>!existing.has(id))};
    }
    return Object.freeze({capture,validate,target});
});
