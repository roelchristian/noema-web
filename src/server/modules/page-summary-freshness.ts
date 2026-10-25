import {createHash} from 'node:crypto';
import type {BlockEvidence} from './page-block-evidence.js';
import {summaryInput} from './summary-content.js';
import type {Page} from '../../shared/domain.js';
import {createClassificationBaseline,type ClassificationBaseline} from './page-semantic-drift.js';
import {compareTokenHistograms,validTokenHistogram,type TokenHistogram} from './token-histogram.js';
export type SummaryBaseline=Pick<ClassificationBaseline,'version'|'title'|'tokenCounts'|'tokenCount'|'headings'> & {semanticVersion?:1;orderedContentHash?:string;blockEvidence?:BlockEvidence};
/** Preserve word order, quantities and mathematical operators; ignore presentation punctuation. */
function orderedContentHash(text:string):string {
  const tokens=text.normalize('NFC').match(/[\p{L}\p{N}]+(?:[.,][\p{N}]+)*|[+*−=<>×÷^%∑∏√≤≥≠±\/\-()\[\]{}|]|\p{S}|!(?==)/gu)??[];
  return createHash('sha256').update(JSON.stringify(tokens)).digest('hex');
}
export function summaryBaseline(page:Pick<Page,'title'|'blocks'>,resolve:(id:string)=>string|undefined):SummaryBaseline {
  const classification=createClassificationBaseline(page,resolve);
  const {version,title,tokenCounts,tokenCount,headings,blockEvidence}=classification;
  return {version,title,tokenCounts,tokenCount,headings,semanticVersion:1,orderedContentHash:orderedContentHash(summaryInput(page,resolve,false)),blockEvidence};
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
  // A bag of words cannot establish semantic equivalence. Any uncertain ordered
  // content edit requests a refresh, even when its vocabulary overlap is high.
  const ordered=baseline as typeof baseline & {semanticVersion?:unknown;orderedContentHash?:unknown};
  return comparison.score>=0.1||ordered.semanticVersion!==1||typeof ordered.orderedContentHash!=='string'||ordered.orderedContentHash!==current.orderedContentHash;
}
