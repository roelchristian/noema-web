// Optional Chromium tooling, as used by the browser checks. No extra app dependency.
// The SVG is the only authored geometry; the ICO is a generated compatibility asset.
import {readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const svg=await readFile(new URL('../public/noema-mark.svg',import.meta.url),'utf8');
const sizes=[16,32,48],images=[];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:48,height:48},deviceScaleFactor:1,colorScheme:'light'});
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>body{margin:0;background:transparent}img{display:block;background:#fff;border-radius:16%}</style><img src="data:image/svg+xml,${encodeURIComponent(svg)}">`);
  const image=page.locator('img');await image.evaluate(e=>e.decode());
  for(const size of sizes){
    await image.evaluate((e,size)=>{e.width=size;e.height=size;},size);
    images.push(await image.screenshot({omitBackground:true}));
  }
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
  let offset=header.length;
  images.forEach((png,i)=>{
    const entry=6+16*i;header[entry]=sizes[i];header[entry+1]=sizes[i];
    header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
    header.writeUInt32LE(png.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=png.length;
  });
  await writeFile(new URL('../public/favicon.ico',import.meta.url),Buffer.concat([header,...images]));
  console.log('Generated favicon.ico: 16, 32 and 48px, dark mark on a neutral white backing.');
} finally {await browser.close();}
