import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarOrganization } from '../src/client/organization/SidebarOrganization.tsx';
import { OrganizationLibrary } from '../src/client/organization/OrganizationLibrary.tsx';

const data = {
  collections: [],
  folders: [{id: 'desk', name: 'Desk', parent_id: null}, {id: 'child', name: 'Subfolder', parent_id: 'desk'}],
  locations: [{kind: 'page', item_id: 'filed', folder_id: 'desk'}], memberships: [],
  favourites: [{kind: 'folder', item_id: 'child'}, {kind: 'page', item_id: 'draft'}],
};
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(createElement(OrganizationLibrary, {
  data, vaultId: 'default', pages: [{id: 'draft', title: 'Draft', updated_at: '2026-10-17'}, {id: 'filed', title: 'Filed', updated_at: '2026-10-17'}],
  entities: [], favouritesOnly: false, context: {collection: '', folder: ''},
  onContextChange: noop, onChanged: noop, onOpenPage: noop, onOpenEntity: noop, onOpenFolder: noop,
  onRenamePage: noop, onDeletePage: noop, onNewNote: noop, onError: noop, ...props,
}));

test('Library places folders and notes in the same table and keeps page selection scoped to notes', () => {
  const html = render();
  assert.match(html, /<h1 class="page-heading">Pages<\/h1>/);
  const table = html.slice(html.indexOf('class="organization-items'));
  assert.match(table, /Desk/);
  assert.match(table, /Draft/);
  assert.doesNotMatch(table, /Filed/);
  assert.ok(table.indexOf('Desk') < table.indexOf('Draft'));
  assert.doesNotMatch(html, /organization-folder-grid/);
  assert.doesNotMatch(html, /Subfolder/);
  assert.match(table, /aria-label="Favourite: Desk"/);
  assert.doesNotMatch(table, /aria-label="Select Desk"/);
});

test('folder browsing and Favourites include the right folder rows', () => {
  const folder = render({context: {collection: '', folder: 'desk'}});
  assert.match(folder, /Subfolder/);
  assert.match(folder, /Filed/);
  assert.doesNotMatch(folder, /Draft/);
  const favourites = render({favouritesOnly: true});
  assert.match(favourites, /Subfolder/);
  assert.match(favourites, /Draft/);
  assert.doesNotMatch(favourites, />Desk</);
  assert.doesNotMatch(favourites, /Filed/);
  assert.match(favourites, /aria-label="Remove favourite: Subfolder"/);
  const inbox = render({inboxOnly: true});
  assert.match(inbox, /Draft/);
  assert.doesNotMatch(inbox, /Subfolder|>Desk<|Filed/);
});


test('Library and sidebar folder rows are draggable while collections remain curated drop targets', () => {
  const html = render();
  const row = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  assert.match(row, /draggable="true"/);
  assert.match(row, /Desk/);
  const sidebar = renderToStaticMarkup(createElement(SidebarOrganization, {
    data: {...data, collections: [{id: 'theme', name: 'Theme'}]}, vaultId: 'default', pages: [],
    context: {collection: '', folder: ''}, active: true, disabled: false, available: true,
    onOpen: noop, onOpenUnfiled: noop, onOpenPage: noop, onRenamePage: noop, onDeletePage: noop, onMovePage: noop, onChanged: noop, onError: noop,
  }));
  assert.match(sidebar, /draggable="true"[^>]*>[\s\S]*?Open folder: Desk/);
  assert.match(sidebar, /draggable="false"[^>]*>[\s\S]*?Open collection: Theme/);
});

test('Library omits routine status and combines factual AI history in its one label',()=>{
  assert.doesNotMatch(render(),/page-ai-library-status|>Regular</);
  const html=render({pages:[{id:'draft',title:'Combined',updated_at:'2026-10-17',creationMethod:'manual_creation',aiStatus:'ai_assisted',aiReviewAccepted:true,containsAIExplanations:true}]});
  assert.match(html,/title="Created in Noema · AI writing edits accepted · Contains AI explanations"/);
  assert.match(html,/>AI writing edits accepted<\/span>/);
  const generated=render({pages:[{id:'draft',title:'Generated',updated_at:'2026-10-17',aiStatus:'ai_generated_edited',aiReviewAccepted:true,containsAIExplanations:true}]});
  assert.match(generated,/AI-generated content · AI writing edits accepted · Contains AI explanations · Edited after generation/);
  assert.match(generated,/>AI-generated<\/span>/);
  assert.doesNotMatch(generated,/AI-generated, edited/);
});

test('sidebar caps every page group at five and View all opens its full list', async t => {
  const {setupDOM} = await import('./helpers/dom.mjs');
  const {act} = await import('react');
  const {createRoot} = await import('react-dom/client');
  const {saveSidebarExpansion} = await import('../src/client/organization/sidebar-expansion.ts');
  const env = setupDOM(t);
  const vaultId = 'sidebar-page-limit';
  saveSidebarExpansion(vaultId, new Set(['folder:desk', 'folder:child', 'collection:theme', 'collection:theme/folder:desk', 'unfiled']));
  const pages = ['desk', 'child', 'unfiled'].flatMap(group => Array.from({length: 7}, (_, index) => ({id: `${group}-${index}`, title: `${group} ${index}`, updated_at: ''})));
  const organization = {...data,
    collections: [{id: 'theme', name: 'Theme'}],
    locations: pages.filter(page => !page.id.startsWith('unfiled')).map(page => ({kind: 'page', item_id: page.id, folder_id: page.id.startsWith('child') ? 'child' : 'desk'})),
    memberships: pages.filter(page => page.id.startsWith('unfiled')).map(page => ({kind: 'page', item_id: page.id, collection_id: 'theme'})),
    folderLinks: [{folder_id: 'desk', collection_id: 'theme'}],
  };
  const opened = [], root = createRoot(document.querySelector('#mount'));
  env.defer(() => act(async () => root.unmount()));
  const props = {data: organization, pages, vaultId, activePageId: 'desk-6', activeFolderPath: [], revealPageId: null, onRevealed: noop,
    context: {collection: '', folder: ''}, active: false, disabled: false, available: true,
    onOpen: (...args) => opened.push(args), onOpenUnfiled: () => opened.push(['unfiled']),
    onOpenPage: noop, onRenamePage: noop, onDeletePage: noop, onMovePage: noop, onChanged: noop, onError: noop};
  await act(async () => root.render(createElement(SidebarOrganization, props)));
  const buttons = [...document.querySelectorAll('.sidebar-view-all')];
  assert.equal(buttons.length, 5);
  for (const button of buttons) {
    const links = [...button.parentElement.children].filter(node => node.classList.contains('sidebar-page-row'));
    assert.equal(links.length, 5);
    await act(async () => button.click());
  }
  assert.deepEqual(opened, [['', 'child'], ['', 'desk'], ['unfiled'], ['', 'desk'], ['theme', '']]);
  assert.equal(document.querySelectorAll('.organization-page-link[aria-current="page"]').length, 2);
  assert.equal(document.querySelector('[data-canonical-page="desk-6"]')?.title, 'desk 6');
  await act(async () => root.render(createElement(SidebarOrganization, {...props, disabled: true})));
  assert.ok([...document.querySelectorAll('.sidebar-view-all')].every(button => button.disabled));
  await act(async () => root.render(createElement(SidebarOrganization, {...props, pages: pages.filter(page => Number(page.id.split('-')[1]) < 5)})));
  assert.equal(document.querySelectorAll('.sidebar-view-all').length, 0);
});

test('Library makes all-pages scope and folder grouping explicit without changing row identities', async () => {
  const {setLibraryViewState,clearLibraryViewStates}=await import('../src/client/state/library-view-state.ts');
  const destination=JSON.stringify(['organization','','']);
  const vaultId='library-presentation-contract';
  setLibraryViewState(vaultId,destination,{groupFolders:false,sort:'modified-desc'});
  const current=render({vaultId});
  assert.ok(current.indexOf('data-library-row="page:draft"')<current.indexOf('data-library-row="folder:desk"'));
  assert.match(current,/Group folders first/);
  assert.match(current,/2 items · Pages root/);
  setLibraryViewState(vaultId,destination,{scope:'all'});
  const all=render({vaultId});
  assert.match(all,/data-library-row="page:filed"/);
  assert.doesNotMatch(all,/data-library-row="folder:desk"/);
  assert.doesNotMatch(all,/class="library-item-extra"/);
  setLibraryViewState(vaultId,destination,{columns:'location'});
  assert.match(render({vaultId}),/class="library-item-extra">Desk/);
  assert.match(all,/Text in this scope/);
  clearLibraryViewStates(vaultId);
});

test('Preview cover treatment only reserves space for a genuine image', async()=>{
  const {PageCover}=await import('../src/client/components/PageCover.tsx');
  assert.equal(renderToStaticMarkup(createElement(PageCover,{vaultId:'test',icon:'page'})),'');
  assert.match(renderToStaticMarkup(createElement(PageCover,{vaultId:'test',imageId:'cover'})),/loading="lazy"/);
});

test('Presentation persistence inherits per vault while selections and search remain ephemeral', async t=>{
  const {setupDOM}=await import('./helpers/dom.mjs');setupDOM(t);
  const {saveLibraryPresentation,readLibraryPresentation,getLibraryViewState,setLibraryViewState,clearLibraryViewStates}=await import('../src/client/state/library-view-state.ts');
  const root=JSON.stringify(['organization','','']),folder=JSON.stringify(['organization','','new']);
  saveLibraryPresentation('preferences',root,{layout:'list',sort:'title-desc',groupFolders:false,columns:'location',density:'compact'});
  assert.deepEqual(readLibraryPresentation('preferences',folder),{layout:'list',sort:'title-desc',groupFolders:false,columns:'location',density:'compact'});
  assert.deepEqual(readLibraryPresentation('another-vault',folder),{});
  setLibraryViewState('preferences','knowledge',{grouping:'all'});
  assert.equal(readLibraryPresentation('preferences','knowledge').grouping,'all');
  setLibraryViewState('preferences',folder,{query:'private query',selectedIds:['private-id'],scroll:{top:123,left:0},sort:'title-asc'});
  assert.doesNotMatch(JSON.stringify([...Array(window.localStorage.length)].map((_,i)=>window.localStorage.getItem(window.localStorage.key(i)))),/private query|private-id|123/);
  clearLibraryViewStates('preferences');
  const restored=getLibraryViewState('preferences',folder);
  assert.equal(restored.sort,'title-asc');assert.equal(restored.query,'');assert.deepEqual(restored.selectedIds,[]);assert.equal(restored.scroll.top,0);
});

test('legacy library layouts migrate to list density without changing other preferences',async t=>{
  const {setupDOM}=await import('./helpers/dom.mjs');setupDOM(t);
  const {readLibraryPresentation}=await import('../src/client/state/library-view-state.ts');
  const root=JSON.stringify(['organization','','']),folder=JSON.stringify(['organization','','child']);
  const key=destination=>'noema-library-presentation/'+JSON.stringify(['migration',destination]);
  window.localStorage.setItem(key('organization'),JSON.stringify({layout:'compact',sort:'title-asc',columns:'location',density:'comfortable'}));
  assert.deepEqual(readLibraryPresentation('migration',folder),{layout:'list',density:'compact',sort:'title-asc',columns:'location'});
  window.localStorage.setItem(key(folder),JSON.stringify({layout:'grid',density:'comfortable'}));
  assert.deepEqual(readLibraryPresentation('migration',folder),{layout:'list',density:'standard',sort:'title-asc',columns:'location'});
  window.localStorage.setItem(key(root),JSON.stringify({layout:'list',density:'compact'}));
  assert.equal(readLibraryPresentation('migration',root).density,'compact');
});

test('list density controls are icon-only, persist compact spacing, and survive sorting and navigation',async t=>{
  const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t);
  const {act}=await import('react'),{createRoot}=await import('react-dom/client');
  const {LibraryDensitySwitch,useLibraryDensity}=await import('../src/client/components/LibraryDensitySwitch.tsx');
  const {useLibraryViewState,readLibraryPresentation}=await import('../src/client/state/library-view-state.ts');
  const previousObserver=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {observe(){}disconnect(){}}});
  env.defer(()=>{if(previousObserver)Object.defineProperty(globalThis,'ResizeObserver',previousObserver);else delete globalThis.ResizeObserver;});
  const vaultId='density-controls',destination=JSON.stringify(['organization','','']);
  function Library({destination}) {
    const [density,setDensity,ref]=useLibraryDensity(JSON.stringify([vaultId,destination]),'library');
    const [state,setState]=useLibraryViewState(vaultId,destination);
    return createElement('section',{ref,'data-layout':'list','data-density':density},
      createElement(LibraryDensitySwitch,{value:density,onChange:setDensity}),
      createElement('button',{'aria-label':'Sort',onClick:()=>setState(previous=>({...previous,sort:'title-asc'}))},state.sort));
  }
  window.localStorage.setItem('noema-view-mode/'+JSON.stringify([vaultId,destination]),'grid');
  const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  const mount=async destination=>act(async()=>root.render(createElement(Library,{destination})));
  await mount(destination);
  assert.equal(document.querySelector('section').dataset.layout,'list');
  assert.equal(document.querySelector('section').dataset.density,'standard');
  const buttons=[...document.querySelectorAll('[aria-label="List density"] button')];
  assert.equal(buttons.length,3);assert.ok(buttons.every(button=>button.textContent===''&&button.querySelector('svg')));
  assert.notEqual(buttons[0].querySelector('path').getAttribute('d'),buttons[1].querySelector('path').getAttribute('d'));
  await act(async()=>document.querySelector('[aria-label="Compact spacing"]').click());
  assert.equal(document.querySelector('section').dataset.density,'compact');
  await act(async()=>document.querySelector('[aria-label="Sort"]').click());
  assert.equal(readLibraryPresentation(vaultId,destination).density,'compact');
  await mount(JSON.stringify(['organization','','new-folder']));
  assert.equal(document.querySelector('section').dataset.density,'compact');
  await act(async()=>document.querySelector('[aria-label="Regular spacing"]').click());
  assert.equal(document.querySelector('section').dataset.layout,'list');
  assert.equal(document.querySelector('section').dataset.density,'standard');
});

test('Reading Notes uses the canonical list and collections lead the unified table',()=>{
  const collections=[{id:'reading',name:'Reading Notes',description:'Books and essays'}];
  const root=render({data:{...data,collections}});
  assert.match(root,/data-library-row="collection:reading"/);assert.match(root,/Reading Notes/);
  assert.doesNotMatch(root,/organization-container-grid|organization-container-card|organization-section-toggle/);
  assert.ok(root.indexOf('data-library-row="collection:reading"')<root.indexOf('data-library-row="folder:desk"'));
  assert.match(root,/Open collection: Reading Notes/);
  const collectionsOnly=render({data:{...data,collections,folders:[],favourites:[]},pages:[]});
  assert.match(collectionsOnly,/data-library-row="collection:reading"/);
  assert.doesNotMatch(collectionsOnly,/Nothing here yet/);
  assert.match(root,/data-layout="list"/);
  assert.doesNotMatch(root,/Grid view|View layout|Row spacing/);
  const reading=render({data:{...data,collections},context:{collection:'reading',folder:''}});
  assert.match(reading,/data-layout="list"/);assert.match(reading,/data-density="comfortable"/);
});

test('View options contains secondary settings, preserves density changes, and restores focus on Escape',async t=>{
  const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t);
  const {act,useState}=await import('react'),{createRoot}=await import('react-dom/client');
  const {LibraryToolbar}=await import('../src/client/components/LibraryToolbar.tsx');
  const panels=new WeakSet(),prototype=env.dom.window.HTMLElement.prototype,originalMatches=prototype.matches;
  t.mock.method(prototype,'matches',function(selector){return selector===':popover-open'?panels.has(this):originalMatches.call(this,selector);});
  prototype.showPopover=function(){panels.add(this);};prototype.hidePopover=function(){panels.delete(this);};
  t.mock.method(prototype,'getBoundingClientRect',()=>({left:200,right:238,top:100,bottom:138,width:38,height:38}));
  const previousObserver=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {observe(){}disconnect(){}}});
  env.defer(()=>{if(previousObserver)Object.defineProperty(globalThis,'ResizeObserver',previousObserver);else delete globalThis.ResizeObserver;});
  function Library(){
    const [density,setDensity]=useState('standard'),[group,setGroup]=useState(true);
    return createElement(LibraryToolbar,{density,onDensity:setDensity,group,onGroup:setGroup,sort:'modified-desc',onSort:noop,filter:createElement('input',{'aria-label':'Filter'})},createElement('label',null,'Scope',createElement('select',{'aria-label':'Scope'},createElement('option',null,'Current level'))));
  }
  const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  await act(async()=>root.render(createElement(Library)));
  const trigger=document.querySelector('[aria-label="View options"]'),panel=document.querySelector('.library-view-options');
  assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.ok(panel.contains(document.querySelector('[aria-label="Scope"]')));
  assert.ok(panel.contains(document.querySelector('[aria-label="List density"]')));
  assert.equal(document.querySelector('[aria-label="Sort library"]').closest('.library-view-options'),null);
  await act(async()=>trigger.click());assert.equal(trigger.getAttribute('aria-expanded'),'true');
  await act(async()=>document.querySelector('[aria-label="Comfortable spacing"]').click());
  assert.equal(document.querySelector('[aria-label="Comfortable spacing"]').getAttribute('aria-pressed'),'true');
  await act(async()=>panel.dispatchEvent(new env.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(document.activeElement,trigger);
});

test('quick preview shows a page cover and opening text only after explicitly opening it',async t=>{
  const {setupDOM}=await import('./helpers/dom.mjs'),env=setupDOM(t);
  const {act,useRef}=await import('react'),{createRoot}=await import('react-dom/client');
  const {api}=await import('../src/client/api.ts'),{useLibraryQuickPreview}=await import('../src/client/components/LibraryQuickPreview.tsx');
  env.dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  env.dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let previewReads=0;
  t.mock.method(api,'pagePreview',async()=>{previewReads++;return {id:'covered',title:'Covered note',revision:1,updated_at:'',blocks:[{id:'opening',type:'paragraph',content:[{text:'Opening text stays available.'}]}]};});
  t.mock.method(api,'pageEntityAssociations',async()=>[]);
  function Library(){
    const ref=useRef(null),item={kind:'page',id:'covered',name:'Covered note'};
    const {showPreview,quickPreview}=useLibraryQuickPreview(ref,{vaultId:'preview',items:[item],pages:[{id:'covered',title:'Covered note',updated_at:'',featuredImageId:'cover-image'}],entities:[],onOpen:noop});
    return createElement('section',{ref},createElement('button',{onClick:()=>showPreview(item)},'Preview'),quickPreview);
  }
  const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
  await act(async()=>root.render(createElement(Library)));
  assert.equal(previewReads,0);assert.equal(document.querySelector('img'),null);
  await act(async()=>document.querySelector('button').click());
  assert.equal(previewReads,1);assert.equal(document.querySelector('dialog img').getAttribute('src'),'/api/images/cover-image?vault=preview');
  assert.match(document.querySelector('dialog').textContent,/Opening text stays available/);
});
