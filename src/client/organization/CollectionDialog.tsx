import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {Collection,Domain,Entity,Organization,PageSummary} from '../../shared/domain';
import {api} from '../api';
import {Modal,ModalHeader} from '../components/Modal';
import {Select} from '../components/Select';
import {useSemanticCollectionPreview} from './useSemanticCollectionPreview';
import {useSmartCollectionPreview} from './useSmartCollectionPreview';
import {RuleEditor,initialRule,nodeCount} from './CollectionRuleEditor';
import {parseSmartRule,type RuleNode} from '../../shared/smart-collections';
import type {ExampleCollectionDefinition} from '../../shared/example-collections';
import {useExampleCollectionPreview} from './useExampleCollectionPreview';
import {CollectionRuleGeneration} from './CollectionRuleGeneration';
import {collectionDefinitionUnchanged} from './collection-draft';
import {CollectionExamplePicker} from './CollectionExamplePicker';
import {t as uiText} from '../i18n';
import {Icon} from '../components/Icon';

interface Preview {items:{item_id:string;title:string;matched:boolean;evidence:string[];state?:string}[];evaluated:number;matched:number;hasMore:boolean;unevaluated?:number;errors?:number}
type Matching='rules'|'semantic'|'hybrid'|'examples';
export function CollectionDialog({vaultId,data,pages=[],collection,onChanged,onClose,inline=false,initialKind='manual',onBusyChange}:{vaultId:string;data:Organization;pages?:PageSummary[];collection?:Collection;onChanged:(data:Organization)=>void;onClose:()=>void;inline?:boolean;initialKind?:'manual'|'smart';onBusyChange?:(busy:boolean)=>void}) {
  const active=useRef(true),currentVault=useRef(vaultId);currentVault.current=vaultId;
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const [name,setName]=useState(collection?.name??''),[kind,setKind]=useState<'manual'|'smart'>(collection?.kind??initialKind);
  const [method,setMethod]=useState<Matching>(collection?.matching??'rules');
  const [humanDescription,setHumanDescription]=useState(collection?.description??'');
  const [description,setDescription]=useState(collection?.semantic?.description??'');
  const [root,setRoot]=useState<RuleNode>(collection?.rule?.root??initialRule());
  const [examples,setExamples]=useState<ExampleCollectionDefinition>(collection?.examples??{version:1,positivePageIds:[],negativePageIds:[],threshold:0.55,minCoverage:0.5,negativeMargin:0.05});
  const [generatedPending,setGeneratedPending]=useState(false);
  const [domains,setDomains]=useState<Domain[]>([]),[entities,setEntities]=useState<Entity[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[choicesError,setChoicesError]=useState('');
  useEffect(()=>{if(kind!=='smart')return;let active=true;const controller=new AbortController();void Promise.all([api.domains(),api.entities(vaultId,controller.signal)]).then(([taxonomy,entities])=>{if(active){setDomains(taxonomy.domains);setEntities(entities);}}).catch(()=>{if(active&&!controller.signal.aborted)setChoicesError('Subject and entity choices could not be loaded. Reopen the collection to retry.');});return()=>{active=false;controller.abort();};},[vaultId,kind]);
  const rule={version:1 as const,root};
  const semanticMode=method==='semantic'||method==='hybrid',ruleMode=method==='rules'||method==='hybrid';
  let ruleValid=true;try{if(ruleMode)parseSmartRule(rule);}catch{ruleValid=false;}
  const rulePreview=useSmartCollectionPreview<Preview>(vaultId,rule,kind==='smart'&&method==='rules'&&!generatedPending);
  const semanticPreview=useSemanticCollectionPreview<Preview>(vaultId,description,kind==='smart'&&semanticMode&&(!ruleMode||ruleValid),{collectionId:collection?.semantic?collection.id:undefined,savedDescription:collection?.semantic?.description,threshold:collection?.semantic?.threshold,minCoverage:collection?.semantic?.minCoverage,...(method==='hybrid'?{rule}:{})});
  const examplePreview=useExampleCollectionPreview<Preview>(vaultId,examples,kind==='smart'&&method==='examples',collection?.examples);
  const preview=semanticMode?semanticPreview:method==='examples'?examplePreview:rulePreview;
  const semanticDefinition={version:1 as const,description,threshold:collection?.semantic?.threshold??0.55,minCoverage:collection?.semantic?.minCoverage??0.5};
  const metadataOnly=collectionDefinitionUnchanged(collection,{kind,matching:method,rule,semantic:semanticDefinition,examples});
  const automaticInvalid=generatedPending||!!preview.error||ruleMode&&!ruleValid||semanticMode&&(!description.trim()||!semanticPreview.canSave||semanticPreview.loading)||method==='examples'&&(!examplePreview.canSave||examplePreview.loading);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy||generatedPending||kind==='smart'&&!metadataOnly&&automaticInvalid)return;
    setBusy(true);onBusyChange?.(true);setError('');
    const definition=kind==='manual'?{}:method==='examples'?{matching:method,examples}:{matching:method,...(ruleMode?{rule}:{}),...(semanticMode?{semantic:{version:1,description,threshold:collection?.semantic?.threshold??0.55,minCoverage:collection?.semantic?.minCoverage??0.5},...(semanticPreview.evaluationToken?{evaluationToken:semanticPreview.evaluationToken}:{})}:{})};
    try{const result=await api.organize(vaultId,'collections'+(collection?'/'+collection.id:''),{name,description:humanDescription,...(metadataOnly?{}:{kind,...definition})},collection?'PUT':'POST');if(active.current&&currentVault.current===vaultId){onChanged(result);onClose();}}
    catch(error){if(active.current&&currentVault.current===vaultId)setError(error instanceof Error?error.message:'Could not save collection.');}
    finally{if(active.current&&currentVault.current===vaultId){setBusy(false);onBusyChange?.(false);}}
  }
  const title=collection?'Edit collection':inline?(kind==='smart'?'Create Smart Collection':'Add collection'):'New collection';
  const form=<form onSubmit={submit}>{inline?<header className="collection-create-heading"><h2>{uiText(title)}</h2><button type="button" className="modal-close" disabled={busy} aria-label={uiText('Back')} onClick={onClose}><Icon name="chevron"/></button></header>:<ModalHeader titleId="collection-definition-title" closeDisabled={busy}>{uiText(title)}</ModalHeader>}<fieldset disabled={busy} className="smart-collection-fields"><label>{uiText('Name')}<input autoFocus required maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><label className="container-description-field">Description <small>Optional</small><textarea aria-label="Description" value={humanDescription} maxLength={2000} rows={2} placeholder="What is this collection for?" onChange={e=>setHumanDescription(e.target.value)}/></label>{!inline&&<label>Collection type<Select value={kind} onChange={e=>setKind(e.target.value as 'manual'|'smart')}><option value="manual">Manual collection</option><option value="smart">Smart collection</option></Select></label>}
    {kind==='smart'&&<label>Matching method<Select value={method} onChange={e=>setMethod(e.target.value as Matching)}><option value="rules">Rules</option><option value="semantic">Semantic matching</option><option value="hybrid">Rules + semantic matching</option><option value="examples">Example matching</option></Select></label>}
    <p>{kind==='smart'?'Matching pages appear automatically. Explicit inclusions, exclusions and linked folders are preserved. Pages keep their physical folders.':'Choose memberships and link folders without moving content.'}</p>
    {kind==='smart'&&<>
      {ruleMode&&<>{method==='hybrid'&&<><h3>Eligibility rules</h3><p>Only pages that satisfy these rules are considered for semantic matching.</p></>}{choicesError&&<p role="alert">{choicesError}</p>}<RuleEditor node={root} onChange={setRoot} data={data} domains={domains} entities={entities} canAdd={nodeCount(root)<60}/><CollectionRuleGeneration vaultId={vaultId} data={data} domains={domains} entities={entities} enabled={kind==='smart'&&ruleMode} onApply={setRoot} onPending={setGeneratedPending}/></>}
      {semanticMode&&<><label>Matching description<textarea aria-label="Matching description" value={description} maxLength={2000} rows={5} placeholder="Describe the ideas and themes that belong here…" onChange={e=>setDescription(e.target.value)}/></label><p>Evaluate this description against existing indexed passages{method==='hybrid'?' from eligible pages':''}. Evaluate may contact your configured embedding provider. Typing does not make provider calls or index missing pages.</p><button type="button" className="button" disabled={!description.trim()||semanticPreview.loading||method==='hybrid'&&!ruleValid||generatedPending} onClick={()=>void semanticPreview.evaluate()}>{semanticPreview.loading?'Evaluating description…':'Evaluate description'}</button>{method==='hybrid'&&!ruleValid&&<p>Complete the eligibility rules before evaluation.</p>}{semanticPreview.stale&&<p role="status">Definition changed. The preview needs to be updated.</p>}</>}
      {method==='examples'&&<><CollectionExamplePicker pages={pages} examples={examples} onChange={setExamples}/><button type="button" className="button" disabled={examples.positivePageIds.length<2||examplePreview.loading} onClick={()=>void examplePreview.evaluate()}>{examplePreview.loading?'Evaluating examples…':'Evaluate examples'}</button></>}
      {!generatedPending&&<section className="smart-collection-preview" aria-live="polite" aria-busy={preview.loading}><h3>Live preview</h3>{preview.loading?<p>{semanticMode?'Evaluating description against indexed content…':method==='examples'?'Evaluating saved example indexes…':'Checking a bounded sample…'}</p>:preview.error?<p role="alert">{preview.error}</p>:preview.result&&<><p>{preview.result.matched} matching pages among {preview.result.evaluated} evaluated{preview.result.hasMore?' · More pages have not been evaluated. This is a lower bound, not a vault total.':'.'}</p>{method!=='rules'&&<p>{preview.result.unevaluated??0} pages await a complete, current index. {preview.result.errors??0} indexing or evaluation errors. Gaps are not confirmed non-matches.</p>}<ul>{preview.result.items.filter(item=>item.matched).slice(0,8).map(item=><li key={item.item_id}>{item.title||'Untitled'}<small>{item.state&&item.state!=='evaluated'?item.state+' · ':''}{item.evidence.join(' · ')}</small></li>)}</ul></>}{method!=='rules'&&!preview.loading&&!preview.result&&!preview.error&&<p>Not yet evaluated. Choose {method==='examples'?'Evaluate examples':'Evaluate description'} to preview existing indexed content.</p>}</section>}
      {semanticMode&&!metadataOnly&&!semanticPreview.canSave&&<p>Evaluate this description before saving. Saved descriptions reuse their embedding when unchanged.</p>}{method==='examples'&&!metadataOnly&&!examplePreview.canSave&&<p>Evaluate these examples before saving. Unavailable or unrelated examples must be replaced before matching can proceed.</p>}
    </>}
    </fieldset>{error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button" type="button" disabled={busy} onClick={onClose}>{uiText('Cancel')}</button><button className="button primary" disabled={busy||!name.trim()||generatedPending||kind==='smart'&&!metadataOnly&&automaticInvalid}>{uiText(busy?'Saving…':inline?'Create collection':'Save collection')}</button></div></form>;
  return inline?form:<Modal className="collection-definition-dialog" titleId="collection-definition-title" onClose={()=>{if(!busy)onClose();}}>{form}</Modal>;
}
