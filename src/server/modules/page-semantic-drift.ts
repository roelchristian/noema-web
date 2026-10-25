import {createHash} from 'node:crypto';
import {blockEvidence,type BlockEvidence} from './page-block-evidence.js';
import type {Page,Segment} from '../../shared/domain.js';
import {isAIExplanation} from '../../shared/semantic-blocks.js';
import {conceptContentHash} from './summary-content.js';
import {tokenHistogram,compareTokenHistograms,validTokenHistogram,upgradeTokenHistogram} from './token-histogram.js';

export const CLASSIFICATION_VERSION='semantic-drift-v2';
type DriftPage=Pick<Page,'title'|'blocks'>;
type ResolveName=(id:string)=>string|undefined;
export interface CachedPageEmbedding {contentHash:string;vector:number[];model?:string}
export interface ClassificationBaseline {
  blockEvidence?:BlockEvidence;
  version:1|2;contentHash:string;title:string;body:string;headings:string[];
  tokenCounts:Record<string,number>;tokenCount:number;sampled:boolean;embedding?:CachedPageEmbedding;
}
export type DriftReason='unchanged'|'formatting_only'|'insignificant_drift'|'semantic_stable'|'manual_override'|'initial_enrichment'|'significant_drift'|'explicit_refresh';
export interface DriftDecision {needsClassification:boolean;reason:DriftReason;score:number;contentHash:string;cosineSimilarity?:number;newSubjects:string[]}
// Ambiguous words such as field, group and order are deliberately excluded.
const disciplineTerms:Record<string,readonly string[]>={
  mathematics:['algebra','polynomial','theorem','axiom','homomorphism','isomorphism','topology','calculus','matrix','matrices','eigenvalue','integral','derivative','equation','proof'],
  computing:['algorithm','algorithms','compiler','database','programming','software','recursion','runtime','javascript','typescript','encryption','computability'],
  history:['historical','historian','historians','empire','dynasty','medieval','revolution','colonial','chronology','historiography','archaeology'],
  psychology:['psychology','psychological','cognition','cognitive','behavior','behaviour','therapy','trauma','anxiety','perception','memory','conditioning'],
  theology:['theology','theological','christology','trinity','scripture','salvation','liturgy','sacrament','ecclesiology','doctrine','biblical'],
  language:['linguistics','linguistic','grammar','syntax','phonology','morphology','translation','vocabulary','conjugation','declension','phoneme','semantics'],
};
const normalize=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
const tokens=(text:string)=>normalize(text).match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}\p{P}]/gu)??[];
function subjects(text:string):string[] {
  const words=new Set(tokens(text));
  return Object.entries(disciplineTerms).filter(([,terms])=>terms.filter(term=>words.has(term)).length>=2).map(([subject])=>subject);
}
function validEmbedding(value:CachedPageEmbedding|undefined,hash:string):value is CachedPageEmbedding {
  return !!value&&value.contentHash===hash&&value.vector.length>0&&value.vector.length<=4096&&value.vector.every(Number.isFinite);
}
function cosine(a:CachedPageEmbedding|undefined,b:CachedPageEmbedding|undefined):number|undefined {
  if(!a||!b||a.model!==b.model||a.vector.length!==b.vector.length)return undefined;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.vector.length;i++){const x=a.vector[i]!,y=b.vector[i]!;dot+=x*y;aa+=x*x;bb+=y*y;}
  return aa&&bb?Math.max(-1,Math.min(1,dot/Math.sqrt(aa*bb))):undefined;
}
/** Bounded local evidence, kept with the vault. This never invokes an embedding provider. */
export function createClassificationBaseline(page:DriftPage,resolveName:ResolveName=()=>undefined,embedding?:CachedPageEmbedding):ClassificationBaseline {
  const plain=(segments:Segment[])=>segments.map(segment=>segment.entityId?segment.mentionText??resolveName(segment.entityId)??'[mention]':segment.text??'').join('');
  const blocks=page.blocks.filter(block=>!isAIExplanation(block));
  const body=normalize(blocks.map(block=>block.type==='table'||block.type==='columns'?(block.rows??[]).map(row=>row.map(plain).join(' ')).join(' '):plain(block.content)).join(' '));
  const allTokens=tokens(body);
  const contentHash=conceptContentHash(page,resolveName);
  // Include start, middle and end, instead of silently discarding the end of a long note.
  const sampled=body.length>24000;
  const snapshot=sampled?body.slice(0,8000)+' '+body.slice(Math.max(0,Math.floor(body.length/2)-4000),Math.floor(body.length/2)+4000)+' '+body.slice(-8000):body;
  const baseline:ClassificationBaseline={version:2,blockEvidence:blockEvidence(page,resolveName),contentHash,title:normalize(page.title).slice(0,500),body:snapshot,
    headings:blocks.filter(block=>block.type==='heading1'||block.type==='heading2').map(block=>normalize(plain(block.content)).slice(0,300)).slice(0,128),
    tokenCounts:tokenHistogram(allTokens),tokenCount:allTokens.length,sampled,
    ...(validEmbedding(embedding,contentHash)?{embedding:{...embedding,vector:[...embedding.vector]}}:{})};
  return baseline;
}
export function assessSemanticDrift(input:{page:DriftPage;baseline?:ClassificationBaseline;currentDomainIds?:readonly string[];origin?:'manual'|'inferred';explicit?:boolean;embedding?:CachedPageEmbedding;resolveName?:ResolveName}):DriftDecision {
  const current=createClassificationBaseline(input.page,input.resolveName,input.embedding),baseline=input.baseline;
  const decision=(needsClassification:boolean,reason:DriftReason,score=0,extra:Partial<DriftDecision>={}):DriftDecision=>({needsClassification,reason,score,contentHash:current.contentHash,newSubjects:[],...extra});
  if(input.origin==='manual')return decision(false,'manual_override');
  if(input.explicit)return decision(true,'explicit_refresh',1);
  if(!baseline)return decision(true,'initial_enrichment',1);
  if(!validTokenHistogram(baseline))return decision(true,'significant_drift',1);
  if(baseline.contentHash===current.contentHash&&baseline.title===current.title&&JSON.stringify(baseline.headings)===JSON.stringify(current.headings))return decision(false,'unchanged');
  // A changed truncated legacy source has no complete evidence of its prior vocabulary.
  // Neither semantic samples nor embeddings can reconstruct that missing evidence.
  if(!upgradeTokenHistogram(baseline))return decision(true,'significant_drift',1);
  const {score,retainedFraction}=compareTokenHistograms(current,baseline);
  const before=subjects(baseline.body),after=subjects(current.body);
  const represented=(subject:string)=>(input.currentDomainIds??[]).some(id=>id.startsWith(subject)||subject==='computing'&&/computer|computing/.test(id)||subject==='language'&&/lingu|language/.test(id)||subject==='theology'&&/religion|theolog/.test(id));
  const newSubjects=after.filter(subject=>!before.includes(subject)&&!represented(subject));
  const newHeadings=current.headings.filter(heading=>!baseline.headings.includes(heading));
  const headingNovelty=newHeadings.some(heading=>subjects(heading).some(subject=>!before.includes(subject)&&!represented(subject)));
  const titleNovelty=baseline.title!==current.title&&subjects(current.title).some(subject=>!before.includes(subject)&&!represented(subject));
  const similarity=validEmbedding(baseline.embedding,baseline.contentHash)&&validEmbedding(input.embedding,current.contentHash)?cosine(baseline.embedding,input.embedding):undefined;
  const extra={newSubjects,...(similarity===undefined?{}:{cosineSimilarity:similarity})};
  // Strong local evidence of a new discipline wins over a long page's embedding.
  if(headingNovelty||titleNovelty||newSubjects.length>0)return decision(true,'significant_drift',score,extra);
  if(score<0.03)return decision(false,'insignificant_drift',score,extra);
  if(similarity!==undefined&&similarity>=0.97)return decision(false,'semantic_stable',score,extra);
  if(similarity!==undefined&&similarity<0.92&&score>=0.08)return decision(true,'significant_drift',score,extra);
  const sameDiscipline=before.length>0&&after.some(subject=>before.includes(subject));
  // 30% is a candidate signal. Same-discipline expansion retains assignments;
  // major replacement with little retained evidence still gets another look.
  if(score>=0.3&&(!sameDiscipline||retainedFraction<0.25))return decision(true,'significant_drift',score,extra);
  return decision(false,sameDiscipline?'semantic_stable':'insignificant_drift',score,extra);
}
/** Stable diagnostic fingerprint; raw note text must never be written to routine logs. */
export function classificationBaselineFingerprint(baseline:ClassificationBaseline):string {return createHash('sha256').update(baseline.contentHash).digest('hex');}
