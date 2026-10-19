import type {Page} from '../../shared/domain.js';
import {createClassificationBaseline,type ClassificationBaseline} from './page-semantic-drift.js';
import {compareTokenHistograms,validTokenHistogram,type TokenHistogram} from './token-histogram.js';
export type SummaryBaseline=Pick<ClassificationBaseline,'version'|'title'|'tokenCounts'|'tokenCount'|'headings'>;
export function summaryBaseline(page:Pick<Page,'title'|'blocks'>,resolve:(id:string)=>string|undefined):SummaryBaseline {
  const classification=createClassificationBaseline(page,resolve);
  const {version,title,tokenCounts,tokenCount,headings}=classification;
  return {version,title,tokenCounts,tokenCount,headings};
}
export function validSummaryBaseline(value:unknown):value is TokenHistogram & Pick<SummaryBaseline,'title'|'headings'> {
  if(!validTokenHistogram(value))return false;
  const metadata=value as typeof value & {title?:unknown;headings?:unknown};
  return typeof metadata.title==='string'&&Array.isArray(metadata.headings)&&metadata.headings.every(heading=>typeof heading==='string');
}
/** Summaries retain their generating baseline so many small edits accumulate. */
export function materiallyStaleSummary(previous:unknown,current:SummaryBaseline):boolean {
  // Missing markers are summaries saved with the original raw-token encoding.
  if(!validSummaryBaseline(previous))return true;
  const baseline=previous;
  if(baseline.title!==current.title||JSON.stringify(baseline.headings)!==JSON.stringify(current.headings))return true;
  const comparison=compareTokenHistograms(current,baseline);
  return comparison.score>=0.1;
}
