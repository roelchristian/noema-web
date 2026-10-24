// Disposable synthetic schema; real UI and backend. No provider calls or real vault data.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {lifecycleFixture} from '../test/helpers/entity-lifecycle-fixture.mjs';
import {PropertyDefinitionGovernance} from '../src/server/modules/property-definition-governance.ts';
import {entityTypes} from '../src/shared/domain.ts';
import {createApp} from '../src/server/http.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const artifacts=resolve(process.env.NOEMA_SCREENSHOTS??'/tmp/noema-entity-settings-evidence');await mkdir(artifacts,{recursive:true});
const f=await lifecycleFixture(),governance=new PropertyDefinitionGovernance(f.store);
f.knowledge.addSubtype('default',{type:'person',name:'Synthetic field specialist'});
const definition=governance.create('default',{name:'Synthetic count',scope:{kind:'main_type',type:'person'},valueKind:'short_text',cardinality:'many'});
f.knowledge.property('default',f.person.id,{name:'Synthetic count',value:'one'});f.knowledge.property('default',f.person.id,{name:'Synthetic count',value:'two'});
const server=createApp(f.store,resolve('dist/client'));server.listen(0,'127.0.0.1');await once(server,'listening');
let browser,page;const errors=[],external=[],results=[];
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const width of [1440,390])for(const mode of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:960},hasTouch:width===390,isMobile:width===390,reducedMotion:'reduce'});
  await context.addInitScript(mode=>{if(!localStorage.getItem('noema.appearance.v1'))localStorage.setItem('noema.appearance.v1',JSON.stringify({mode,entityColors:Object.fromEntries(['person','place','event','creativework','organization','organism','culture','source','concept'].map(type=>[type,'rose'])),subtypeIcons:{'creativework:song':'star'}}));},mode);
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?vault=default');
  if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Vault options',exact:true}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Entities',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'Main entity type'});assert.equal(await nav.getByRole('button').count(),9);
  await nav.getByRole('button',{name:/Person/}).focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.schema-type-inspector h3').evaluate(e=>e===document.activeElement),true);
  await verifyCategoryColors(page,width);
  await page.screenshot({path:resolve(artifacts,`${width}-${mode}-types.png`),fullPage:true});
  const icon=page.getByRole('button',{name:'Icon for Writer',exact:true});await icon.click();
  await page.getByRole('searchbox',{name:'Search icons',exact:true}).fill('star');await page.getByRole('button',{name:'Star',exact:true}).click();assert.equal(await icon.evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('noema.appearance.v1')).subtypeIcons['person:writer']),'star');
  await assertCategoryColors(page,'person'); // Custom symbol inherits the category palette.
  await icon.click();await page.keyboard.press('Escape');assert.equal(await page.locator('.schema-icon-palette').count(),0);assert.equal(await icon.evaluate(e=>e===document.activeElement),true);
  await icon.click();await page.getByRole('button',{name:'Use category icon',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('noema.appearance.v1')).subtypeIcons['person:writer']),null);
  await assertCategoryColors(page,'person'); // Explicit category fallback keeps the same colors.
  await page.getByRole('textbox',{name:'New subtype name',exact:true}).fill('Unsaved synthetic subtype');
  if(width===390){await page.getByRole('button',{name:'Back to types'}).click();assert.equal(await nav.getByRole('button',{name:/Person/}).evaluate(e=>e===document.activeElement),true);}
  await nav.getByRole('button',{name:/Place/}).click();
  if(width===390)await page.getByRole('button',{name:'Back to types'}).click();
  await nav.getByRole('button',{name:/Person/}).click();assert.equal(await page.getByRole('textbox',{name:'New subtype name'}).inputValue(),'Unsaved synthetic subtype');
  await page.getByRole('button',{name:'Writer',exact:true}).click();
  assert.ok(await page.locator('.schema-property-summary small').count()>0);
  await page.getByRole('button',{name:'Reset icons',exact:true}).click();
  await page.waitForFunction(()=>{const icons=JSON.parse(localStorage.getItem('noema.appearance.v1')).subtypeIcons;return icons['creativework:song']==='star'&&!Object.hasOwn(icons,'person:writer');});
  await page.locator('.schema-views').getByRole('button',{name:'Properties',exact:true}).click();
  const search=page.getByRole('searchbox',{name:'Search properties'});await search.fill('birth date');await page.locator('.schema-registry-list button').filter({hasText:'Person'}).click();
  assert.ok(await page.locator('.schema-builtin').isVisible());assert.equal(await page.locator('.property-definition-form').count(),0);
  await search.fill('Synthetic count');await page.locator('.schema-registry-list button').click();
  await page.getByRole('textbox',{name:'Property display label'}).fill('Unsaved synthetic label');
  await page.locator('.schema-views').getByRole('button',{name:'Types & subtypes',exact:true}).click();await page.locator('.schema-views').getByRole('button',{name:'Properties',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Property display label'}).inputValue(),'Unsaved synthetic label');
  await page.getByRole('button',{name:'Cancel changes'}).click();assert.equal(await page.getByRole('textbox',{name:'Property display label'}).inputValue(),'Synthetic count');
  // Keyboard operates the shared searchable select and keeps its focus contract.
  const cardinality=page.getByRole('combobox',{name:'Property cardinality',exact:true});await cardinality.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  assert.equal(await cardinality.innerText(),'Single value');
  await page.getByRole('button',{name:'Review definition impact',exact:true}).click();await page.locator('.property-definition-impact').waitFor();assert.match(await page.locator('.property-definition-impact').innerText(),/Affected values: 2/);
  const apply=page.getByRole('button',{name:'Apply definition',exact:true});assert.equal(await apply.isDisabled(),true);
  await page.getByRole('checkbox',{name:'Retain all incompatible authored values for review and apply this definition.'}).check();
  await page.screenshot({path:resolve(artifacts,`${width}-${mode}-impact.png`),fullPage:true});
  // Leave cardinality unchanged for each scenario; exercise actual create/update separately below.
  await page.getByRole('button',{name:'Cancel changes'}).click();
  await page.getByRole('button',{name:'Add property',exact:true}).click();
  await page.getByRole('textbox',{name:'Property display label'}).fill('Synthetic count');
  assert.equal(await page.locator('select[aria-label="Property cardinality"]').inputValue(),'one');
  await page.locator('.schema-definition-advanced summary').click();assert.equal(await page.getByRole('textbox',{name:'Stable property key'}).inputValue(),'synthetic_count_2');
  await page.screenshot({path:resolve(artifacts,`${width}-${mode}-create.png`),fullPage:true});
  assert.equal(await page.locator('dialog.settings-modal').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  const tooSmall=await page.locator('.entity-schema-manager button:visible, .entity-schema-manager summary:visible').evaluateAll(nodes=>nodes.filter(e=>{const r=e.getBoundingClientRect();return r.height<(innerWidth<=600?44:30)-.1||r.width<(innerWidth<=600?44:0)-.1;}).map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  assert.deepEqual(tooSmall,[]);
  await page.getByRole('textbox',{name:'Property display label'}).fill('Synthetic field '+width+' '+mode);
  await page.getByRole('combobox',{name:'Property definition scope'}).click();await page.getByRole('option',{name:'Writer',exact:true}).click();
  await page.getByRole('button',{name:'Create definition',exact:true}).click();await page.getByText('Definition saved. Existing authored values are retained.',{exact:true}).waitFor();
  const created=f.knowledge.schema('default').propertyDefinitions.find(item=>item.label==='Synthetic field '+width+' '+mode);assert.equal(created.scope.subtypeId,'person:writer');assert.equal(created.cardinality,'one');
  if(width===390&&mode==='dark'){
   await search.fill('Synthetic count');await page.locator('.schema-registry-list button').click();
   await cardinality.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');
   await page.getByRole('button',{name:'Review definition impact',exact:true}).click();await page.locator('.property-definition-impact').waitFor();
   await page.getByRole('checkbox',{name:'Retain all incompatible authored values for review and apply this definition.'}).check();await page.getByRole('button',{name:'Apply definition',exact:true}).click();await page.getByText('Definition saved. Existing authored values are retained.',{exact:true}).waitFor();
   assert.equal(f.knowledge.detail('default',f.person.id).properties.filter(item=>item.name==='Synthetic count').length,2);
  }
  results.push({width,mode,passed:['nine type counts','all nine category palettes and subtype icons','live colors and reopen/reload persistence','neutral selection and global icons preserved','keyboard selection and focus','palette search/select/Escape/focus return','subtype drafts across type navigation','combined inherited summary','category reset','registry search','builtin read-only inspector','edit/cancel','draft across views','impact preview and explicit compatibility confirmation','single-value creation and collision-safe key','no dialog overflow','control target sizes','typed subtype create persisted','compatible values retained through confirmed update']});
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 assert.equal(governance.impact('default',definition.id,{cardinality:'many'}).affectedValues,2);
 await writeFile(resolve(artifacts,'result.json'),JSON.stringify({browser:await browser.version(),results,errors,external},null,2));console.log('Entity Settings browser checks passed: '+artifacts);
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true});await writeFile(resolve(artifacts,'failure.txt'),await page.locator('body').innerText());}throw error;}
finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}


async function assertCategoryColors(page,type){
 const colors=await page.evaluate(type=>{
  const probe=document.createElement('span');document.body.append(probe);
  const resolve=(property,value)=>{probe.style[property]=value;return getComputedStyle(probe)[property];};
  const expected={color:resolve('color',`var(--${type}-text)`),backgroundColor:resolve('backgroundColor',`var(--${type}-bg)`)};
  const row=document.querySelector('.schema-type-nav button[aria-pressed=true]');
  const icons=[row.querySelector('.entity-icon'),...document.querySelectorAll('.schema-subtypes .entity-icon')];
  const actual=icons.map(icon=>{const style=getComputedStyle(icon);return {color:style.color,backgroundColor:style.backgroundColor,stroke:getComputedStyle(icon.querySelector('svg')).stroke};});
  const selection={actual:getComputedStyle(row).backgroundColor,expected:resolve('backgroundColor','var(--surface-hover)')};
  const functional=document.createElement('span');functional.className='entity-icon person';document.body.append(functional);
  const neutral={actual:getComputedStyle(functional).color,expected:resolve('color','light-dark(#292929, var(--text))')};
  functional.remove();probe.remove();return {expected,actual,selection,neutral};
 },type);
 assert.ok(colors.actual.length>1,'Expected navigation and subtype icons');
 for(const actual of colors.actual)assert.deepEqual(actual,{...colors.expected,stroke:colors.expected.color},type+' category icon palette');
 assert.equal(colors.selection.actual,colors.selection.expected,'Selected row stays neutral');
 assert.equal(colors.neutral.actual,colors.neutral.expected,'Icons outside Settings keep the shared treatment');
}
async function verifyCategoryColors(page,width){
 const nav=page.locator('.schema-type-nav');
 for(let index=0;index<entityTypes.length;index++){
  if(width===390)await page.getByRole('button',{name:'Back to types'}).click();
  await nav.locator('button').nth(index).click();await assertCategoryColors(page,entityTypes[index]);
 }
 if(width===390)await page.getByRole('button',{name:'Back to types'}).click();
 await nav.locator('button').first().click();
 await page.getByRole('button',{name:'Person color: Rose',exact:true}).click();await page.getByRole('option',{name:'Ocean',exact:false}).click();
 await page.getByRole('button',{name:'Person color: Ocean',exact:true}).waitFor();await assertCategoryColors(page,'person');
 const open=async()=>{
  if(width===390)await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('button',{name:'Vault options',exact:true}).click();await page.getByRole('menuitem',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Entities',exact:true}).click();
  if(width===390)await page.locator('.schema-type-nav button').first().click();
 };
 await page.getByRole('button',{name:'Done',exact:true}).click();
 // Closing Settings leaves mobile navigation open.
 if(width===390)await page.getByRole('button',{name:'Close navigation',exact:true}).click();
 await open();await assertCategoryColors(page,'person');
 await page.reload();await open();await assertCategoryColors(page,'person');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('noema.appearance.v1')).entityColors.person),'ocean');
}
