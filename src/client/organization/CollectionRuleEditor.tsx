import type {Domain,Entity,Organization} from '../../shared/domain';
import type {RuleNode} from '../../shared/smart-collections';
import {Select} from '../components/Select';
type Predicate=Exclude<RuleNode,{children:RuleNode[]}>;
type Field=Predicate['field'];
const fields:[Field,string][]=[['title','Title'],['created_at','Created'],['updated_at','Last modified'],['language','Language'],['favourite','Favourite'],['reading_note','Reading note'],['unfiled','Unfiled'],['folder','Folder'],['subject','Subject'],['entity','Knowledge entity']];
export const initialRule=():RuleNode=>({op:'all',children:[{field:'title',operator:'contains',value:''}]});
function predicate(field:Field):RuleNode {
  if(field==='favourite'||field==='reading_note'||field==='unfiled')return {field,operator:'is',value:true};
  if(field==='folder')return {field,operator:'within',value:''};
  if(field==='subject')return {field,operator:'within',value:'',role:'any'};
  if(field==='entity')return {field,operator:'mentions',value:''};
  if(field==='created_at'||field==='updated_at')return {field,operator:'after',value:new Date().toISOString()};
  if(field==='title')return {field,operator:'contains',value:''};
  return {field,operator:'equals',value:''};
}
export function nodeCount(node:RuleNode):number{return 'children' in node?1+node.children.reduce((n,c)=>n+nodeCount(c),0):1;}

export function RuleEditor({node,onChange,data,domains,entities,depth=0,canAdd}:{node:RuleNode;onChange:(node:RuleNode)=>void;data:Organization;domains:Domain[];entities:Entity[];depth?:number;canAdd:boolean}) {
  if('children' in node)return <fieldset className="smart-rule-group"><legend>Match <Select aria-label="Group matching" value={node.op} onChange={e=>onChange({...node,op:e.target.value as typeof node.op})}><option value="all">ALL</option><option value="any">ANY</option><option value="none">NONE</option></Select> of these conditions</legend>
    {node.children.map((child,index)=><div className="smart-rule-child" key={index}><RuleEditor node={child} onChange={next=>onChange({...node,children:node.children.map((value,i)=>i===index?next:value)})} data={data} domains={domains} entities={entities} depth={depth+1} canAdd={canAdd}/><button type="button" aria-label="Remove condition" disabled={node.children.length===1} onClick={()=>onChange({...node,children:node.children.filter((_,i)=>i!==index)})}>Remove</button></div>)}
    <div className="smart-rule-actions"><button type="button" disabled={!canAdd||node.children.length>=16} onClick={()=>onChange({...node,children:[...node.children,predicate('title')]})}>Add condition</button><button type="button" disabled={!canAdd||node.children.length>=16||depth>=3} onClick={()=>onChange({...node,children:[...node.children,initialRule()]})}>Add group</button></div>
  </fieldset>;
  const choices=node.field==='folder'?data.folders.map(f=>({id:f.id,name:f.name})):node.field==='subject'?domains.map(d=>({id:d.id,name:d.label})):node.field==='entity'?entities.filter(e=>!e.archived_at&&!e.inactive).map(e=>({id:e.id,name:e.name})):null;
  const operators=node.field==='title'?['contains','equals']:node.field==='created_at'||node.field==='updated_at'?['before','after']:node.field==='folder'||node.field==='subject'?['is','within']:node.field==='entity'?['mentions','associated']:[node.operator];
  const boolean=typeof node.value==='boolean';
  return <div className="smart-rule-predicate"><Select aria-label="Condition field" value={node.field} onChange={e=>onChange(predicate(e.target.value as Field))}>{fields.map(([value,label])=><option value={value} key={value}>{label}</option>)}</Select><Select aria-label="Condition operator" value={node.operator} onChange={e=>onChange({...node,operator:e.target.value} as RuleNode)}>{operators.map(operator=><option key={operator}>{operator}</option>)}</Select>
    {boolean?<Select aria-label="Condition value" value={String(node.value)} onChange={e=>onChange({...node,value:e.target.value==='true'} as RuleNode)}><option value="true">Yes</option><option value="false">No</option></Select>:choices?<Select aria-label="Condition value" value={String(node.value)} onChange={e=>onChange({...node,value:e.target.value} as RuleNode)}><option value="">Choose…</option>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.name}</option>)}</Select>:<input aria-label="Condition value" required type={node.field.endsWith('_at')?'date':'text'} value={node.field.endsWith('_at')?String(node.value).slice(0,10):String(node.value)} maxLength={500} onChange={e=>onChange({...node,value:node.field.endsWith('_at')&&e.target.value?e.target.value+'T00:00:00.000Z':e.target.value} as RuleNode)}/>}
    {node.field==='subject'&&<Select aria-label="Subject role" value={node.role??'any'} onChange={e=>onChange({...node,role:e.target.value} as RuleNode)}><option value="any">Any Subject</option><option value="primary">Primary Subject</option><option value="secondary">Secondary Subject</option></Select>}
  </div>;
}
