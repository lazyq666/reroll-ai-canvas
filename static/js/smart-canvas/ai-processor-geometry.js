/* Smart Canvas AI Processor Geometry Module */
const AI_PROCESSOR_FALLBACK_RATIOS = Object.freeze(['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9']);

function processorRatioValue(value){
    const parts=String(value||'').split(':').map(Number);
    return parts.length===2&&parts[0]>0&&parts[1]>0?parts[0]/parts[1]:0;
}
function processorResolutionTier({inputWidth=1,inputHeight=1,resolutionTiers=[],requested='auto'}={}){
    const tiers=[...new Set((resolutionTiers||[]).map(value=>String(value||'').toLowerCase()).filter(value=>/^\d+k$/.test(value)))];
    const available=tiers.length?tiers:['1k','2k','4k'];
    const explicit=String(requested||'auto').toLowerCase();
    if(explicit!=='auto'&&available.includes(explicit)) return explicit;
    const longEdge=Math.max(1,Number(inputWidth)||1,Number(inputHeight)||1);
    const desired=longEdge>=3000?4:longEdge>=1800?2:1;
    return available.map(tier=>({tier,distance:Math.abs(Number.parseInt(tier,10)-desired)}))
        .sort((left,right)=>left.distance-right.distance||Number.parseInt(left.tier,10)-Number.parseInt(right.tier,10))[0]?.tier||'1k';
}
function processorClosestContainingCanvas({width=1,height=1,supportedRatios=[],maxLongEdge=4096}={}){
    const targetWidth=Math.max(1,Math.round(Number(width)||1));
    const targetHeight=Math.max(1,Math.round(Number(height)||1));
    const targetRatio=targetWidth/targetHeight;
    const ratios=[...new Set((supportedRatios||[]).filter(value=>processorRatioValue(value)>0))];
    const choices=(ratios.length?ratios:AI_PROCESSOR_FALLBACK_RATIOS).map(ratio=>{
        const value=processorRatioValue(ratio);
        const containerWidth=Math.max(targetWidth,Math.ceil(targetHeight*value));
        const containerHeight=Math.max(targetHeight,Math.ceil(targetWidth/value));
        return {ratio,value,containerWidth,containerHeight,error:Math.abs(Math.log(value/targetRatio))};
    }).sort((left,right)=>left.error-right.error||(left.containerWidth*left.containerHeight)-(right.containerWidth*right.containerHeight));
    const selected=choices[0];
    const scale=Math.min(1,Math.max(1,Number(maxLongEdge)||4096)/Math.max(selected.containerWidth,selected.containerHeight));
    const inputWidth=Math.max(1,Math.round(selected.containerWidth*scale));
    const inputHeight=Math.max(1,Math.round(selected.containerHeight*scale));
    const targetInputWidth=Math.max(1,Math.round(targetWidth*scale));
    const targetInputHeight=Math.max(1,Math.round(targetHeight*scale));
    return Object.freeze({
        targetWidth,targetHeight,targetRatio,ratio:selected.ratio,
        containerWidth:selected.containerWidth,containerHeight:selected.containerHeight,
        inputWidth,inputHeight,targetInputWidth,targetInputHeight,
        offsetX:Math.round((inputWidth-targetInputWidth)/2),
        offsetY:Math.round((inputHeight-targetInputHeight)/2),
        scale
    });
}
function processorLoadImage(url){
    return new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=()=>resolve(image);
        image.onerror=()=>reject(new Error(window.StudioI18n?.t?.('smart.imageLoadFailed') || 'Could not load image'));
        image.src=String(url||'');
    });
}
function processorCanvasBlob(canvas){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(window.StudioI18n?.t?.('smart.imageProcessingFailed') || 'Could not process image')),'image/png'));
}
async function processorPaddedBlob({sourceUrl='',sourceWidth=0,sourceHeight=0,left=0,right=0,top=0,bottom=0,fillColor='white'}={}){
    const image=await processorLoadImage(sourceUrl);
    const width=Math.max(1,Math.round(Number(sourceWidth)||image.naturalWidth||1));
    const height=Math.max(1,Math.round(Number(sourceHeight)||image.naturalHeight||1));
    const edges={left:Math.max(0,Math.round(left)),right:Math.max(0,Math.round(right)),top:Math.max(0,Math.round(top)),bottom:Math.max(0,Math.round(bottom))};
    const canvas=document.createElement('canvas');
    canvas.width=width+edges.left+edges.right;
    canvas.height=height+edges.top+edges.bottom;
    const context=canvas.getContext('2d');
    context.fillStyle=/^#[0-9a-f]{6}$/i.test(fillColor)?fillColor:'white';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,edges.left,edges.top,width,height);
    return {blob:await processorCanvasBlob(canvas),width:canvas.width,height:canvas.height,edges};
}
async function processorWorkingBlob({sourceUrl='',targetWidth=1,targetHeight=1,supportedRatios=[],maxLongEdge=4096,fillColor='white'}={}){
    const image=await processorLoadImage(sourceUrl);
    const plan=processorClosestContainingCanvas({width:targetWidth,height:targetHeight,supportedRatios,maxLongEdge});
    const canvas=document.createElement('canvas');
    canvas.width=plan.inputWidth; canvas.height=plan.inputHeight;
    const context=canvas.getContext('2d');
    context.fillStyle=/^#[0-9a-f]{6}$/i.test(fillColor)?fillColor:'white';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,plan.offsetX,plan.offsetY,plan.targetInputWidth,plan.targetInputHeight);
    return {blob:await processorCanvasBlob(canvas),plan};
}
async function processorCenterCropBlob({sourceUrl='',targetWidth=1,targetHeight=1}={}){
    const image=await processorLoadImage(sourceUrl);
    const outputWidth=Math.max(1,Math.round(Number(targetWidth)||1));
    const outputHeight=Math.max(1,Math.round(Number(targetHeight)||1));
    const sourceRatio=image.naturalWidth/image.naturalHeight;
    const targetRatio=outputWidth/outputHeight;
    let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;
    if(sourceRatio>targetRatio){ sw=Math.round(sh*targetRatio); sx=Math.round((image.naturalWidth-sw)/2); }
    else if(sourceRatio<targetRatio){ sh=Math.round(sw/targetRatio); sy=Math.round((image.naturalHeight-sh)/2); }
    const canvas=document.createElement('canvas');
    canvas.width=outputWidth; canvas.height=outputHeight;
    canvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,outputWidth,outputHeight);
    return processorCanvasBlob(canvas);
}
async function processorUploadBlob(blob,name='ai-processor.png'){
    const form=new FormData(); form.append('files',blob,name);
    const response=await fetch('/api/ai/upload',{method:'POST',body:form});
    if(!response.ok) throw new Error((await response.text()) || window.StudioI18n?.t?.('smart.imageUploadFailed') || 'Could not upload image');
    const data=await response.json();
    const file=data.files?.[0];
    if(!file?.url) throw new Error(window.StudioI18n?.t?.('smart.imageUploadFailed') || 'Could not upload image');
    return {...file,kind:file.kind||'image'};
}
async function processorPostprocessOutputs(outputs=[],target={}){
    const width=Math.max(1,Math.round(Number(target.width)||1));
    const height=Math.max(1,Math.round(Number(target.height)||1));
    const processed=[];
    for(let index=0;index<(outputs||[]).length;index++){
        const item=outputs[index];
        const url=typeof item==='string'?item:item?.url;
        if(!url) continue;
        const blob=await processorCenterCropBlob({sourceUrl:url,targetWidth:width,targetHeight:height});
        const file=await processorUploadBlob(blob,`ai-processor-${width}x${height}-${index+1}.png`);
        processed.push({...file,natural_w:width,natural_h:height,width,height});
    }
    return processed;
}

window.SmartCanvasModules=window.SmartCanvasModules||{};
window.SmartCanvasModules.aiProcessorGeometry=Object.freeze({
    closestContainingCanvas:processorClosestContainingCanvas,
    resolutionTier:processorResolutionTier,
    paddedBlob:processorPaddedBlob,
    workingBlob:processorWorkingBlob,
    centerCropBlob:processorCenterCropBlob,
    uploadBlob:processorUploadBlob,
    postprocessOutputs:processorPostprocessOutputs,
    fallbackRatios:[...AI_PROCESSOR_FALLBACK_RATIOS]
});
