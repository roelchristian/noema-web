import type {Page} from '../../shared/domain.js';
import {createClassificationBaseline,type ClassificationBaseline} from './page-semantic-drift.js';
export type SummaryBaseline=Pick<ClassificationBaseline,'title'|'tokenCounts'|'tokenCount'|'headings'>;
export function summaryBaseline(page:Pick<Page,'title'|'blocks'>,resolve:(id:string)=>string|undefined):SummaryBaseline {
  const {title,tokenCounts,tokenCount,headings}=createClassificationBaseline(page,resolve);
  return {title,tokenCounts,tokenCount,headings};
}
/** Summaries retain their generating baseline so many small edits accumulate. */
export function materiallyStaleSummary(previous:unknown,current:SummaryBaseline):boolean {
  if(!previous||typeof previous!=='object')return true;
  const baseline=previous as Partial<SummaryBaseline>;
  if(typeof baseline.title!=='string'||typeof baseline.tokenCount!=='number'||!baseline.tokenCounts||!Array.isArray(baseline.headings))return true;
  if(baseline.title!==current.title||JSON.stringify(baseline.headings)!==JSON.stringify(current.headings))return true;
  let overlap=0;
  for(const [token,count] of Object.entries(current.tokenCounts))overlap+=Math.min(count,Object.hasOwn(baseline.tokenCounts,token)?baseline.tokenCounts[token]!:0);
  return 1-overlap/Math.max(1,baseline.tokenCount,current.tokenCount)>=0.1;
}
