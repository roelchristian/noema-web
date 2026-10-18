import type {SourceStructureKind} from './domain.js';

/** Offsets are zero-based UTF-16, end-exclusive; lines and physical pages are one-based. */
export interface SourceDocumentRange {
 startOffset:number;endOffset:number;startLine:number;endLine:number;
 startPage:number|null;endPage:number|null;
}
export interface SourceDocumentNode {
 id:string;
 kind:SourceStructureKind|'paragraph'|'code'|'equation'|'list'|'table'|'blockquote'|'footnote';
 range:SourceDocumentRange;
 title?:string;
 level?:number;
 text?:string;
 /** Local rules cannot always establish an exact statement/proof ending. */
 extent?:'explicit'|'inferred';
 children?:SourceDocumentNode[];
}
export interface SourceDocument {
 schemaVersion:1;
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
