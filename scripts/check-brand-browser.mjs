// Real built shell; disposable in-memory vault; no credentials or provider calls.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {resolve,join} from 'node:path';
import {openDatabase} from '../src/server/database.ts';
import {Store} from '../src/server/store.ts';
import {createApp} from '../src/server/http.ts';
import {Intelligence} from '../src/server/modules/intelligence.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/tmp/noema-brand-evidence');
await mkdir(artifacts,{recursive:true});
const db=openDatabase(':memory:');
const provider=new Intelligence({read:()=>null,write(){},remove(){}},async()=>{throw new Error('Provider calls forbidden in brand fixture');});
const server=createApp(new Store(db),resolve('dist/client'),provider);
const results=[],errors=[];let browser;
// Check rendered pixels, including separated components and the open central hole.
async function pixels(page,url,size,{transparent=false,dark=false}={}) {
  return page.evaluate(async({url,size,transparent,dark})=>{
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,size,size);
    const data=ctx.getImageData(0,0,size,size).data;
    const pixel=(x,y)=>Array.from(data.slice((y*size+x)*4,(y*size+x)*4+4));
    const ink=Array.from({length:size*size},(_,i)=>data[i*4+3]>80&&(transparent||Math.min(...data.slice(i*4,i*4+3))<200));
    const visited=new Set(),components=[];
    for(let i=0;i<ink.length;i++)if(ink[i]&&!visited.has(i)){
      const pending=[i];visited.add(i);let count=0;
      while(pending.length){const p=pending.pop(),x=p%size,y=Math.floor(p/size);count++;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy,n=ny*size+nx;
          if(nx>=0&&nx<size&&ny>=0&&ny<size&&ink[n]&&!visited.has(n)){visited.add(n);pending.push(n);}
        }
      }components.push(count);
    }
    const center=pixel(size/2,size/2),satellite=pixel(Math.floor(size*.92),size/2);
    const opaqueColors=[...new Set(Array.from({length:size*size},(_,i)=>data[i*4+3]===255?Array.from(data.slice(i*4,i*4+3)).join(','):null).filter(Boolean))];
    const transparentPixels=Array.from({length:size*size},(_,i)=>data[i*4+3]===0).filter(Boolean).length;
    return {size,width:image.naturalWidth,height:image.naturalHeight,components:components.sort((a,b)=>a-b),center,satellite,corner:pixel(0,0),transparentPixels,opaqueColors,dark};
  },{url,size,transparent,dark});
}
try {
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  for(const width of [1440,390])for(const mode of ['light','dark'])for(const theme of ['ink','juniper','atlantic']){
    const key=`${width}-${mode}-${theme}`,context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,colorScheme:mode,reducedMotion:'reduce'});
    console.log('Checking sidebar',key);
    await context.addInitScript(({mode,theme})=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,theme})),{mode,theme});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto(base);
    await page.getByRole('button',{name:'A place for connected ideas',exact:false}).first().waitFor();
    await page.evaluate(()=>document.fonts.ready);
    if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
    const brand=page.getByRole('link',{name:'Noema home',exact:true}),mark=brand.locator('.brand-mark');
    await brand.waitFor();await page.evaluate(()=>document.fonts.ready);
    assert.equal(await mark.getAttribute('aria-hidden'),'true');
    assert.equal(await brand.locator('span').innerText(),'noema');
    const styles=await mark.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,color:s.color,paint:s.backgroundColor,filter:s.filter,mask:s.maskImage,wordmark:getComputedStyle(e.nextElementSibling).color};});
    assert.equal(styles.width,18);assert.equal(styles.height,18);
    assert.equal(styles.paint,styles.wordmark);assert.equal(styles.filter,'none');assert.ok(styles.mask.includes('/noema-mark.svg'));
    assert.equal(await page.locator('link[rel=icon][type="image/svg+xml"]').getAttribute('href'),'/noema-mark.svg');
    await mark.screenshot({path:join(artifacts,key+'-18px.png'),animations:'disabled'});
    if(theme==='ink'){
      await brand.screenshot({path:join(artifacts,key+'-wordmark.png'),animations:'disabled'});
      await page.screenshot({path:join(artifacts,key+'-shell.png'),animations:'disabled'});
    }
    results.push({key,...styles});await context.close();
  }
  // Exercise the real system-appearance subscription and its runtime color tokens.
  const live=await browser.newPage({colorScheme:'light'});
  await live.addInitScript(()=>localStorage.setItem('noema.appearance.v1',JSON.stringify({mode:'system',theme:'ink'})));
  await live.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await live.goto(base);const liveMark=live.locator('.brand-mark');await liveMark.waitFor();
  const lightPaint=await liveMark.evaluate(e=>getComputedStyle(e).backgroundColor);
  await live.emulateMedia({colorScheme:'dark'});
  await live.waitForFunction(()=>document.documentElement.dataset.mode==='dark');
  assert.notEqual(await liveMark.evaluate(e=>getComputedStyle(e).backgroundColor),lightPaint);
  await live.emulateMedia({colorScheme:'light'});
  await live.waitForFunction(()=>document.documentElement.dataset.mode==='light');
  assert.equal(await liveMark.evaluate(e=>getComputedStyle(e).backgroundColor),lightPaint);
  await live.close();
  const raster=[];
  for(const mode of ['light','dark']){
    const page=await browser.newPage({colorScheme:mode});
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    // Standalone SVG, as a favicon resource: independent of saved app appearance.
    await page.goto(base+'/noema-mark.svg');
    assert.equal(await page.locator('svg').evaluate(e=>getComputedStyle(e).color),mode==='dark'?'rgb(230, 230, 230)':'rgb(23, 23, 23)');
    await page.goto(base);await page.evaluate(mode=>document.documentElement.style.colorScheme=mode,mode);
    for(const size of [16,18]){
      const sample=await pixels(page,base+'/noema-mark.svg',size,{transparent:true,dark:mode==='dark'});
      assert.equal(sample.components.length,3,JSON.stringify(sample));
      assert.equal(sample.center[3],0,'The central ring must stay hollow');
      assert.equal(sample.corner[3],0,'The adaptive SVG must have no backing');
      assert.ok(sample.transparentPixels>size*size/2);
      assert.ok(sample.satellite[3]>180,'The satellite must stay visible');
      assert.equal(sample.satellite[0],mode==='dark'?230:23);raster.push({mode,...sample});
    }
    await page.close();
  }
  const ico=await readFile('public/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
  const page=await browser.newPage(),previews=[];
  for(let i=0;i<3;i++){
    const entry=6+16*i,size=ico[entry],length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12);
    assert.equal(size,[16,32,48][i]);assert.equal(ico[entry+1],size,'ICO frame must be square');
    const png=ico.subarray(offset,offset+length),url='data:image/png;base64,'+png.toString('base64');
    const sample=await pixels(page,url,size,{transparent:true});
    assert.equal(sample.width,size);assert.equal(sample.height,size,'Decoded PNG dimensions must match the ICO frame');
    assert.equal(sample.components.length,3,JSON.stringify(sample));
    assert.equal(sample.center[3],0,'The ring center must reveal the browser background');
    assert.equal(sample.corner[3],0,'No favicon tile or enclosure');
    assert.ok(sample.transparentPixels>size*size/2,'The canvas must have no backing');
    assert.deepEqual(sample.opaqueColors,['118,118,118'],'Fallback ink must remain neutral #767676');
    assert.ok(sample.satellite[3]>180,'The satellite must remain visible');
    await writeFile(join(artifacts,`favicon-${size}.png`),png);raster.push({format:'ico',...sample});
    previews.push({size,url});
  }
  // Inspect the actual favicon assets on browser-like light/dark surfaces.
  await page.goto(base);
  for(const mode of ['light','dark']){
    const background=mode==='dark'?'#202020':'#ffffff';
    await page.emulateMedia({colorScheme:mode});await page.setViewportSize({width:760,height:410});
    await page.setContent(`<style>:root{color-scheme:${mode}}body{margin:24px;background:${background};color:${mode==='dark'?'#e6e6e6':'#171717'};font:14px system-ui}section{display:flex;align-items:center;gap:24px;height:70px}section span{width:110px}.zoom{height:180px}.zoom img{width:128px;height:128px;image-rendering:pixelated}</style><h1>Quiet Orbit · ${mode} background</h1><section><span>Adaptive SVG</span>${previews.map(({size})=>`<img src="${base}/noema-mark.svg" width="${size}" height="${size}">`).join('')}</section><section><span>Transparent ICO</span>${previews.map(({size,url})=>`<img src="${url}" width="${size}" height="${size}">`).join('')}</section><section class="zoom"><span>16px · 8× pixels</span><img src="${base}/noema-mark.svg" width="16" height="16"><img src="${previews[0].url}" width="16" height="16"></section>`);
    const samples=await page.locator('img').evaluateAll(async(images,background)=>{
      await Promise.all(images.map(image=>image.decode()));
      for(const image of images.filter(image=>image.closest('.zoom'))){
        // Enlarge the rasterized 16px pixels, including the adaptive SVG sample.
        const thumbnail=document.createElement('canvas');thumbnail.width=thumbnail.height=16;
        thumbnail.getContext('2d').drawImage(image,0,0,16,16);image.src=thumbnail.toDataURL();await image.decode();
      }
      return images.map(image=>{
        const size=Number(image.getAttribute('width')),canvas=document.createElement('canvas');canvas.width=canvas.height=size;
        const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,size,size);ctx.drawImage(image,0,0,size,size);
        const at=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
        return {size,corner:at(0,0),center:at(size/2,size/2)};
      });
    },background);
    const expected=mode==='dark'?[32,32,32,255]:[255,255,255,255];
    for(const sample of samples){assert.deepEqual(sample.corner,expected);assert.deepEqual(sample.center,expected);}
    await page.screenshot({path:join(artifacts,`favicons-${mode}.png`)});
  }
  assert.deepEqual(errors,[]);
  await writeFile(join(artifacts,'results.json'),JSON.stringify({browser:browser.version(),results,raster,errors},null,2));
  console.log(`Quiet Orbit browser checks passed: ${results.length} shell variants; 16/18px SVG in light/dark; all ICO sizes. Evidence: ${artifacts}`);
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
}
