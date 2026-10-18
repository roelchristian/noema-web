import {defaultSourcePageOptions,sourcePageChoices,sourcePageFormats,type SourcePageOptions} from '../../shared/source-page';

const storageKey='noema-source-page-options';
let sessionOptions:SourcePageOptions={...defaultSourcePageOptions};

/** Remember generation preferences across sources without carrying over source-specific focus. */
export function readSourcePagePreferences():SourcePageOptions {
  try {
    const stored:unknown=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(!stored||typeof stored!=='object'||Array.isArray(stored))return {...sessionOptions};
    const value=stored as Record<string,unknown>,options={...defaultSourcePageOptions};
    for(const key of ['format','detail'] as const) {
      if(typeof value[key]==='string'&&Object.hasOwn(sourcePageChoices[key].options,value[key] as string))Object.assign(options,{[key]:value[key]});
    }
    if(typeof value.language==='string'&&value.language.length<=100)options.language=value.language.trim();
    options.organization=sourcePageFormats[options.format].organization;
    sessionOptions=options;
  }catch{/* Keep session preferences when browser storage is unavailable. */}
  return {...sessionOptions};
}

export function rememberSourcePagePreferences(options:SourcePageOptions):void {
  sessionOptions={...options};
  try{localStorage.setItem(storageKey,JSON.stringify({format:options.format,detail:options.detail,language:options.language}));}catch{/* Generation can continue without persistent browser storage. */}
}
