export function renderArtwork(canvas, options={}) {
const c=canvas.getContext("2d");
function sculpture(x,y,w,h,{angle=0,depth=false,transparent=false,light=0,explode=0,tint=0}={}){
 c.save();c.beginPath();c.roundRect(x,y,w,h,9);c.clip();
 if(transparent){for(let yy=0;yy<h;yy+=16)for(let xx=0;xx<w;xx+=16){c.fillStyle=((xx/16+yy/16)%2)?'#e8e8e8':'#f6f6f6';c.fillRect(x+xx,y+yy,16,16);}}
 else{const bg=c.createLinearGradient(x,y,x+w,y+h);bg.addColorStop(0,depth?'#151515':'#e7e8e4');bg.addColorStop(1,depth?'#424242':'#bfc3bb');c.fillStyle=bg;c.fillRect(x,y,w,h);}
 const cx=x+w*.5,cy=y+h*.46,sz=Math.min(w,h)*.28;
 if(!transparent){c.save();c.translate(cx,y+h*.8+explode*35);c.scale(1,.22);const sg=c.createRadialGradient(0,0,0,0,0,sz*1.35);sg.addColorStop(0,'#00000048');sg.addColorStop(1,'#00000000');c.fillStyle=sg;c.fillRect(-sz*1.4,-sz*1.4,sz*2.8,sz*2.8);c.restore();}
 // Three curved polished-metal ribbons, projected as a sculpture.
 c.save();c.translate(cx,cy-explode*22);c.rotate(-.34+Math.sin(angle)*.12);
 const order=[0,1,2];for(const j of order){c.save();c.translate((j-1)*sz*.12+explode*(j-1)*sz*.5, (j-1)*sz*.35-explode*j*sz*.15);c.rotate(j*.93+angle*.35);c.scale(.78+Math.cos(angle+j*.3)*.16,1);
 const g=c.createLinearGradient(-sz,-sz,sz,sz);if(depth){g.addColorStop(0,['#fff','#cfcfcf','#969696'][j]);g.addColorStop(1,['#9a9a9a','#888','#606060'][j]);}else{const shift=Math.sin(light)*.12;g.addColorStop(0,'#202722');g.addColorStop(.22+shift,'#f4f6ed');g.addColorStop(.37+shift,'#8e9885');g.addColorStop(.47+shift,'#fafcf6');g.addColorStop(.54+shift,'#414a3e');g.addColorStop(.72,'#151c15');g.addColorStop(.91,'#c9d3be');g.addColorStop(1,'#f8faf4');}
 c.beginPath();c.ellipse(0,0,sz,sz*.54,0,0,Math.PI*2);c.ellipse(sz*.07,-sz*.04,sz*.65,sz*.24,0,0,Math.PI*2,true);c.fillStyle=g;c.fill('evenodd');c.strokeStyle=depth?'#ffffff22':'#ffffff88';c.lineWidth=1;c.stroke();c.restore();}c.restore();
 if(tint){c.fillStyle=`rgba(167,244,67,${tint})`;c.fillRect(x,y,w,h);}c.restore();
}
sculpture(0,0,canvas.width,canvas.height,options);
}
