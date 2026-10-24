import {getLocale} from '../i18n';
import {t as uiText} from '../i18n';
import {DisclosureSummary} from '../components/DisclosureSummary';
import { useEffect, useMemo, useState } from 'react';
import { aiActivityLabels, type AIActivity } from '../../shared/intelligence';
import {formatEstimatedUSD,isUnpaidActivity} from '../../shared/ai-pricing';
import {AIPricingNote} from './AIPricingNote';
import { api } from '../api';
import { Select } from '../components/Select';

type Period = '7' | '30' | '60' | '90' | 'year' | 'all' | 'custom';
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const number = (value: number) => value.toLocaleString(getLocale());
const compact = (value: number) => new Intl.NumberFormat(getLocale(),{notation:'compact',maximumFractionDigits:1}).format(value);

export function AIActivityUsage({excludeUnpaid=false,onExcludeUnpaidChange}:{excludeUnpaid?:boolean;onExcludeUnpaidChange?:(value:boolean)=>void}={}) {
  const [items,setItems]=useState<AIActivity[]>([]);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [period,setPeriod]=useState<Period>('7');
  const [start,setStart]=useState(()=>dateKey(new Date(Date.now()-6*86400000)));
  const [end,setEnd]=useState(()=>dateKey(new Date()));
  const [action,setAction]=useState('all'),[status,setStatus]=useState('all');
  useEffect(()=>{
    let active=true,loading=false;
    async function refresh() {
      if(loading)return;
      loading=true;
      try {
        const records=new Map<string,AIActivity>();
        let cursor:number|undefined;
        do {
          const page=await api.aiActivity(cursor);
          if(!active)return;
          page.items.forEach(item=>records.set(item.id,item));
          cursor=page.nextCursor??undefined;
        } while(cursor!==undefined);
        setItems([...records.values()]);setError('');
      } catch(error) {
        if(active){setItems([]);setError(error instanceof Error?error.message:'Could not load token usage.');}
      } finally {loading=false;if(active)setBusy(false);}
    }
    void refresh();
    const changed=()=>{void refresh();};
    window.addEventListener('noema:ai-activity',changed);
    const timer=setInterval(changed,15000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('noema:ai-activity',changed);};
  },[revision]);
  const invalid=period==='custom'&&(!start||!end||start>end);
  const summary=useMemo(()=>{
    const today=new Date();today.setHours(0,0,0,0);
    const from=period==='custom'?new Date(start+'T00:00:00'):new Date(today);
    if(period==='year')from.setFullYear(from.getFullYear()-1);
    else if(period!=='all'&&period!=='custom')from.setDate(from.getDate()-Number(period)+1);
    const until=period==='custom'?new Date(end+'T00:00:00'):new Date(today);until.setDate(until.getDate()+1);
    const filtered=invalid?[]:items.filter(item=>{
      const time=new Date(item.startedAt).getTime();
      return (!excludeUnpaid||!isUnpaidActivity(item))&&(period==='all'||time>=from.getTime()&&time<until.getTime())&&(action==='all'||item.action===action)&&(status==='all'||item.status===status);
    });
    const sum=(field:'inputTokens'|'outputTokens'|'cachedInputTokens'|'cacheWriteTokens'|'reasoningTokens')=>filtered.reduce((total,item)=>total+(item[field]??0),0);
    const buckets=new Map<string,{input:number;output:number;cost:number;priced:number;unpriced:number}>();
    // Longer ranges use monthly buckets to keep the timeline readable.
    const first=period==='all'?new Date(Math.min(today.getTime(),...filtered.map(item=>new Date(item.startedAt).getTime()))):from;
    const monthly=(until.getTime()-first.getTime())/86400000>31;
    const key=(date:Date)=>dateKey(date).slice(0,monthly?7:10);
    if(!invalid){
      const date=new Date(first);if(monthly)date.setDate(1);
      while(date<until){buckets.set(key(date),{input:0,output:0,cost:0,priced:0,unpriced:0});if(monthly)date.setMonth(date.getMonth()+1);else date.setDate(date.getDate()+1);}
    }
    const actions=new Map<string,number>();
    const actionCosts=new Map<string,{cost:number;priced:number;unpriced:number}>();
    let cost=0,priced=0;
    for(const item of filtered){
      const hasCost=item.estimatedCost!=null&&Number.isFinite(item.estimatedCost);
      if(hasCost){cost+=item.estimatedCost!;priced++;}
      const actionCost=actionCosts.get(item.action)??{cost:0,priced:0,unpriced:0};
      if(hasCost){actionCost.cost+=item.estimatedCost!;actionCost.priced++;}else actionCost.unpriced++;
      actionCosts.set(item.action,actionCost);
      const bucket=buckets.get(key(new Date(item.startedAt)));
      if(bucket){bucket.input+=item.inputTokens??0;bucket.output+=item.outputTokens??0;if(hasCost){bucket.cost+=item.estimatedCost!;bucket.priced++;}else bucket.unpriced++;}
      actions.set(item.action,(actions.get(item.action)??0)+(item.inputTokens??0)+(item.outputTokens??0));
    }
    return {filtered,cost,priced,actionCosts,input:sum('inputTokens'),output:sum('outputTokens'),cached:sum('cachedInputTokens'),writes:sum('cacheWriteTokens'),reasoning:sum('reasoningTokens'),reported:filtered.filter(item=>item.inputTokens!=null||item.outputTokens!=null).length,buckets:[...buckets],monthly,actions:[...actions].sort((a,b)=>b[1]-a[1])};
  },[items,period,start,end,action,status,invalid,excludeUnpaid]);
  const maximum=Math.max(1,...summary.buckets.map(([,value])=>value.input+value.output));
  const total=summary.input+summary.output;
  return <section className="ai-usage" aria-label={uiText("AI token consumption")} aria-busy={busy}>
    <div className="ai-usage-heading"><div><h3>{uiText("Token consumption")}</h3></div><button className="button small" disabled={busy} onClick={()=>{setBusy(true);setRevision(value=>value+1);}}>{uiText("Refresh usage")}</button></div>
    <div className="ai-usage-filters">
      <div className="ai-usage-period"><span>{uiText("Period")}</span><div className="display-options" role="group" aria-label={uiText("Usage period")}>{([{id:'7',label:uiText("7 days")},{id:'30',label:uiText("30 days")},{id:'60',label:uiText("60 days")},{id:'90',label:uiText("90 days")},{id:'year',label:uiText("1 year")},{id:'all',get label(){return uiText("All")}},{id:'custom',label:uiText("Custom")}] as const).map(option=><button type="button" key={option.id} aria-pressed={period===option.id} onClick={()=>setPeriod(option.id)}>{option.label}</button>)}</div></div>
      <label>{uiText("Action type")}<Select aria-label={uiText("Action type")} value={action} onChange={event=>setAction(event.target.value)}><option value="all">{uiText("All actions")}</option>{Object.entries(aiActivityLabels).map(([value,label])=><option value={value} key={value}>{uiText(label)}</option>)}</Select></label>
      <label>{uiText("Status")}<Select aria-label={uiText("Status")} value={status} onChange={event=>setStatus(event.target.value)}><option value="all">{uiText("All statuses")}</option>{['running','completed','failed','interrupted','skipped'].map(value=><option value={value} key={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</Select></label>
    </div>
    <label className="embedding-toggle"><input type="checkbox" checked={excludeUnpaid} onChange={event=>onExcludeUnpaidChange?.(event.target.checked)}/><span>{uiText("Exclude unpaid activity (Kokoro and DOI metadata lookups)")}</span></label>
    {period==='custom'&&<div className="ai-usage-custom"><label>{uiText("From")}<input type="date" value={start} max={end} onChange={event=>setStart(event.target.value)}/></label><label>{uiText("To")}<input type="date" value={end} min={start} onChange={event=>setEnd(event.target.value)}/></label></div>}
    {invalid&&<p role="alert">{uiText("Choose a start date on or before the end date.")}</p>}
    {error&&<p role="alert">{error}</p>}
    <p className="ai-usage-note" role="status">{busy?uiText("Loading all retained activity…"):uiText("{value0} matching actions · {value1} with reported token usage",{value0: number(summary.filtered.length),value1: number(summary.reported)})}</p>
    <div className="ai-usage-stats">{[['Total tokens',total],['Input tokens',summary.input],['Output tokens',summary.output],['Cached input',summary.cached]].map(([label,value])=><div className="ai-usage-stat" key={label}><span>{label}</span><strong title={number(Number(value))}>{number(Number(value))}</strong></div>)}</div>
    <div className="ai-usage-cost" role="status"><strong>{uiText("Estimated USD")}: {formatEstimatedUSD(summary.priced?summary.cost:summary.filtered.length?null:0)}</strong><span> · {summary.priced.toLocaleString(getLocale())} {uiText("priced actions")} · {(summary.filtered.length-summary.priced).toLocaleString(getLocale())} {uiText("unpriced actions")}{summary.priced>0&&summary.priced<summary.filtered.length?` · ${uiText("Partial estimate")}`:''}</span></div>
    <div className="ai-usage-visuals">
    <div className="ai-usage-chart"><div className="ai-usage-chart-heading"><h4>{uiText("Usage over time") + " "}<small>{summary.monthly?uiText("Monthly"):uiText("Daily")}{" " + uiText("totals")}</small></h4><div className="ai-usage-legend"><span><i className="ai-usage-input"/>{uiText("Input")}</span><span><i className="ai-usage-output"/>{uiText("Output")}</span></div></div>
      {!summary.reported?<p className="ai-activity-empty">{busy?uiText("Loading token usage…"):summary.filtered.length?uiText("Token counts have not been reported for these actions."):uiText("No AI activity in this period. Try another period or filter.")}</p>:<>
        <div className="ai-usage-plot"><div className="ai-usage-axis"><span>{compact(maximum)}</span><span>{compact(maximum/2)}</span><span>0</span></div><div className="ai-usage-bars" role="img" aria-label={uiText("Stacked input and output token totals over time. Exact values are available in the totals table below.")}>{summary.buckets.map(([date,value],index)=><div className="ai-usage-column" key={date}><div className="ai-usage-bar" tabIndex={0} aria-label={uiText("{value0}: {value1} input, {value2} output tokens",{value0: date,value1: number(value.input),value2: number(value.output)})} title={uiText("{value0}\nInput: {value1}\nOutput: {value2}",{value0: date,value1: number(value.input),value2: number(value.output)})}><span className="ai-usage-output" style={{height:`${value.output/maximum*100}%`}}/><span className="ai-usage-input" style={{height:`${value.input/maximum*100}%`}}/></div><span className="ai-usage-date">{index===0||index===summary.buckets.length-1||index%Math.ceil(summary.buckets.length/6)===0?(summary.monthly?date:date.slice(5)):''}</span></div>)}</div></div>
        <details className="ai-usage-details"><DisclosureSummary>{uiText("View exact") + " "}{summary.monthly?uiText("monthly"):uiText("daily")}{" " + uiText("totals")}</DisclosureSummary><div className="ai-usage-totals"><table><thead><tr><th scope="col">{uiText("Period")}</th><th scope="col">{uiText("Input tokens")}</th><th scope="col">{uiText("Output tokens")}</th><th scope="col">{uiText("Estimated USD")}</th><th scope="col">{uiText("Unpriced actions")}</th></tr></thead><tbody>{summary.buckets.map(([date,value])=><tr key={date}><th scope="row">{date}</th><td>{number(value.input)}</td><td>{number(value.output)}</td><td>{formatEstimatedUSD(value.priced?value.cost:value.unpriced?null:0)}</td><td>{number(value.unpriced)}</td></tr>)}</tbody></table></div></details>
      </>}
    </div>
    <section className="ai-usage-actions"><h4>{uiText("Usage by action")}</h4>{summary.actions.length?summary.actions.map(([key,value])=><div className="ai-usage-action" key={key}><div><span>{uiText(aiActivityLabels[key as AIActivity['action']])}</span><strong>{number(value)} <small>{uiText("tokens")}</small></strong></div><p className="ai-usage-note">{uiText("Estimated USD")}: {formatEstimatedUSD(summary.actionCosts.get(key)?.priced?summary.actionCosts.get(key)!.cost:null)} · {number(summary.actionCosts.get(key)?.unpriced??0)} {uiText("unpriced actions")}</p><div className="ai-usage-track"><span style={{width:`${total?value/total*100:0}%`}}/></div></div>):<p className="ai-usage-note">{uiText("No matching actions.")}</p>}</section>
    </div>
    <section className="ai-usage-token-details" aria-label={uiText("Token details")}><dl><div><dt>{uiText("Cache writes")}</dt><dd>{number(summary.writes)}</dd></div><div><dt>{uiText("Reasoning tokens")}</dt><dd>{number(summary.reasoning)}</dd></div><div><dt>{uiText("Usage not reported")}</dt><dd>{number(summary.filtered.length-summary.reported)}{" " + uiText("actions")}</dd></div></dl></section>
    <AIPricingNote report/>
  </section>;
}
