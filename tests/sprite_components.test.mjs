import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSpriteFrames, spriteFramePixels} from '../static/js/smart-canvas/sprite-components.js';
import {createOwnershipBoundaries, ownershipFrame, validOwnershipBoundaries} from '../static/js/smart-canvas/sprite-ownership.js';

function sheet() {
    const source={width:80,height:60,data:new Uint8ClampedArray(80*60*4)};
    const colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]];
    for(let i=0;i<4;i++) rect(source,10+i%2*40,18+Math.floor(i/2)*30,12,10,colors[i]);
    return source;
}
function rect(source,x,y,w,h,color) {
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++) source.data.set(color,(yy*source.width+xx)*4);
}
const alphaCount=data=>{let count=0;for(let p=3;p<data.length;p+=4)if(data[p])count++;return count;};

test('connected weapons survive grid crossings and overlapping sprite bounds never copy neighboring pixels',()=>{
    const source=sheet();
    rect(source,20,14,2,5,[255,0,0,255]);rect(source,20,14,26,2,[255,0,0,255]);
    rect(source,35,26,17,2,[0,255,0,255]);
    const plan=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(plan.frames.length,4);
    assert.ok(plan.frames[0].right>40);
    const frames=plan.frames.map(frame=>spriteFramePixels(source,plan,frame));
    assert.equal(frames.reduce((n,data)=>n+alphaCount(data),0),alphaCount(source.data));
    for(let p=0;p<frames[0].length;p+=4)if(frames[0][p+3])assert.deepEqual([...frames[0].slice(p,p+4)],[255,0,0,255]);
});

test('bent ownership boundaries override proximity and keep each detached fragment intact',()=>{
    const source=sheet();rect(source,43,5,2,2,[0,255,255,255]);
    const straight=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(straight.fragments[0].index,1);
    const boundaries=createOwnershipBoundaries(2,2);
    boundaries.columns[0][0]=[{x:.6,y:0},{x:.6,y:.5},{x:.5,y:1}];
    const bent=extractSpriteFrames(source,{rows:2,cols:2,boundaries});
    assert.equal(bent.fragments[0].index,0);
    assert.equal(alphaCount(spriteFramePixels(source,bent,bent.frames[0])),124);
    assert.equal(ownershipFrame(boundaries,43/80,5/60),0);
});

test('large detached effects remain effects; lower-body anchors do not follow effect growth',()=>{
    const source=sheet();
    const before=extractSpriteFrames(source,{rows:2,cols:2});
    rect(source,24,1,14,9,[0,255,255,255]); // Larger than a single body.
    rect(source,20,11,2,8,[255,0,0,255]);rect(source,20,11,26,2,[255,0,0,255]);
    const after=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(after.frames.length,4);
    assert.equal(after.fragments.length,1);
    assert.deepEqual(after.anchors,before.anchors);
    assert.equal(new Set(after.frames.map(f=>f.anchorX+f.offsetX)).size,1);
    assert.equal(new Set(after.frames.map(f=>f.anchorY+f.offsetY)).size,1);
});

test('manual body and foot anchors preserve every effect offset without scaling',()=>{
    const source=sheet();rect(source,43,5,2,2,[0,255,255,255]);
    const plan0=extractSpriteFrames(source,{rows:2,cols:2});
    const anchors=plan0.anchors.map(a=>({...a}));anchors[1]={x:54,y:26};
    const plan=extractSpriteFrames(source,{rows:2,cols:2,anchors});
    const frame=plan.frames[1], pixels=spriteFramePixels(source,plan,frame);
    const particle=((5+frame.offsetY)*plan.width+43+frame.offsetX)*4;
    assert.deepEqual([...pixels.slice(particle,particle+4)],[0,255,255,255]);
    assert.equal((43+frame.offsetX)-(frame.anchorX+frame.offsetX),43-54);
    assert.equal((5+frame.offsetY)-(frame.anchorY+frame.offsetY),5-26);
});

test('near-invisible bridges cannot merge two characters; faint outlines are preserved',()=>{
    const source=sheet();rect(source,22,20,28,1,[255,0,0,3]);
    const plan=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(plan.frames.length,4);
    assert.equal(plan.frames.reduce((n,frame)=>n+alphaCount(spriteFramePixels(source,plan,frame)),0),alphaCount(source.data));
});

test('touching opaque bodies fail rather than silently cropping them',()=>{
    const source=sheet();rect(source,22,20,28,1,[255,0,0,255]);
    assert.throws(()=>extractSpriteFrames(source,{rows:2,cols:2}),/countMismatch/);
});

test('opaque screenshots and empty sources fail explicitly',()=>{
    const source=sheet();rect(source,0,0,80,60,[0,0,0,255]);
    assert.throws(()=>extractSpriteFrames(source,{rows:2,cols:2}),/noTransparency/);
    source.data.fill(0);assert.throws(()=>extractSpriteFrames(source,{rows:2,cols:2}),/emptySource/);
});

test('crossing, unsorted, or out-of-bounds ownership lines are rejected',()=>{
    const boundaries=createOwnershipBoundaries(2,3);
    assert.equal(validOwnershipBoundaries(boundaries,2,3),true);
    boundaries.columns[0][0][2].x=.9;
    assert.equal(validOwnershipBoundaries(boundaries,2,3),false);
    assert.throws(()=>extractSpriteFrames(sheet(),{rows:2,cols:3,boundaries}),/invalidBoundaries/);
    assert.equal(validOwnershipBoundaries({rowCuts:[0,1,.5],columns:[[],[]]},2,1),false);
});

test('automatic seams route around crossing weapons and the nearby detached trail',()=>{
    const source=sheet();
    rect(source,20,14,2,5,[255,0,0,255]);rect(source,20,14,26,2,[255,0,0,255]);
    rect(source,46,10,2,2,[0,255,255,255]);
    const plan=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(plan.boundaryConflicts,0);
    assert.equal(plan.fragments[0].index,0,'The seam should keep the detached continuation with the crossing weapon');
    assert.ok(plan.boundaries.columns[0][0].some(p=>p.x>.5));
    assert.equal(plan.frames.reduce((n,f)=>n+alphaCount(spriteFramePixels(source,plan,f)),0),alphaCount(source.data));
});

test('horizontal boundaries bend around a sword reaching into the previous row',()=>{
    const source=sheet();
    rect(source,20,48,12,2,[0,0,255,255]);rect(source,30,25,2,25,[0,0,255,255]);
    const plan=extractSpriteFrames(source,{rows:2,cols:2});
    assert.equal(plan.boundaryConflicts,0);
    assert.ok(plan.boundaries.rowLines[0].some(p=>p.x<.5));
    assert.ok(new Set(plan.boundaries.rowLines[0].map(p=>p.x)).size>1);
    assert.equal(validOwnershipBoundaries(plan.boundaries,2,2),true);
});

test('manual boundaries remain authoritative; removing them reproduces automatic placement',()=>{
    const source=sheet();rect(source,20,14,2,5,[255,0,0,255]);rect(source,20,14,26,2,[255,0,0,255]);
    const auto=extractSpriteFrames(source,{rows:2,cols:2});
    const manual=createOwnershipBoundaries(2,2);
    const edited=extractSpriteFrames(source,{rows:2,cols:2,boundaries:manual});
    assert.deepEqual(edited.boundaries,manual);
    assert.ok(edited.boundaryConflicts>0);
    assert.deepEqual(extractSpriteFrames(source,{rows:2,cols:2}).boundaries,auto.boundaries);
});

test('unresolved automatic seams are reported while full characters remain intact',()=>{
    const source=sheet();rect(source,20,14,2,5,[255,0,0,255]);rect(source,20,14,49,2,[255,0,0,255]);
    const plan=extractSpriteFrames(source,{rows:2,cols:2});
    assert.ok(plan.boundaryConflicts>0);
    assert.equal(plan.frames[0].right,69);
    assert.equal(plan.frames.reduce((n,f)=>n+alphaCount(spriteFramePixels(source,plan,f)),0),alphaCount(source.data));
});

test('automatic single-column boundaries remain valid and crossed row lines are rejected',()=>{
    const source={width:30,height:60,data:new Uint8ClampedArray(30*60*4)};
    rect(source,10,18,12,10,[255,0,0,255]);rect(source,10,48,12,10,[0,255,0,255]);
    const plan=extractSpriteFrames(source,{rows:2,cols:1});
    assert.equal(plan.boundaryConflicts,0);
    assert.equal(validOwnershipBoundaries(plan.boundaries,2,1),true);
    const crossed=createOwnershipBoundaries(3,2);
    crossed.rowLines=[[{x:.3,y:0},{x:.8,y:1}],[{x:.6,y:0},{x:.6,y:1}]];
    assert.equal(validOwnershipBoundaries(crossed,3,2),false);
});
