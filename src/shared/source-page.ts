import type {Block,Page} from './domain.js';

export const sourcePageBlockTypes=['paragraph','heading1','heading2','bullet','numbered','quote','code','math'] as const;
export interface SourcePageReview {id:string;title:string;blocks:Block[];focus:string}
export type SourcePageEvent =
  | {type:'status';phase:'thinking'|'reviewing'}
  | {type:'title';title:string}
  | {type:'block';block:Block}
  | {type:'review';draft:SourcePageReview}
  | {type:'completed';page:Page}
  | {type:'error';message:string};
