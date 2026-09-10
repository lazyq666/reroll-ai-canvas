import { validOwnershipBoundaries, rowBoundaryY, ownershipRowBand} from '/static/js/smart-canvas/sprite-ownership.js?v=2';

const COLORS = ['#ffb64f','#60d9f5','#c09bff','#7be0ae'];
const copy = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class SpriteAuthoring {
    constructor(grid, image, canvas, draw, recognize, status) {
        this.grid = grid; this.image = image; this.canvas = canvas;
        this.draw = draw; this.recognize = recognize; this.status = status;
        this.root = grid.dialog.bodyElement;
        this.events = new AbortController();
        this.bind();
    }
    dispose() { this.events.abort(); this.drag = null; this.grid.editing = false; }
    t(key, values = {}) {
        let text = this.grid.t(key);
        for (const [key,value] of Object.entries(values)) text = text.replace(`{${key}}`, value);
        return text;
    }
    handles() {
        const g = this.grid, w = this.image.naturalWidth, h = this.image.naturalHeight;
        if (!g.boundaries || !w) return [];
        if (g.editMode === 'anchors') return (g.anchors || []).map((a, index) => ({
            id:`a:${index}`, x:a.x, y:a.y, label:this.t('frameNumber',{n:index+1}), index,
        }));
        const handles = [];
        if (g.boundaries.rowLines) {
            g.boundaries.rowLines.forEach((points, index) => points.forEach((p, point) => handles.push({
                id:`h:${index+1}:${point}`, x:p.y*w, y:p.x*h, row:index+1, point,
                label:this.t('rowBoundaryPoint',{row:index+1,point:point+1}),
            })));
        } else g.boundaries.rowCuts.slice(1,-1).forEach((y,index)=>handles.push({
            id:`h:${index+1}`, x:w/2, y:y*h, row:index+1, label:this.t('rowBoundary',{n:index+1}),
        }));
        g.boundaries.columns.forEach((lines,row)=>lines.forEach((points,col)=>points.forEach((p,point)=>{
            const [top, bottom] = ownershipRowBand(g.boundaries, row);
            const y = point === 0 ? rowBoundaryY(g.boundaries,row,p.x)
                : point === points.length-1 ? rowBoundaryY(g.boundaries,row+1,p.x) : top+p.y*(bottom-top);
            if (y < rowBoundaryY(g.boundaries,row,p.x) || y > rowBoundaryY(g.boundaries,row+1,p.x)) return;
            handles.push({id:`v:${row}:${col}:${point}`,row,col,point,x:p.x*w,y:y*h,
                label:this.t('boundaryPoint',{row:row+1,col:col+1,point:point+1})});
        })));
        return handles;
    }
    selected() { return this.handles().find(h=>h.id===this.grid.selectedHandle) || null; }
    sync() {
        const selected = this.selected();
        if (selected) this.grid.selectedHandle = selected.id;
        this.canvas.setAttribute('aria-label',`${this.t('preview')}${selected ? ' · '+selected.label : ''}`);
    }
    apply(handle, x, y) {
        if (!handle || this.grid.dialog.pending) return false;
        const w=this.image.naturalWidth, h=this.image.naturalHeight;
        x=clamp(Math.round(x),0,w-1); y=clamp(Math.round(y),0,h-1);
        if (handle.id.startsWith('a:')) {
            this.grid.anchors[handle.index]={x,y};
        } else {
            const next = copy(this.grid.boundaries);
            if (handle.id.startsWith('h:')) {
                if (next.rowLines) {
                    const line = next.rowLines[handle.row-1], point = line[handle.point];
                    point.x = clamp(y/h,1/h,1-1/h);
                    if (handle.point > 0 && handle.point < line.length-1) {
                        point.y = clamp(x/w,line[handle.point-1].y+1e-8,line[handle.point+1].y-1e-8);
                    }
                } else next.rowCuts[handle.row] = clamp(y/h,next.rowCuts[handle.row-1]+1/h,next.rowCuts[handle.row+1]-1/h);
            } else {
                const line=next.columns[handle.row][handle.col], point=line[handle.point];
                point.x=clamp(x/w,1/w,1-1/w);
                if (handle.point>0 && handle.point<line.length-1) {
                    const [top, bottom] = ownershipRowBand(next, handle.row);
                    point.y=clamp((y/h-top)/(bottom-top),line[handle.point-1].y+1e-8,line[handle.point+1].y-1e-8);
                }
            }
            if (!validOwnershipBoundaries(next,this.grid.rows,this.grid.cols)) return false;
            this.grid.boundaries=next;
        }
        this.sync(); this.draw(); return true;
    }
    bind() {
        const g=this.grid, root=this.root;
        const mode=root.querySelector('[data-gif-edit-mode]');
        mode.addEventListener('ic-change',event=>{
            if (g.dialog.pending) return;
            g.editMode=event.detail.value;g.selectedHandle='';this.sync();this.draw();
        });
        root.querySelector('[data-gif-reset-authoring]').addEventListener('click',()=>{
            if (g.dialog.pending) return;
            g.boundaries=null;g.anchors=null;g.selectedHandle='';this.recognize();
        });
        const position=event=>{
            const rect=this.canvas.getBoundingClientRect();
            return {x:(event.clientX-rect.left)*this.image.naturalWidth/rect.width,
                y:(event.clientY-rect.top)*this.image.naturalHeight/rect.height};
        };
        this.canvas.addEventListener('pointerdown',event=>{
            if (g.dialog.pending || event.button!==0) return;
            const rect=this.canvas.getBoundingClientRect(), p=position(event);
            const handles=this.handles().map(handle=>({...handle,distance:Math.hypot((handle.x-p.x)*rect.width/this.image.naturalWidth,(handle.y-p.y)*rect.height/this.image.naturalHeight)}));
            const target=handles.sort((a,b)=>a.distance-b.distance)[0];
            if (!target || target.distance>16) return;
            event.preventDefault();event.stopPropagation();this.canvas.focus();
            this.drag=target;g.selectedHandle=target.id;g.editing=true;
            this.canvas.setPointerCapture(event.pointerId);this.sync();this.draw();this.status();
        });
        this.canvas.addEventListener('pointermove',event=>{
            if (!this.drag) return;
            event.preventDefault();const p=position(event);this.apply(this.drag,p.x,p.y);
        });
        const end=()=>{if(!this.drag)return;this.drag=null;g.editing=false;this.recognize();};
        this.canvas.addEventListener('pointerup',end);
        this.canvas.addEventListener('pointercancel',end);
        this.canvas.addEventListener('lostpointercapture',end);

    }
    paint(ctx, scale) {
        const g=this.grid, boundaries=g.boundaries;
        if (!boundaries) return;
        const w=this.image.naturalWidth*scale, h=this.image.naturalHeight*scale;
        const unit=this.canvas.width/Math.max(1,this.canvas.getBoundingClientRect().width);
        ctx.lineWidth=unit;
        const rowPath = row => row === 0 ? [{x:0,y:0},{x:1,y:0}]
            : row === g.rows ? [{x:0,y:1},{x:1,y:1}]
            : boundaries.rowLines ? boundaries.rowLines[row-1].map(p=>({x:p.y,y:p.x}))
            : [{x:0,y:boundaries.rowCuts[row]},{x:1,y:boundaries.rowCuts[row]}];
        for (let row=1;row<g.rows;row++) {
            ctx.strokeStyle='#a9b6c6';ctx.beginPath();
            rowPath(row).forEach((p,i)=>{if(i)ctx.lineTo(p.x*w,p.y*h);else ctx.moveTo(p.x*w,p.y*h);});ctx.stroke();
        }
        boundaries.columns.forEach((lines,row)=>{
            const [top,bottom]=ownershipRowBand(boundaries,row);
            ctx.save();ctx.beginPath();
            [...rowPath(row),...rowPath(row+1).reverse()].forEach((p,i)=>{if(i)ctx.lineTo(p.x*w,p.y*h);else ctx.moveTo(p.x*w,p.y*h);});
            ctx.closePath();ctx.clip();
            lines.forEach((points,col)=>{
                ctx.strokeStyle=COLORS[col%COLORS.length];ctx.beginPath();
                points.forEach((p,i)=>{const x=p.x*w,y=(top+p.y*(bottom-top))*h;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
            });
            ctx.restore();
            for(let col=0;col<g.cols;col++) {
                const x=col/g.cols*w+4, y=rowBoundaryY(boundaries,row,col/g.cols)*h+4;
                const size=Math.max(16*unit,w/55);
                ctx.fillStyle=COLORS[col%COLORS.length];ctx.fillRect(x,y,size*1.6,size);
                ctx.fillStyle='#152232';ctx.font=`bold ${size*.65}px sans-serif`;
                ctx.fillText(String(row*g.cols+col+1).padStart(2,'0'),x+3*unit,y+size*.75);
            }
        });
        for(const fragment of g.analysis?.fragments || []) {
            if(fragment.area<4) continue;
            ctx.strokeStyle=COLORS[(fragment.index%g.cols)%COLORS.length];
            ctx.strokeRect(fragment.x*scale,fragment.y*scale,Math.max(2*unit,fragment.w*scale),Math.max(2*unit,fragment.h*scale));
        }
        for(const handle of this.handles()) {
            const x=handle.x*scale,y=handle.y*scale,selected=handle.id===g.selectedHandle;
            ctx.strokeStyle='#172333';ctx.fillStyle=selected?'#ffffff':'#64d9f5';ctx.lineWidth=unit;
            if(g.editMode==='anchors') {
                ctx.strokeStyle=COLORS[handle.index%COLORS.length];ctx.lineWidth=2*unit;
                ctx.beginPath();ctx.moveTo(x-14*unit,y);ctx.lineTo(x+14*unit,y);ctx.moveTo(x,y-28*unit);ctx.lineTo(x,y+5*unit);ctx.stroke();
            }
            ctx.beginPath();ctx.arc(x,y,(selected?6:4)*unit,0,Math.PI*2);ctx.fill();ctx.stroke();
        }
    }
}
