import type {SmartRuleDefinition,SmartRuleNode,SmartRulePredicate} from '../../shared/smart-collections.js';
import {parseSmartRule} from '../../shared/smart-collections.js';
import {Store} from '../store.js';
import {HttpError} from '../validation.js';

export interface SmartRuleResult {item_id:string;title:string;matched:boolean;evidence:string[]}
interface Candidate {id:string;title:string;language:string|null;created_at:string;updated_at:string}

/** Reference existence is checked independently of match evaluation, including under NONE. */
export function validateRuleReferences(store:Store,vault:string,definition:SmartRuleDefinition):void {
  const visit=(node:SmartRuleNode)=>{
    if('op' in node){node.children.forEach(visit);return;}
    let exists=true;
    if(node.field==='folder')exists=!!store.get('SELECT id FROM folders WHERE vault_id=? AND id=?',vault,node.value);
    if(node.field==='entity')exists=!!store.get('SELECT id FROM entities WHERE vault_id=? AND id=? AND archived_at IS NULL AND inactive=0',vault,node.value);
    if(node.field==='subject')exists=!!store.get('SELECT id FROM domains WHERE id=?',node.value);
    if(!exists)throw new HttpError(400,`The ${node.field} rule references an unavailable item.`);
  };
  visit(parseSmartRule(definition).root);
}

/** Select a bounded page batch before evaluating predicates. Never scans page content vault-wide. */
export function evaluateSmartRule(store:Store,vault:string,definition:SmartRuleDefinition,after:string,limit:number,itemIds?:string[]):{items:SmartRuleResult[];hasMore:boolean} {
  if(!Number.isSafeInteger(limit)||limit<1||limit>250)throw new HttpError(400,'Rule batches must contain 1–250 pages.');
  const rule=parseSmartRule(definition);
  validateRuleReferences(store,vault,rule);
  if(itemIds!==undefined&&(!Array.isArray(itemIds)||itemIds.length>250||itemIds.some(id=>typeof id!=='string'||!id||id.length>500)))throw new HttpError(400,'Invalid rule candidate IDs.');
  if(itemIds?.length===0)return {items:[],hasMore:false};
  const candidates=store.all<Candidate>(`SELECT id,title,language,created_at,updated_at FROM pages
    WHERE vault_id=? AND deleted_at IS NULL AND archived_at IS NULL AND id>? ${itemIds?'AND id IN ('+itemIds.map(()=>'?').join(',')+')':''} ORDER BY id LIMIT ?`,vault,after,...(itemIds??[]),limit+1);
  const hasMore=candidates.length>limit;
  const has=(sql:string,...values:(string|number)[])=>!!store.get(sql,...values);
  const label=(node:SmartRulePredicate):string=>{
    const value=String(node.value);
    if(node.field==='subject')return `Subject ${node.role&&node.role!=='any'?`(${node.role}) `:''}${node.operator==='within'?'is within':'is'} ${store.get<{label:string}>('SELECT label FROM domains WHERE id=?',value)?.label??value}`;
    if(node.field==='folder')return `Folder ${node.operator==='within'?'is within':'is'} ${store.get<{name:string}>('SELECT name FROM folders WHERE vault_id=? AND id=?',vault,value)?.name??value}`;
    if(node.field==='entity')return `${node.operator==='mentions'?'Mentions':'Associated with'} ${store.get<{name:string}>('SELECT name FROM entities WHERE vault_id=? AND id=?',vault,value)?.name??value}`;
    if(node.field==='reading_note')return node.value?'Is a reading note':'Is not a reading note';
    if(node.field==='unfiled')return node.value?'Is unfiled':'Has a folder';
    if(node.field==='favourite')return node.value?'Is a favourite':'Is not a favourite';
    return `${node.field==='created_at'?'Created':node.field==='updated_at'?'Modified':node.field==='title'?'Title':'Language'} ${node.operator} ${value}`;
  };
  const describe=(node:SmartRuleNode):string=>'op' in node?`${node.op.toUpperCase()} (${node.children.map(describe).join('; ')})`:label(node);
  const leaf=(node:SmartRulePredicate,page:Candidate):boolean=>{
    const value=String(node.value);
    switch(node.field) {
      case 'title':return node.operator==='equals'?page.title.toLocaleLowerCase()===value.toLocaleLowerCase():page.title.toLocaleLowerCase().includes(value.toLocaleLowerCase());
      case 'language':return page.language?.toLowerCase()===value.toLowerCase();
      case 'created_at':case 'updated_at':return node.operator==='before'?Date.parse(page[node.field])<Date.parse(value):Date.parse(page[node.field])>Date.parse(value);
      case 'favourite':return has("SELECT 1 FROM favourites WHERE vault_id=? AND kind='page' AND item_id=?",vault,page.id)===node.value;
      case 'reading_note':return has('SELECT 1 FROM page_reading_notes WHERE vault_id=? AND page_id=?',vault,page.id)===node.value;
      case 'unfiled':return !has("SELECT 1 FROM item_locations WHERE vault_id=? AND kind='page' AND item_id=? AND folder_id IS NOT NULL",vault,page.id)===node.value;
      case 'folder':return node.operator==='is'
        ?has("SELECT 1 FROM item_locations WHERE vault_id=? AND kind='page' AND item_id=? AND folder_id=?",vault,page.id,value)
        :has(`WITH RECURSIVE ancestors(id,parent_id) AS (
          SELECT f.id,f.parent_id FROM item_locations l JOIN folders f ON f.id=l.folder_id AND f.vault_id=l.vault_id WHERE l.vault_id=? AND l.kind='page' AND l.item_id=?
          UNION SELECT f.id,f.parent_id FROM folders f JOIN ancestors a ON f.id=a.parent_id WHERE f.vault_id=?
        ) SELECT 1 FROM ancestors WHERE id=?`,vault,page.id,vault,value);
      case 'subject': {
        const role=node.role??'any';
        return node.operator==='is'
          ?has('SELECT 1 FROM page_domains WHERE page_id=? AND domain_id=? AND (?=\'any\' OR role=?)',page.id,value,role,role)
          :has(`WITH RECURSIVE ancestors(id,parent_id) AS (
            SELECT d.id,d.parent_id FROM page_domains p JOIN domains d ON d.id=p.domain_id WHERE p.page_id=? AND (?='any' OR p.role=?)
            UNION SELECT d.id,d.parent_id FROM domains d JOIN ancestors a ON d.id=a.parent_id
          ) SELECT 1 FROM ancestors WHERE id=?`,page.id,role,role,value);
      }
      case 'entity':return node.operator==='associated'
        ?has(`SELECT 1 FROM entity_page_associations a JOIN entities e ON e.id=a.entity_id WHERE a.page_id=? AND a.entity_id=? AND e.vault_id=? AND e.archived_at IS NULL AND e.inactive=0`,page.id,value,vault)
        :has(`SELECT 1 FROM pages p,json_tree(p.blocks) j JOIN entities e ON e.id=j.value
          WHERE p.id=? AND p.vault_id=? AND j.key='entityId' AND j.type='text' AND j.value=? AND e.vault_id=? AND e.archived_at IS NULL AND e.inactive=0 LIMIT 1`,page.id,vault,value,vault);
    }
  };
  const evaluate=(node:SmartRuleNode,page:Candidate):{matched:boolean;evidence:string[]}=>{
    if(!('op' in node)){const matched=leaf(node,page);return {matched,evidence:matched?[label(node)]:[]};}
    const children=node.children.map(child=>evaluate(child,page));
    const matched=node.op==='all'?children.every(child=>child.matched):node.op==='any'?children.some(child=>child.matched):children.every(child=>!child.matched);
    return {matched,evidence:!matched?[]:node.op==='none'?[`None matched: ${node.children.map(describe).join('; ')}`]:children.filter(child=>child.matched).flatMap(child=>child.evidence)};
  };
  return {hasMore,items:candidates.slice(0,limit).map(page=>({item_id:page.id,title:page.title,...evaluate(rule.root,page)}))};
}
