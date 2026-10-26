import type {SourceIngestionBlock,SourceIngestionPage,SourceIngestionProvenance} from './source-ingestion.js';
import type {SourceStructureKind,SourceReference} from './domain.js';

/** Offsets are zero-based UTF-16, end-exclusive; lines and physical pages are one-based. */
export interface SourceDocumentRange {
 startOffset:number;endOffset:number;startLine:number;endLine:number;
 startPage:number|null;endPage:number|null;
}
export interface SourceDocumentNode {
 id:string;
 /** Noema-only ordinal; never a printed source number. Assigned locally. */
 appNumber?:string;
 kind:SourceStructureKind|'paragraph'|'code'|'equation'|'list'|'table'|'blockquote'|'footnote';
 range:SourceDocumentRange;
 title?:string;
 level?:number;
 text?:string;
 /** Local rules cannot always establish an exact statement/proof ending. */
 extent?:'explicit'|'inferred';
 /** Additive rich extraction data; geometry remains model-estimated and approximate. */
 ingestion?:{kind:SourceIngestionBlock['kind'];table:SourceIngestionBlock['table'];location:SourceIngestionBlock['location'];uncertainty:string|null;furniture:boolean;continues:string|null};
 children?:SourceDocumentNode[];
}
export interface SourceDocument {
 schemaVersion:1;
 ingestion?:{readingMapping?:{nodes:{originalId:string;readingId:string|null}[];relations:{kind:string;from:string|null;to:string|null;uncertain:boolean}[]};documentId:string;contentHash:string;assemblyVersion:number;relations:{kind:string;from:string;to:string;uncertain:boolean}[];blocks:(SourceIngestionBlock&{immutableId:string})[];pages:SourceIngestionPage[];provenance:SourceIngestionProvenance};
 source:{fileId:string;name:string;title:string;format:string;language:string|null;url:string|null};
 coordinates:{offsets:'zero-based UTF-16, end-exclusive';lines:'one-based extracted text';pages:'one-based physical page order, not printed labels'};
 physical:{pageCount:number|null;pages:{number:number;range:SourceDocumentRange}[]};
 semantic:{kind:'document';children:SourceDocumentNode[]};
 processing:{text:'stored extraction'|'LaTeX cleaned extraction';math?:{format:'LaTeX';originalTextHash:string;uncertain:{line:number;text:string}[]};structure:'stored markers plus local rules';aiEnrichmentStatus:string;aiScope:'bounded excerpts for long sources';inferredExtents:true};
}

/** Semantic paths are shared by citation generation, saved references and the viewer. */
export function sourceDocumentEntries(document:SourceDocument) {
 const entries:{node:SourceDocumentNode;path:SourceDocumentNode[]}[]=[];
 const visit=(nodes:SourceDocumentNode[],parents:SourceDocumentNode[])=>{
  for(const node of nodes){const path=[...parents,node];entries.push({node,path});if(node.children)visit(node.children,path);}
 };
 visit(document.semantic.children,[]);return entries;
}
export function sourceNodeLabel(path:SourceDocumentNode[]) {
 const titles=path.flatMap(node=>node.title?[node.title]:[]);
 const labels=titles.length?titles:path.slice(-1).map(node=>`${node.kind[0]!.toUpperCase()}${node.kind.slice(1)}`);
 return labels.filter((label,index)=>index===0||label!==labels[index-1]).join(' › ');
}

const sectionKinds=new Set(['chapter','section','subsection','heading']);
/** Number semantic siblings in document order, independently of source titles or AI output. */
export function numberSourceNodes(nodes:SourceDocumentNode[],sectionPrefix=''):SourceDocumentNode[] {
 let section=0;
 const counts=new Map<SourceDocumentNode['kind'],number>();
 return nodes.map(node=>{
  const structural=sectionKinds.has(node.kind);
  const ordinal=(counts.get(node.kind)??0)+1;counts.set(node.kind,ordinal);
  const appNumber=structural?[sectionPrefix,++section].filter(Boolean).join('.'):String(ordinal);
  return {...node,appNumber,...(node.children?{children:numberSourceNodes(node.children,structural?appNumber:sectionPrefix)}:{})};
 });
}
const locatorKinds:Record<SourceDocumentNode['kind'],string>={chapter:'§',section:'§',subsection:'§',heading:'§',paragraph:'¶',theorem:'Thm.',lemma:'Lem.',proposition:'Prop.',corollary:'Cor.',definition:'Def.',proof:'Proof',example:'Ex.',remark:'Rem.',code:'Code',equation:'Eq.',list:'List',table:'Table',blockquote:'Quote',footnote:'Note'};
/** A complete app locator retains the semantic scope of locally numbered blocks. */
export function sourceNodeLocator(path:SourceDocumentNode[]):string|undefined {
 if(!path.length||path.some(node=>!node.appNumber))return;
 const section=path.reduce((last,node,index)=>sectionKinds.has(node.kind)?index:last,-1);
 const scoped=path.slice(Math.max(0,section));
 return scoped.filter((node,index)=>{
  // A single prose child is already identified by its statement/proof label.
  const parent=scoped[index-1];
  return !(node.kind==='paragraph'&&parent&&!sectionKinds.has(parent.kind)&&parent.children?.length===1);
 }).map(node=>`${locatorKinds[node.kind]} ${node.appNumber}`).join(' · ');
}

/** Legacy line/offset ranges can span several semantic blocks. Keep both endpoints. */
export function sourceReferenceLocator(entries:ReturnType<typeof sourceDocumentEntries>,reference:Pick<SourceReference,'nodeId'|'startLine'|'endLine'|'startOffset'|'endOffset'>):string|undefined {
 if(reference.nodeId){const entry=entries.find(({node})=>node.id===reference.nodeId);return entry?sourceNodeLocator(entry.path):undefined;}
 const matches=entries.filter(({node})=>{
  if(reference.startOffset!==undefined&&reference.endOffset!==undefined) {
   const end=node.text!==undefined?node.range.endOffset:node.range.startOffset+(node.title?.length??0);
   return node.range.startOffset<reference.endOffset&&end>reference.startOffset;
  }
  return node.range.startLine<=reference.endLine&&(node.text!==undefined?node.range.endLine:node.range.startLine)>=reference.startLine;
 });
 const leaves=matches.filter(({node})=>node.text!==undefined),selected=leaves.length?leaves:matches;
 const first=selected[0],last=selected.at(-1);
 if(!first||!last)return;
 const start=sourceNodeLocator(first.path),end=sourceNodeLocator(last.path);
 if(!start||!end||start===end)return start;
 const prefix=start.match(/^(.*?)(\d+)$/),suffix=end.match(/^(.*?)(\d+)$/);
 if(prefix&&suffix&&prefix[1]===suffix[1])return `${start}–${suffix[2]}`;
 const startParts=start.split(' · '),endParts=end.split(' · ');
 let shared=0;
 while(shared<Math.min(startParts.length,endParts.length)-1&&startParts[shared]===endParts[shared])shared++;
 return `${start}–${endParts.slice(shared).join(' · ')}`;
}
