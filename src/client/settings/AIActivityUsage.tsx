import { useEffect, useMemo, useState } from 'react';
import { aiActivityLabels, type AIActivity } from '../../shared/intelligence';
import { api } from '../api';
import { Select } from '../components/Select';

type Period = '7' | '30' | '60' | '90' | 'all' | 'custom';
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const number = (value: number) => value.toLocaleString();
const compact = (value: number) => new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value);

export function AIActivityUsage() {
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
    if(period!=='all'&&period!=='custom')from.setDate(from.getDate()-Number(period)+1);
    const until=period==='custom'?new Date(end+'T00:00:00'):new Date(today);until.setDate(until.getDate()+1);
    const filtered=invalid?[]:items.filter(item=>{
      const time=new Date(item.startedAt).getTime();
      return (period==='all'||time>=from.getTime()&&time<until.getTime())&&(action==='all'||item.action===action)&&(status==='all'||item.status===status);
    });
    const sum=(field:'inputTokens'|'outputTokens'|'cachedInputTokens'|'cacheWriteTokens'|'reasoningTokens')=>filtered.reduce((total,item)=>total+(item[field]??0),0);
    const buckets=new Map<string,{input:number;output:number}>();
    // Longer ranges use monthly buckets to keep the timeline readable.
    const first=period==='all'?new Date(Math.min(today.getTime(),...filtered.map(item=>new Date(item.startedAt).getTime()))):from;
    const monthly=(until.getTime()-first.getTime())/86400000>31;
    const key=(date:Date)=>dateKey(date).slice(0,monthly?7:10);
    if(!invalid){
      const date=new Date(first);if(monthly)date.setDate(1);
      while(date<until){buckets.set(key(date),{input:0,output:0});if(monthly)date.setMonth(date.getMonth()+1);else date.setDate(date.getDate()+1);}
    }
    const actions=new Map<string,number>();
    for(const item of filtered){
      const bucket=buckets.get(key(new Date(item.startedAt)));
      if(bucket){bucket.input+=item.inputTokens??0;bucket.output+=item.outputTokens??0;}
      actions.set(item.action,(actions.get(item.action)??0)+(item.inputTokens??0)+(item.outputTokens??0));
    }
    return {filtered,input:sum('inputTokens'),output:sum('outputTokens'),cached:sum('cachedInputTokens'),writes:sum('cacheWriteTokens'),reasoning:sum('reasoningTokens'),reported:filtered.filter(item=>item.inputTokens!=null||item.outputTokens!=null).length,buckets:[...buckets],monthly,actions:[...actions].sort((a,b)=>b[1]-a[1])};
  },[items,period,start,end,action,status,invalid]);
  const maximum=Math.max(1,...summary.buckets.map(([,value])=>value.input+value.output));
  const total=summary.input+summary.output;
  return <section className="ai-usage" aria-label="AI token consumption" aria-busy={busy}>
    <div className="ai-usage-heading"><div><h3>Token consumption</h3></div><button className="button small" disabled={busy} onClick={()=>{setBusy(true);setRevision(value=>value+1);}}>Refresh usage</button></div>
    <div className="ai-usage-filters">
      <div className="ai-usage-period"><span>Period</span><div className="display-options" role="group" aria-label="Usage period">{([{id:'7',label:'7 days'},{id:'30',label:'30 days'},{id:'60',label:'60 days'},{id:'90',label:'90 days'},{id:'all',label:'All'},{id:'custom',label:'Custom'}] as const).map(option=><button type="button" key={option.id} aria-pressed={period===option.id} onClick={()=>setPeriod(option.id)}>{option.label}</button>)}</div></div>
      <label>Action type<Select aria-label="Action type" value={action} onChange={event=>setAction(event.target.value)}><option value="all">All actions</option>{Object.entries(aiActivityLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</Select></label>
      <label>Status<Select aria-label="Status" value={status} onChange={event=>setStatus(event.target.value)}><option value="all">All statuses</option>{['running','completed','failed','interrupted','skipped'].map(value=><option value={value} key={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</Select></label>
    </div>
    {period==='custom'&&<div className="ai-usage-custom"><label>From<input type="date" value={start} max={end} onChange={event=>setStart(event.target.value)}/></label><label>To<input type="date" value={end} min={start} onChange={event=>setEnd(event.target.value)}/></label></div>}
    {invalid&&<p role="alert">Choose a start date on or before the end date.</p>}
    {error&&<p role="alert">{error}</p>}
    <p className="ai-usage-note" role="status">{busy?'Loading all retained activity…':`${number(summary.filtered.length)} matching actions · ${number(summary.reported)} with reported token usage`}</p>
    <div className="ai-usage-stats">{[['Total tokens',total],['Input tokens',summary.input],['Output tokens',summary.output],['Cached input',summary.cached]].map(([label,value])=><div className="ai-usage-stat" key={label}><span>{label}</span><strong title={number(Number(value))}>{number(Number(value))}</strong></div>)}</div>
    <div className="ai-usage-visuals">
    <div className="ai-usage-chart"><div className="ai-usage-chart-heading"><h4>Usage over time <small>{summary.monthly?'Monthly':'Daily'} totals</small></h4><div className="ai-usage-legend"><span><i className="ai-usage-input"/>Input</span><span><i className="ai-usage-output"/>Output</span></div></div>
      {!summary.reported?<p className="ai-activity-empty">{busy?'Loading token usage…':summary.filtered.length?'Token counts have not been reported for these actions.':'No AI activity in this period. Try another period or filter.'}</p>:<>
        <div className="ai-usage-plot"><div className="ai-usage-axis"><span>{compact(maximum)}</span><span>{compact(maximum/2)}</span><span>0</span></div><div className="ai-usage-bars" role="img" aria-label="Stacked input and output token totals over time. Exact values are available in the totals table below.">{summary.buckets.map(([date,value],index)=><div className="ai-usage-column" key={date}><div className="ai-usage-bar" tabIndex={0} aria-label={`${date}: ${number(value.input)} input, ${number(value.output)} output tokens`} title={`${date}\nInput: ${number(value.input)}\nOutput: ${number(value.output)}`}><span className="ai-usage-output" style={{height:`${value.output/maximum*100}%`}}/><span className="ai-usage-input" style={{height:`${value.input/maximum*100}%`}}/></div><span className="ai-usage-date">{index===0||index===summary.buckets.length-1||index%Math.ceil(summary.buckets.length/6)===0?(summary.monthly?date:date.slice(5)):''}</span></div>)}</div></div>
        <details className="ai-usage-details"><summary>View exact {summary.monthly?'monthly':'daily'} totals</summary><div className="ai-usage-totals"><table><thead><tr><th scope="col">Period</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th></tr></thead><tbody>{summary.buckets.map(([date,value])=><tr key={date}><th scope="row">{date}</th><td>{number(value.input)}</td><td>{number(value.output)}</td></tr>)}</tbody></table></div></details>
      </>}
    </div>
    <section className="ai-usage-actions"><h4>Usage by action</h4>{summary.actions.length?summary.actions.map(([key,value])=><div className="ai-usage-action" key={key}><div><span>{aiActivityLabels[key as AIActivity['action']]}</span><strong>{number(value)} <small>tokens</small></strong></div><div className="ai-usage-track"><span style={{width:`${total?value/total*100:0}%`}}/></div></div>):<p className="ai-usage-note">No matching actions.</p>}</section>
    </div>
    <section className="ai-usage-token-details" aria-label="Token details"><dl><div><dt>Cache writes</dt><dd>{number(summary.writes)}</dd></div><div><dt>Reasoning tokens</dt><dd>{number(summary.reasoning)}</dd></div><div><dt>Usage not reported</dt><dd>{number(summary.filtered.length-summary.reported)} actions</dd></div></dl></section>
    <details className="ai-usage-note ai-usage-about"><summary>About these totals · Up to 1,000 retained actions</summary><p>Across unlocked vaults, using local dates. Older activity may no longer be available. Refreshes every 15 seconds. Cached input and reasoning are included in input and output totals when reported by the provider; they are not added again. Missing counts are excluded.</p></details>
  </section>;
}
