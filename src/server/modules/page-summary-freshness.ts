import type {Page} from '../../shared/domain.js';
import {createClassificationBaseline,classificationBaselineTokens,type ClassificationBaseline} from './page-semantic-drift.js';
import {compareTokenHistograms,validTokenHistogram} from './token-histogram.js';
export type SummaryBaseline=Pick<ClassificationBaseline,'version'|'title'|'tokenCounts'|'tokenCount'|'headings'>;
// Full current tokens are needed only to compare a legacy retained vocabulary.
// Keep them out of persisted summary provenance and release them with the baseline.
const rawTokens=new WeakMap<SummaryBaseline,readonly string[]>();
export function summaryBaseline(page:Pick<Page,'title'|'blocks'>,resolve:(id:string)=>string|undefined):SummaryBaseline {
  const classification=createClassificationBaseline(page,resolve);
  const {version,title,tokenCounts,tokenCount,headings}=classification;
  const baseline={version,title,tokenCounts,tokenCount,headings};
  const tokens=classificationBaselineTokens(classification);
  if(tokens)rawTokens.set(baseline,tokens);
  return baseline;
}
/** Summaries retain their generating baseline so many small edits accumulate. */
export function materiallyStaleSummary(previous:unknown,current:SummaryBaseline):boolean {
  if(!previous||typeof previous!=='object'||Array.isArray(previous))return true;
  // Missing markers are summaries saved with the original raw-token encoding.
  if(!validTokenHistogram(previous))return true;
  const baseline=previous as typeof previous & Partial<Pick<SummaryBaseline,'title'|'headings'>>;
  if(typeof baseline.title!=='string'||!Array.isArray(baseline.headings)||baseline.headings.some(heading=>typeof heading!=='string'))return true;
  if(baseline.title!==current.title||JSON.stringify(baseline.headings)!==JSON.stringify(current.headings))return true;
  const comparison=compareTokenHistograms(current,{version:baseline.version,tokenCounts:baseline.tokenCounts,tokenCount:baseline.tokenCount},rawTokens.get(current));
  return comparison.score>=0.1;
}
