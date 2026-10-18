import {defaultSourcePageOptions,normalizeSourcePageOptions,type SourcePageOptions} from '../../shared/source-page';

const storageKey='noema-source-page-options';
let sessionOptions:SourcePageOptions={...defaultSourcePageOptions};

/** Remember exposed settings without carrying over source-specific focus. */
export function readSourcePagePreferences():SourcePageOptions {
  try {
    const stored:unknown=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(stored&&typeof stored==='object'&&!Array.isArray(stored))sessionOptions=normalizeSourcePageOptions(stored);
  }catch{/* Keep session preferences when browser storage is unavailable. */}
  return {...sessionOptions};
}
export function rememberSourcePagePreferences(options:SourcePageOptions):void {
  sessionOptions=normalizeSourcePageOptions(options);
  try{localStorage.setItem(storageKey,JSON.stringify(sessionOptions));}catch{/* Generation can continue without persistent browser storage. */}
}
