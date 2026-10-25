/** Only safe metadata is retained; provider response bodies never enter retry state. */
export type AIRetryCategory='configuration'|'request'|'capacity'|'transport'|'output_limit'|'response'|'local_admission';
export function providerRetryCategory(status:number):AIRetryCategory {
  if(status===401||status===403)return 'configuration';
  if(status===408||status===429||status>=500)return 'capacity';
  return 'request';
}
export function retryAfterMs(value:string|null,clock=Date.now()):number|undefined {
  if(!value)return undefined;
  const seconds=Number(value),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-clock;
  return Number.isFinite(delay)&&delay>=0?delay:undefined;
}
export function aiRetryPolicy(error:unknown):{category:AIRetryCategory;retryable:boolean;retryAfterMs:number;dispatched:boolean} {
  const e=error&&typeof error==='object'?error as Record<string,unknown>:{};
  const category=typeof e.retryCategory==='string'?e.retryCategory as AIRetryCategory:e.code==='local_admission'?'local_admission':typeof e.providerStatus==='number'?providerRetryCategory(e.providerStatus):error instanceof Error&&typeof e.status!=='number'?'transport':e.status===408||e.status===429||typeof e.status==='number'&&e.status>=500?'capacity':'request';
  return {category,retryable:e.retryable!==false&&['capacity','transport','response','local_admission'].includes(category),retryAfterMs:typeof e.retryAfterMs==='number'&&Number.isFinite(e.retryAfterMs)?Math.max(0,e.retryAfterMs):0,dispatched:category!=='local_admission'};
}
