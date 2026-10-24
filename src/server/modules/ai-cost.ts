import type {AIModelPricing} from '../../shared/intelligence.js';
import {publishedPricingVersion} from '../../shared/ai-pricing.js';

export interface CostUsage {model:string;started_at:string;input_tokens:number|null;output_tokens:number|null;cached_input_tokens:number|null;cache_write_tokens:number|null}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;

/** Reasoning and cache subsets already belong to the provider totals. */
export function estimateActivityCost(row:CostUsage,pricing:AIModelPricing,usage:Record<string,unknown>={}) {
  const rates=pricing.models[row.model],input=row.input_tokens,output=row.output_tokens;
  if(!rates||input===null||output===null)return null;
  const cached=row.cached_input_tokens??0,writes=row.cache_write_tokens??0;
  if(cached+writes>input)return null;
  let cost:number;
  if(rates.audioOutputPerMillion!==undefined){
    const incoming=object(usage.input_tokens_details??usage.input_token_details),outgoing=object(usage.output_tokens_details??usage.output_token_details);
    const textIn=count(incoming.text_tokens),audioIn=count(incoming.audio_tokens),textOut=count(outgoing.text_tokens),audioOut=count(outgoing.audio_tokens);
    // Never apply a text-only rate to an unknown speech modality mix.
    if(textIn===null||audioIn===null||textOut===null||audioOut===null||textIn+audioIn!==input||textOut+audioOut!==output)return null;
    const cache=object(incoming.cached_tokens_details),cachedText=count(cache.text_tokens)??(cached===0?0:null),cachedAudio=count(cache.audio_tokens)??(cached===0?0:null);
    if(cachedText===null||cachedAudio===null||cachedText+cachedAudio!==cached||cachedText>textIn||cachedAudio>audioIn)return null;
    cost=(textIn-cachedText)*rates.inputPerMillion+cachedText*(rates.cachedInputPerMillion??rates.inputPerMillion)+(audioIn-cachedAudio)*(rates.audioInputPerMillion??0)+cachedAudio*(rates.cachedAudioInputPerMillion??rates.audioInputPerMillion??0)+textOut*rates.outputPerMillion+audioOut*rates.audioOutputPerMillion;
  }else{
    const long=rates.longContextThreshold!==undefined&&input>rates.longContextThreshold;
    const geminiIncrease=pricing.version===publishedPricingVersion&&row.model==='gemini-3.8-flash-lite-tts'&&row.started_at>='2027-01-01';
    cost=((input-cached-writes)*rates.inputPerMillion+cached*(rates.cachedInputPerMillion??rates.inputPerMillion)+writes*(rates.cacheWritePerMillion??rates.inputPerMillion))*(long?2:1)+output*rates.outputPerMillion*(long?1.5:1);
    if(geminiIncrease)cost*=2;
  }
  return Number.isFinite(cost)?cost/1000000:null;
}
