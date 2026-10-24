import {SuccessNotice,useSuccessNotice} from '../components/SuccessNotice';
import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import {formatEstimatedUSD,isUnpaidActivity} from '../../shared/ai-pricing';
import {AIPricingNote} from './AIPricingNote';
import { AIActivityUsage } from './AIActivityUsage';
import { AIActivityDebug } from './AIActivityDebug';
import { useEffect, useRef, useState } from 'react';
import { aiActivityLabels, type AIActivity, type AIActivityPage } from '../../shared/intelligence';
import { Modal, ModalHeader } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../api';

export function AIActivityLog({onOpenPage, onClose}: {onClose: () => void; onOpenPage: (vaultId: string, pageId: string) => Promise<void>}) {
  const [excludeUnpaid,setExcludeUnpaid]=useState(false);
  const [view,setView]=useState<'log'|'usage'>('log');
  const [debugId,setDebugId]=useState<string|null>(null);
  const autoRefresh=useRef(true);
  const [confirmClear,setConfirmClear]=useState(false);
  const [message,setMessage,messageOccurrence]=useSuccessNotice();
  const [data,setData]=useState<AIActivityPage>({items:[],nextCursor:null});
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    if(view!=='log')return;
    let active=true,sequence=0;
    async function refresh() {
      if(!autoRefresh.current)return;
      const version=++sequence;
      try {const result=await api.aiActivity();if(active&&version===sequence){setData(result);setError('');}}
      catch(error){if(active&&version===sequence)setError(error instanceof Error?error.message:'Could not load activity.');}
      finally{if(active&&version===sequence)setBusy(false);}
    }
    const changed=()=>{void refresh();};
    void refresh();
    window.addEventListener('noema:ai-activity',changed);
    const timer=setInterval(changed,1000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('noema:ai-activity',changed);};
  },[view]);
  async function load(cursor?:number) {
    autoRefresh.current=cursor===undefined;
    setBusy(true);setError('');setMessage('');
    try {const result=await api.aiActivity(cursor);setData(current=>cursor?{...result,items:[...current.items,...result.items.filter(item=>!current.items.some(old=>old.id===item.id))]}:result);}
    catch(error){setError(error instanceof Error?error.message:'Could not load activity.');}
    finally{setBusy(false);}
  }
  async function open(item:AIActivity) {
    try {await onOpenPage(item.vaultId!,item.objectId!);}
    catch(error){setError(error instanceof Error?error.message:'Could not open page.');}
  }
  async function exportCSV() {
    setBusy(true);setError('');setMessage('');
    try {
      const items:AIActivity[]=[];
      let cursor:number|undefined;
      do {
        const page=await api.aiActivity(cursor);
        items.push(...page.items.filter(item=>!excludeUnpaid||!isUnpaidActivity(item)));cursor=page.nextCursor??undefined;
      } while(cursor!==undefined);
      const fields: (keyof AIActivity)[]=['id','action','status','startedAt','finishedAt','vaultId','vaultName','objectKind','objectId','objectTitle','revision','model','reasoningEffort','promptBytes','inputTokens','cachedInputTokens','cacheWriteTokens','outputTokens','reasoningTokens','estimatedCost','pricingVersion','durationMs','httpStatus'];
      const cell=(value:unknown)=>{
        const text=String(value??'');
        return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';
      };
      const csv=[fields.map(cell).join(','),...items.map(item=>fields.map(field=>cell(item[field])).join(','))].join('\r\n');
      const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='noema-ai-activity-'+new Date().toISOString().slice(0,10)+'.csv';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage(`Exported ${items.length} activity records.`);
    }catch(error){setError(error instanceof Error?error.message:'Could not export activity.');}
    finally{setBusy(false);}
  }
  const visibleItems=excludeUnpaid?data.items.filter(item=>!isUnpaidActivity(item)):data.items;
  if(debugId)return <AIActivityDebug id={debugId} onClose={()=>setDebugId(null)}/>;
  if(confirmClear) return <ConfirmDialog danger title={uiText("Clear AI activity?")} description={uiText("Delete all activity and debug traces for unlocked vaults. Running requests continue.")} action={uiText("Clear activity")} onClose={()=>setConfirmClear(false)} onConfirm={async()=>{await api.clearAIActivity();setData({items:[],nextCursor:null});setMessage('Activity cleared.');}}/>;
  return <Modal className="ai-activity-modal" titleId="ai-activity-heading" onClose={onClose}>
    <ModalHeader titleId="ai-activity-heading">{uiText("AI activity log")}</ModalHeader>
    <div className="settings-tabs ai-activity-views" role="tablist" aria-label={uiText("AI activity views")}>
      {([{id:'log',label:uiText("Activity log")},{id:'usage',label:uiText("Token usage")}] as const).map(tab=><button key={tab.id} type="button" id={'ai-activity-tab-'+tab.id} role="tab" aria-selected={view===tab.id} aria-controls="ai-activity-panel" tabIndex={view===tab.id?0:-1} onClick={()=>setView(tab.id)} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const next=event.key==='Home'?'log':event.key==='End'?'usage':view==='log'?'usage':'log';
        setView(next);document.getElementById('ai-activity-tab-'+next)?.focus();
      }}>{tab.label}</button>)}
    </div>
    <label className="embedding-toggle"><input type="checkbox" checked={excludeUnpaid} onChange={event=>setExcludeUnpaid(event.target.checked)}/><span>{uiText("Exclude unpaid activity (Kokoro and DOI metadata lookups)")}</span></label>
    <div id="ai-activity-panel" role="tabpanel" aria-labelledby={'ai-activity-tab-'+view} tabIndex={0}>
    {view==='usage'?<AIActivityUsage excludeUnpaid={excludeUnpaid}/>:<>
    <p className="ai-activity-description">{uiText("Activity and token usage are stored locally for one year. Debug traces expire separately after 30 days. Locked vault activity is hidden and excluded from export and clear. Cache reads and writes appear when reported by the provider.")}</p>
    <AIPricingNote/>
    {data.enrichmentMetrics&&<section aria-label={uiText("Page enrichment efficiency")} className="ai-activity-description">
      <p><strong>{uiText("Page enrichment:")}</strong> {data.enrichmentMetrics.requestsAvoided.toLocaleString(getLocale())}{" " + uiText("local decisions avoided a request ·") + " "}{data.enrichmentMetrics.providerRequests.toLocaleString(getLocale())}{" " + uiText("provider requests ·") + " "}{data.enrichmentMetrics.completedPages.toLocaleString(getLocale())}{" " + uiText("successfully enriched pages.")}</p>
      {data.enrichmentMetrics.estimatedCost!==null&&<p>{uiText("Estimated cost: $")}{data.enrichmentMetrics.estimatedCost.toFixed(6)}{" " + uiText("USD")}{data.enrichmentMetrics.costPerCompletedPage!==null?uiText(" · ${value0} per successfully enriched page",{value0: data.enrichmentMetrics.costPerCompletedPage.toFixed(6)}):''}.</p>}
      <p>{uiText("Recent retained records across unlocked vaults. Cost appears when versioned model rates and provider token counts are available.")}</p>
      {!!data.enrichmentMetrics.reasons.length&&<details><DisclosureSummary>{uiText("Local decision reasons")}</DisclosureSummary><ul>{data.enrichmentMetrics.reasons.map(item=><li key={item.reason}>{item.reason.replaceAll('_',' ')}: {item.count.toLocaleString(getLocale())}</li>)}</ul></details>}
    </section>}
    <div className="ai-activity-toolbar"><button className="button" disabled={busy} onClick={()=>void load()}>{uiText("Refresh")}</button><button className="button" disabled={busy||!data.items.length} onClick={()=>void exportCSV()}>{uiText("Export CSV")}</button><button className="button danger" disabled={busy||!data.items.length} onClick={()=>setConfirmClear(true)}>{uiText("Clear activity")}</button></div>
    {error&&<p role="alert">{error}</p>}
    {message?<SuccessNotice inline message={message} occurrence={messageOccurrence} onDismiss={()=>setMessage('')}/>:<p role="status">{busy?uiText("Loading activity…"):uiText("{value0} records loaded",{value0: visibleItems.length})}</p>}
    <div className="ai-activity-table-wrap" tabIndex={0} role="region" aria-label={uiText("AI activity records")} aria-busy={busy}>
      <table className="ai-activity-table">
        <caption className="sr-only">{uiText("AI activity, newest first")}</caption>
        <thead><tr>{['Started','Action','Status','Source','Model / reasoning','Input bytes','Input tokens','Cached input','Cache writes','Output tokens','Reasoning tokens','Estimated USD','Duration','HTTP','Debug'].map(label=><th scope="col" key={label}>{uiText(label)}</th>)}</tr></thead>
        <tbody>{visibleItems.map(item=><tr key={item.id}>
          <td><time dateTime={item.startedAt}>{new Date(item.startedAt).toLocaleString(getLocale())}</time></td>
          <td>{uiText(aiActivityLabels[item.action])}</td>
          <td><span className={'ai-activity-status '+item.status}>{uiText(item.status)}</span></td>
          <td>{item.objectId?<>
            {item.available?<button className="ai-activity-link ai-activity-title" title={item.objectTitle||uiText("Untitled")} onClick={()=>void open(item)}>{item.objectTitle||uiText("Untitled")}</button>:<span className="ai-activity-title" title={item.objectTitle||uiText("Unavailable page")}>{item.objectTitle||uiText("Unavailable page")}</span>}
          </>:item.action==='text_to_speech'?<span>{uiText("Editor selection")}</span>:item.action==='search_embedding'?<span>{uiText("Vault search")}</span>:<span>{uiText("Settings → Intelligence")}</span>}</td>
          <td className="ai-activity-model">{item.model}{item.action!=='note_embedding'&&item.action!=='search_embedding'&&item.action!=='text_to_speech'&&<small className="ai-activity-reasoning">{item.reasoningEffort==='none'?uiText("no reasoning"):uiText("{value0} reasoning",{value0: item.reasoningEffort})}</small>}</td>
          <td>{item.promptBytes===null?uiText("Not sent"):item.promptBytes.toLocaleString(getLocale())}</td>
          <td>{item.inputTokens==null?'—':item.inputTokens.toLocaleString(getLocale())}</td>
          <td>{item.cachedInputTokens==null?'—':item.cachedInputTokens.toLocaleString(getLocale())}</td>
          <td>{item.cacheWriteTokens==null?'—':item.cacheWriteTokens.toLocaleString(getLocale())}</td>
          <td>{item.outputTokens==null?'—':item.outputTokens.toLocaleString(getLocale())}</td>
          <td>{item.reasoningTokens==null?'—':item.reasoningTokens.toLocaleString(getLocale())}</td>
          <td title={item.pricingVersion?uiText("Pricing: {value0}",{value0: item.pricingVersion}):uiText("Estimate unavailable: missing usage or verified rates")}>{formatEstimatedUSD(item.estimatedCost)}</td>
          <td>{item.durationMs===null?'—':`${(item.durationMs/1000).toFixed(1)}s`}</td>
          <td>{item.httpStatus??'—'}</td>
          <td>{item.debugRecorded?<button className="ai-activity-link" onClick={()=>setDebugId(item.id)}>{uiText("Open payload")}</button>:uiText("Off")}</td>
        </tr>)}</tbody>
      </table>
      {!busy&&!visibleItems.length&&!error&&<p className="ai-activity-empty">{uiText("No matching AI activity.")}</p>}
    </div>
    <footer className="ai-activity-footer">{data.nextCursor!==null&&<button className="button" disabled={busy} onClick={()=>void load(data.nextCursor!)}>{uiText("Load older activity")}</button>}<p>{uiText("Export CSV includes all retained records matching the unpaid activity filter. Clear activity removes all records for unlocked vaults regardless of this filter. Loading older activity pauses auto-refresh.")}</p><button className="button primary" onClick={onClose}>{uiText("Done")}</button></footer>
    </>}
    </div>
  </Modal>;
}
