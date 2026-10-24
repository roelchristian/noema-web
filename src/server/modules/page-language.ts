import {HttpError} from '../validation.js';

const languageNames:Record<string,string>={catalan:'ca',coptic:'cop',danish:'da',dutch:'nl',greek:'el','greek (modern, polytonic)':'el-polyton','greek (koine)':'grc','middle english':'enm',occitan:'oc','old english':'ang',russian:'ru',swahili:'sw',swedish:'sv',syriac:'syr',turkish:'tr',ukrainian:'uk',czech:'cs',english:'en',french:'fr',german:'de',japanese:'ja',latin:'la','mandarin chinese (simplified)':'zh-Hans','mandarin chinese (traditional)':'zh-Hant',polish:'pl',portuguese:'pt',spanish:'es',tagalog:'tl'};

/** Persist canonical BCP 47 tags; null means the page language is not known. */
export function pageLanguage(value:unknown):string|null {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>100)throw new HttpError(400,'Invalid page language. Use a BCP 47 language tag.');
  const trimmed=value.trim();if(!trimmed)return null;
  try{return Intl.getCanonicalLocales(languageNames[trimmed.toLowerCase()]??trimmed)[0]??null;}
  catch{throw new HttpError(400,'Invalid page language. Use a BCP 47 language tag.');}
}
