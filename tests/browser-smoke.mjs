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
 assert.ok(max-min>3.1,'relief has no height');return {triangles:n,min,max};
 }
 const gray=await stl('gray');
 const pngPending=page.waitForEvent('download');await page.locator('#map').click();const png=await pngPending;await png.saveAs('test-results/depth.png');const p=await readFile('test-results/depth.png');assert.equal(p[24],16,'expected 16-bit PNG');
 await page.locator('#modelChoice').selectOption('small');await page.locator('#autoFace').uncheck();
 await page.locator('#ai').click();await page.waitForFunction(()=>/AI-барельеф готов|Ошибка AI/.test(document.querySelector('#status').textContent),{},{timeout:600000});
 const status=await page.locator('#status').innerText();assert.match(status,/AI-барельеф готов/);
 const ai=await stl('ai');assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({gray,ai,status},null,2));
}finally{await page.screenshot({path:'test-results/screenshot.png',fullPage:true}).catch(()=>{});await browser.close();}
