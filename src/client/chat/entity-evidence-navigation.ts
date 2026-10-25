/** Reveal a validated record identity without entering an editor or changing data. */
export function revealEntityFact(root:HTMLElement,factId:string):boolean {
 const relation=factId.startsWith('relationship:'),property=factId.startsWith('property:');
 const home=root.classList.contains('entity-home'),tab=relation?'connections':'overview';
 const tabButton=document.getElementById(`${home?'entity-home-tab-':'entity-tab-'}${tab}`);
 if(tabButton?.getAttribute('aria-selected')!=='true'){tabButton?.click();return false;}
 const selector=relation?`[data-relationship-id="${CSS.escape(factId.slice(13))}"]`:property?`[data-property-id="${CSS.escape(factId.slice(9))}"]`:factId==='description'?'[data-entity-description]':'[data-entity-overview]';
 const candidates=Array.from(root.querySelectorAll<HTMLElement>(selector));
 // Full property details preserve long values that the glance list abbreviates.
 const target=candidates.find(item=>item.classList.contains('entity-property-card'))??candidates[0];
 if(!target)return false;
 for(let parent:HTMLElement|null=target.parentElement;parent&&parent!==root;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
 target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'instant'});
 return true;
}
