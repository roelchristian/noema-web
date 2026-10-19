/** Source offsets use zero-based UTF-16 positions and an exclusive end. */
export const highlightColors = ['yellow','green','blue','pink','purple'] as const;
export type HighlightColor = typeof highlightColors[number];
export const readingNoteMaxWords = 200;
export function readingNoteWordCount(text:string) {return text.trim().split(/\s+/u).filter(Boolean).length;}
export const readingExplanationFamiliarities={beginner:'Beginner',familiar:'Familiar',expert:'Expert'} as const;
export interface ReadingExplanationOptions {language:string;familiarity:keyof typeof readingExplanationFamiliarities}
export interface SourceSelection {
 sourceId:string;fileId:string;sourceHash:string;startOffset:number;endOffset:number;excerpt:string;
 startLine?:number;endLine?:number;nodeId?:string;contextLabel?:string;appLocator?:string;
}
export interface SourceHighlight extends SourceSelection {id:string;color:HighlightColor;createdAt:string}
export interface ReadingNoteAnchor {pageId:string;title:string;text?:string;sourceHash:string;startOffset:number;endOffset:number}
export interface ReadingNoteMetadata extends Omit<SourceSelection,'sourceId'|'fileId'> {
 explanation?:ReadingExplanationOptions;
 sourceId:string|null;fileId:string|null;startLine:number;endLine:number;createdAt:string;maxWords:200;
}
