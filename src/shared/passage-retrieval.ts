import type {SemanticSearchResult} from './embeddings.js';
/** Internal evidence retrieval keeps multiple passages from the same source.
 * Scores are reciprocal-rank fusion scores, not cosine similarities. */
export interface PassageRetrievalResult extends SemanticSearchResult {
 passageId:string;
 lexicalRank?:number;
 semanticRank?:number;
}
