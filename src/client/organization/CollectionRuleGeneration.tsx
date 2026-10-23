import {useEffect,useState} from 'react';
import type {Domain,Entity,Organization} from '../../shared/domain';
import type {RuleNode} from '../../shared/smart-collections';
import {RuleEditor,nodeCount} from './CollectionRuleEditor';
import {useCollectionRuleGeneration} from './useCollectionRuleGeneration';
import {useSmartCollectionPreview} from './useSmartCollectionPreview';

interface Preview {items:{item_id:string;title:string;matched:boolean}[];evaluated:number;matched:number;hasMore:boolean}
export function CollectionRuleGeneration({vaultId,data,domains,entities,enabled,onApply,onPending}:{vaultId:string;data:Organization;domains:Domain[];entities:Entity[];enabled:boolean;onApply:(root:RuleNode)=>void;onPending:(pending:boolean)=>void}) {
  const [prompt,setPrompt]=useState(''),[draft,setDraft]=useState<RuleNode|null>(null);
  const generation=useCollectionRuleGeneration(vaultId,prompt,enabled);
  useEffect(()=>{setDraft(generation.result?.rule.root??null);},[generation.result]);
  const currentDraft=generation.result?draft:null;
  useEffect(()=>{onPending(generation.loading||!!currentDraft);return()=>onPending(false);},[generation.loading,currentDraft,onPending]);
  const preview=useSmartCollectionPreview<Preview>(vaultId,{version:1,root:currentDraft},!!currentDraft&&enabled);
  return <details className="collection-rule-generation"><summary>Describe rules in natural language</summary><label>Describe rule conditions<textarea aria-label="Describe rule conditions" maxLength={2000} rows={3} value={prompt} onChange={event=>setPrompt(event.target.value)}/></label><p>Generate an editable draft using your configured AI provider. Nothing is saved until you review and use the rules.</p><button type="button" className="button" disabled={!prompt.trim()||generation.loading} onClick={()=>void generation.generate()}>{generation.loading?'Generating rules…':'Generate editable rules'}</button>
    {generation.error&&<p role="alert">{generation.error}</p>}
    {currentDraft&&<section className="generated-rule-draft"><h3>Generated rule draft · Review before use</h3>{generation.result?.warnings?.map((warning,index)=><p key={index}>{warning}</p>)}<RuleEditor node={currentDraft} onChange={setDraft} data={data} domains={domains} entities={entities} canAdd={nodeCount(currentDraft)<60}/><section aria-live="polite" aria-busy={preview.loading}><h4>Generated-rule preview</h4>{preview.loading?<p>Checking a bounded sample…</p>:preview.error?<p role="alert">{preview.error}</p>:preview.result&&<><p>{preview.result.matched} matching pages among {preview.result.evaluated} evaluated{preview.result.hasMore?' · More pages have not been evaluated.':'.'}</p><ul>{preview.result.items.filter(item=>item.matched).slice(0,5).map(item=><li key={item.item_id}>{item.title||'Untitled'}</li>)}</ul></>}</section><div className="smart-rule-actions"><button type="button" className="button primary" disabled={preview.loading||!!preview.error||!preview.result} onClick={()=>{onApply(currentDraft);setDraft(null);}}>Use these rules</button><button type="button" className="button" onClick={()=>setDraft(null)}>Discard generated draft</button></div></section>}
  </details>;
}
