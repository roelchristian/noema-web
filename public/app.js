const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const labels = {person:'Person',place:'Place',event:'Event',creativework:'Creative work',organization:'Organization'};
const icons = {person:'◉',place:'⌖',event:'◷',creativework:'▤',organization:'▦'};
let pages = [], entities = [], current = null, view = 'pages', panelId = null, menuState = null, timer;
const pending = new Map();
const pageCache = new Map();
let saving = false;
async function api(url, method='GET', body) {
 const response = await fetch('/api/'+url, {method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
 const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function error(e) { $('#toast').textContent=e.message; $('#toast').hidden=false; setTimeout(()=>$('#toast').hidden=true,5000); }
const run = fn => (...args) => { try { return Promise.resolve(fn(...args)).catch(error); } catch(e) { error(e); } };
const getEntity = id => entities.find(e=>e.id===id);
function chip(id) { const e=getEntity(id); return `<span class="mention ${esc(e?.type || '')}" contenteditable="false" data-entity="${esc(id)}" role="button" tabindex="0">${icons[e?.type] || '◇'} ${esc(e?.name || 'Unknown entity')}</span>`; }
function segments(content) { return content.map(s=>s.entityId ? chip(s.entityId) : esc(s.text)).join(''); }
function readSegments(el) {
 const output=[];
 function walk(node) {
  if (node.nodeType===3) { if(node.textContent) output.push({text:node.textContent.replace(/\u200b/g,'')}); }
  else if(node.nodeType===1) {
   if(node.dataset.entity) output.push({entityId:node.dataset.entity});
   else if(node.tagName==='BR') output.push({text:'\n'});
   else node.childNodes.forEach(walk);
  }
 }
 el.childNodes.forEach(walk); return output;
}
function collect() {
 if(!current || view!=='pages') return;
 current.title=$('#page-title').value;
 current.blocks=[...document.querySelectorAll('.block')].map(row=>({id:row.dataset.id,type:row.dataset.type,checked:!!row.querySelector('input')?.checked,content:readSegments(row.querySelector('.block-content'))}));
}
function scheduleSave() {
 collect(); pageCache.set(current.id,structuredClone(current)); pending.set(current.id, structuredClone(current)); $('#save-status').textContent='Unsaved changes';
 clearTimeout(timer); timer=setTimeout(()=>flush(),400);
}
async function flush() {
 if(saving) return; saving=true;
 try {
  while(pending.size) {
   const [id,snapshot]=pending.entries().next().value; pending.delete(id); $('#save-status').textContent='Saving…';
   try { await api('pages/'+id,'PUT',snapshot); const listed=pages.find(p=>p.id===id); if(listed)listed.title=snapshot.title; } catch(e) { if(!pending.has(id)) pending.set(id,snapshot); throw e; }
  }
  $('#save-status').textContent='All changes saved'; renderSidebar();
 } catch(e) { $('#save-status').textContent='Save failed · click to retry'; error(e); }
 finally {saving=false;}
}
$('#save-status').onclick=()=>flush();
window.addEventListener('beforeunload',e=>{if(pending.size||saving){e.preventDefault();e.returnValue='';}});
function renderSidebar() {
 $('#page-list').innerHTML=pages.map(p=>`<button class="page-link ${current?.id===p.id&&view==='pages'?'selected':''}" data-page="${esc(p.id)}"><span>▤</span>${esc((current?.id===p.id?current.title:p.title)||'Untitled')}</button>`).join('');
 $('#entity-count').textContent=entities.length;
 $('#pages-nav').classList.toggle('active',view==='pages'); $('#entities-nav').classList.toggle('active',view==='entities');
}
function blockHTML(b) {
 return `<div class="block ${esc(b.type)}" data-id="${esc(b.id)}" data-type="${esc(b.type)}"><button class="block-handle" title="Block options" aria-label="Block options">⠿</button>${b.type==='todo'?`<input type="checkbox" aria-label="Complete task" ${b.checked?'checked':''}>`:b.type==='bullet'?'<span class="bullet-marker">•</span>':''}<div class="block-content" contenteditable="true" spellcheck="true" data-placeholder="Type / for blocks, @ for entities">${segments(b.content)}</div></div>`;
}
async function openPage(id) {
 if(current&&view==='pages') {collect(); if(pending.has(current.id)) pending.set(current.id,structuredClone(current));}
 current=pageCache.has(id) ? structuredClone(pageCache.get(id)) : await api('pages/'+id); view='pages'; hideMenu(); renderPage();
}
function renderPage() {
 renderSidebar(); $('#breadcrumb').innerHTML=`<span>Workspace</span> <b>/</b> Pages <b>/</b> ${esc(current.title||'Untitled')}`;
 $('#content').innerHTML=`<article class="page"><div class="page-eyebrow"><span class="page-symbol">✳</span> YOUR CONNECTED NOTEBOOK</div><input id="page-title" aria-label="Page title" placeholder="Untitled" value="${esc(current.title)}"><div class="page-meta"><span>▤ Page</span><span>↗ Connected knowledge</span><button id="delete-page">Delete page</button></div><div id="blocks">${current.blocks.map(blockHTML).join('')}</div><button id="add-block">+ <span>Add a block</span></button><footer class="editor-footer"><kbd>/</kbd> choose a block <span>·</span> <kbd>@</kbd> mention an entity <span>·</span> Enter for a new block</footer></article>`;
 $('#page-title').oninput=()=>{scheduleSave();renderSidebar();};
 $('#blocks').addEventListener('input',e=>{scheduleSave(); const el=e.target.closest('.block-content'); if(el) detectMenu(el);});
 $('#blocks').addEventListener('change',scheduleSave);
 $('#blocks').addEventListener('keydown',editorKey);
 $('#blocks').addEventListener('paste',e=>{
  if(!e.target.closest('.block-content'))return; e.preventDefault(); const text=e.clipboardData.getData('text/plain');
  const sel=getSelection(); if(!sel.rangeCount)return; const range=sel.getRangeAt(0); range.deleteContents(); const node=document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); sel.removeAllRanges();sel.addRange(range);scheduleSave();
 });
 $('#blocks').onclick=e=>{
  const mention=e.target.closest('[data-entity]'); if(mention){openEntity(mention.dataset.entity).catch(error);return;}
  const handle=e.target.closest('.block-handle'); if(handle)showBlockMenu(handle.closest('.block'));
 };
 $('#add-block').onclick=()=>insertBlock($('#blocks').lastElementChild);
 $('#delete-page').onclick=run(async()=>{if(!confirm('Delete this page?'))return; pending.delete(current.id); pageCache.delete(current.id); while(saving)await new Promise(r=>setTimeout(r,30)); await api('pages/'+current.id,'DELETE');pages=await api('pages');current=null;if(pages.length)await openPage(pages[0].id);else await newPage();});
}
function focusEnd(el) {el.focus(); const range=document.createRange();range.selectNodeContents(el);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);}
function insertBlock(after,type='paragraph',content=[]) {
 const wrapper=document.createElement('div');wrapper.innerHTML=blockHTML({id:uid(),type,content});const row=wrapper.firstElementChild;
 if(after)after.after(row);else $('#blocks').append(row); focusEnd(row.querySelector('.block-content'));scheduleSave(); return row;
}
function editorKey(e) {
 const el=e.target.closest('.block-content'); if(!el)return;
 if(menuState&&!$('#command-menu').hidden) {
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=[...$('#command-menu').querySelectorAll('button')];menuState.index=(menuState.index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items.forEach((b,i)=>b.classList.toggle('highlight',i===menuState.index));return;}
  if(e.key==='Enter'){e.preventDefault();$('#command-menu').querySelectorAll('button')[menuState.index]?.click();return;}
  if(e.key==='Escape'){e.preventDefault();hideMenu();return;}
 }
 if(e.key==='Enter'&&!e.shiftKey) {
  e.preventDefault();hideMenu();const row=el.closest('.block');
  const selection=getSelection(); const range=selection.getRangeAt(0);range.deleteContents();const tail=range.cloneRange();tail.setEnd(el,el.childNodes.length);const fragment=tail.extractContents();const temp=document.createElement('div');temp.append(fragment);
  const type=['bullet','todo'].includes(row.dataset.type)?row.dataset.type:'paragraph';
  if(!el.textContent&&type!=='paragraph'){setBlockType(row,'paragraph');return;}
  const next=insertBlock(row,type,readSegments(temp));const target=next.querySelector('.block-content');target.focus();const cursor=document.createRange();cursor.selectNodeContents(target);cursor.collapse(true);selection.removeAllRanges();selection.addRange(cursor);scheduleSave();
 }
 if(e.key==='Backspace'&&!el.textContent&&$('#blocks').children.length>1){e.preventDefault();const row=el.closest('.block');const target=row.previousElementSibling||row.nextElementSibling;row.remove();focusEnd(target.querySelector('.block-content'));scheduleSave();}
 if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();flush();}
}
const blockOptions=[['paragraph','Text','Plain text for your thoughts','T'],['heading1','Heading 1','A large section heading','H₁'],['heading2','Heading 2','A smaller section heading','H₂'],['bullet','Bullet list','A simple list of ideas','•'],['todo','To-do','Keep track of a task','☑'],['quote','Quote','Make a thought stand out','❝']];
function hideMenu(){$('#command-menu').hidden=true;menuState=null;}
function showMenu(row,items,onPick,heading) {
 const box=row.getBoundingClientRect(),menu=$('#command-menu');menu.innerHTML=`<div class="menu-label">${esc(heading)}</div>`+items.map((i,n)=>`<button class="${n===0?'highlight':''}" data-index="${n}"><span class="menu-icon">${esc(i.icon)}</span><span>${esc(i.title)}<small>${esc(i.detail||'')}</small></span></button>`).join('');
 menu.style.left=Math.max(8,Math.min(box.left+32,innerWidth-330))+'px';menu.style.top=Math.max(8,Math.min(box.bottom+5,innerHeight-370))+'px';menu.hidden=false;
 menuState={...menuState,index:0};menu.onmousedown=e=>e.preventDefault();menu.onclick=e=>{const b=e.target.closest('button');if(b)onPick(items[Number(b.dataset.index)]);};
}
function setBlockType(row,type,clear=false){const content=clear?[]:readSegments(row.querySelector('.block-content'));const wrapper=document.createElement('div');wrapper.innerHTML=blockHTML({id:row.dataset.id,type,content});const next=wrapper.firstElementChild;row.replaceWith(next);hideMenu();focusEnd(next.querySelector('.block-content'));scheduleSave();}
function showBlockMenu(row){menuState={kind:'block'};showMenu(row,[...blockOptions.map(([type,title,detail,icon])=>({type,title,detail,icon})),{type:'delete',title:'Delete block',icon:'×'}],item=>{if(item.type==='delete'){if($('#blocks').children.length>1)row.remove();else row.querySelector('.block-content').textContent='';hideMenu();scheduleSave();}else setBlockType(row,item.type);},'BLOCK OPTIONS');}
function detectMenu(el) {
 const selection=getSelection(); if(!selection.rangeCount)return hideMenu(); const range=selection.getRangeAt(0); if(!el.contains(range.startContainer))return hideMenu();
 const before=range.cloneRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);const text=before.toString();
 if(/^\/[^\n]*$/.test(el.textContent)) {
  const query=el.textContent.slice(1).toLowerCase();const items=blockOptions.filter(o=>o[1].toLowerCase().includes(query)).map(([type,title,detail,icon])=>({type,title,detail,icon}));if(!items.length)return hideMenu();
  menuState={kind:'slash'};showMenu(el.closest('.block'),items,item=>setBlockType(el.closest('.block'),item.type,true),'TURN INTO');return;
 }
 const match=text.match(/(?:^|\s)@([^@\n]*)$/);
 if(match&&range.startContainer.nodeType===3) {
  const query=match[1]; const mentionRange=range.cloneRange(); const start=range.startOffset-query.length-1;if(start<0)return hideMenu();mentionRange.setStart(range.startContainer,start);
  menuState={kind:'mention',range:mentionRange};
  const items=entities.filter(e=>e.name.toLowerCase().includes(query.toLowerCase())).slice(0,7).map(e=>({id:e.id,title:e.name,detail:labels[e.type],icon:icons[e.type]}));items.push({create:true,title:query?`Create “${query}”`:'Create a new entity',icon:'+'});
  showMenu(el.closest('.block'),items,item=>{const saved=menuState.range.cloneRange();hideMenu();if(item.create)openCreate(query,saved);else insertMention(saved,item.id);},'LINK AN ENTITY');return;
 }
 hideMenu();
}
function insertMention(range,id){range.deleteContents();const span=document.createElement('span');span.innerHTML=chip(id);const mention=span.firstElementChild;range.insertNode(mention);const space=document.createTextNode(' ');mention.after(space);range.setStartAfter(space);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);mention.closest('.block-content').focus();scheduleSave();}
let createRange=null;
function openCreate(name='',range=null){createRange=range;$('#create-form').reset();$('#create-form').elements.name.value=name;$('#create-dialog').showModal();$('#create-form').elements.name.focus();}
$('#new-entity').onclick=()=>openCreate();$('#cancel-create').onclick=()=>$('#create-dialog').close();
$('#create-form').onsubmit=run(async e=>{e.preventDefault();const form=e.target;const submit=form.querySelector('[type=submit]');submit.disabled=true;try{const result=await api('entities','POST',{name:form.elements.name.value,type:form.elements.type.value});entities=await api('entities');$('#create-dialog').close();if(createRange)insertMention(createRange,result.id);renderSidebar();if(view==='entities')renderEntities();await openEntity(result.id);}finally{submit.disabled=false;}});
async function newPage(){const p=await api('pages','POST',{title:'Untitled'});pages=await api('pages');await openPage(p.id);$('#page-title').focus();$('#page-title').select();}
$('#new-page').onclick=run(newPage);$('#pages-nav').onclick=run(async()=>{if(pages.length)await openPage(current?.id||pages[0].id);else await newPage();});
$('#page-list').onclick=run(async e=>{const b=e.target.closest('[data-page]');if(b)await openPage(b.dataset.page);});
$('#entities-nav').onclick=()=>{if(view==='pages'&&current)collect();view='entities';hideMenu();renderEntities();};
function renderEntities(){renderSidebar();$('#breadcrumb').innerHTML='<span>Workspace</span> <b>/</b> Knowledge entities';$('#content').innerHTML=`<section class="library"><div class="page-eyebrow">YOUR KNOWLEDGE, CONNECTED</div><h1>Knowledge entities<span>${entities.length}</span></h1><p>People, places, and ideas that live beyond a single page.</p><div class="library-tools"><input id="entity-search" placeholder="Search your knowledge…" aria-label="Search entities"><select id="type-filter" aria-label="Filter entity type"><option value="">All types</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div id="entity-grid"></div></section>`;$('#entity-search').oninput=renderGrid;$('#type-filter').onchange=renderGrid;renderGrid();}
function renderGrid(){const query=$('#entity-search').value.toLowerCase(),type=$('#type-filter').value;$('#entity-grid').innerHTML=entities.filter(e=>(!type||e.type===type)&&e.name.toLowerCase().includes(query)).map(e=>`<button class="entity-card" data-entity="${esc(e.id)}"><span class="entity-icon ${esc(e.type)}">${icons[e.type]}</span><small>${labels[e.type]}</small><h3>${esc(e.name)}</h3><p>${esc(e.description||'Add a description, properties, and connections.')}</p><span class="card-arrow">↗</span></button>`).join('')||'<p class="empty">No entities found. Create one to get started.</p>';$('#entity-grid').onclick=run(async e=>{const card=e.target.closest('[data-entity]');if(card)await openEntity(card.dataset.entity);});}
const entityOptions = (exclude) => entities.filter(e=>e.id!==exclude).map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
async function openEntity(id){const e=await api('entities/'+id);panelId=id;const panel=$('#entity-panel');panel.hidden=false;
 panel.innerHTML=`<div class="panel-top"><span>KNOWLEDGE ENTITY</span><button id="close-panel" title="Close entity" aria-label="Close entity">×</button></div><div class="panel-body"><span class="entity-icon large ${esc(e.type)}">${icons[e.type]}</span><form id="entity-form"><input name="name" class="entity-name" aria-label="Entity name" required value="${esc(e.name)}"><select name="type" aria-label="Entity type">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${e.type===k?'selected':''}>${v}</option>`).join('')}</select><textarea name="description" aria-label="Entity description" placeholder="Add a description…">${esc(e.description)}</textarea><button class="button small" type="submit">Save details</button><span id="entity-saved"></span></form><section class="panel-section"><h3>Properties <span>${e.properties.length}</span></h3><p class="section-hint">Describe this entity with values or entity references.</p><div class="property-list">${e.properties.map(p=>`<div class="property-row"><span>${esc(p.name)}</span><div>${p.target_id?chip(p.target_id):esc(p.value)}</div><button class="edit-item" data-edit-property="${esc(p.id)}" aria-label="Edit property">Edit</button><button class="remove" data-remove-property="${esc(p.id)}" aria-label="Remove property">×</button></div>`).join('')||'<div class="empty-small">No properties yet.</div>'}</div><form id="property-form" class="add-form"><input name="key" required placeholder="Property name" aria-label="Property name"><select name="kind" aria-label="Property value type"><option value="text">Text value</option><option value="entity">Entity reference</option></select><input name="value" placeholder="Value" aria-label="Property value"><select name="target" aria-label="Referenced entity" hidden>${entityOptions()}</select><button class="button small" type="submit">+ Add property</button></form></section><section class="panel-section"><h3>Relationships <span>${e.relationships.length}</span></h3><p class="section-hint">Named connections, independent of properties.</p>${e.relationships.map(r=>`<div class="relationship"><span class="relation-label">${r.source_id===id?'→ '+esc(r.label):'← '+esc(r.label)+' (incoming)'}</span>${chip(r.source_id===id?r.target_id:r.source_id)}${r.source_id===id?`<button class="edit-item" data-edit-relation="${esc(r.id)}" aria-label="Edit relationship">Edit</button><button class="remove" data-remove-relation="${esc(r.id)}" aria-label="Remove relationship">×</button>`:''}</div>`).join('')||'<div class="empty-small">No relationships yet.</div>'}<form id="relation-form" class="add-form"><input name="label" required placeholder="e.g. sibling, inspired by, member of" aria-label="Relationship name"><select name="target" required aria-label="Related entity"><option value="">Choose an entity…</option>${entityOptions(id)}</select><button class="button small">+ Add relationship</button></form></section>${e.incomingProperties.length?`<section class="panel-section"><h3>Referenced by</h3>${e.incomingProperties.map(p=>`<div class="backlink">${chip(p.entity_id)}<small>via ${esc(p.name)}</small></div>`).join('')}</section>`:''}<p class="panel-footnote">One entity. Many connections.<br>Changes are shared across your workspace.</p></div>`;
 $('#close-panel').onclick=()=>{panel.hidden=true;panelId=null;};
 $('#entity-form').onsubmit=run(async ev=>{ev.preventDefault();const f=ev.target;await api('entities/'+id,'PUT',{name:f.elements.name.value,type:f.elements.type.value,description:f.elements.description.value});entities=await api('entities');refreshMentions();if(view==='entities')renderGrid();$('#entity-saved').textContent=' Saved';});
 $('#property-form').elements.kind.onchange=ev=>{const f=ev.target.form;f.elements.value.hidden=ev.target.value==='entity';f.elements.target.hidden=ev.target.value!=='entity';};
 $('#property-form').onsubmit=run(async ev=>{ev.preventDefault();const f=ev.target;await api('entities/'+id+'/properties'+(f.dataset.edit?'/'+f.dataset.edit:''),f.dataset.edit?'PUT':'POST',{name:f.elements.key.value,...(f.elements.kind.value==='entity'?{target_id:f.elements.target.value}:{value:f.elements.value.value})});await openEntity(id);});
 $('#relation-form').onsubmit=run(async ev=>{ev.preventDefault();const f=ev.target;await api('entities/'+id+'/relationships'+(f.dataset.edit?'/'+f.dataset.edit:''),f.dataset.edit?'PUT':'POST',{label:f.elements.label.value,target_id:f.elements.target.value});await openEntity(id);});
 panel.onclick=run(async ev=>{
 const editProperty=ev.target.closest('[data-edit-property]');
 if(editProperty){const p=e.properties.find(p=>p.id===editProperty.dataset.editProperty),f=$('#property-form');f.dataset.edit=p.id;f.elements.key.value=p.name;f.elements.kind.value=p.target_id?'entity':'text';f.elements.value.value=p.value||'';if(p.target_id)f.elements.target.value=p.target_id;f.elements.value.hidden=!!p.target_id;f.elements.target.hidden=!p.target_id;f.querySelector('button').textContent='Save property';f.elements.key.focus();return;}
 const editRelation=ev.target.closest('[data-edit-relation]');
 if(editRelation){const r=e.relationships.find(r=>r.id===editRelation.dataset.editRelation),f=$('#relation-form');f.dataset.edit=r.id;f.elements.label.value=r.label;f.elements.target.value=r.target_id;f.querySelector('button').textContent='Save relationship';f.elements.label.focus();return;}
 const mention=ev.target.closest('[data-entity]');if(mention)return openEntity(mention.dataset.entity);const p=ev.target.closest('[data-remove-property]');const r=ev.target.closest('[data-remove-relation]');if(p||r){await api('entities/'+id+'/'+(p?'properties/'+p.dataset.removeProperty:'relationships/'+r.dataset.removeRelation),'DELETE');await openEntity(id);}});
}
function refreshMentions(){document.querySelectorAll('.mention').forEach(el=>{const e=getEntity(el.dataset.entity);if(e){el.textContent=icons[e.type]+' '+e.name;el.className='mention '+e.type;}});}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideMenu();if(!$('#create-dialog').open)$('#entity-panel').hidden=true;}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.mention')){e.preventDefault();openEntity(e.target.dataset.entity).catch(error);}});
document.addEventListener('mousedown',e=>{if(!e.target.closest('#command-menu')&&!e.target.closest('.block'))hideMenu();});
async function init(){[pages,entities]=await Promise.all([api('pages'),api('entities')]);if(pages.length)await openPage(pages[0].id);else await newPage();}
init().catch(error);
