import {Tiktoken} from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';

let tokenizer:Tiktoken|undefined;
/** The fixed text-embedding-3-small model uses cl100k_base. Count ordinary
 * source text, including literal spellings of special tokens, without a request. */
export function passageTokenCount(text:string):number {
  tokenizer??=new Tiktoken(cl100kBase);
  return tokenizer.encode(text,[],[]).length;
}
