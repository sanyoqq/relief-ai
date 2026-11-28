import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await mkdir('test-results',{recursive:true});
try {
 await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Выберите фотографию'),{},{timeout:120000});
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=192;c.height=192;const x=c.getContext('2d');const g=x.createRadialGradient(96,96,0,96,96,90);g.addColorStop(0,'white');g.addColorStop(1,'black');x.fillStyle=g;x.fillRect(0,0,192,192);return c.toDataURL('image/png').split(',')[1]});
 await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 await page.locator('#res').selectOption('128');
 await page.locator('#gray').click();
 async function stl(label){
 const pending=page.waitForEvent('download');await page.locator('#save').click();const dl=await pending;await dl.saveAs('test-results/'+label+'.stl');
 const b=await readFile('test-results/'+label+'.stl');const n=b.readUInt32LE(80);assert.equal(b.length,84+50*n);assert.ok(n>100);
 let min=Infinity,max=-Infinity;for(let i=0;i<n;i++)for(let j=0;j<3;j++){const z=b.readFloatLE(84+i*50+12+j*12+8);assert.ok(Number.isFinite(z));min=Math.min(min,z);max=Math.max(max,z);}
 assert.ok(max-min>3.1,'relief has no height');
 // Spatial diagnostic: maximum surface vertex height per normalized XY bin.
 // This is a coarse vertex envelope, not a rasterized or registered portrait metric.
 let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
 function vertices(fn){for(let i=0;i<n;i++)for(let j=0;j<3;j++){const o=84+i*50+12+j*12;fn(b.readFloatLE(o),b.readFloatLE(o+4),b.readFloatLE(o+8));}}
 vertices((x,y)=>{assert.ok(Number.isFinite(x)&&Number.isFinite(y));xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);});
 assert.ok(xmax>xmin&&ymax>ymin,'degenerate XY extent');
 const size=8, bins=Array(size*size).fill(null);
 vertices((x,y,z)=>{const ix=Math.min(size-1,Math.floor(size*(x-xmin)/(xmax-xmin)));const iy=Math.min(size-1,Math.floor(size*(y-ymin)/(ymax-ymin)));const k=iy*size+ix;bins[k]=bins[k]===null?z:Math.max(bins[k],z);});
 assert.ok(bins.every(v=>v!==null),'surface grid has empty bins');
 return {triangles:n,min,max,xyBounds:[xmin,xmax,ymin,ymax],heightGrid:bins.map(z=>Number(z.toFixed(5))),gridSize:size};
 }
 const gray=await stl('gray');
 // The radial grayscale fixture must produce a raised center, not merely a nonzero global range.
 const g=gray.heightGrid, s=gray.gridSize;
 const center=[3,4].flatMap(y=>[3,4].map(x=>g[y*s+x]));
 const corners=[g[0],g[s-1],g[(s-1)*s],g[s*s-1]];
 const mean=a=>a.reduce((sum,v)=>sum+v,0)/a.length;
 assert.ok(mean(center)-mean(corners)>0.1,'radial fixture lost its central relief');

 const pngPending=page.waitForEvent('download');await page.locator('#map').click();const png=await pngPending;await png.saveAs('test-results/depth.png');const p=await readFile('test-results/depth.png');assert.equal(p[24],16,'expected 16-bit PNG');
 await page.locator('#modelChoice').selectOption('small');await page.locator('#autoFace').uncheck();
 await page.locator('#ai').click();await page.waitForFunction(()=>/AI-барельеф готов|Ошибка AI/.test(document.querySelector('#status').textContent),{},{timeout:600000});
 const status=await page.locator('#status').innerText();assert.match(status,/AI-барельеф готов/);
 const ai=await stl('ai');
 // Measure browser frame cadence during actual pointer-driven orbit.
 // SwiftShader CI is a diagnostic baseline, not a hardware FPS guarantee.
 const canvas=page.locator('#view canvas');
 await canvas.scrollIntoViewIfNeeded();
 const rect=await canvas.boundingBox();
 assert.ok(rect && rect.width>100 && rect.height>100,'3D viewport unavailable');
 const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 const sample=page.evaluate(()=>new Promise(resolve=>{
   const times=[];let previous;
   const start=performance.now();
   function frame(t){
     if(previous!==undefined)times.push(t-previous);
     previous=t;
     if(performance.now()-start>=2000)resolve(times);
     else requestAnimationFrame(frame);
   }
   requestAnimationFrame(frame);
 }));
 try {
   for(let i=1;i<=30;i++){
     await page.mouse.move(x+Math.sin(i/30*Math.PI*2)*Math.min(100,rect.width/4),y+Math.sin(i/30*Math.PI)*Math.min(40,rect.height/4));
     await page.waitForTimeout(35);
   }
 }finally{await page.mouse.up();}
 const frames=await sample;
 assert.ok(frames.length>0 && frames.every(t=>Number.isFinite(t)&&t>0),'no valid animation frames');
 const sorted=[...frames].sort((a,b)=>a-b);
 const rotation={frames:frames.length,fps:1000*frames.length/frames.reduce((a,b)=>a+b,0),p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};
 assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({gray,ai,status,rotation},null,2));
}finally{await page.screenshot({path:'test-results/screenshot.png',fullPage:true}).catch(()=>{});await browser.close();}
