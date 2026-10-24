import {speechModel,type AIActivity,type AIModelPricing} from './intelligence.js';

export const publishedPricingVersion='published-2026-10-25-standard';
export const pricingSources={openai:'https://developers.openai.com/api/docs/pricing',gemini:'https://ai.google.dev/gemini-api/docs/pricing'};
// Verified 2026-10-25 against the sources above and each OpenAI /models/<id> page.
// Standard paid API rates in USD / million tokens. Cache writes use the default 30m rate.
const text=(inputPerMillion:number,outputPerMillion:number,cachedInputPerMillion:number)=>({inputPerMillion,outputPerMillion,cachedInputPerMillion,cacheWritePerMillion:inputPerMillion*1.25,longContextThreshold:272000});
export const publishedModelPricing:AIModelPricing={version:publishedPricingVersion,currency:'USD',models:{
  'gpt-6-luna':text(0.1,0.5,0.01),
  'gpt-6.1-sol':text(2,10,0.1),
  'gpt-6-astra':text(10,50,1),
  'gpt-6-sol':text(2,10,0.2),
  'gpt-5.6-luna':text(0.2,1.2,0.02),
  'gpt-5.6-terra':text(2,12,0.2),
  // Published promotional rate; no unannounced future rate is inferred.
  'gpt-5.6-sol':text(4,20,0.4),
  'gpt-5-mini':{inputPerMillion:0.25,outputPerMillion:2,cachedInputPerMillion:0.025},
  'text-embedding-3-small':{inputPerMillion:0.02,outputPerMillion:0},
  // Historical /audio/speech model: text input only, audio output only.
  'gpt-4o-mini-tts':{inputPerMillion:0.6,outputPerMillion:12},
  'gpt-realtime-2.1-mini':{inputPerMillion:0.6,outputPerMillion:2.4,cachedInputPerMillion:0.06,audioInputPerMillion:10,audioOutputPerMillion:20,cachedAudioInputPerMillion:0.3},
  // This wired endpoint accepts text and returns audio only. Published increase starts 2027-01-01.
  'gemini-3.8-flash-lite-tts':{inputPerMillion:0.5,outputPerMillion:6},
}};

export function formatEstimatedUSD(value:number|null|undefined) {return value==null?'—':value>0&&value<0.000001?'<$0.000001':`$${value.toFixed(6)}`;}

/** Classify only known unpaid operations; an unknown price never implies free usage. */
export function isUnpaidActivity(item:Pick<AIActivity,'action'|'model'>) {
  return item.action==='bibliographic_lookup'||item.action==='text_to_speech'&&item.model===speechModel;
}
